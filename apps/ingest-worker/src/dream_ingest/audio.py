def features(source):
    import numpy as np
    import soundfile as sf
    from scipy.signal import find_peaks
    rms_values, total_power, total_samples, peak = [], 0.0, 0, 0.0
    with sf.SoundFile(str(source)) as audio:
        rate = audio.samplerate
        block = max(1, rate // 20)
        # Retain only 20 summaries per second, not hours of decoded PCM.
        for samples in audio.blocks(blocksize=block, dtype='float32', always_2d=True):
            mono = samples.mean(axis=1)
            power = float(np.sum(mono.astype('float64') ** 2))
            rms_values.append((power / max(1, len(mono))) ** .5)
            total_power += power
            total_samples += len(mono)
            peak = max(peak, float(np.max(np.abs(samples), initial=0)))
    rms = np.asarray(rms_values)
    db = 20 * np.log10(np.maximum(rms, 1e-9))
    onsets = np.maximum(0, np.diff(rms, prepend=0)) if len(rms) else np.array([])
    peaks, _ = find_peaks(onsets, height=max(.005, float(np.percentile(onsets, 90))), distance=4) if len(onsets) else (np.array([]), {})
    quiet = db < -42
    silence, start = [], None
    for i, value in enumerate(quiet):
        if value and start is None:
            start = i
        if not value and start is not None:
            if (i-start) * block / rate >= .25:
                silence.append({'start': start*block/rate, 'end': i*block/rate})
            start = None
    if start is not None and total_samples/rate-start*block/rate >= .25:
        silence.append({'start': start*block/rate, 'end': total_samples/rate})
    return {'rmsDb': db.tolist(), 'hopSec': block/rate, 'onsets': (peaks*block/rate).tolist(), 'silence': silence, 'peakDb': float(20*np.log10(max(peak, 1e-9))), 'loudnessEstimateDb': float(20*np.log10(max((total_power/max(1,total_samples))**.5, 1e-9)))}
