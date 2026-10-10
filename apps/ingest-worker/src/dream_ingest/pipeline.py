import json
import os
import hashlib
import subprocess
from pathlib import Path

REVISION = 'dream-ingest-2'

def atomic_json(path: Path, value):
    temp = path.with_suffix('.tmp.json')
    temp.write_text(json.dumps(value), encoding='utf8')
    os.replace(temp, path)

def execute(request):
    source = Path(request['source']).resolve(strict=True)
    output = Path(request['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stage = request['stage']
    asset_id = request['assetId']
    config = request.get('config', {})
    identity = hashlib.sha256(json.dumps({'asset': request['fingerprint'], 'stage': stage, 'revision': REVISION, 'config': config, 'segments': request.get('segments'), 'frames': request.get('frames')}, sort_keys=True).encode()).hexdigest()
    cached = output / (stage + '-' + identity + '.json')
    if cached.exists():
        try:
            result = json.loads(cached.read_text(encoding='utf8'))
            expected = result.pop('artifactHash')
            actual = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
            if actual == expected:
                result['artifactHash'] = expected
                return result
        except (ValueError, KeyError, OSError):
            pass
        cached.unlink(missing_ok=True)
    if stage == 'shots':
        from scenedetect import open_video, SceneManager, ContentDetector
        video = open_video(str(source))
        manager = SceneManager()
        manager.add_detector(ContentDetector(threshold=27, min_scene_len=15))
        manager.detect_scenes(video, show_progress=False)
        scenes = manager.get_scene_list(start_in_scene=True)
        result = {'shots': [{'id': f'{asset_id}:shot{i}', 'assetId': asset_id, 'start': start.get_seconds(), 'end': end.get_seconds(), 'framePaths': []} for i, (start, end) in enumerate(scenes)]}
    elif stage == 'align':
        import whisperx
        model_dir = Path(config['modelDir']).resolve(strict=True)
        # The model is staged by the publisher; local_files_only prevents implicit downloads.
        model, metadata = whisperx.load_align_model(language_code=config.get('language', 'en'), device='cpu', model_name=str(model_dir), model_dir=str(model_dir))
        audio = whisperx.load_audio(str(source))
        aligned = whisperx.align(request['segments'], model, metadata, audio, 'cpu', return_char_alignments=False)
        result = {'words': [{'id': f'{asset_id}:w{i}', 'assetId': asset_id, 'text': w['word'], 'start': w['start'], 'end': w['end'], 'confidence': w.get('score', 0), 'speaker': 'unknown', 'pauseBefore': 0} for i, w in enumerate(aligned['word_segments']) if 'start' in w and 'end' in w]}
    elif stage == 'diarize':
        from pyannote.audio import Pipeline
        pipeline = Pipeline.from_pretrained(str(Path(config['modelConfig']).resolve(strict=True)))
        output = pipeline(str(source))
        diarization = getattr(output, 'speaker_diarization', output)
        result = {'speakers': [{'start': turn.start, 'end': turn.end, 'speaker': speaker} for turn, _, speaker in diarization.itertracks(yield_label=True)]}
    elif stage == 'faces':
        from .vision import faces
        result = {'faces': faces(source, asset_id, config)}
    elif stage == 'embeddings':
        from .vision import embeddings
        result = {'embeddings': embeddings(request['frames'], config)}
    elif stage == 'audio_features':
        from .audio import features
        result = features(source)
    else:
        raise ValueError('Unknown analysis stage: ' + stage)
    result['pipelineRevision'] = REVISION
    result['artifactHash'] = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    atomic_json(cached, result)
    return result
