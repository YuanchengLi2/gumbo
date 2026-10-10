// Copyright 2025-2026 OpenCut. MIT. See OpenCut-LICENSE.txt and UPSTREAM.md.
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "./scale";
import { mediaTime, type MediaTime, TICKS_PER_SECOND } from "../compat";

export function getMouseTimeFromClientX({
	clientX,
	containerRect,
	zoomLevel,
	scrollLeft,
}: {
	clientX: number;
	containerRect: DOMRect;
	zoomLevel: number;
	scrollLeft: number;
}): MediaTime {
	const mouseX = clientX - containerRect.left + scrollLeft;
	const seconds = Math.max(
		0,
		mouseX / (BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel),
	);
	return mediaTime({
		ticks: Math.round(seconds * TICKS_PER_SECOND),
	});
}
