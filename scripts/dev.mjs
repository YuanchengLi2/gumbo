import {readFileSync,existsSync} from 'node:fs';import {spawn} from 'node:child_process';
if(existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const match=/^(DREAM_(?:SUPABASE_URL|SUPABASE_ANON_KEY|COMPANION_URL|WHISPER_BINARY|WHISPER_MODEL|INGEST_BINARY|FFMPEG|FFPROBE))=(.*)$/.exec(line);if(match)process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}
// Arguments after `pnpm dev --` go to the app (for example --remote-debugging-port=9333 to drive it from a script).
const extra=process.argv.slice(2).filter((arg,n)=>n||arg!=='--');
const child=spawn(process.platform==='win32'?'pnpm.cmd':'pnpm',['--filter','@dream/desktop','start',...(extra.length?['--',...extra]:[])],{stdio:'inherit',shell:process.platform==='win32',env:process.env});child.on('exit',code=>process.exit(code??1));
