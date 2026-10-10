def faces(source, asset_id, config):
    import cv2
    import mediapipe as mp
    cap = cv2.VideoCapture(str(source))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    options = mp.tasks.vision.FaceDetectorOptions(base_options=mp.tasks.BaseOptions(model_asset_path=config['modelFile']), running_mode=mp.tasks.vision.RunningMode.VIDEO, min_detection_confidence=.6)
    detector = mp.tasks.vision.FaceDetector.create_from_options(options)
    tracks = []
    for frame in range(0, int(frames), max(1, round(fps*.5))):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
        ok, image = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        detections = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), round(frame/fps*1000)).detections or []
        available = set(range(len(tracks)))
        for detection in detections:
            b = detection.bounding_box
            height, width = image.shape[:2]
            box = [max(0, b.origin_x/width), max(0, b.origin_y/height), min(1, b.width/width), min(1, b.height/height)]
            candidates = [(i, sum((tracks[i]['samples'][-1]['box'][j]-box[j])**2 for j in (0,1))) for i in available if frame/fps-tracks[i]['samples'][-1]['t'] < 1]
            best = min(candidates, key=lambda p:p[1]) if candidates else None
            if best and best[1] < .04:
                track = tracks[best[0]]
                available.remove(best[0])
            else:
                track = {'id': f'{asset_id}:face{len(tracks)}', 'assetId': asset_id, 'samples': []}
                tracks.append(track)
            track['samples'].append({'t': frame/fps, 'box': box})
    detector.close()
    cap.release()
    return tracks

def embeddings(frames, config):
    import torch
    from PIL import Image
    from transformers import AutoProcessor, AutoModel
    model = AutoModel.from_pretrained(config['modelDir'], local_files_only=True)
    processor = AutoProcessor.from_pretrained(config['modelDir'], local_files_only=True)
    result = []
    for frame in frames:
        image = Image.open(frame['path']).convert('RGB')
        inputs = processor(images=image, return_tensors='pt')
        with torch.no_grad():
            vector = model.get_image_features(**inputs)
            vector = vector / vector.norm(dim=-1, keepdim=True)
        result.append({'id': frame['id'], 'vector': vector[0].tolist()})
    return result
