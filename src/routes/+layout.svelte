<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { seedDatabase } from '$lib/db';
	import { pwaInfo } from 'virtual:pwa-info';

	let { children } = $props();

	onMount(async () => {
		await seedDatabase();

		if (pwaInfo) {
			const { registerSW } = await import('virtual:pwa-register');
			registerSW({
				immediate: true,
				onRegistered() {
					console.log('SW registered');
				},
				onRegisterError(error: unknown) {
					console.error('SW registration error', error);
				}
			});
		}
	});

	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');
</script>

<svelte:head>
	<title>Feel Festival Timetable</title>
	<meta
		name="description"
		content="Feel Festival 2026 - Timetable und Festival Map"
	/>

	<link rel="icon" href={favicon} />
	{@html webManifestLink}
</svelte:head>
{@render children()}
