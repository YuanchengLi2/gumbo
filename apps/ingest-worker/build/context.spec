from PyInstaller.utils.hooks import copy_metadata

a = Analysis(['context-entry.py'], pathex=['../src'],
             datas=copy_metadata('claude-real-video'),
             excludes=['torch', 'transformers', 'whisper', 'whisperx', 'faster_whisper', 'mlx_whisper',
                       'yt_dlp', 'numpy', 'scipy', 'cv2', 'mcp', 'flask', 'sherpa_onnx',
                       'claude_real_video.memory', 'claude_real_video.mcp_server', 'claude_real_video.serve'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='dream-context', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='dream-context')
