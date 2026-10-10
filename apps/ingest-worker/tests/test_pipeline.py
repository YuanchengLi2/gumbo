import unittest
import tempfile
import wave
import json
from pathlib import Path
from dream_ingest.pipeline import execute

class PipelineTests(unittest.TestCase):
    def test_silent_audio_and_cache_repair(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'silent.wav'
            with wave.open(str(path), 'wb') as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(bytes(16000 * 2 * 2))
            request = {'id': 'test', 'source': str(path), 'output': folder, 'stage': 'audio_features', 'assetId': 'audio', 'fingerprint': 'silent-fixture', 'config': {}}
            result = execute(request)
            self.assertEqual(result['silence'], [{'start': 0.0, 'end': 2.0}])
            self.assertEqual(result['onsets'], [])
            cached = next(Path(folder).glob('audio_features-*.json'))
            cached.write_text('{broken', encoding='utf8')
            self.assertEqual(execute(request), result)
            self.assertEqual(json.loads(cached.read_text())['artifactHash'], result['artifactHash'])

    def test_real_video_scene_detection(self):
        source = Path(__file__).resolve().parents[3] / 'artifacts' / 'fixtures' / 'source.mp4'
        self.assertTrue(source.exists(), 'Generate the known six-second fixture first.')
        with tempfile.TemporaryDirectory() as folder:
            result = execute({'id': 'shots', 'source': str(source), 'output': folder, 'stage': 'shots', 'assetId': 'video', 'fingerprint': 'testsrc-6s', 'config': {}})
            self.assertGreaterEqual(len(result['shots']), 1)
            self.assertEqual(result['shots'][0]['start'], 0)
            self.assertAlmostEqual(result['shots'][-1]['end'], 6, places=1)
            self.assertTrue(all(s['end'] > s['start'] for s in result['shots']))

if __name__ == '__main__':
    unittest.main()
