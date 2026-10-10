"""Small local media-context worker. No model calls, downloads, or transcription."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from claude_real_video import core


def prepare(request):
    started = time.perf_counter()
    source = Path(request['source']).resolve(strict=True)
    output = Path(request['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / 'frames.json'
    if manifest.exists():
        saved = json.loads(manifest.read_text(encoding='utf-8'))
        if all((output / frame['file']).is_file() for frame in saved['frames']):
            return {**saved, 'cached': True, 'elapsedMs': round((time.perf_counter()-started)*1000)}

    def run(command):
        executable = request['ffprobe'] if command[0] == 'ffprobe' else request['ffmpeg']
        args = [executable, *command[1:]]
        if command[0] == 'ffmpeg':
            args[1:1] = ['-nostdin', '-threads', '4', '-filter_threads', '2']
            # Scene scoring needs visual structure, not full-resolution pixels.
            # Downscale before CRV's select filter while preserving source PTS.
            if '-vf' in args:
                index = args.index('-vf') + 1
                filters = args[index]
                if filters.startswith('select=') and ',showinfo,scale=' in filters:
                    selection, scale = filters.split(',showinfo,', 1)
                    args[index] = scale + ',' + selection + ',showinfo'
        return subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace',
                              timeout=40, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    core._run = run  # Use Dream's bundled executables and keep Windows subprocesses hidden.
    core._vfr_flag.cache_clear()
    duration = float(request['endSec']) - float(request.get('startSec', 0))
    with tempfile.TemporaryDirectory(prefix='frames-', dir=output) as temporary:
        decode_start = time.perf_counter()
        count, times = core.extract_frames(str(source), temporary, scene=.30,
                                          fps_floor=max(.75, duration / 24),
                                          start=float(request.get('startSec', 0)), end=float(request['endSec']),
                                          frame_width=int(request.get('width', 384)))
        if count == 0 or len(times) != count:
            raise ValueError('No timestamped frames could be extracted from this source.')
        decode_ms = round((time.perf_counter()-decode_start)*1000)
        dedup_start = time.perf_counter()
        _, records = core.dedup_frames(temporary, threshold=8, window=2, max_frames=0, times=times)
        dedup_ms = round((time.perf_counter()-dedup_start)*1000)
        kept = [row for row in records if row['kept']]
        limit = int(request.get('maxFrames', 12))
        if len(kept) > limit:
            kept = [kept[round(i*(len(kept)-1)/(limit-1))] for i in range(limit)]
        frames = []
        for index, row in enumerate(kept):
            name = f'frame-{index:02}.jpg'
            os.replace(Path(temporary) / row['name'], output / name)
            frames.append({'file': name, 'timeSec': row['t'], 'selection': row['via']})
        result = {'frames': frames, 'extractedFrames': count, 'library': 'claude-real-video@0.10.7',
                  'cached': False, 'decodeMs': decode_ms, 'dedupMs': dedup_ms,
                  'elapsedMs': round((time.perf_counter()-started)*1000)}
        pending = output / 'frames.tmp.json'
        pending.write_text(json.dumps(result), encoding='utf-8')
        os.replace(pending, manifest)
        return result


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            print(json.dumps({'result': prepare(request)}), flush=True)
        except Exception as error:
            print(json.dumps({'error': str(error)}), flush=True)


if __name__ == '__main__':
    main()
