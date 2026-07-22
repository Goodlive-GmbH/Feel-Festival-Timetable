<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import type { Stage, Artist, Performance, Poi, PoiType } from '$lib/types';

	let {
		stages = [],
		artists = [],
		performances = [],
		pois = [],
		onstageselect
	} = $props<{
		stages?: Stage[];
		artists?: Artist[];
		performances?: Performance[];
		pois?: Poi[];
		onstageselect?: (stageId: string) => void;
	}>();

	function artistName(id: string): string {
		return (artists as Artist[]).find((a) => a.id === id)?.name ?? id;
	}

	function isFavoriteArtist(id: string): boolean {
		return (artists as Artist[]).find((a) => a.id === id)?.isFavorite === true;
	}

	let mapContainer: HTMLDivElement;
	// Leaflet is imported dynamically (SSR-safe), so we keep loose typing here.
	/* eslint-disable @typescript-eslint/no-explicit-any */
	let map: any | undefined;
	let L: any;
	let markerLayer: any;
	let nowRefreshTimer: ReturnType<typeof setInterval> | undefined;

	// Intrinsic pixel size of the map graphic (native SVG resolution).
	const IMG_W = 7425;
	const IMG_H = 5280;
	// The tile pyramid is generated into a SQUARE canvas that is a multiple of
	// (TILE_SIZE * 2^TILE_MAX_ZOOM) on both axes, so every zoom level halves
	// evenly and the tile-grid aspect stays constant (no stretching). The map
	// content is centered inside that grid with transparent padding, which
	// markers must account for.
	const TILE_SIZE = 512;
	const TILE_MAX_ZOOM = 3;
	const GRID_SIDE = 8192; // 512 * 2^3 * 2  (multiple of 4096)
	const GRID_W = GRID_SIDE;
	const GRID_H = GRID_SIDE;
	const PAD_X = (GRID_W - IMG_W) / 2;
	const PAD_Y = (GRID_H - IMG_H) / 2;

	// --- Camps (user placed, persisted in localStorage) ---
	// A camp is either the user's own ("own") or a generic marked place ("place").
	// Every camp auto-locks shortly after placement / movement to avoid accidental
	// drags, and can be temporarily unlocked from its popup.
	interface Camp {
		id: string;
		kind: 'own' | 'place';
		name?: string;
		x: number;
		y: number;
	}
	const CAMPS_KEY = 'festivalCamps';
	// Bumped to v2: the coordinate space changed from the old 1200x1200 squashed
	// imageOverlay space to the real 7680x5632 tile-grid space, so stale (v1)
	// saved views from the old space would misplace the map.
	const VIEW_KEY = 'festivalMapViewV2'; // persisted center/zoom/bearing across remounts
	const LOCK_DELAY = 5_000; // auto-lock a camp after this idle time
	const UNLOCK_WINDOW = 30_000; // temporary unlock duration

	type PlaceMode = null | 'own' | 'place';
	let placeMode = $state<PlaceMode>(null);
	let camps = $state<Camp[]>([]);
	// Per-camp unlock state keyed by camp id.
	let unlocked = $state<Record<string, boolean>>({});
	const lockTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	const unlockTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	const campMarkers: Record<string, any> = {};

	// Coherent in-map naming dialog, shown right after placing a generic place.
	let namingFor = $state<{ id: string } | null>(null);
	let namingValue = $state('');

	// Temporary debug HUD: fractional (0-1) image-space coords under the cursor.
	// Disabled — re-enable to read out coordinates at the mouse position.
	// let mouseCoord = $state<{ x: number; y: number } | null>(null);

	function isCampUnlocked(id: string): boolean {
		return unlocked[id] === true;
	}

	function loadCamps(): Camp[] {
		try {
			const raw = localStorage.getItem(CAMPS_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			// Migrate the legacy single-pin format if present.
			if (!parsed) {
				const legacy = localStorage.getItem('campingPin');
				if (legacy) {
					const p = JSON.parse(legacy);
					localStorage.removeItem('campingPin');
					return [{ id: 'own', kind: 'own', x: p.x, y: p.y }];
				}
				return [];
			}
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function saveCamps() {
		localStorage.setItem(CAMPS_KEY, JSON.stringify(camps));
	}

	interface MapView {
		center: [number, number];
		zoom: number;
		bearing: number;
	}
	function loadView(): MapView | null {
		try {
			const raw = localStorage.getItem(VIEW_KEY);
			if (!raw) return null;
			const v = JSON.parse(raw);
			if (
				Array.isArray(v?.center) &&
				typeof v?.center[0] === 'number' &&
				typeof v?.center[1] === 'number' &&
				typeof v?.zoom === 'number'
			) {
				return { center: v.center, zoom: v.zoom, bearing: Number(v.bearing) || 0 };
			}
		} catch {
			/* ignore */
		}
		return null;
	}
	function saveView() {
		if (!map) return;
		const view: MapView = {
			center: [map.getCenter().lat, map.getCenter().lng],
			zoom: map.getZoom(),
			bearing: typeof map.getBearing === 'function' ? map.getBearing() : 0
		};
		localStorage.setItem(VIEW_KEY, JSON.stringify(view));
	}

	// Convert relative image-space coords (0-1) into CRS.Simple LatLng.
	// The map content sits inside the tile grid with PAD_X/PAD_Y transparent
	// padding on each side, so we offset into the full grid pixel space first.
	// In CRS.Simple, y grows downward when we flip: we map [ -y*GRID_H, x*GRID_W ].
	function toLatLng(x: number, y: number) {
		return L.latLng(-(PAD_Y + y * IMG_H), PAD_X + x * IMG_W);
	}
	function fromLatLng(latlng: { lat: number; lng: number }) {
		return { x: (latlng.lng - PAD_X) / IMG_W, y: (-latlng.lat - PAD_Y) / IMG_H };
	}

	const POI_META: Record<PoiType, { label: string; glyph: string; bg: string }> = {
		food: { label: 'Essen', glyph: '🍔', bg: 'var(--color-fest-green-teal)' },
		wc: { label: 'WC', glyph: 'WC', bg: 'var(--color-fest-teal)' },
		entrance: { label: 'Eingang', glyph: '🚪', bg: 'var(--color-fest-blue)' },
		medical: { label: 'Sanitäter', glyph: '＋', bg: 'var(--color-fest-logo)' },
		water: { label: 'Wasser', glyph: '💧', bg: 'var(--color-fest-cyan)' },
		info: { label: 'Info', glyph: 'i', bg: 'var(--color-fest-dark-teal)' },
		camping: { label: 'Camping', glyph: '⛺', bg: 'var(--color-fest-logo)' }
	};

	function stageIcon(name: string, liveArtist?: string, fav = false) {
		const live = liveArtist != null;
		const nowLine = live
			? `<span class="fest-stage-now">${fav ? '♥\uFE0E' : '▶'} ${liveArtist}</span>`
			: '';
		const liveClass = live ? (fav ? ' fest-stage-pin-live fest-stage-pin-fav' : ' fest-stage-pin-live') : '';
		return L.divIcon({
			className: 'fest-marker',
			html: `<div class="fest-stage-pin${liveClass}"><span class="fest-stage-dot"></span><span class="fest-stage-label">${name}${nowLine}</span></div>`,
			iconSize: [0, 0],
			iconAnchor: [0, 0]
		});
	}

	function poiIcon(type: PoiType) {
		const meta = POI_META[type];
		return L.divIcon({
			className: 'fest-marker',
			html: `<div class="fest-poi-pin" style="background:${meta.bg}"><span>${meta.glyph}</span></div>`,
			iconSize: [28, 28],
			iconAnchor: [14, 14]
		});
	}

	function campIcon(camp: Camp) {
		const own = camp.kind === 'own';
		const locked = !isCampUnlocked(camp.id);
		const label = camp.name
			? `<span class="fest-camp-label">${camp.name}</span>`
			: '';
		const lockBadge = locked ? '<span class="fest-camp-lock">🔒\uFE0E</span>' : '';
		return L.divIcon({
			className: 'fest-marker',
			html: `<div class="fest-camp-wrap"><div class="fest-camp-pin ${own ? 'fest-camp-pin-own' : 'fest-camp-pin-place'}"><span>${own ? '⛺' : '📍\uFE0E'}</span>${lockBadge}</div>${label}</div>`,
			iconSize: [34, 34],
			iconAnchor: [17, 34]
		});
	}

	function isLiveNow(p: Performance, now: number): boolean {
		return new Date(p.startTime).getTime() <= now && new Date(p.endTime).getTime() > now;
	}

	function nowPlaying(stageId: string): Performance | undefined {
		const now = Date.now();
		return (performances as Performance[]).find((p) => p.stageId === stageId && isLiveNow(p, now));
	}

	function upcomingActs(stageId: string): string {
		const now = Date.now();
		const acts = (performances as Performance[])
			.filter((p) => p.stageId === stageId && new Date(p.endTime).getTime() >= now)
			.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
			.slice(0, 3);
		if (acts.length === 0) return '<p class="fest-popup-empty">Keine weiteren Acts</p>';
		return acts
			.map((p) => {
				const t = new Date(p.startTime).toLocaleTimeString('de-DE', {
					hour: '2-digit',
					minute: '2-digit'
				});
				const artist = artistName(p.artistId);
				const live = isLiveNow(p, now);
				const fav = live && isFavoriteArtist(p.artistId);
				const cls = live ? (fav ? ' fest-popup-act-live fest-popup-act-fav' : ' fest-popup-act-live') : '';
				const badge = live
					? `<span class="fest-popup-live-badge${fav ? ' fest-popup-live-badge-fav' : ''}">${fav ? '♥\uFE0E ' : ''}Jetzt live</span>`
					: '';
				return `<div class="fest-popup-act${cls}"><span class="fest-popup-time">${t}</span> ${artist}${badge}</div>`;
			})
			.join('');
	}

	function buildMarkers() {
		if (!map) return;
		markerLayer.clearLayers();

		for (const stage of stages as Stage[]) {
			if (stage.x == null || stage.y == null) continue;
			const live = nowPlaying(stage.id);
			const liveArtist = live ? artistName(live.artistId) : undefined;
			const liveFav = live ? isFavoriteArtist(live.artistId) : false;
			const marker = L.marker(toLatLng(stage.x, stage.y), {
				icon: stageIcon(stage.name, liveArtist, liveFav)
			}).addTo(markerLayer);
			const popupHtml = `
				<div class="fest-popup">
					<b class="fest-popup-title">${stage.name}</b>
					<div class="fest-popup-acts">${upcomingActs(stage.id)}</div>
					<button class="fest-popup-btn" data-stage="${stage.id}">Im Timetable öffnen</button>
				</div>`;
			marker.bindPopup(popupHtml);
			marker.on('popupopen', (e: any) => {
				const btn = e.popup.getElement()?.querySelector('.fest-popup-btn');
				btn?.addEventListener('click', () => {
					onstageselect?.(stage.id);
				});
			});
		}

		for (const poi of pois as Poi[]) {
			const meta = POI_META[poi.type];
			const marker = L.marker(toLatLng(poi.x, poi.y), { icon: poiIcon(poi.type) }).addTo(
				markerLayer
			);
			marker.bindPopup(
				`<div class="fest-popup"><b class="fest-popup-title">${poi.name}</b><span class="fest-popup-sub">${meta.label}</span></div>`
			);
		}
	}

	function campPopupHtml(camp: Camp): string {
		const title = camp.kind === 'own' ? 'Camp markieren' : (camp.name || 'Markierter Ort');
		const unlockedNow = isCampUnlocked(camp.id);
		const lockBtn = `<button class="fest-popup-btn fest-popup-btn-lock">${unlockedNow ? 'Sperren' : 'Entsperren'}</button>`;
		return `<div class="fest-popup"><b class="fest-popup-title">${title}</b>${lockBtn}<button class="fest-popup-btn fest-popup-btn-remove">Entfernen</button></div>`;
	}

	function campDraggable(camp: Camp): boolean {
		return isCampUnlocked(camp.id);
	}

	function renderCamps() {
		if (!map) return;
		for (const key of Object.keys(campMarkers)) {
			campMarkers[key].remove();
			delete campMarkers[key];
		}

		for (const camp of camps) {
			const draggable = campDraggable(camp);
			const marker = L.marker(toLatLng(camp.x, camp.y), {
				icon: campIcon(camp),
				draggable,
				zIndexOffset: 1000
			}).addTo(map);
			marker.bindPopup(campPopupHtml(camp));

			marker.on('dragend', () => {
				const p = fromLatLng(marker.getLatLng());
				camp.x = Math.min(1, Math.max(0, p.x));
				camp.y = Math.min(1, Math.max(0, p.y));
				saveCamps();
				scheduleLock(camp.id);
			});

			marker.on('popupopen', (e: any) => {
				const el = e.popup.getElement();
				el?.querySelector('.fest-popup-btn-remove')?.addEventListener('click', () => {
					removeCamp(camp.id);
				});
				el?.querySelector('.fest-popup-btn-lock')?.addEventListener('click', () => {
					if (isCampUnlocked(camp.id)) lockCamp(camp.id);
					else unlockCamp(camp.id);
				});
			});

			campMarkers[camp.id] = marker;
		}
	}

	function scheduleLock(id: string) {
		clearTimeout(lockTimers[id]);
		lockTimers[id] = setTimeout(() => lockCamp(id), LOCK_DELAY);
	}

	function lockCamp(id: string) {
		clearTimeout(lockTimers[id]);
		clearTimeout(unlockTimers[id]);
		unlocked = { ...unlocked, [id]: false };
		renderCamps();
	}

	function unlockCamp(id: string) {
		unlocked = { ...unlocked, [id]: true };
		renderCamps();
		clearTimeout(unlockTimers[id]);
		// Auto re-lock after the unlock window unless moved (which reschedules).
		unlockTimers[id] = setTimeout(() => lockCamp(id), UNLOCK_WINDOW);
	}

	function removeCamp(id: string) {
		camps = camps.filter((c) => c.id !== id);
		delete unlocked[id];
		clearTimeout(lockTimers[id]);
		clearTimeout(unlockTimers[id]);
		saveCamps();
		renderCamps();
	}

	function setPlaceMode(mode: PlaceMode) {
		placeMode = mode;
		if (mapContainer) {
			mapContainer.style.cursor = mode ? 'crosshair' : '';
		}
	}

	function placeCampAt(x: number, y: number) {
		const cx = Math.min(1, Math.max(0, x));
		const cy = Math.min(1, Math.max(0, y));
		if (placeMode === 'own') {
			const existing = camps.find((c) => c.kind === 'own');
			let id = 'own';
			if (existing) {
				existing.x = cx;
				existing.y = cy;
				camps = [...camps];
			} else {
				id = 'own';
				camps = [...camps, { id, kind: 'own', x: cx, y: cy }];
			}
			unlocked = { ...unlocked, [id]: true };
			saveCamps();
			renderCamps();
			scheduleLock(id);
		} else if (placeMode === 'place') {
			const id = `place-${Date.now()}`;
			camps = [
				...camps,
				{ id, kind: 'place', name: undefined, x: cx, y: cy }
			];
			unlocked = { ...unlocked, [id]: true };
			saveCamps();
			renderCamps();
			scheduleLock(id);
			// Open the in-map naming dialog so the user can label the place.
			namingFor = { id };
			namingValue = '';
		}
		setPlaceMode(null);
	}

	function confirmNaming() {
		if (!namingFor) return;
		const id = namingFor.id;
		const name = namingValue.trim();
		camps = camps.map((c) => (c.id === id ? { ...c, name: name || undefined } : c));
		saveCamps();
		renderCamps();
		namingFor = null;
		namingValue = '';
	}

	function cancelNaming() {
		if (namingFor) {
			// A place with no name is still valid — just keep it unnamed.
			renderCamps();
		}
		namingFor = null;
		namingValue = '';
	}

	onMount(async () => {
		L = await import('leaflet');
		// leaflet-rotate patches Leaflet core (side-effect import) to add the
		// `rotate`/`touchRotate` map options used below for two-finger rotation.
		await import('leaflet-rotate');

		camps = loadCamps();

		const bounds = [
			[0, 0],
			[-GRID_H, GRID_W]
		] as [number, number][];

		// Custom CRS for the tiled map. Leaflet's default CRS.Simple uses
		// scale(z) = 2^z, which would make one 512px tile cover 512/2^z image
		// pixels and produce a grid that does NOT match our generated pyramid.
		// We define scale(z) = 2^(z - TILE_MAX_ZOOM) so that at z = TILE_MAX_ZOOM
		// exactly one tile = TILE_SIZE image pixels (scale 1, native), and the
		// grid aspect stays constant across levels (no stretching). This also
		// keeps pinch-zoom direction correct (pinch-in raises z -> zooms in).
		const TileCrs = L.Util.extend({}, L.CRS.Simple, {
			scale: (z: number) => Math.pow(2, z - TILE_MAX_ZOOM),
			zoom: (s: number) => TILE_MAX_ZOOM + Math.log2(s)
		});

		map = L.map(mapContainer, {
			crs: TileCrs,
			zoomControl: false,
			attributionControl: false,
			// Full pyramid (z=0..TILE_MAX_ZOOM) now exists, so allow the whole
			// range. zoomSnap:0 keeps pinch smooth/fractional between levels.
			minZoom: 0,
			maxZoom: TILE_MAX_ZOOM,
			// zoomSnap: 0 allows fractional zoom so pinch gestures scale smoothly
			// instead of snapping/animating to the nearest integer zoom level.
			zoomSnap: 0,
			zoomDelta: 0.5,
			rotate: true,
			touchRotate: true,
			bearing: 0
		});

		// Force the Leaflet container background to dark teal (beats Leaflet's
		// default #ddd gray, which the global CSS rule can lose to on some builds).
		mapContainer.style.background = 'var(--color-fest-dark-teal)';
		map.getContainer().style.background = 'var(--color-fest-dark-teal)';

		// PoC: render the static tile pyramid instead of a single giant image
		// overlay. Only z=3 tiles exist yet, so this validates that swapping the
		// one large texture for many small tiles removes the pinch-zoom lag.
		L.tileLayer('/tiles/{z}/{x}/{y}.webp', {
			tileSize: TILE_SIZE,
			bounds: L.latLngBounds(bounds),
			minZoom: 0,
			maxZoom: TILE_MAX_ZOOM,
			noWrap: true,
			zoomReverse: false,
			attribution: ''
		}).addTo(map);
		const latLngBounds = L.latLngBounds(bounds);
		// No maxBounds: it makes Leaflet pan the view back inside the bounds after a
		// rotation or when zoomed out, which reads as an unwanted recentering.
		const saved = loadView();
		if (saved && typeof saved.zoom === 'number') {
			// Restore the last view (center/zoom/rotation) so switching tabs back
			// and forth does not reset the user's orientation.
			map.setView(saved.center, saved.zoom, { animate: false });
			if (typeof map.setBearing === 'function') map.setBearing(saved.bearing);
		} else {
			// First visit: fit the WHOLE map into the viewport (preserves aspect
			// ratio — no stretching/clipping at the edges). setView(center, 0)
			// alone does not fit and lets the wide map overflow a portrait screen.
			map.fitBounds(latLngBounds, { animate: false, padding: [8, 8] });
		}

		markerLayer = L.layerGroup().addTo(map);

		// Placement mode: next map tap drops/adds a camp of the active kind.
		map.on('click', (e: any) => {
			if (!placeMode) return;
			const p = fromLatLng(e.latlng);
			placeCampAt(p.x, p.y);
		});

		// Persist the current view (center/zoom/bearing) whenever the user pans,
		// zooms or rotates so it can be restored on the next mount.
		map.on('moveend zoomend rotateend', saveView);

		// Temporary: show fractional (0-1) image-space coords at the mouse position.
		// Disabled — re-enable to read out coordinates at the mouse position.
		// const updateMouseCoord = (e: any) => {
		// 	const p = fromLatLng(e.latlng);
		// 	mouseCoord = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? p : { x: p.x, y: p.y };
		// };
		// map.on('mousemove', updateMouseCoord);
		// map.on('mouseout', () => (mouseCoord = null));

		buildMarkers();
		renderCamps();
		// Auto-lock any persisted camps shortly after load.
		for (const c of camps) scheduleLock(c.id);

		// Keep the "now playing" highlight current as acts start and end.
		// Skip refreshes while a popup is open so it isn't torn down mid-read.
		nowRefreshTimer = setInterval(() => {
			if (map && !map._popup) buildMarkers();
		}, 60_000);
	});

	// Rebuild markers whenever the data props change after mount.
	$effect(() => {
		void stages;
		void artists;
		void performances;
		void pois;
		if (map) buildMarkers();
	});

	onDestroy(() => {
		if (nowRefreshTimer) clearInterval(nowRefreshTimer);
		for (const id of Object.keys(lockTimers)) clearTimeout(lockTimers[id]);
		for (const id of Object.keys(unlockTimers)) clearTimeout(unlockTimers[id]);
		// Save the current view before the map is destroyed on tab switch so the
		// rotation and zoom are preserved when returning to the map.
		saveView();
		if (map) map.remove();
	});
	/* eslint-enable @typescript-eslint/no-explicit-any */
</script>

<div class="relative h-full w-full bg-fest-dark-teal">
	<div bind:this={mapContainer} class="leaflet-container-dark z-0 h-full w-full"></div>

	<!-- Debug coordinate picker disabled -->

	<div class="absolute right-4 bottom-4 z-[400] flex flex-col items-end gap-2">
		{#if placeMode}
			<span
				class="rounded-full bg-fest-logo px-3 py-1 text-xs font-bold text-fest-text shadow-lg"
			>
				Tippe auf die Karte…
			</span>
		{/if}
		{#if !camps.some((c) => c.kind === 'own')}
			<button
				type="button"
				onclick={() => setPlaceMode(placeMode === 'own' ? null : 'own')}
				class="fest-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-lg transition-colors {placeMode ===
				'own'
					? 'bg-fest-logo text-fest-text'
					: 'bg-fest-dark-teal text-fest-turquoise'}"
			>
				<span aria-hidden="true">⛺&#xFE0E;</span>
				Camp markieren
			</button>
		{/if}
		<button
			type="button"
			onclick={() => setPlaceMode(placeMode === 'place' ? null : 'place')}
			class="fest-button flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-lg transition-colors {placeMode ===
			'place'
				? 'bg-fest-logo text-fest-text'
				: 'bg-fest-dark-teal text-fest-turquoise'}"
		>
			<span aria-hidden="true">📍&#xFE0E;</span>
			Ort markieren
		</button>
	</div>

	{#if namingFor}
		<div class="absolute inset-0 z-[500] flex items-end justify-center bg-fest-text/40 p-4">
			<div class="fest-naming w-full max-w-sm rounded-2xl p-4 shadow-2xl">
				<b class="fest-naming-title">Ort benennen</b>
				<p class="fest-naming-sub">Wie soll dieser Ort heißen? (optional)</p>
				<input
					class="fest-naming-input"
					type="text"
					bind:value={namingValue}
					placeholder="z. B. Treffpunkt, Bar, Freundes-Camp…"
					onkeydown={(e) => {
						if (e.key === 'Enter') confirmNaming();
						if (e.key === 'Escape') cancelNaming();
					}}
				/>
				<div class="mt-3 flex justify-end gap-2">
					<button
						type="button"
						class="fest-popup-btn fest-popup-btn-remove"
						onclick={cancelNaming}
					>
						Überspringen
					</button>
					<button type="button" class="fest-popup-btn" onclick={confirmNaming}>
						Speichern
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Golden highlight for a favorited artist that is currently on stage */
	:global(.leaflet-container),
	:global(.leaflet-container-dark) {
		--fest-gold: #f5c518;
		background: var(--color-fest-dark-teal) !important;
	}

	:global(.fest-marker) {
		background: transparent;
		border: none;
	}

	:global(.fest-stage-pin) {
		display: flex;
		align-items: center;
		gap: 4px;
		transform: translate(-6px, -6px);
		white-space: nowrap;
	}
	:global(.fest-stage-dot) {
		width: 12px;
		height: 12px;
		border-radius: 9999px;
		background: var(--color-fest-logo);
		border: 2px solid var(--color-fest-widget);
		box-shadow: 0 0 0 2px var(--color-fest-text);
		flex-shrink: 0;
	}
	:global(.fest-stage-label) {
		display: flex;
		flex-direction: column;
		font-size: 11px;
		font-weight: 700;
		color: var(--color-fest-widget);
		background: color-mix(in srgb, var(--color-fest-text) 82%, transparent);
		padding: 1px 6px;
		border-radius: 6px;
		border: 1px solid var(--color-fest-dark-teal);
	}

	/* Stage currently hosting a live act */
	:global(.fest-stage-pin-live) {
		z-index: 500;
	}
	:global(.fest-stage-pin-live .fest-stage-dot) {
		background: var(--color-fest-turquoise);
		animation: fest-pulse 1.6s ease-in-out infinite;
	}
	:global(.fest-stage-pin-live .fest-stage-label) {
		border-color: var(--color-fest-turquoise);
		box-shadow: 0 0 8px color-mix(in srgb, var(--color-fest-turquoise) 60%, transparent);
	}
	:global(.fest-stage-now) {
		font-size: 10px;
		font-weight: 700;
		color: var(--color-fest-turquoise);
		margin-top: 1px;
		white-space: nowrap;
	}

	/* Favorited artist currently live — golden highlight */
	:global(.fest-stage-pin-fav .fest-stage-dot) {
		background: var(--fest-gold);
		animation-name: fest-pulse-gold;
	}
	:global(.fest-stage-pin-fav .fest-stage-label) {
		border-color: var(--fest-gold);
		box-shadow: 0 0 8px color-mix(in srgb, var(--fest-gold) 65%, transparent);
	}
	:global(.fest-stage-pin-fav .fest-stage-now) {
		color: var(--fest-gold);
	}

	@keyframes fest-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 2px var(--color-fest-text);
		}
		50% {
			box-shadow:
				0 0 0 2px var(--color-fest-text),
				0 0 0 7px color-mix(in srgb, var(--color-fest-turquoise) 45%, transparent);
		}
	}

	@keyframes fest-pulse-gold {
		0%,
		100% {
			box-shadow: 0 0 0 2px var(--color-fest-text);
		}
		50% {
			box-shadow:
				0 0 0 2px var(--color-fest-text),
				0 0 0 7px color-mix(in srgb, var(--fest-gold) 55%, transparent);
		}
	}

	:global(.fest-poi-pin) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 9999px;
		font-size: 14px;
		line-height: 1;
		color: var(--color-fest-text);
		border: 2px solid var(--color-fest-widget);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
		font-weight: 700;
	}

	:global(.fest-camp-wrap) {
		display: flex;
		flex-direction: column;
		align-items: center;
		transform: translateY(-17px);
	}
	:global(.fest-camp-pin) {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 9999px 9999px 9999px 0;
		transform: rotate(-45deg);
		border: 2px solid var(--color-fest-widget);
		box-shadow: 0 3px 6px rgba(0, 0, 0, 0.5);
	}
	:global(.fest-camp-pin-own) {
		background: var(--color-fest-logo);
	}
	:global(.fest-camp-pin-place) {
		background: var(--color-fest-cyan);
	}
	:global(.fest-camp-pin span) {
		transform: rotate(45deg);
		font-size: 16px;
	}
	:global(.fest-camp-lock) {
		position: absolute;
		top: -8px;
		right: -8px;
		transform: rotate(45deg);
		font-size: 11px;
		background: var(--color-fest-text);
		border-radius: 9999px;
		padding: 1px 2px;
		line-height: 1;
	}
	:global(.fest-camp-label) {
		margin-top: 2px;
		font-size: 10px;
		font-weight: 700;
		color: var(--color-fest-widget);
		background: color-mix(in srgb, var(--color-fest-text) 82%, transparent);
		padding: 1px 5px;
		border-radius: 6px;
		border: 1px solid var(--color-fest-dark-teal);
		white-space: nowrap;
	}

	/* In-map naming dialog */
	:global(.fest-naming) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--color-fest-text);
		border: 1px solid var(--color-fest-dark-teal);
		border-radius: 0.75rem;
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
	}
	:global(.fest-naming-title) {
		font-size: 15px;
		color: var(--color-fest-cyan);
	}
	:global(.fest-naming-sub) {
		font-size: 12px;
		color: var(--color-fest-turquoise);
		margin-bottom: 4px;
	}
	:global(.fest-naming-input) {
		width: 100%;
		background: color-mix(in srgb, var(--color-fest-dark-teal) 35%, var(--color-fest-text));
		color: var(--color-fest-widget);
		border: 1px solid var(--color-fest-dark-teal);
		border-radius: 0.5rem;
		padding: 8px 10px;
		font-size: 14px;
		outline: none;
	}
	:global(.fest-naming-input:focus) {
		border-color: var(--color-fest-turquoise);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-fest-turquoise) 40%, transparent);
	}
	:global(.fest-naming-input::placeholder) {
		color: var(--color-fest-teal);
	}

	/* Popup theming */
	:global(.leaflet-popup-content-wrapper) {
		background-color: var(--color-fest-text);
		color: var(--color-fest-widget);
		border: 1px solid var(--color-fest-dark-teal);
		border-radius: 0.5rem;
		box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
	}
	:global(.leaflet-popup-tip) {
		background-color: var(--color-fest-text);
		border: 1px solid var(--color-fest-dark-teal);
	}
	:global(.fest-popup) {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 150px;
	}
	:global(.fest-popup-title) {
		font-size: 14px;
		color: var(--color-fest-cyan);
	}
	:global(.fest-popup-sub) {
		font-size: 12px;
		color: var(--color-fest-turquoise);
	}
	:global(.fest-popup-acts) {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	:global(.fest-popup-act) {
		font-size: 12px;
		color: var(--color-fest-widget);
	}
	:global(.fest-popup-act-live) {
		font-weight: 700;
		color: var(--color-fest-turquoise);
	}
	:global(.fest-popup-act-fav) {
		color: var(--fest-gold);
	}
	:global(.fest-popup-live-badge) {
		display: inline-block;
		margin-left: 6px;
		font-size: 10px;
		font-weight: 700;
		color: var(--color-fest-text);
		background: var(--color-fest-turquoise);
		padding: 0 5px;
		border-radius: 9999px;
		vertical-align: middle;
	}
	:global(.fest-popup-live-badge-fav) {
		background: var(--fest-gold);
	}
	:global(.fest-popup-time) {
		font-weight: 700;
		color: var(--color-fest-turquoise);
	}
	:global(.fest-popup-empty) {
		font-size: 12px;
		color: var(--color-fest-teal);
		font-style: italic;
	}
	:global(.fest-popup-btn) {
		margin-top: 2px;
		background: var(--color-fest-blue);
		color: var(--color-fest-widget);
		border-radius: 9999px;
		padding: 5px 10px;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		border: none;
	}
	:global(.fest-popup-btn-remove) {
		background: var(--color-fest-logo);
		color: var(--color-fest-text);
	}
</style>
