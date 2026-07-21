import { writable } from 'svelte/store';

// Global state to handle communication between the Search Bar and the Timetable component
export const globalSearchQuery = writable<string>('');
export const selectedPerformanceId = writable<string | null>(null);
export const selectedStageId = writable<string | null>(null);

// Incremented after DB is re-seeded (e.g. via import) so components can re-fetch
export const dbReloadSignal = writable(0);
