/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/vanillajs" />

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Build-time env vars from Vite (set via .env files or Vercel dashboard)
// See .env.development and .env.production for documentation
declare namespace App {
	interface Env {
		PUBLIC_SCHEDULE_IMPORT_MODE: 'dragdrop' | 'file';
	}
}

export {};
