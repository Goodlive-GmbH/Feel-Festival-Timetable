#!/usr/bin/env npx tsx
/**
 * Convert festival timetable Excel file to the app's JSON seed format.
 *
 * Usage:
 *   npx tsx scripts/convert_timetable.ts [input.xlsx] [output.json]
 *
 * Defaults:
 *   input  = import/timetable.xlsx
 *   output = src/lib/mockData.json
 *
 * Excel must have a "Worksheet" sheet with rows starting at row 4
 * and columns: tag (A), von (B), bis (C), name (D), teilnehmende (E),
 * gruppen (F), bereich (G), jobs (H), beschreibung (I), ereignisart (J),
 * genre (K), typ (L).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseExcelToSchedule } from '../src/lib/parseExcel.js';
import type { Stage, Poi } from '../src/lib/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const input = resolve(process.argv[2] || `${projectRoot}/import/timetable.xlsx`);
const output = resolve(process.argv[3] || `${projectRoot}/src/lib/mockData.json`);

console.log(`Reading: ${input}`);
const buf = readFileSync(input).buffer;
const schedule = parseExcelToSchedule(buf);

// Bump the seed version so clients reseed their local database on next load.
const seedVersion = Date.now();

// Map coordinates (stage x/y), the manual display order, and the pois list are
// maintained by hand, not derived from the Excel sheet — carry them over from
// the existing JSON so a regeneration never wipes the festival map layout or
// the curated stage ordering.
let existingStages: Stage[] = [];
let existingPois: Poi[] = [];
if (existsSync(output)) {
	try {
		const [prev] = JSON.parse(readFileSync(output, 'utf-8')) as [
			{ stages?: Stage[]; pois?: Poi[] }
		];
		existingStages = prev?.stages ?? [];
		existingPois = prev?.pois ?? [];
	} catch {
		console.warn('Could not read existing map data; starting fresh.');
	}
}

const mergedStages = schedule.stages.map((stage) => {
	const prev = existingStages.find((s) => s.id === stage.id);
	return prev ? { ...stage, x: prev.x, y: prev.y, order: prev.order } : stage;
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
	output,
	JSON.stringify([{ ...schedule, stages: mergedStages, pois: existingPois, seedVersion }], null, 2),
	'utf-8'
);

console.log(`Written: ${output}`);
console.log(`  Seed version: ${seedVersion}`);
console.log(`  Stages: ${schedule.stages.length}`);
console.log(`  Artists: ${schedule.artists.length}`);
console.log(`  Performances: ${schedule.performances.length}`);
console.log(`  POIs (preserved): ${existingPois.length}`);
