let active=false;
export async function withExportLock<T>(work:()=>Promise<T>){if(active)throw new Error('An export is already running.');active=true;try{return await work();}finally{active=false;}}
