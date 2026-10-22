// Runs the app's own Export (renderVideo) on a sample edit in a hidden Electron window, with the sample media served over
// dream-media:// as the app serves it (ranges included), writes the video, and prints the frames the paused player draws.
const {app,BrowserWindow,protocol}=require('electron');const fs=require('fs');const path=require('path');
protocol.registerSchemesAsPrivileged([{scheme:'dream-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true,bypassCSP:true}}]);
const media=JSON.parse(process.env.EXPORT_MEDIA);
app.whenReady().then(async()=>{
 protocol.handle('dream-media',request=>{
  const file=media[new URL(request.url).hostname],data=fs.readFileSync(file),range=/bytes=(\d+)-(\d*)/.exec(request.headers.get('range')??'');
  const headers={'content-type':file.endsWith('.mp4')?'video/mp4':'application/octet-stream','accept-ranges':'bytes','access-control-allow-origin':'*'};
  if(!range)return new Response(data,{headers:{...headers,'content-length':String(data.length)}});
  const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;
  return new Response(data.subarray(start,end+1),{status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':String(end-start+1)}});
 });
 const w=new BrowserWindow({show:false,width:400,height:300,webPreferences:{backgroundThrottling:false}});
 await w.loadFile(path.resolve(__dirname,'export.html'));
 try{
  const result=await w.webContents.executeJavaScript(`(async()=>{while(!window.ready)await new Promise(r=>setTimeout(r,20));return runExport(${JSON.stringify(fs.readFileSync(process.env.EXPORT_SPEC,'utf8'))});})()`);
  fs.writeFileSync(process.env.EXPORT_OUT,Buffer.from(result.video,'base64'));
  process.stdout.write('RESULT '+JSON.stringify({timing:result.timing,preview:result.preview})+'\n');
 }catch(error){process.stdout.write('FAILED '+String(error&&error.message||error)+'\n');}
 app.quit();
});
