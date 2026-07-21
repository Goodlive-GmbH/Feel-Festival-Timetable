import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			scope: '/',
			base: '/',
			manifest: {
				name: 'Festival Timetable',
				short_name: 'Timetable',
				description: 'Offline-first festival companion app',
				theme_color: '#142C50',
				background_color: '#142C50',
				display: 'standalone',
				start_url: '/',
				scope: '/',
				icons: [
					{
						src: '/pwa-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: '/pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable'
					}
				]
			},
			workbox: {
				// Precache build assets plus the static festival-map tile pyramid
				// (resvg/sharp generated WebP tiles under static/tiles/) so the map
				// is available offline after the PWA is installed.
				globPatterns: ['client/**/*.{js,css,html,ico,png,svg}', 'client/tiles/**/*.webp'],
				navigateFallback: '/',
				runtimeCaching: [
					{
						urlPattern: /^\/?$/,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'pages',
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24
							}
						}
					}
				]
			},
			devOptions: {
				enabled: true,
				type: 'module',
				navigateFallback: '/'
			},
			kit: {
				includeVersionFile: true
			}
		})
	]
});
