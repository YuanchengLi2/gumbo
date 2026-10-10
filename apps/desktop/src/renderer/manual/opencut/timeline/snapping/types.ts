// Copyright 2025-2026 OpenCut. MIT. See OpenCut-LICENSE.txt and UPSTREAM.md.
import type { MediaTime } from "../../compat";

export type SnapPointType =
	| "element-start"
	| "element-end"
	| "playhead"
	| "bookmark"
	| "keyframe";

export interface SnapPoint {
	time: MediaTime;
	type: SnapPointType;
	elementId?: string;
	trackId?: string;
}

export interface SnapResult {
	snappedTime: MediaTime;
	snapPoint: SnapPoint | null;
	snapDistance: number;
}

export type TimelineSnapPointSource = () => Iterable<SnapPoint>;
