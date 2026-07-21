<script lang="ts">
	import { db, dbReady } from '$lib/db';
	import { parseExcelToSchedule } from '$lib/parseExcel';
	import { dbReloadSignal } from '$lib/store';

	let dragging = $state(false);
	let importing = $state(false);
	let feedback = $state<{ ok: boolean; msg: string } | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function handleDragLeave() {
		dragging = false;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) await processFile(file);
	}

	async function handleFilePick(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) await processFile(file);
	}

	async function processFile(file: File) {
		if (!file.name.endsWith('.xlsx')) {
			feedback = { ok: false, msg: 'Please select an .xlsx file' };
			return;
		}
		importing = true;
		feedback = null;
		try {
			const buf = await file.arrayBuffer();
			const schedule = parseExcelToSchedule(buf);
			await dbReady();
			await db.transaction('rw', db.stages, db.artists, db.performances, db.meta, async () => {
				await db.stages.clear();
				await db.artists.clear();
				await db.performances.clear();
				await db.stages.bulkAdd(schedule.stages);
				await db.artists.bulkAdd(schedule.artists);
				await db.performances.bulkAdd(schedule.performances);
				// Mark this local import as the newest seed so the bundled
				// mockData.json won't overwrite it on the next load.
				await db.meta.put({ key: 'seedVersion', value: Date.now() });
			});
			dbReloadSignal.update(n => n + 1);
			feedback = {
				ok: true,
				msg: `Loaded ${schedule.stages.length} stages, ${schedule.artists.length} artists, ${schedule.performances.length} performances`
			};
		} catch (err) {
			feedback = { ok: false, msg: err instanceof Error ? err.message : 'Parse failed' };
		} finally {
			importing = false;
		}
	}
</script>

<div
	class="border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer {dragging
		? 'border-fest-logo bg-fest-logo/10'
		: 'border-fest-teal/40 hover:border-fest-teal/80'}"
	class:opacity-50={importing}
	role="button"
	tabindex="0"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	onclick={() => fileInput?.click()}
	onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
>
	<input
		type="file"
		accept=".xlsx"
		class="hidden"
		bind:this={fileInput}
		onchange={handleFilePick}
	/>
	{#if importing}
		<p class="text-fest-turquoise text-sm animate-pulse">Importing schedule...</p>
	{:else if feedback}
		<p class="text-sm {feedback.ok ? 'text-fest-green-teal' : 'text-fest-logo'}">
			{feedback.msg}
		</p>
		{#if feedback.ok}
			<p class="text-[10px] text-fest-teal mt-1">Click or drop to replace</p>
		{/if}
	{:else}
		<svg class="w-8 h-8 mx-auto mb-1 text-fest-teal/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
		</svg>
		<p class="text-xs text-fest-teal">Drop .xlsx file here or click to browse</p>
		<p class="text-[10px] text-fest-teal/50 mt-1">Replace entire schedule</p>
	{/if}
</div>
