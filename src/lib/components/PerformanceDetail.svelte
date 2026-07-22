<script lang="ts">
	import type { Performance, Artist, Stage } from '$lib/types';
	import { SHOW_GENRE } from '$lib/featureFlags';

	let {
		performance,
		artist,
		stage,
		cardClass = '',
		textClass = '',
		genreClass = '',
		onclose,
		ontogglefavorite
	} = $props<{
		performance: Performance;
		artist: Artist | undefined;
		stage: Stage | undefined;
		cardClass?: string;
		textClass?: string;
		genreClass?: string;
		onclose: () => void;
		ontogglefavorite: (e: MouseEvent) => void;
	}>();

	const timeLabel = $derived(
		`${new Date(performance.startTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} - ${new Date(performance.endTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
	);
	const dayLabel = $derived(
		new Date(performance.startTime).toLocaleDateString('de-DE', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	class="fixed inset-0 z-[200] flex items-center justify-center bg-fest-text/80 p-4 backdrop-blur-sm"
	tabindex="-1"
	role="dialog"
	aria-modal="true"
	aria-labelledby="perf-detail-title"
	onclick={onclose}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-lg border-l-4 shadow-2xl {cardClass}"
		onclick={(e: MouseEvent) => e.stopPropagation()}
	>
		<div class="flex items-start justify-between gap-3 p-5 pb-3">
			<div class="min-w-0 flex-1">
				<h2
					id="perf-detail-title"
					class="font-neo-heading text-2xl font-bold uppercase break-words {textClass}"
				>
					{artist?.name ?? 'Unknown Artist'}
				</h2>
				{#if SHOW_GENRE && artist?.genre}
					<span class="text-sm font-bold uppercase tracking-wider {genreClass}">
						{artist.genre}
					</span>
				{/if}
			</div>
			<button
				class="text-4xl leading-none transition-transform active:scale-95 {artist?.isFavorite
					? 'text-fest-logo opacity-100 drop-shadow-md'
					: 'opacity-50 hover:opacity-100'} {textClass}"
				onclick={ontogglefavorite}
				aria-label="Favorite"
			>
				<span class="inline-block scale-y-[0.85]">{#if artist?.isFavorite}♥{:else}♡{/if}</span>
			</button>
		</div>

		<div class="flex flex-wrap items-center gap-2 px-5 pb-4">
			<span
				class="rounded border border-fest-teal/40 bg-fest-dark-teal px-2 py-1 text-sm font-bold text-fest-turquoise"
			>
				{timeLabel}
			</span>
			{#if stage}
				<span
					class="rounded border border-fest-teal/40 bg-fest-dark-teal px-2 py-1 text-sm font-bold text-fest-turquoise"
				>
					● {stage.name}
				</span>
			{/if}
			<span
				class="rounded border border-fest-teal/40 bg-fest-dark-teal px-2 py-1 text-sm font-bold text-fest-turquoise capitalize"
			>
				{dayLabel}
			</span>
		</div>

		{#if performance.info}
			<div class="overflow-y-auto border-t border-fest-text/10 bg-fest-widget/95 px-5 py-4">
				<p class="text-sm leading-relaxed whitespace-pre-line text-fest-text">
					{performance.info}
				</p>
			</div>
		{/if}

		<div class="flex justify-end border-t border-fest-text/10 bg-fest-widget/95 px-5 py-3">
			<button
				class="fest-button rounded-full bg-fest-blue px-4 py-2 text-sm font-bold text-fest-widget"
				onclick={onclose}
			>
				Schließen
			</button>
		</div>
	</div>
</div>
