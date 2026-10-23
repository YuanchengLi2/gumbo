import type {Command} from '../shell/types';
import {textTools} from './text';
import {grepTools} from './grep';
import {sed} from './sed';
import {awk} from './awk';
import {fileTools} from './files';
import {archiveTools} from './archive';
import {systemTools} from './system';

/** Every Unix tool, by name: the desktop's BusyBox list (unixTools in code-runtime.ts) and a few more that cost nothing.
 * `less` and `more` page nothing here, so they print like cat. */
export const unixTools:Record<string,Command>={...textTools,...grepTools,sed,awk,gawk:awk,mawk:awk,nawk:awk,...fileTools,...archiveTools,...systemTools,less:textTools.cat,more:textTools.cat};
/** Programs people reach for that cannot run in a browser tab, with what to do instead. */
export const unavailable:Record<string,string>={
 npm:'npm is not available in the browser sandbox: packages cannot be installed with it. Bundle with esbuild from files in the workspace, and use python3 (pip install works through micropip for pure-Python packages).',
 yarn:'yarn is not available in the browser sandbox; use esbuild on files in the workspace.',
 pnpm:'pnpm is not available in the browser sandbox; use esbuild on files in the workspace.',
 'apt-get':'there is no system package manager in the browser sandbox. Available: python3 (with numpy, Pillow and micropip), ffmpeg, ffprobe, node, esbuild and the Unix tools.',
 apt:'there is no system package manager in the browser sandbox. Available: python3 (with numpy, Pillow and micropip), ffmpeg, ffprobe, node, esbuild and the Unix tools.',
 brew:'there is no system package manager in the browser sandbox.',
 sudo:'there is no sudo in the browser sandbox; commands already run with full access to the workspace.',
 git:'git is not available in the browser sandbox.',
 docker:'docker is not available in the browser sandbox.',
 ssh:'ssh is not available in the browser sandbox.',
 jq:"jq is not available here; parse JSON with python3 -c 'import json,sys; …' or node -e.",
 bc:"bc is not available here; use awk 'BEGIN{print 1.5*3}' or python3 -c.",
 convert:'ImageMagick is not available here; use python3 with Pillow (from PIL import Image) or ffmpeg.',
 magick:'ImageMagick is not available here; use python3 with Pillow (from PIL import Image) or ffmpeg.',
 identify:'ImageMagick is not available here; use ffprobe or python3 with Pillow.',
 sox:'sox is not available here; use ffmpeg audio filters.',
 ffplay:'ffplay cannot play in the sandbox; use ffmpeg and ffprobe.',
 open:'open is not available in the browser sandbox.','xdg-open':'xdg-open is not available in the browser sandbox.',
 vi:'interactive editors are not available; write files with cat > file <<EOF or sed -i.',vim:'interactive editors are not available; write files with cat > file <<EOF or sed -i.',nano:'interactive editors are not available; write files with cat > file <<EOF or sed -i.'
};
