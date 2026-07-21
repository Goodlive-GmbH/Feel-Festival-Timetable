import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = '/home/agent/workspace/src/lib/assets/festival-map.svg';
const TILE_DIR = '/home/agent/workspace/static/tiles';
const TILE_SIZE = 512;
const MIN_ZOOM = 0;
const MAX_ZOOM = 3;

// Native pixel dimensions of the map graphic (z = MAX_ZOOM).
const IMG_W = 7425;
const IMG_H = 5280;

// IMPORTANT: for a stretch-free pyramid the base grid must be a multiple of
// (TILE_SIZE * 2^MAX_ZOOM) on BOTH axes, otherwise tile counts don't halve
// evenly between levels and each level's tile-grid aspect drifts -> Leaflet
// stretches the content when cross-scaling (z0 looked square, z2 edges
// stretched). That forces a SQUARE base grid of side = multiple of 4096.
// The map content is centered inside with transparent padding, so its true
// aspect ratio is preserved (it just gets letterboxed, never stretched).
const GRID_SIDE =
	Math.ceil(Math.max(IMG_W, IMG_H) / (TILE_SIZE * Math.pow(2, MAX_ZOOM))) *
	TILE_SIZE *
	Math.pow(2, MAX_ZOOM); // 8192
const GRID_W = GRID_SIDE;
const GRID_H = GRID_SIDE;

// Padding (px) applied equally on each side to center the map inside the square.
const PAD_X = (GRID_W - IMG_W) / 2;
const PAD_Y = (GRID_H - IMG_H) / 2;

async function rasterize() {
	console.log('Rasterizing SVG with resvg...');
	const svg = fs.readFileSync(SRC, 'utf8');
	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: IMG_W } });
	// Resvg has no transparent-pad option, so rasterize at native size then use
	// sharp to composite it, centered, onto the exact grid canvas.
	const png = resvg.render().asPng();
	const fitted = await sharp(png, { limitInputPixels: false })
		.resize(GRID_W, GRID_H, {
			fit: 'contain',
			background: { r: 0, g: 0, b: 0, alpha: 0 },
			kernel: 'lanczos3'
		})
		.png()
		.toBuffer();
	console.log(`  Grid PNG: ${GRID_W}x${GRID_H}, ${(fitted.length / 1e6).toFixed(1)} MB`);
	return fitted;
}

async function sliceZoom(gridBuffer, zoom, prevDims) {
	// Build dimensions by halving the PREVIOUS level (top-down). GRID_W/GRID_H are
	// already exact multiples of TILE_SIZE, so every derived level is too, and
	// each level is EXACTLY 2x its child (what Leaflet assumes).
	const w = prevDims ? Math.max(1, Math.round(prevDims.w / 2)) : GRID_W;
	const h = prevDims ? Math.max(1, Math.round(prevDims.h / 2)) : GRID_H;
	const cols = Math.ceil(w / TILE_SIZE);
	const rows = Math.ceil(h / TILE_SIZE);

	const zDir = path.join(TILE_DIR, String(zoom));
	fs.mkdirSync(zDir, { recursive: true });

	// Render the resize to a buffer ONCE, then slice tiles from that buffer.
	const resizedBuffer = await sharp(gridBuffer, { limitInputPixels: false })
		.resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
		.toBuffer();
	const img = sharp(resizedBuffer);

	const tileTasks = [];
	let count = 0;
	let bytes = 0;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const left = x * TILE_SIZE;
			const top = y * TILE_SIZE;
			const width = Math.min(TILE_SIZE, w - left);
			const height = Math.min(TILE_SIZE, h - top);
			const outDir = path.join(zDir, String(x));
			fs.mkdirSync(outDir, { recursive: true });
			const out = path.join(outDir, `${y}.webp`);
			tileTasks.push(async () => {
				await img.clone().extract({ left, top, width, height }).webp({ quality: 80 }).toFile(out);
				bytes += fs.statSync(out).size;
				count++;
			});
		}
	}
	const CONCURRENCY = 8;
	for (let i = 0; i < tileTasks.length; i += CONCURRENCY) {
		await Promise.all(tileTasks.slice(i, i + CONCURRENCY).map((t) => t()));
	}
	console.log(
		`  z=${zoom}: ${count} tiles (${cols}x${rows}), ${w}x${h}, ${(bytes / 1e6).toFixed(1)} MB`
	);
	return { w, h };
}

async function main() {
	// Expose grid/padding constants for the component to keep markers aligned.
	const meta = { GRID_W, GRID_H, PAD_X, PAD_Y, IMG_W, IMG_H, TILE_SIZE, MAX_ZOOM };
	fs.writeFileSync(path.join(TILE_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

	const gridBuffer = await rasterize();
	fs.rmSync(TILE_DIR, { recursive: true, force: true });
	fs.mkdirSync(TILE_DIR, { recursive: true });
	fs.writeFileSync(path.join(TILE_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

	let prev = null;
	for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
		prev = await sliceZoom(gridBuffer, z, prev);
	}
	console.log('Done.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
