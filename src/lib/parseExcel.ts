import * as XLSX from 'xlsx';
import type { Stage, Artist, Performance } from './types';

const TZ_OFFSET = 2;

const STAGE_COLORS = [
	'bg-fest-blue',
	'bg-fest-dark-teal',
	'bg-fest-teal',
	'bg-fest-green-teal',
	'bg-fest-beige',
	'bg-fest-turquoise'
];

function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function parseDate(day: number, month: number, timeStr: string, year: number): Date {
	const [h, m] = timeStr.split(':').map(Number);
	const d = new Date(Date.UTC(year, month - 1, day, h - TZ_OFFSET, m));
	return d;
}

function parseDayMonth(tag: string): { day: number; month: number } | null {
	const m = tag.match(/(\d+)\.(\d+)/);
	if (!m) return null;
	return { day: parseInt(m[1]), month: parseInt(m[2]) };
}

function parseEndDay(bis: string): { day: number; month: number } | null {
	const m = bis.match(/\((\d+)\.(\d+)\.\)/);
	if (!m) return null;
	return { day: parseInt(m[1]), month: parseInt(m[2]) };
}

interface ExcelRow {
	tag: string;
	von: string;
	bis: string;
	name: string;
	gruppe: string;
	bereich: string;
	ereignisart: string;
	genre: string;
	typ: string;
	info: string;
}

function cleanCell(v: unknown): string {
	if (v === null || v === undefined) return '';
	const s = String(v).trim();
	return s;
}

export interface ParsedSchedule {
	stages: Stage[];
	artists: Artist[];
	performances: Performance[];
}

function detectYear(rows: ExcelRow[]): number {
	const yearMatch = rows.length > 0 ? rows[0].tag.match(/(\d{4})/) : null;
	if (yearMatch) return parseInt(yearMatch[1]);
	return new Date().getFullYear();
}

export function parseExcelToSchedule(data: ArrayBuffer): ParsedSchedule {
	const wb = XLSX.read(data, { type: 'array' });
	const ws = wb.Sheets['Worksheet'];
	if (!ws) {
		throw new Error('Excel file must contain a "Worksheet" sheet');
	}

	const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
		header: [
			'tag',
			'von',
			'bis',
			'name',
			'teilnehmende',
			'gruppen',
			'bereich',
			'jobs',
			'beschreibung',
			'ereignisart',
			'genre',
			'typ',
			'info'
		],
		range: 3,
		defval: ''
	});

	const rows: ExcelRow[] = [];
	for (const raw of rawRows) {
		const tag = cleanCell(raw.tag);
		const name = cleanCell(raw.name);
		if (!tag || !name) continue;
		rows.push({
			tag,
			von: cleanCell(raw.von),
			bis: cleanCell(raw.bis),
			name,
			gruppe: cleanCell(raw.gruppen),
			bereich: cleanCell(raw.bereich),
			ereignisart: cleanCell(raw.ereignisart),
			genre: cleanCell(raw.genre),
			typ: cleanCell(raw.typ),
			info: cleanCell(raw.info)
		});
	}

	const year = detectYear(rows);

	// Track stages in first-appearance order from the sheet, deduped.
	const stageNames: string[] = [];
	const stageSeen = new Set<string>();
	for (const r of rows) {
		if (r.bereich && !stageSeen.has(r.bereich)) {
			stageSeen.add(r.bereich);
			stageNames.push(r.bereich);
		}
	}
	const stages: Stage[] = stageNames.map((name, i) => ({
		id: `stage-${slugify(name)}`,
		name,
		// Default order follows sheet appearance; can be overridden manually
		// in mockData.json and is preserved across regenerations.
		order: i,
		color: STAGE_COLORS[i % STAGE_COLORS.length]
	}));
	const stageIdMap = new Map(stages.map((s) => [s.name, s.id]));

	const seenSlugs = new Set<string>();
	const artists: Artist[] = [];
	const artistIdMap = new Map<string, string>();
	for (const r of rows) {
		const slug = slugify(r.name);
		let id = `art-${slug}`;
		if (seenSlugs.has(id)) continue;
		seenSlugs.add(id);
		artistIdMap.set(r.name, id);
		artists.push({
			id,
			name: r.name,
			genre: r.genre || 'Various'
		});
	}

	const performances: Performance[] = [];
	let perfCounter = 1;
	for (const r of rows) {
		const dm = parseDayMonth(r.tag);
		if (!dm) continue;
		const { day, month } = dm;

		const startTime = r.von.includes(':')
			? parseDate(day, month, r.von, year)
			: new Date(Date.UTC(year, month - 1, day, 0 - TZ_OFFSET, 0));

		const endDayMonth = parseEndDay(r.bis);
		const bisClean = r.bis.split('(')[0].trim();
		let endTime: Date;
		if (bisClean.includes(':')) {
			if (endDayMonth) {
				endTime = parseDate(endDayMonth.day, endDayMonth.month, bisClean, year);
			} else {
				endTime = parseDate(day, month, bisClean, year);
			}
			if (endTime < startTime) {
				endTime = new Date(endTime.getTime() + 86400000);
			}
		} else {
			endTime = new Date(startTime.getTime() + 3600000);
		}

		const stageId = stageIdMap.get(r.bereich) ?? '';
		const artistId = artistIdMap.get(r.name) ?? '';

		performances.push({
			id: `perf-${String(perfCounter).padStart(4, '0')}`,
			stageId,
			artistId,
			startTime: startTime.toISOString(),
			endTime: endTime.toISOString(),
			type: r.typ || r.ereignisart || 'Show',
			...(r.info ? { info: r.info } : {})
		});
		perfCounter++;
	}

	return { stages, artists, performances };
}
