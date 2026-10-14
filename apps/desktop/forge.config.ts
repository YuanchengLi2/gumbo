import {stageVisualRuntime} from './build-visual-runtime';
import type {ForgeConfig} from '@electron-forge/shared-types';
import {VitePlugin} from '@electron-forge/plugin-vite';
import {AutoUnpackNativesPlugin} from '@electron-forge/plugin-auto-unpack-natives';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {MakerZIP} from '@electron-forge/maker-zip';
import {MakerDMG} from '@electron-forge/maker-dmg';
import {finalizeInstallers} from './finalize-installer';
import {copyRuntimeDependencies} from './copy-runtime';
import {rmSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
/** Removes what the installed app never uses from its copy of resources/staged: the local analysis runtime (only the
 * retired audio_features step ran it) and imageio's bundled ffmpeg (commands set IMAGEIO_FFMPEG_EXE to the app's own). */
function slimStagedRuntime(staged:string){
 rmSync(join(staged,'ingest'),{recursive:true,force:true});
 const imageio=join(staged,'libraries','python','imageio_ffmpeg','binaries');
 if(existsSync(imageio))for(const name of readdirSync(imageio))if(/^ffmpeg/i.test(name))rmSync(join(imageio,name),{force:true});
}
const config:ForgeConfig={outDir:process.env.DREAM_PACKAGE_DIR,hooks:{generateAssets:async()=>stageVisualRuntime(),postMake:async(_config,results)=>finalizeInstallers(results)},packagerConfig:{icon:'resources/icon',name:'Dream',executableName:'Dream',win32metadata:{ProductName:'Figjam',FileDescription:'Figjam',CompanyName:'Figjam'},asar:{unpackDir:"node_modules"},appBundleId:'app.dream.editor',appCategoryType:'public.app-category.video',prune:false,afterCopy:[async({buildPath})=>{copyRuntimeDependencies(buildPath);}],afterCopyExtraResources:[async({buildPath})=>{slimStagedRuntime(join(buildPath,'resources','staged'));}],extraResource:['resources/runtime-manifest.json','resources/models-manifest.json','resources/notices','resources/staged'],...(process.env.DREAM_SIGN_IDENTITY?{osxSign:{identity:process.env.DREAM_SIGN_IDENTITY}}:{})},rebuildConfig:{},makers:[new MakerSquirrel({name:'Dream'}),new MakerZIP({},['darwin']),new MakerDMG({format:'ULFO'})],plugins:[new AutoUnpackNativesPlugin({}),new VitePlugin({build:[{entry:'src/main/index.ts',config:'vite.main.config.ts',target:'main'},{entry:'../project-service/src/main.ts',config:'vite.service.config.ts',target:'main'},{entry:'../project-service/src/procedural-worker.ts',config:'vite.procedural.config.ts',target:'main'},{entry:'src/workers/component-compile.ts',config:'vite.compile.config.ts',target:'main'},{entry:'src/preload/index.ts',config:'vite.preload.config.ts',target:'preload'}],renderer:[{name:'main_window',config:'vite.renderer.config.ts'}]})]};
export default config;
