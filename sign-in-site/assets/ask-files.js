// The request bars' "+": the videos picked (or dropped on the bar) go to Gumbo with the request. The site and the app
// share one address, so the files are copied into this browser's private storage where the app's own picker puts them
// (/imports/<id>/<name>), and /app/?ask=…&files=[…] hands their paths over (first-ask.ts in the app).
(function(){
 const ACCEPT='video/*,audio/*,image/*,.mkv,.mts,.m2ts,.heic,.heif';
 const safe=name=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(-180)||'media';
 const style=document.createElement('style');
 style.textContent='.bar button.plus{border:0;cursor:pointer;transition:background .15s}.bar button.plus:hover{background:var(--line)}'+
  '.bar.dropping{box-shadow:0 0 0 5px rgba(255,213,188,.75)}.picked{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.picked:empty{display:none}'+
  '.picked span{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 6px 5px 11px;border-radius:999px;background:var(--card);color:var(--ink);font:500 13px var(--sans)}'+
  '.picked b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.picked button{appearance:none;border:0;background:none;color:var(--muted);cursor:pointer;font:16px/1 var(--sans);padding:0 4px}';
 document.head.append(style);
 async function store(files){
  const root=await navigator.storage.getDirectory(),imports=await root.getDirectoryHandle('imports',{create:true}),paths=[];
  for(const file of files){
   const id=crypto.randomUUID().slice(0,8),name=safe(file.name),dir=await imports.getDirectoryHandle(id,{create:true});
   const writer=await (await dir.getFileHandle(name,{create:true})).createWritable();await file.stream().pipeTo(writer);paths.push(`/imports/${id}/${name}`);
  }
  return paths;
 }
 /** Makes one bar's "+" pick files; returns open(idea), which carries them to Gumbo with the request. */
 window.gumboAsk=function(ask){
  const form=ask.querySelector('form'),plus=form.querySelector('.plus'),picked=[];
  const input=document.createElement('input');input.type='file';input.multiple=true;input.accept=ACCEPT;input.hidden=true;form.append(input);
  const button=document.createElement('button');button.type='button';button.className='plus';button.setAttribute('aria-label','Add your videos');button.innerHTML=plus.innerHTML;plus.replaceWith(button);
  const list=document.createElement('div');list.className='picked';form.after(list);
  const draw=()=>{list.replaceChildren(...picked.map((file,i)=>{const chip=document.createElement('span'),name=document.createElement('b'),remove=document.createElement('button');
   name.textContent=file.name;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+file.name);remove.addEventListener('click',()=>{picked.splice(i,1);draw();});chip.append(name,remove);return chip;}));};
  const add=files=>{picked.push(...[...files].filter(f=>/^(video|audio|image)\//.test(f.type)||/\.(mkv|mts|m2ts|heic|heif)$/i.test(f.name)));draw();form.querySelector('textarea').focus();};
  button.addEventListener('click',()=>input.click());
  input.addEventListener('change',()=>{add(input.files);input.value='';});
  form.addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();form.classList.add('dropping');});
  form.addEventListener('dragleave',e=>{if(!form.contains(e.relatedTarget))form.classList.remove('dropping');});
  form.addEventListener('drop',e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();form.classList.remove('dropping');add(e.dataTransfer.files);});
  return async idea=>{
   let paths=[];
   // A browser that can't keep files (no private storage) still opens Gumbo with the request; the files are added there.
   if(picked.length){form.setAttribute('aria-busy','true');try{paths=await store(picked);}catch{}}
   location.href='/app/?try=1&ask='+encodeURIComponent(idea.slice(0,2000))+(paths.length?'&files='+encodeURIComponent(JSON.stringify(paths)):'');
  };
 };
})();
