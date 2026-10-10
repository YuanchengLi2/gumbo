export const canvasPresets=[
 {ratio:'16:9',name:'Landscape',width:1920,height:1080},
 {ratio:'9:16',name:'Portrait',width:1080,height:1920},
 {ratio:'4:3',name:'Classic',width:1440,height:1080},
 {ratio:'3:4',name:'Portrait classic',width:1080,height:1440},
 {ratio:'1:1',name:'Square',width:1080,height:1080},
 {ratio:'4:5',name:'Social',width:1080,height:1350}
] as const;
export function canvasRatio(width:number,height:number){return canvasPresets.find(p=>Math.abs(p.width/p.height-width/height)<.001)?.ratio??`${width}:${height}`;}
