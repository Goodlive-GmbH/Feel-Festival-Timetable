<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Timetable from '$lib/components/Timetable.svelte';
	import FestivalMap from '$lib/components/FestivalMap.svelte';
	import ImportSchedule from '$lib/components/ImportSchedule.svelte';
	import WelcomeDialog from '$lib/components/WelcomeDialog.svelte';
	import logo from '$lib/assets/logo.svg';
	import birdLogo from '$lib/assets/Bird Feel Festival pink.svg';
	import { db, dbReady } from '$lib/db';
	import type { Stage, Artist, Performance, Poi } from '$lib/types';
	import { PUBLIC_SCHEDULE_IMPORT_MODE } from '$env/static/public';
	import Fuse from 'fuse.js';
	import { selectedPerformanceId, selectedStageId, dbReloadSignal } from '$lib/store';

	const showImport = PUBLIC_SCHEDULE_IMPORT_MODE === 'dragdrop';

	// Switcher string to toggle views
	let activeTab = $state<'schedule' | 'map'>('schedule');
	let importPanelOpen = $state(false);

	// First-visit welcome dialog
	let showWelcome = $state(browser ? localStorage.getItem('welcomeSeen') !== 'true' : false);

	interface BeforeInstallPromptEvent extends Event {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
	}
	let deferredInstallPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let canInstall = $derived(deferredInstallPrompt !== null);

	// iOS Safari doesn't support beforeinstallprompt — detect it to show a manual hint.
	function detectIosInstallable() {
		if (!browser) return false;
		const ua = navigator.userAgent;
		const isIos = /iphone|ipad|ipod/i.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as unknown as { standalone?: boolean }).standalone === true;
		return isIos && isSafari && !isStandalone;
	}
	let showIosInstallHint = $state(browser ? detectIosInstallable() : false);

	function closeWelcome() {
		showWelcome = false;
		if (browser) {
			localStorage.setItem('welcomeSeen', 'true');
		}
	}

	function openWelcome() {
		showWelcome = true;
	}

	async function installPwa() {
		if (!deferredInstallPrompt) return;
		await deferredInstallPrompt.prompt();
		await deferredInstallPrompt.userChoice;
		deferredInstallPrompt = null;
	}

	// View state lifted from Timetable
	function getDefaultView() {
		if (typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches) {
			return 'list';
		}
		return 'grid';
	}
	let viewMode = $state<'grid' | 'list'>(
		browser ? (localStorage.getItem('viewMode') as 'grid' | 'list') || getDefaultView() : getDefaultView()
	);
	let showOnlyFavorites = $state(
		browser ? localStorage.getItem('showOnlyFavorites') === 'true' : false
	);

	$effect(() => {
		if (browser) {
			localStorage.setItem('viewMode', viewMode);
		}
	});

	$effect(() => {
		if (browser) {
			localStorage.setItem('showOnlyFavorites', String(showOnlyFavorites));
		}
	});

	function toggleViewMode() {
		viewMode = viewMode === 'grid' ? 'list' : 'grid';
	}

	function toggleFavorites() {
		showOnlyFavorites = !showOnlyFavorites;
	}

	// Day navigation
	let selectedDayIndex = $state(0);
	let allDays = $derived.by(() => {
		const set = new Set(allPerformances.map(p => new Date(p.startTime).toDateString()));
		return [...set].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
	});
	let selectedDay = $derived(allDays[selectedDayIndex] ?? '');
	let dayLabel = $derived(selectedDay ? new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

	// Separate trigger — only incremented by prev/next buttons, never by scroll callback
	let scrollToIndex = $state(-1);

	function prevDay() {
		const next = selectedDayIndex - 1;
		if (next >= 0) {
			selectedDayIndex = next;
			scrollToIndex = next;
		}
	}
	function nextDay() {
		const next = selectedDayIndex + 1;
		if (next < allDays.length) {
			selectedDayIndex = next;
			scrollToIndex = next;
		}
	}

	// Search State
	let searchQuery = $state('');
	let allArtists = $state<Artist[]>([]);
	let allPerformances = $state<Performance[]>([]);
	let allStages = $state<Stage[]>([]);
	let allPois = $state<Poi[]>([]);
	type SearchItem = (Artist & { performances: Performance[]; _type: 'artist' }) | (Stage & { _type: 'stage' });
	let searchResults = $state<SearchItem[]>([]);
	let isSearchFocused = $state(false);

	let fuseWrapper: any = null;

	async function loadSearchData() {
		await dbReady();
		allArtists = await db.artists.toArray();
		allPerformances = await db.performances.toArray();
		allStages = await db.stages.toArray();
		allPois = await db.pois.toArray();

		const mappedArtists: SearchItem[] = allArtists.map(artist => ({
			...artist,
			_type: 'artist' as const,
			performances: allPerformances.filter(p => p.artistId === artist.id)
		}));

		const mappedStages: SearchItem[] = allStages.map(stage => ({
			...stage,
			_type: 'stage' as const
		}));

		const searchIndex = [...mappedArtists, ...mappedStages];

		fuseWrapper = new Fuse(searchIndex, {
			keys: ['name', 'type', 'genre'],
			threshold: 0.3,
			distance: 100
		});
	}

	$effect(() => {
		$dbReloadSignal;
		loadSearchData();
	});

	onMount(() => {
		loadSearchData();

		const handleBeforeInstall = (e: Event) => {
			e.preventDefault();
			deferredInstallPrompt = e as BeforeInstallPromptEvent;
		};
		const handleInstalled = () => {
			deferredInstallPrompt = null;
		};
		window.addEventListener('beforeinstallprompt', handleBeforeInstall);
		window.addEventListener('appinstalled', handleInstalled);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
			window.removeEventListener('appinstalled', handleInstalled);
		};
	});

	function handleSearchInput(e: Event) {
		const val = (e.target as HTMLInputElement).value;
		searchQuery = val;
		if (val.trim() === '') {
			searchResults = [];
		} else if (fuseWrapper) {
			searchResults = fuseWrapper.search(val).map((res: any) => res.item).slice(0, 5);
		}
		// Clear stage selection when user starts typing a new search
		selectedStageId.set(null);
	}

	function openStageInSchedule(stageId: string) {
		selectedStageId.set(stageId);
		activeTab = 'schedule';
	}

	function selectSearchResult(result: SearchItem) {
		if (result._type === 'artist' && result.performances.length > 0) {
			const firstPerf = result.performances[0];
			selectedPerformanceId.set(firstPerf.id);
			const perfDay = new Date(firstPerf.startTime).toDateString();
			const dayIndex = allDays.indexOf(perfDay);
			if (dayIndex >= 0) {
				selectedDayIndex = dayIndex;
				scrollToIndex = dayIndex;
			}
		} else if (result._type === 'stage') {
			selectedStageId.set(result.id);
		}

		// If map is open, gently swap back to the schedule view
		if (activeTab !== 'schedule') {
			activeTab = 'schedule';
		}

		// Clear search menu and input
		searchQuery = '';
		searchResults = [];
		isSearchFocused = false;
	}

	function clearStageFilter() {
		selectedStageId.set(null);
	}
</script>

{#if showWelcome}
	<WelcomeDialog onclose={closeWelcome} {canInstall} oninstall={installPwa} {showIosInstallHint} />
{/if}

<div class="h-[100dvh] w-screen flex flex-col overflow-hidden bg-fest-text text-fest-widget selection:bg-fest-blue relative">
	<!-- App Header / Search Bar -->
	<header class="h-16 border-b border-fest-teal bg-fest-text/95 backdrop-blur-md flex items-center px-4 justify-between z-[80] shadow-md shrink-0 relative">
		<h1 class="flex shrink-0 items-center gap-2">
			<a href="https://feel-festival.de/" target="_blank" rel="noopener noreferrer">
				<img src={logo} alt="FEST" class="h-8 w-auto md:hidden" />
				<img src={birdLogo} alt="FEST" class="hidden h-10 w-auto md:block" />
			</a>
		</h1>

		<div class="flex items-center gap-2">
			<div class="flex items-center gap-1">
				{#if showImport}
					<button
						class="fest-button flex h-8 items-center rounded-full px-2 text-xs"
						style="background-color: {importPanelOpen ? 'var(--color-fest-logo)' : 'var(--color-fest-teal)'};"
						title="Import Schedule"
						onclick={() => (importPanelOpen = !importPanelOpen)}
					>
						{importPanelOpen ? '✕' : '📥'}
					</button>
				{/if}

				<button
					class="fest-button flex h-8 items-center justify-center rounded-full px-2 text-sm font-bold normal-case italic leading-none"
					style="background-color: var(--color-fest-green-teal);"
					title="Info"
					aria-label="Info"
					onclick={openWelcome}
				>
					i
				</button>

				<button
					class="fest-button flex h-8 items-center rounded-full px-2.5 text-xs {showOnlyFavorites ? '!text-fest-widget' : ''}"
					style="background-color: {showOnlyFavorites ? 'var(--color-fest-logo)' : 'var(--color-fest-green-teal)'};"
					onclick={toggleFavorites}
				>
					{showOnlyFavorites ? '♥\uFE0E All' : '♡\uFE0E Fav'}
				</button>

				<button
					class="fest-button flex h-8 items-center rounded-full px-2.5 text-xs {viewMode === 'grid' ? '!text-fest-widget' : ''}"
					style="background-color: {viewMode === 'grid' ? 'var(--color-fest-logo)' : 'var(--color-fest-green-teal)'};"
					title="Toggle View Mode"
					onclick={toggleViewMode}
				>
					{viewMode === 'grid' ? '☰ List' : '▦ Grid'}
				</button>
			</div>
			
			<div class="search-wrap w-28 md:w-36 hover:w-40 md:hover:w-44 focus-within:w-48 md:focus-within:w-72 min-w-0 transition-all duration-300 ease-in-out relative">
			<input 
				type="text" 
				placeholder="Search..." 
				class="w-full h-8 bg-fest-dark-teal border border-fest-teal rounded-full pl-4 pr-10 focus:outline-none focus:ring-2 focus:ring-fest-blue text-sm placeholder-fest-teal text-fest-widget"
				value={searchQuery}
				oninput={handleSearchInput}
				onfocus={() => isSearchFocused = true}
				onblur={() => setTimeout(() => isSearchFocused = false, 200)}
			/>
			<svg class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fest-turquoise pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
			
			<!-- Search Results Dropdown -->
			{#if isSearchFocused && searchResults.length > 0}
				<div class="absolute top-full mt-2 w-full bg-fest-dark-teal border border-fest-teal rounded-xl shadow-2xl overflow-hidden flex flex-col z-[100]">
					{#each searchResults as result}
						{#if result._type === 'stage'}
							<button 
								class="text-left px-4 py-2 text-sm hover:bg-fest-teal border-b border-fest-teal/50 last:border-none focus:bg-fest-teal outline-none flex justify-between items-center transition-colors text-fest-widget"
								onclick={() => selectSearchResult(result)}
							>
								<span class="font-bold text-fest-cyan truncate pr-2 flex items-center gap-2">
									<span>●</span> {result.name}
								</span>
								<span class="text-[10px] text-fest-teal flex-shrink-0">Stage</span>
							</button>
						{:else}
							{#each result.performances as perf}
								<button 
									class="text-left px-4 py-2 text-sm hover:bg-fest-teal border-b border-fest-teal/50 last:border-none focus:bg-fest-teal outline-none flex justify-between items-center transition-colors text-fest-widget"
									onclick={() => selectSearchResult(result)}
								>
									<span class="font-bold text-fest-logo truncate pr-2">{result.name}</span>
									<span class="text-[10px] text-fest-turquoise flex-shrink-0">
										{new Date(perf.startTime).toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}
									</span>
								</button>
							{/each}
							
							{#if result.performances.length === 0}
								<div class="px-4 py-2 text-sm border-b border-fest-teal/50 last:border-none text-fest-teal italic">
									{result.name} <span class="text-[10px] opacity-70">(No timeslot)</span>
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			{/if}
		</div>
		</div>
	</header>

	<!-- Import Panel (preview/dev only) -->
	{#if showImport && importPanelOpen}
		<div class="shrink-0 border-b border-fest-teal bg-fest-dark-teal/80 backdrop-blur-sm px-4 py-3">
			<ImportSchedule />
		</div>
	{/if}

	<!-- Main Viewport -->
	<main class="flex-1 overflow-hidden relative">
		{#if activeTab === 'schedule'}
			<Timetable {viewMode} {showOnlyFavorites} {selectedDay} {scrollToIndex} ondayvisible={(i: number) => selectedDayIndex = i} onprevday={prevDay} onnextday={nextDay} />
		{:else}
			<FestivalMap
				stages={allStages}
				artists={allArtists}
				performances={allPerformances}
				pois={allPois}
				onstageselect={openStageInSchedule}
			/>
		{/if}

		<!-- Stage filter chip -->
		{#if $selectedStageId}
			{@const stage = allStages.find(s => s.id === $selectedStageId)}
			<div class="absolute top-2 {viewMode === 'list' ? 'right-2' : 'left-1/2 -translate-x-1/2'} z-[70] flex items-center gap-2 bg-fest-dark-teal/90 backdrop-blur-sm border border-fest-cyan rounded-full px-3 py-1 shadow-lg">
				<span class="text-xs text-fest-cyan font-bold">● {$selectedStageId ? stage?.name ?? 'Stage' : ''}</span>
				<button class="text-fest-widget/60 hover:text-fest-widget text-lg leading-none" onclick={clearStageFilter}>×</button>
			</div>
		{/if}
	</main>

	<!-- Bottom Navigation Bar (PWA standard for mobile) -->
	<nav class="h-16 shrink-0 bg-fest-text border-t border-fest-teal flex items-center z-50 max-w-full">
		<button 
			class="flex-1 h-full flex flex-col items-center justify-center gap-1 transition-colors {activeTab === 'schedule' ? 'text-fest-blue font-bold bg-fest-dark-teal/50' : 'text-fest-turquoise hover:text-fest-widget'}"
			onclick={() => activeTab = 'schedule'}
		>
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="{activeTab === 'schedule' ? '2' : '1.5'}" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
			<span class="text-[10px] uppercase tracking-wider">Schedule</span>
		</button>

		<button 
			class="flex-1 h-full flex flex-col items-center justify-center gap-1 transition-colors {activeTab === 'map' ? 'text-fest-blue font-bold bg-fest-dark-teal/50' : 'text-fest-turquoise hover:text-fest-widget'}"
			onclick={() => activeTab = 'map'}
		>
			<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="{activeTab === 'map' ? '2' : '1.5'}" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
			<span class="text-[10px] uppercase tracking-wider">Map</span>
		</button>
	</nav>
</div>

