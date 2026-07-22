<script lang="ts">
	import { onMount } from 'svelte';
	import Lenis from 'lenis';
	import { db, dbReady } from '$lib/db';
	import type { Stage, Artist, Performance } from '$lib/types';
	import { selectedPerformanceId, selectedStageId, dbReloadSignal } from '$lib/store';
	import PerformanceDetail from './PerformanceDetail.svelte';
	import { SHOW_GENRE } from '$lib/featureFlags';

	let stages = $state<Stage[]>([]);
	let artists = $state<Artist[]>([]);
	let performances = $state<Performance[]>([]);

	// Filters & Views (passed from parent)
	let { viewMode = 'grid', showOnlyFavorites = false, selectedDay = '', scrollToIndex = -1, ondayvisible = (_i: number) => {}, onprevday = (_e: MouseEvent) => {}, onnextday = (_e: MouseEvent) => {} } = $props();

	let allDays = $derived(
		[...new Set(performances.map(p => new Date(p.startTime).toDateString()))].sort(
			(a, b) => new Date(a).getTime() - new Date(b).getTime()
		)
	);

	function scrollToDayIndex(idx: number) {
		if (idx < 0 || idx >= allDays.length || viewMode !== 'grid' || !timetableContainerEl) return;
		ondayvisible(idx);
		const dayMs = new Date(allDays[idx]).getTime();
		const chunkMs = 1000 * 60 * CHUNK_SIZE_MINUTES;
		const pixels = 120 + ((dayMs - gridStart) / chunkMs) * chunkPixelSize;
		timetableContainerEl.scrollTo({ left: Math.max(0, pixels - 120), behavior: 'smooth' });
	}

	$effect(() => {
		if (scrollToIndex < 0 || scrollToIndex >= allDays.length || viewMode !== 'grid') return;
		scrollToDayIndex(scrollToIndex);
	});

	// Day indicator derived values (grid view)
	let currDayIdx = $derived(allDays.findIndex(d => d === selectedDay));
	let hasPrevDay = $derived(currDayIdx > 0);
	let hasNextDay = $derived(currDayIdx >= 0 && currDayIdx < allDays.length - 1);
	let nextDayLabel = $derived(hasNextDay
		? new Date(allDays[currDayIdx + 1]).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
		: ''
	);
	let prevDayLabel = $derived(hasPrevDay
		? new Date(allDays[currDayIdx - 1]).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
		: ''
	);

	function onGridScroll() {
		if (!timetableContainerEl || allDays.length <= 1 || viewMode !== 'grid') return;
		const sl = timetableContainerEl.scrollLeft;
		const cw = timetableContainerEl.clientWidth;
		const centerPx = sl + cw / 2;
		const chunkMs = 1000 * 60 * CHUNK_SIZE_MINUTES;
		const timeAtCenter = gridStart + ((centerPx - 120) / chunkPixelSize) * chunkMs;
		let idx = 0;
		for (let i = 0; i < allDays.length; i++) {
			if (timeAtCenter >= new Date(allDays[i]).getTime()) idx = i;
		}
		ondayvisible(idx);
	}

	async function loadData() {
		await dbReady();
		stages = (await db.stages.toArray()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		artists = await db.artists.toArray();
		performances = await db.performances.toArray();
	}

	$effect(() => {
		$dbReloadSignal;
		loadData();
	});

	// Grid State
	const CHUNK_SIZE_MINUTES = 15;
	const MAX_CHUNK_PX = 60;
	let chunkPixelSize = $state(20);
	let rawGridStart = $derived(performances.length > 0
		? Math.min(...performances.map(p => new Date(p.startTime).getTime())) - 60 * 60 * 1000
		: Date.now() - 12 * 60 * 60 * 1000
	);
	let rawGridEnd = $derived(performances.length > 0
		? Math.max(...performances.map(p => new Date(p.endTime).getTime())) + 60 * 60 * 1000
		: Date.now() + 12 * 60 * 60 * 1000
	);
	let gridStart = $derived(Math.floor(rawGridStart / (60 * 60 * 1000)) * (60 * 60 * 1000));
	let gridEnd = $derived(Math.ceil(rawGridEnd / (60 * 60 * 1000)) * (60 * 60 * 1000));
	let totalChunks = $derived(Math.ceil((gridEnd - gridStart) / (1000 * 60 * CHUNK_SIZE_MINUTES)));
	let rowHeight = $state(70);

	let minChunkPx = $derived(Math.max(30, Math.round(18 - (rowHeight - 60) * (8 / 60))));

	$effect(() => {
		if (chunkPixelSize < minChunkPx) {
			chunkPixelSize = minChunkPx;
		}
	});

	let timeHeaders = $derived(Array.from({ length: totalChunks }, (_, i) => {
		const time = new Date(gridStart + i * CHUNK_SIZE_MINUTES * 60 * 1000);
		return time.getMinutes() === 0 ? time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
	}));

	// Pinch-to-zoom state
	let initialPinchDist = 0;
	let initialChunkPx = 20;
	let pinchActive = false;
	let initialScrollLeft = 0;
	let pinchCenterX = 0;

	// Swipe state (list view)
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeStartTime = 0;

	function handleListTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		swipeStartX = e.touches[0].clientX;
		swipeStartY = e.touches[0].clientY;
		swipeStartTime = Date.now();
	}

	function handleListTouchMove(e: TouchEvent) {
		if (swipeStartX === 0 || e.touches.length !== 1) return;
		const dx = e.touches[0].clientX - swipeStartX;
		const dy = e.touches[0].clientY - swipeStartY;
		if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
			e.preventDefault();
		}
	}

	function handleListTouchEnd(e: TouchEvent) {
		if (swipeStartX === 0) return;
		const dx = e.changedTouches[0].clientX - swipeStartX;
		const dt = Date.now() - swipeStartTime;

		if (Math.abs(dx) > 50 && dt < 300) {
			if (dx > 0) {
				onprevday();
			} else {
				onnextday();
			}
		}
		swipeStartX = 0;
	}

	function setChunkPixelSize(px: number) {
		chunkPixelSize = Math.max(minChunkPx, Math.min(MAX_CHUNK_PX, px));
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			pinchActive = true;
			lenis?.stop();
			initialPinchDist = Math.hypot(
				e.touches[0].clientX - e.touches[1].clientX,
				e.touches[0].clientY - e.touches[1].clientY
			);
			initialChunkPx = chunkPixelSize;
			initialScrollLeft = timetableContainerEl?.scrollLeft ?? 0;
			const rect = timetableContainerEl?.getBoundingClientRect();
			pinchCenterX = rect ? (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left : 0;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2 && pinchActive) {
			e.preventDefault();
			const dist = Math.hypot(
				e.touches[0].clientX - e.touches[1].clientX,
				e.touches[0].clientY - e.touches[1].clientY
			);
			const newPx = Math.round(initialChunkPx * (dist / initialPinchDist));
			setChunkPixelSize(newPx);
			// Adjust scroll to keep content under pinch center stationary
			const ratio = chunkPixelSize / initialChunkPx;
			const newScrollLeft = Math.round((initialScrollLeft + pinchCenterX) * ratio - pinchCenterX);
			if (timetableContainerEl) {
				timetableContainerEl.scrollLeft = Math.max(0, newScrollLeft);
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (pinchActive && e.touches.length < 2) {
			pinchActive = false;
			lenis?.start();
		}
	}

	// Dynamic row height
	function updateRowHeight() {
		if (stages.length > 0 && timetableContainerEl) {
			const h = timetableContainerEl.clientHeight;
			rowHeight = Math.max(60, Math.floor(Math.max(0, h - 44) / stages.length));
		}
	}

	$effect(() => {
		stages.length;
		updateRowHeight();
	});

	// "Now" Indicator State
	let nowPixels = $state(0);
	let nowInView = $state(false);
	let nowBehindSticky = $state(false);
	let animationFrameId: number;
	let lenisRafId: number;
	let timetableContainerEl: HTMLDivElement | null = null;
	let timetableContentEl: HTMLDivElement | null = null;
	let lenis: Lenis | null = null;

	function updateNowLine() {
		const now = Date.now();
		if (now > gridStart && now < gridEnd) {
			// Calculate the exact pixel position of "Now" relative to the grid start
			// +120px offset for the Stage names column
			nowPixels = 120 + ((now - gridStart) / (1000 * 60 * CHUNK_SIZE_MINUTES)) * chunkPixelSize;
			if (timetableContainerEl) {
				const sl = timetableContainerEl.scrollLeft;
				const cw = timetableContainerEl.clientWidth;
				nowInView = nowPixels >= sl + 120 && nowPixels <= sl + cw;
				nowBehindSticky = nowPixels < sl + 120;
			}
		} else {
			nowPixels = -100; // Hide offscreen if outside of bounds
			nowInView = false;
			nowBehindSticky = false;
		}
		animationFrameId = requestAnimationFrame(updateNowLine);
	}

	onMount(() => {
		let ro: ResizeObserver | null = null;
		if (timetableContainerEl && timetableContentEl) {
			ro = new ResizeObserver(updateRowHeight);
			ro.observe(timetableContainerEl);
			lenis = new Lenis({
				wrapper: timetableContainerEl,
				content: timetableContentEl,
				smoothWheel: true,
				gestureOrientation: 'vertical',
				wheelMultiplier: 0.9,
				touchMultiplier: 1.05
			});

			const lenisRaf = (time: number) => {
				lenis?.raf(time);
				lenisRafId = requestAnimationFrame(lenisRaf);
			};

			lenisRafId = requestAnimationFrame(lenisRaf);
		}

		(async () => {
			await loadData();
		})();

		// Watch the selected store
		const unsub = selectedPerformanceId.subscribe(id => {
			if (id) {
				requestAnimationFrame(() => {
					const el = document.getElementById(`perf-${id}`) ?? document.getElementById(`list-perf-${id}`);
					if (el) {
						el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
					}
				});
			}
		});

		updateNowLine();

		return () => {
			unsub();
			ro?.disconnect();
			if (lenisRafId) {
				cancelAnimationFrame(lenisRafId);
			}
			lenis?.destroy();
			lenis = null;
			cancelAnimationFrame(animationFrameId);
		};
	});

	function getArtistName(id: string): string {
		return artists.find(a => a.id === id)?.name || 'Unknown Artist';
	}

	function hashVariant(name: string, mod: number): number {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = ((hash << 5) - hash) + name.charCodeAt(i);
			hash |= 0;
		}
		return Math.abs(hash) % mod;
	}

	function getDayBgColor(dayStr: string): string {
		const day = new Date(dayStr).getDay();
		switch (day) {
			case 4: return '#2232b4';
			case 5: return '#64cfce';
			case 6: return '#2232b4';
			case 0: return '#64cfce';
			case 1: return '#2232b4';
			default: return '#2232b4';
		}
	}

	function getGridCardStyle(artistId: string, perfType: string | undefined, stageIndex: number): { card: string; text: string; genre: string } {
		const artist = artists.find(a => a.id === artistId);
		const type = (perfType || artist?.type || '').toLowerCase();
		const isEvenRow = stageIndex % 2 === 0;

		if (type === 'dj') {
			return {
				card: isEvenRow ? 'bg-[#ede9c3] text-fest-text' : 'bg-[#f1f296] text-fest-text',
				text: 'text-fest-text',
				genre: 'text-fest-text/70'
			};
		}
		if (type === 'live') {
			return {
				card: 'bg-[#f59f5b] text-fest-text',
				text: 'text-fest-text',
				genre: 'text-fest-text/70'
			};
		}
		return {
			card: isEvenRow ? 'bg-[#f8b7c4] text-fest-text' : 'bg-[#f7e0e4] text-fest-text',
			text: 'text-fest-text',
			genre: 'text-fest-text/70'
		};
	}

	function exactCardStyle(perf: Performance) {
		const start = new Date(perf.startTime).getTime();
		const end = new Date(perf.endTime).getTime();
		const chunkMs = 1000 * 60 * CHUNK_SIZE_MINUTES;
		const left = 120 + ((start - gridStart) / chunkMs) * chunkPixelSize;
		const width = ((end - start) / chunkMs) * chunkPixelSize;
		return { left: `${left}px`, width: `${width}px` };
	}

	async function toggleFavorite(e: MouseEvent, artistId: string) {
		e.stopPropagation();
		const artist = artists.find(a => a.id === artistId);
		if (artist) {
			const updatedStatus = !artist.isFavorite;
			artists = artists.map(a => a.id === artistId ? { ...a, isFavorite: updatedStatus } : a);
			await db.artists.update(artistId, { isFavorite: updatedStatus });
		}
	}

	// Detail dialog: only opened for performances that carry an info text
	let detailPerformanceId = $state<string | null>(null);
	let detailPerformance = $derived(
		detailPerformanceId ? performances.find(p => p.id === detailPerformanceId) ?? null : null
	);
	let detailArtist = $derived(
		detailPerformance ? artists.find(a => a.id === detailPerformance!.artistId) : undefined
	);
	let detailStage = $derived(
		detailPerformance ? stages.find(s => s.id === detailPerformance!.stageId) : undefined
	);
	let detailStyle = $derived(
		detailPerformance
			? getGridCardStyle(
					detailPerformance.artistId,
					detailPerformance.type,
					stages.findIndex(s => s.id === detailPerformance!.stageId)
				)
			: null
	);

	function openDetail(perf: Performance) {
		if (!perf.info) return;
		detailPerformanceId = perf.id;
	}

	function closeDetail() {
		detailPerformanceId = null;
	}

	let filteredPerformances = $derived(
		showOnlyFavorites
			? performances.filter(p => artists.find(a => a.id === p.artistId)?.isFavorite)
			: performances
	);

	// Day-filtered performances used in list view
	let listPerformances = $derived(
		selectedDay
			? filteredPerformances.filter(p => new Date(p.startTime).toDateString() === selectedDay)
			: filteredPerformances
	);

	// Sort chronologically for the List View
	let sortedPerformances = $derived(
		[...listPerformances]
			.filter(p => !$selectedStageId || p.stageId === $selectedStageId)
			.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
	);

	function jumpToNow() {
		if (nowPixels > 0 && viewMode === 'grid') {
			const container = document.querySelector('.timetable-container');
			if (container) {
				const containerWidth = container.clientWidth;
				// Center the "now" line in the viewport
				container.scrollTo({
					left: nowPixels - containerWidth / 2,
					behavior: 'smooth'
				});
			}
		}
	}
</script>

<!-- Outer Wrapper so absolute/actions don't move inside the scrolling container itself if it's the body -->
<div class="relative w-full h-full">
	{#if allDays.length > 1}
		{#if viewMode === 'grid'}
			<div class="absolute z-[70] flex items-start" style="top: 0; left: calc(120px + 8px); height: 44px;">
				<div class="flex items-center gap-1 bg-fest-text/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
					{#if hasPrevDay}
						<button class="text-[10px] font-bold text-fest-turquoise hover:text-fest-widget"
							onclick={() => scrollToDayIndex(currDayIdx - 1)}>
							◀&#xFE0E;{prevDayLabel}
						</button>
					{/if}
					<button class="text-[10px] font-bold text-fest-widget hover:text-fest-turquoise whitespace-nowrap cursor-pointer"
						title="Scroll to start of day"
						onclick={() => scrollToDayIndex(currDayIdx)}>
						{selectedDay ? new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
					</button>
					{#if hasNextDay}
						<button class="text-[10px] font-bold text-fest-turquoise hover:text-fest-widget"
							onclick={() => scrollToDayIndex(currDayIdx + 1)}>
							▶&#xFE0E;
						</button>
					{/if}
				</div>
			</div>
			{#if hasNextDay}
				<div class="absolute z-[70] flex items-start pointer-events-none" style="top: 0; right: 8px; height: 44px;">
					<button class="text-[10px] font-bold text-fest-turquoise hover:text-fest-widget pointer-events-auto flex items-center gap-1 bg-fest-text/80 backdrop-blur-sm px-1.5 py-0.5 rounded"
						onclick={() => scrollToDayIndex(currDayIdx + 1)}>
						{nextDayLabel} ▶&#xFE0E;
					</button>
				</div>
			{/if}
		{:else}
			<div class="absolute z-[70] flex items-start" style="top: 0; left: 50%; transform: translateX(-50%);">
				<div class="flex items-center gap-1 bg-fest-text/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
					{#if hasPrevDay}
						<button class="text-[10px] font-bold text-fest-turquoise hover:text-fest-widget"
							onclick={() => onprevday()}>
							◀&#xFE0E;{prevDayLabel}
						</button>
					{/if}
					<button class="text-[10px] font-bold text-fest-widget hover:text-fest-turquoise whitespace-nowrap cursor-pointer">
						{selectedDay ? new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
					</button>
					{#if hasNextDay}
						<button class="text-[10px] font-bold text-fest-turquoise hover:text-fest-widget"
							onclick={() => onnextday()}>
							▶&#xFE0E;{nextDayLabel}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
	{#if !nowInView && nowPixels > 0 && viewMode === 'grid'}
		<div class="absolute top-2 z-[70] -translate-x-1/2 opacity-60 hover:opacity-100 transition-opacity" style="left: calc(120px + (100% - 120px) / 2);">
			<button class="fest-button text-xs py-1 px-3 !bg-fest-cyan" onclick={jumpToNow}>
				Jump to Now
			</button>
		</div>
	{/if}

	<div bind:this={timetableContainerEl} role="application" class="timetable-container absolute inset-0 overflow-auto text-fest-widget"
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		ontouchcancel={handleTouchEnd}
		onscroll={onGridScroll}
	>
		<div bind:this={timetableContentEl} class="timetable-scroll-content" style="position: relative; min-height: 100%; {viewMode === 'grid' ? 'min-width: ' + (120 + totalChunks * chunkPixelSize) + 'px' : 'min-width: 0'}">
		{#if viewMode === 'grid'}
			<!-- Day background colors -->
			{#each allDays as day}
				{@const chunkMs = 1000 * 60 * CHUNK_SIZE_MINUTES}
				{@const dayStartMs = new Date(day).setHours(0,0,0,0)}
				{@const dayEndMs = dayStartMs + 86400000}
				{@const bgLeftMs = Math.max(dayStartMs, gridStart)}
				{@const bgRightMs = Math.min(dayEndMs, gridEnd)}
				{@const dayLeft = 120 + ((bgLeftMs - gridStart) / chunkMs) * chunkPixelSize}
				{@const dayWidth = ((bgRightMs - bgLeftMs) / chunkMs) * chunkPixelSize}
				{#if dayWidth > 0}
					<div class="absolute top-0 pointer-events-none" style="left: {dayLeft}px; width: {dayWidth}px; height: 100%; background-color: {getDayBgColor(day)}; z-index: 0;"></div>
				{/if}
			{/each}
			<!-- Midnight markers (23:45-00:15) -->
			{#each allDays as day, i}
				{#if i > 0}
					{@const chunkMs = 1000 * 60 * CHUNK_SIZE_MINUTES}
					{@const midnightMs = new Date(day).setHours(0,0,0,0)}
					{@const markerLeft = 120 + ((midnightMs - 15 * 60 * 1000 - gridStart) / chunkMs) * chunkPixelSize}
					{@const markerWidth = ((30 * 60 * 1000) / chunkMs) * chunkPixelSize}
					<div class="absolute top-0 pointer-events-none" style="left: {markerLeft}px; width: {markerWidth}px; height: 100%; background-color: #0f2c64; z-index: 0;"></div>
				{/if}
			{/each}
			<div class="absolute top-0 pointer-events-none pattern-overlay" style="left: 120px; right: 0; height: 100%; z-index: 1;"></div>
			<div 
				class="timetable-grid grid text-sm relative"
				style="grid-template-columns: 120px repeat({totalChunks}, {chunkPixelSize}px); grid-template-rows: 44px repeat({stages.length}, {rowHeight}px); z-index: 2;"
			>
		<!-- Top-Left Blank Corner -->
		<div class="sticky top-0 left-0 z-[60] bg-fest-blue border-b border-r border-fest-dark-teal p-2 font-bold flex items-center justify-center shadow-md">
			<span class="text-[10px] uppercase tracking-widest text-fest-widget font-extrabold flex items-center gap-1">
				<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16z"></path></svg>
				Stages
			</span>
		</div>

		<!-- Time Headers -->
			{#each timeHeaders as header, i}
			<div 
				class="sticky top-0 bg-fest-text border-b border-fest-dark-teal flex flex-col justify-end pb-1 pl-2 shadow-sm"
				style="z-index: {header ? 50 : 40}; grid-column: {i + 2}; grid-row: 1;"
			>
				{#if header}
					<span class="bg-fest-text -translate-x-1/2 px-0.5 text-fest-widget font-bold whitespace-nowrap text-[10px]">{header}</span>
				{/if}
			</div>
		{/each}

		<!-- Grid body vertical divider lines (outside grid rows so they don't affect overflow) -->
		<div class="absolute pointer-events-none" style="top: 44px; left: 120px; right: 0; bottom: 0; overflow: hidden">
			{#each timeHeaders as header, i}
				<div class="absolute top-0 bottom-0 w-[1px]"
					style="left: {i * chunkPixelSize}px; background-color: var(--color-fest-teal); opacity: {header ? 0.4 : 0.15}"
				></div>
			{/each}
		</div>

		<!-- Stages Column Background -->
		{#each stages as stage, i}
			{@const rowIndex = i + 2}
			<div 
				class="sticky left-0 z-[55] border-r border-b border-fest-dark-teal p-2 pl-3 flex flex-col justify-center shadow-[4px_0_10px_rgba(0,0,0,0.3)] bg-fest-blue"
				style="grid-row: {rowIndex}; grid-column: 1;"
			>
				<h3 class="font-extrabold text-xs shadow-sm text-fest-widget drop-shadow-md flex items-center gap-1.5" title="{stage.name}">
					<span class="text-fest-turquoise">●</span> {stage.name}
				</h3>
			</div>

			<!-- Very subtle horizontal row dividers -->
			<div 
				class="border-b border-fest-widget/10 pointer-events-none z-[1]"
				style="grid-row: {rowIndex}; grid-column: 2 / -1;"
			></div>

			<!-- Selected stage highlight border -->
			{#if $selectedStageId === stage.id}
				<div 
					class="pointer-events-none z-[15] border-2 border-fest-cyan rounded-sm"
					style="grid-row: {rowIndex}; grid-column: 1 / -1; margin: -1px;"
				></div>
			{/if}
		{/each}

		<!-- Performance Blocks -->
		{#each filteredPerformances as perf}
			{@const rowIndex = stages.findIndex(s => s.id === perf.stageId) + 2}
			{@const stageIndex = rowIndex - 2}
			{@const style = exactCardStyle(perf)}
			{@const artist = artists.find(a => a.id === perf.artistId)}
			{@const isFav = artist?.isFavorite}
			{@const genre = artist?.genre}
			{@const gridStyle = getGridCardStyle(perf.artistId, perf.type, stageIndex)}
			{@const cardContentWidth = Math.max(1, parseFloat(style.width) - 16)}
			{@const nameAreaWidth = Math.max(1, cardContentWidth - 22)}
			{@const nameLen = artist?.name.length ?? 1}
			{@const nameFontSize = Math.max(7, Math.min(10, Math.floor(nameAreaWidth * 2 / (nameLen * 0.55))))}
			{@const cardTop = 44 + (rowIndex - 2) * rowHeight + 2}
			
			{#if rowIndex > 1}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div 
					id="perf-{perf.id}"
					role={perf.info ? 'button' : undefined}
					tabindex={perf.info ? 0 : undefined}
					onclick={() => openDetail(perf)}
					onkeydown={(e) => { if (perf.info && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(perf); } }}
					class="performance-card absolute rounded-sm p-1.5 flex flex-col shadow-sm transition-all z-20 hover:z-[30] hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-fest-widget focus:outline-none border-l-4
						{perf.info ? 'cursor-pointer' : ''}
						{isFav ? 'ring-2 ring-fest-logo' : ''} 
						{gridStyle.card}
						{$selectedPerformanceId === perf.id ? 'ring-4 ring-fest-widget shadow-xl' : ''}"
					style="left: {style.left}; width: {style.width}; top: {cardTop}px; height: {rowHeight - 4}px;"
				>
					<div class="flex justify-between items-start gap-1">
						<span class="font-bold leading-tight flex-1 min-w-0 {gridStyle.text}" style="font-size: {nameFontSize}px">{getArtistName(perf.artistId)}</span>
						<button 
							class="text-lg leading-none transition-transform active:scale-95 flex-shrink-0 {isFav ? 'text-fest-logo drop-shadow-md opacity-100' : 'opacity-50 hover:opacity-100'}"
							onclick={(e) => toggleFavorite(e, perf.artistId)}
							aria-label="Favorite"
						>
							<span class="inline-block scale-y-[0.85]">{#if isFav}♥&#xFE0E;{:else}♡&#xFE0E;{/if}</span>
						</button>
					</div>
					{#if SHOW_GENRE && genre}
						<span class="text-[8px] font-semibold {gridStyle.genre} uppercase tracking-wider">
							{genre}
						</span>
					{/if}
					<div class="text-[9px] mt-auto flex items-end justify-between gap-1 {gridStyle.text}/80">
						<span class="font-semibold">{new Date(perf.startTime).toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})} - {new Date(perf.endTime).toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}</span>
						{#if perf.info}<svg class="w-3 h-3 shrink-0 opacity-70 {gridStyle.text}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><title>Mehr Infos</title><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a1.4 1.4 0 110 2.8A1.4 1.4 0 0112 7zm1.4 11h-2.8v-6.5h2.8V18z"/></svg>{/if}
					</div>
				</div>
			{/if}
		{/each}

		<!-- "Now" Indicator Line -->
		{#if nowPixels > 0 && !nowBehindSticky}
			<div class="fixed-now-line pointer-events-none absolute top-[44px] bottom-0 w-[2px] z-[60] flex justify-center opacity-70" style="background-color: var(--color-fest-logo); left: {nowPixels}px; height: calc(100% - 44px);">
				<!-- Dot at top -->
				<div class="w-3 h-3 rounded-full border-2 border-fest-logo opacity-40 absolute -top-1.5" style="background-color: var(--color-fest-turquoise);"></div>
			</div>
		{/if}
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="list-view-wrap absolute inset-0 overflow-hidden" style="background-color: {selectedDay ? getDayBgColor(selectedDay) : '#2232b4'};"
				ontouchstart={handleListTouchStart}
				ontouchmove={handleListTouchMove}
				ontouchend={handleListTouchEnd}
			>
			<div class="absolute inset-0 pointer-events-none pattern-overlay"></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="list-view-scroll absolute inset-0 overflow-y-auto">
			<div class="list-view relative flex flex-col gap-4 mt-6 max-w-2xl mx-auto w-full pb-10 px-4 z-[1]">
			<!-- List View -->
			{#if sortedPerformances.length === 0}
				<div class="text-center p-10 font-neo-heading font-bold text-fest-turquoise border-[3px] border-fest-teal border-dashed">
					No performances match your filter! 
				</div>
			{/if}

			{#each sortedPerformances as perf}
				{@const artist = artists.find(a => a.id === perf.artistId)}
				{@const stage = stages.find(s => s.id === perf.stageId)}
				{@const isFav = artist?.isFavorite}
				{@const genre = artist?.genre}
				{@const stageIndex = stages.findIndex(s => s.id === perf.stageId)}
				{@const listStyle = getGridCardStyle(perf.artistId, perf.type, stageIndex)}
				
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div 
					role={perf.info ? 'button' : undefined}
					tabindex={perf.info ? 0 : undefined}
					onclick={() => openDetail(perf)}
					onkeydown={(e) => { if (perf.info && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(perf); } }}
					class="{listStyle.card} border-l-4 rounded-sm p-3 sm:p-4 flex flex-col justify-between gap-3 w-full {perf.info ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} {isFav ? 'ring-2 ring-fest-logo' : ''} {$selectedPerformanceId === perf.id ? 'ring-4 ring-fest-widget shadow-xl' : ''}"
					id="list-perf-{perf.id}"
				>
					<div class="flex justify-between items-start gap-3">
						<div class="flex-1 flex flex-col">
							<h3 class="font-neo-heading text-lg font-bold uppercase {listStyle.text} break-words">
								{getArtistName(perf.artistId)}
							</h3>
							{#if SHOW_GENRE && genre}
								<span class="text-sm font-bold {listStyle.genre} uppercase tracking-wider">
									{genre}
								</span>
							{/if}
						</div>
						<button 
							class="shrink-0 text-4xl leading-none transition-transform active:scale-95 {isFav ? 'text-fest-logo drop-shadow-md opacity-100' : 'opacity-50 hover:opacity-100'}"
							onclick={(e) => toggleFavorite(e, perf.artistId)}
							aria-label="Favorite"
						>
							<span class="inline-block scale-y-[0.85]">{#if isFav}♥&#xFE0E;{:else}♡&#xFE0E;{/if}</span>
						</button>
					</div>
					<div class="flex items-end justify-between gap-2">
						<div class="text-sm font-bold text-fest-turquoise bg-fest-dark-teal px-2 py-1 border border-fest-teal/40 rounded flex items-center gap-2">
							<span>{new Date(perf.startTime).toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})} - {new Date(perf.endTime).toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})}</span>
							{#if stage}
								<span class="text-fest-turquoise">| {stage.name}</span>
							{/if}
						</div>
						{#if perf.info}
							<svg class="w-4 h-4 shrink-0 opacity-70 {listStyle.text}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><title>Mehr Infos</title><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a1.4 1.4 0 110 2.8A1.4 1.4 0 0112 7zm1.4 11h-2.8v-6.5h2.8V18z"/></svg>
						{/if}
					</div>
				</div>
			{/each}
			</div>
			</div>
			</div>
		{/if}
		</div>
</div>
</div>

{#if detailPerformance}
	<PerformanceDetail
		performance={detailPerformance}
		artist={detailArtist}
		stage={detailStage}
		cardClass={detailStyle?.card ?? ''}
		textClass={detailStyle?.text ?? ''}
		genreClass={detailStyle?.genre ?? ''}
		onclose={closeDetail}
		ontogglefavorite={(e: MouseEvent) => detailPerformance && toggleFavorite(e, detailPerformance.artistId)}
	/>
{/if}

<style>
	/* Custom background diagonal diamond pattern */
	.pattern-overlay {
		background-image: 
			linear-gradient(135deg, color-mix(in srgb, #000 0%, transparent) 25%, transparent 25%),
			linear-gradient(225deg, color-mix(in srgb, #000 0%, transparent) 25%, transparent 25%),
			linear-gradient(45deg, color-mix(in srgb, #000 0%, transparent) 25%, transparent 25%),
			linear-gradient(315deg, color-mix(in srgb, #000 0%, transparent) 25%, transparent 25%);
		background-position:  40px 0, 40px 0, 0 0, 0 0;
		background-size: 80px 80px;
		background-repeat: repeat;
	}

	.timetable-container {
		touch-action: pan-x pan-y;
	}

	.timetable-container::-webkit-scrollbar {
		height: 8px;
		width: 8px;
	}
	.timetable-container::-webkit-scrollbar-track {
		background: #142C50; 
	}
	.timetable-container::-webkit-scrollbar-thumb {
		background: #F3A0A2; 
		border-radius: 4px;
	}
	.timetable-container::-webkit-scrollbar-thumb:hover {
		background: #38909F; 
	}
</style>
