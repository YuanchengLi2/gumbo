import {it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {slimLibraries} from '../../apps/desktop/slim-libraries';
vi.mock('electron',()=>({app:{getPath:()=>tmpdir()}}));
const {missingPython}=await import('../../apps/desktop/src/main/extra-libraries');

/** The packaged shared libraries (apps/desktop/slim-libraries.ts) and the packages fetched after install
 * (src/main/extra-libraries.ts). */
const file=(path:string,text='x')=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};

it('leaves out tests, stubs, headers, docs, stray wheels and matplotlib, defers scipy and OpenCV, and keeps bytecode and licenses',()=>{
 const libraries=mkdtempSync(join(tmpdir(),'gumbo-libraries-')),python=join(libraries,'python'),node=join(libraries,'node_modules');
 file(join(libraries,'libraries.json'),JSON.stringify({python:{numpy:'2.2.6',scipy:'1.16.2','opencv-python-headless':'4.12.0.88'}}));
 for(const path of ['numpy/__init__.py','numpy/__pycache__/x.cpython-313.pyc','numpy/_core/tests/test_x.py','numpy/__init__.pyi','numpy/_core/include/numpy/arrayobject.h','numpy/testing/__init__.py',
  'scipy/__init__.py','scipy.libs/x.dll','scipy-1.16.2.dist-info/METADATA','cv2/__init__.py','opencv_python_headless-4.12.0.88.dist-info/METADATA','opencv_python_headless.libs/x.dll',
  'matplotlib/__init__.py','fontTools/__init__.py','six.py','scipy-1.16.2-cp313-cp313-win_amd64.whl'])file(join(python,path));
 for(const path of ['three/build/three.module.js','three/index.d.ts','three/README.md','three/LICENSE.md','sharp/lib/index.js.map'])file(join(node,path));
 slimLibraries(libraries);
 const has=(path:string)=>existsSync(join(libraries,path));
 expect(['python/numpy/__init__.py','python/numpy/__pycache__/x.cpython-313.pyc','python/numpy/testing/__init__.py','node_modules/three/build/three.module.js','node_modules/three/LICENSE.md'].filter(p=>!has(p))).toEqual([]);
 expect(['python/numpy/_core/tests','python/numpy/__init__.pyi','python/numpy/_core/include/numpy/arrayobject.h','python/scipy','python/scipy.libs','python/scipy-1.16.2.dist-info','python/cv2',
  'python/opencv_python_headless-4.12.0.88.dist-info','python/opencv_python_headless.libs','python/matplotlib','python/fontTools','python/six.py','python/scipy-1.16.2-cp313-cp313-win_amd64.whl',
  'node_modules/three/index.d.ts','node_modules/three/README.md','node_modules/sharp/lib/index.js.map'].filter(has)).toEqual([]);
 expect(JSON.parse(readFileSync(join(libraries,'deferred.json'),'utf8'))).toEqual({python:{scipy:'1.16.2','opencv-python-headless':'4.12.0.88'}});

 // Until a package's dist-info is in the user's folder it is missing; a build without deferred packages needs nothing.
 const folder=mkdtempSync(join(tmpdir(),'gumbo-extra-'));
 expect(missingPython(libraries,folder)).toEqual({scipy:'1.16.2','opencv-python-headless':'4.12.0.88'});
 mkdirSync(join(folder,'opencv_python_headless-4.12.0.88.dist-info'));expect(missingPython(libraries,folder)).toEqual({scipy:'1.16.2'});
 expect(missingPython(mkdtempSync(join(tmpdir(),'gumbo-dev-')),folder)).toEqual({});
});
