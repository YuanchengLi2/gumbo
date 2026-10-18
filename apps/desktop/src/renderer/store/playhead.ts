import {create} from 'zustand';

/** The frame the player is on, updated every frame while it plays. It is kept apart from the editor store because the
 * workspace re-renders on any change to that store: a 10-minute edit with a hundred clips took 300 ms to re-render, so
 * a frame-by-frame update played at 2 frames a second. Only the playhead line, the timecode and the scrubber follow this;
 * the editor's own frame is set when playback stops or the playhead is moved. */
export const usePlayhead=create<{frame:number}>(()=>({frame:0}));
