export const liveSceneGuide=`# Live scenes

Chat creates code. Never render PNG sequences, record browser playback, or encode a video during chat. Only the user's Export action renders and encodes.

Write an HTML scene, for example src/intro/scene.html. Put JavaScript inline or in local files referenced with <script src="...">; reference stylesheets with <link rel="stylesheet" href="...">. Publication inlines these workspace files into one self-contained scene. Bundle npm libraries with the bundle_scene tool (for example entry src/intro/main.js, output output/intro.js) and reference the bundle with <script src="../../output/intro.js"></script> (paths are relative to the scene file, or to the workspace root). Splitting a scene into several files keeps each write small. Use plain scripts, not type="module". External URLs, network fetches and browser automation are unavailable. HTML, SVG, Canvas and WebGL all work. Do not use wall-clock animation, CSS transitions or autonomous requestAnimationFrame loops. Every animation must be a deterministic function of time.

Define window.renderFrame = async function(frame, fps) { ... }. Gumbo calls it at the current scene frame during playback, seeking and export. Time is frame/fps. Set the complete scene state on every call; seeking backwards must work. Await asynchronous drawing work before returning. The scene runs in an isolated iframe at its declared width and height. Default body margin is zero. It cannot access Gumbo, files, credentials or the network.

Example self-contained scene:
<!doctype html><html><body><div id="title" style="color:white;font:80px sans-serif">Hello</div><script>
window.renderFrame = (frame, fps) => {
 document.body.style.background = '#111827';
 document.getElementById('title').style.transform = 'translateX(' + (frame / fps * 100) + 'px)';
};
</script></body></html>

Declare it in project.json outputs:
{"id":"intro","kind":"scene","path":"src/intro/scene.html","width":1920,"height":1080,"fps":30,"durationInFrames":150}
Reference assetId "output:intro" in the spine or a visual source layer, using srcIn:0 and srcOut:5 for this example. Read context/project-schema.json for the complete timeline schema. Call publish_project once the source and timeline are ready; commands never publish. Successful publication immediately updates the right panel and rewrites project.json with the new baseVersionId and resolved asset IDs (outputs is emptied). To revise a scene already on the timeline, edit its files and publish: the scene is rebuilt from the edited source and the timeline updates automatically. If publication reports a newer version, read context/published-project.json and reapply your change on top of it.

Keep video footage and audio on the shared timeline, not inside the iframe. Use existing asset IDs for footage, music, voice and sound effects; static image and audio files may be declared under output/ with kind image or audio. Put audio in timeline.music or audio source layers so playback, mute, seeking and Export share the same mix. Do not create video files or image sequences for animation. A live scene has no baked audio or frames.

Nothing renders during chat, so make layouts robust in code: size text relative to the scene width and height, measure long text and scale it down to fit its box, keep content inside safe margins, and use flex or grid layout so elements cannot overlap. view_media with target preview returns saved timeline metadata only. Finish once the change is published.
`;
