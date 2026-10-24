"""Quick render on Modal: draws an export's coded scene in many cloud browsers at once.

The editor gets a pass from the gateway (supabase/functions/dream-gateway/scene-render.ts) and posts the scene here:
POST / {token, job:{page, width, height, fps, frames, payload}}. The frames are split into chunks, each drawn by
render.mjs in a container of its own, and the answer is every chunk as a WebM with transparency:
{fps, chunks:[{start, end, webm (base64)}]}. The editor decodes them in place of drawing the scene itself.

Deploy: modal deploy services/scene-render/app.py, with a Modal secret named gumbo-scene-render holding
SCENE_RENDER_SECRET (the same value as the gateway's DREAM_SCENE_RENDER_SECRET).
"""
import base64
import json
import math
import os
import subprocess
import tempfile
import time
from pathlib import Path

import modal

from passes import check_pass

HERE = Path(__file__).parent
PLAYWRIGHT = "1.63.0"
# Playwright's own image: Node, Chromium and everything Chromium needs; ffmpeg encodes the frames.
image = (
    modal.Image.from_registry(f"mcr.microsoft.com/playwright:v{PLAYWRIGHT}-noble", add_python="3.12")
    .apt_install("ffmpeg")
    .run_commands(f"mkdir -p /render && cd /render && npm init -y >/dev/null && npm install playwright-core@{PLAYWRIGHT}")
    .pip_install("fastapi[standard]==0.115.6")
    .add_local_file(HERE / "render.mjs", "/render/render.mjs")
    .add_local_python_source("passes")
)
app = modal.App("gumbo-scene-render", image=image)
secret = modal.Secret.from_name("gumbo-scene-render")

MAX_CHUNKS = 24
MIN_CHUNK = 30
MAX_FRAMES = 36_000
MAX_PAYLOAD = 80 * 1024 * 1024
ORIGINS = ["https://usegumbo.app", "http://localhost:5180", "http://localhost:5181"]
# The cloud browsers open scene pages on the live site, the only one they can reach.
SCENE_PAGES = "https://usegumbo.app/app/engine/app/scene/"


def chunks(frames: int) -> list[tuple[int, int]]:
    size = max(MIN_CHUNK, math.ceil(frames / MAX_CHUNKS))
    return [(start, min(frames, start + size)) for start in range(0, frames, size)]


@app.function(cpu=2.0, memory=4096, timeout=600, max_containers=100)
def render_chunk(job: dict, start: int, end: int) -> bytes:
    with tempfile.TemporaryDirectory() as folder:
        job_path, out_path = Path(folder) / "job.json", Path(folder) / "out.webm"
        job_path.write_text(json.dumps({**job, "start": start, "end": end}))
        result = subprocess.run(["node", "/render/render.mjs", str(job_path), str(out_path)], cwd="/render", capture_output=True, text=True, timeout=570)
        if result.returncode != 0:
            raise RuntimeError(f"Frames {start}-{end} failed: {result.stderr[-2000:]}")
        return out_path.read_bytes()


@app.function(secrets=[secret], timeout=900)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI()
    api.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST"], allow_headers=["content-type"])

    @api.post("/")
    async def render(request: Request):
        if int(request.headers.get("content-length") or 0) > MAX_PAYLOAD:
            raise HTTPException(413, "This scene's files are too big for quick render.")
        body = await request.json()
        job = body.get("job") or {}
        frames = int(job.get("frames") or 0)
        if not (0 < frames <= MAX_FRAMES) or not str(job.get("page", "")).startswith(SCENE_PAGES):
            raise HTTPException(400, "This is not a scene quick render can draw.")
        try:
            account = check_pass(str(body.get("token", "")), os.environ["SCENE_RENDER_SECRET"], frames)
        except PermissionError as error:
            raise HTTPException(403, str(error))
        began = time.time()
        parts = chunks(frames)
        videos = [video async for video in render_chunk.starmap.aio([(job, start, end) for start, end in parts])]
        print(f"{account}: {frames} frames at {job.get('width')}x{job.get('height')} in {len(parts)} chunks, {time.time() - began:.1f}s")
        return {"fps": job["fps"], "chunks": [{"start": start, "end": end, "webm": base64.b64encode(video).decode()} for (start, end), video in zip(parts, videos)]}

    return api
