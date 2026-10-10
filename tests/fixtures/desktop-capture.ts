import type {ElectronApplication,Page} from '@playwright/test';

/** Read actual composited pixels without weakening the renderer's origin boundary. */
export async function capturePreview(app:ElectronApplication,page:Page){
 const point=await page.locator('video').evaluate(video=>{const box=video.getBoundingClientRect();return{x:box.left+box.width*100/1280,y:box.top+box.height*200/720,width:innerWidth,height:innerHeight};});
 return app.evaluate(async({BrowserWindow,nativeImage},point)=>{
  const capture=await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true}),png=capture.toPNG();
  const pixels=nativeImage.createFromBuffer(png).resize({width:point.width,height:point.height}).toBitmap(),offset=(Math.floor(point.y)*point.width+Math.floor(point.x))*4;
  return{png:png.toString('base64'),pixel:[pixels[offset+2],pixels[offset+1],pixels[offset],pixels[offset+3]]};
 },point);
}
