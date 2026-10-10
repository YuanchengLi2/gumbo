# Run PyInstaller in the pinned uv environment on each target platform.
from PyInstaller.utils.hooks import collect_all
datas, binaries, hiddenimports = [], [], []
for module in ['scenedetect', 'mediapipe', 'transformers', 'whisperx', 'pyannote.audio']:
    data, binary, hidden = collect_all(module)
    datas += data
    binaries += binary
    hiddenimports += hidden
a = Analysis(['entry.py'], pathex=['../src'], binaries=binaries, datas=datas, hiddenimports=hiddenimports)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='dream-ingest', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='dream-ingest')
