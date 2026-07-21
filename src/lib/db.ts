import Dexie, { type EntityTable } from 'dexie';
import type { Stage, Artist, Performance, Poi } from './types';
import initialData from './mockData.json';

// The seed version travels with the data: the convert script writes a fresh
// `seedVersion` into mockData.json on every regeneration, so clients reseed
// their local database automatically on the next load.
const SEED_VERSION = (initialData[0] as { seedVersion?: number })?.seedVersion ?? 0;

interface MetaEntry {
	key: string;
	value: number;
}

// Extend Dexie to strongly type our stores
class ScheduleDatabase extends Dexie {
	stages!: EntityTable<Stage, 'id'>;
	artists!: EntityTable<Artist, 'id'>;
	performances!: EntityTable<Performance, 'id'>;
	pois!: EntityTable<Poi, 'id'>;
	meta!: EntityTable<MetaEntry, 'key'>;

	constructor() {
		super('ScheduleTimetableDB');

		// Define the schema for version 1
		this.version(1).stores({
			stages: 'id',
			artists: 'id',
			performances: 'id, stageId, artistId, startTime'
		});

		// Version 2 adds a meta store to track the seed data version
		this.version(2).stores({
			stages: 'id',
			artists: 'id',
			performances: 'id, stageId, artistId, startTime',
			meta: 'key'
		});

		// Version 3 adds a pois store for map points of interest
		this.version(3).stores({
			stages: 'id',
			artists: 'id',
			performances: 'id, stageId, artistId, startTime',
			pois: 'id, type',
			meta: 'key'
		});
	}
}

export const db = new ScheduleDatabase();

// This runs on app startup. Reseeds when the DB is empty or the seed data
// version has changed, preserving user favorites by artist id.
export async function seedDatabase() {
	const [data] = initialData; // Our mock list array wrapper

	const storedVersion = (await db.meta.get('seedVersion'))?.value ?? 0;
	const count = await db.performances.count();

	if (count > 0 && storedVersion === SEED_VERSION) {
		console.log('Database already up to date. Skipping seed.');
		return;
	}

	console.log('Seeding database (version change or empty)...');

	// Preserve favorites across reseed
	const existingArtists = await db.artists.toArray();
	const favoriteIds = new Set(existingArtists.filter((a) => a.isFavorite).map((a) => a.id));

	const artistsToSeed = data.artists.map((a) =>
		favoriteIds.has(a.id) ? { ...a, isFavorite: true } : a
	);

	const poisToSeed: Poi[] = ((data as { pois?: Poi[] }).pois ?? []) as Poi[];

	await db.transaction(
		'rw',
		[db.stages, db.artists, db.performances, db.pois, db.meta],
		async () => {
			await db.stages.clear();
			await db.artists.clear();
			await db.performances.clear();
			await db.pois.clear();

			await db.stages.bulkAdd(data.stages);
			await db.artists.bulkAdd(artistsToSeed);
			await db.performances.bulkAdd(data.performances);
			await db.pois.bulkAdd(poisToSeed);

			await db.meta.put({ key: 'seedVersion', value: SEED_VERSION });
		}
	);

	console.log('Database seeded successfully from JSON.');
}

// Ensures database is seeded before any read operations.
// Cached so multiple calls don't re-seed.
let _ready: Promise<void> | null = null;
export function dbReady(): Promise<void> {
	if (!_ready) {
		_ready = seedDatabase().then(() => {});
	}
	return _ready;
}
