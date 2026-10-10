import json
import sys
import traceback
import os
from pathlib import Path
from .pipeline import execute

def main():
    dll_directory = os.environ.get('DREAM_FFMPEG_DLL_DIR')
    dll_handle = os.add_dll_directory(dll_directory) if sys.platform == 'win32' and dll_directory else None
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get('type') == 'shutdown':
                break
            result = execute(request)
            print(json.dumps({'id': request['id'], 'result': result}), flush=True)
        except Exception as error:
            print(json.dumps({'id': locals().get('request', {}).get('id'), 'error': str(error), 'type': type(error).__name__}), flush=True)

if __name__ == '__main__':
    main()
