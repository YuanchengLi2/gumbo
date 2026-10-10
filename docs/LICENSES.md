# Runtime and model provenance

Electron (MIT), React (MIT), Vite (MIT), Zustand (MIT), better-sqlite3 (MIT), sqlite-vec (MIT/Apache-2.0), Zod (MIT), Lucide (ISC), Whisper / whisper.cpp (MIT). Preserve each package's original notices in the distributed package.

The pinned large-v3-turbo GGML file is distributed by ggerganov/whisper.cpp; its full SHA-256 and size are in `apps/desktop/resources/models-manifest.json`. Downloads verify both before installation. Runtime b5130 is pinned separately with its release SHA-256.

FFmpeg redistribution needs the license corresponding to the exact staged build and its corresponding source availability. The ffmpeg-static Windows binary includes GPL components; shipping it requires GPL notices/source obligations. `ffmpeg.exe.LICENSE` and `ffmpeg.exe.README` must accompany the executable. Do not characterize this build as LGPL-only.

Remotion's licensing and company-use terms must be reviewed for the publisher before commercial distribution. Development use here does not assert a purchased company license.

pyannote model weights have separate access/redistribution conditions. No gated weights or publisher Hugging Face tokens are embedded. Their runtime remains unavailable until approved, locally staged model artifacts exist. The Python runtime is locked, frozen and staged. Frozen scene-detection and audio-analysis checks passed; model-dependent backends and redistribution notices still require release verification.

Dream's score/SFX catalog is original deterministic synthesis; no sampled music, filmed scenes, or voices are included. The system Arial font is used; no font files are redistributed at this stage.

## OpenCut Classic interaction algorithms

The manual editor incorporates MIT-licensed code from OpenCut Classic, pinned to commit `cf5e79e919144200294fb9fed22a222592a0aeea`: selection/range/box logic, snapping, grouped trimming, ruler spacing, pointer-to-time conversion and zoom. Imports and constant-speed timing adapters connect these algorithms to Dream's existing timeline and operation engine. No OpenCut UI is copied.

Source and adaptation notes: `apps/desktop/src/renderer/manual/opencut/UPSTREAM.md`. The original copyright and MIT notice are retained alongside the source and distributed under `resources/notices/OpenCut-LICENSE.txt`.

## Optional scene-aware context

claude-real-video 0.10.7 (MIT) supplies local frame extraction/deduplication for requested scene-aware ranges. Dream uses its local core API only; downloader, network, model-installation, and transcription extras are not shipped in the context worker. Its license is preserved in resources/notices/claude-real-video-LICENSE.txt. The default immediate overview uses the existing FFmpeg runtime and encoded keyframe seeks.
