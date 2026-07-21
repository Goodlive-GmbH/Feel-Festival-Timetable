export interface Stage {
	id: string;
	name: string;
	order?: number; // Manual display order (grid rows / map list). Lower = higher up.
	color?: string; // e.g. for Stage distinct background color
	x?: number; // Map position in image space (0-1 relative to overlay width)
	y?: number; // Map position in image space (0-1 relative to overlay height)
}

export type PoiType = 'food' | 'wc' | 'entrance' | 'medical' | 'camping' | 'water' | 'info';

export interface Poi {
	id: string;
	name: string;
	type: PoiType;
	x: number; // Map position in image space (0-1 relative to overlay width)
	y: number; // Map position in image space (0-1 relative to overlay height)
}

export interface Artist {
	id: string;
	name: string;
	type?: string;
	genre?: string;
	isFavorite?: boolean; // We could store this separately but sticking it here or in a separate table is up to implementation
}

export interface Performance {
	id: string;
	stageId: string;
	artistId: string;
	startTime: string; // ISO 8601 string or numeric timestamp to keep robust timezone handling
	endTime: string;
	type?: string; // Per-performance type (DJ / Live / Rahmenprogramm)
	info?: string; // Optional detailed info text (Excel column M); enables the detail dialog
}
