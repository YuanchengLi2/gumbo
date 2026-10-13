// Loads the bundled harness in a hidden Electron window and prints the pixels each named case draws.
const {app,BrowserWindow}=require('electron');const path=require('path');
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:300,height:200});
 await w.loadFile(path.resolve(__dirname,'harness.html'));
 const results={};
 for(const name of process.env.CASES.split(','))results[name]=await w.webContents.executeJavaScript(`(async()=>{while(!window.ready)await new Promise(r=>setTimeout(r,20));return runCase(${JSON.stringify(name)});})()`);
 process.stdout.write('RESULT '+JSON.stringify(results)+'\n');app.quit();
});
