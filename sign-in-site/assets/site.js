// The site's own pages: icons, the request bars (they open Gumbo with the request), use cases, Max's two sizes, and
// sections easing in as they come on screen. Shared from the homepage's script.
const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
const ICONS={
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.6 7.6 20 18M8.6 16.4 20 6"/>',
 text:'<path d="M5 6h14M12 6v13M9 19h6"/>',
 cc:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2 2 0 1 0 0 3.6M17 10.2a2 2 0 1 0 0 3.6"/>',
 sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
 music:'<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
 spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
 layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
 crop:'<path d="M6 2v16h16M2 6h16v16"/>',
 speed:'<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
 mask:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
 key:'<path d="m12 4 6 8-6 8-6-8z"/>',
 palette:'<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3h3a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><circle cx="8" cy="10" r=".8"/><circle cx="12" cy="7" r=".8"/><circle cx="16" cy="10" r=".8"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
 wand:'<path d="m4 20 12-12M14 4v2M18 8h2M17 4l1.5-1.5M19 10l1.5 1.5"/>',
 smile:'<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
 bowtie:'<path d="M4 5l8 7-8 7zM20 5l-8 7 8 7z"/>',
 cube:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
 screen:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
 wave:'<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 volume:'<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
 film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
 motion:'<circle cx="16" cy="12" r="4"/><path d="M3 9h6M2 12h7M3 15h6"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 pin:'<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
 tag:'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
 clock:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/>',
 vhs:'<rect x="2" y="7" width="14" height="10" rx="2"/><path d="m16 11 6-3v8l-6-3"/>',
 phone:'<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
 star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
 zoom:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
 shrug:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
 horn:'<path d="M3 10v4h4l8 5V5L7 10z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
 type:'<path d="M4 6h16M4 12h10M4 18h7"/>',
 lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`;
document.querySelectorAll('[data-i]').forEach(n=>{n.innerHTML=icon(n.dataset.i);});
const whenSeen=(node,fn,threshold=.3)=>{const ob=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){ob.disconnect();fn();}},{threshold});ob.observe(node);};

// The prompt bars: type an edit and Gumbo opens with it (/app/?ask=…). The app keeps it through its onboarding and
// sign-in, then puts it in its box, ready to send.
const ideas=['Cut every um…','Draw our route on a map…','Make it feel like the 90s…','Three Shorts from my talk…','Make the logo smaller…','Make it better…'];
const openWith=idea=>{location.href='/app/?ask='+encodeURIComponent(idea.slice(0,2000));};
document.querySelectorAll('[data-ask]').forEach((ask,n)=>{
 const form=ask.querySelector('form'),box=ask.querySelector('textarea'),open=window.gumboAsk?.(ask)??openWith;
 const grow=()=>{box.style.height='40px';box.style.height=Math.min(box.scrollHeight,140)+'px';};
 box.addEventListener('input',grow);
 box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});
 ask.querySelectorAll('.chips button').forEach(b=>b.addEventListener('click',()=>{box.value=b.textContent;grow();box.focus();}));
 if(n===0&&!calm){let i=0;setInterval(()=>{if(document.activeElement!==box&&!box.value){i=(i+1)%ideas.length;box.placeholder=ideas[i];}},3000);box.placeholder=ideas[0];}
 form.addEventListener('submit',e=>{e.preventDefault();const idea=box.value.trim();if(!idea){box.focus();return;}
  form.querySelector('.send').classList.add('press');void open(idea);});
});

// Videos on these pages play only while on screen, and wait for the page to settle before loading.
(function videos(){
 const all=[...document.querySelectorAll('.ask-tile video,.uc-tile video')];if(!all.length)return;
 const ob=new IntersectionObserver(es=>{for(const e of es){const v=e.target;if(e.isIntersecting){if(v.preload==='none')v.preload='auto';if(v.closest('.t-slow'))v.playbackRate=.4;if(!calm)v.play().catch(()=>{});}else v.pause();}},{threshold:.2});
 all.forEach(v=>ob.observe(v));
})();

// The captions tile: one word at a time, the important ones in yellow.
(function captions(){
 const cap=document.querySelector('.t-caps .cap');if(!cap)return;
 const words=['you','have','to','try','this','soup'],hot=new Set(['try','soup']);let n=0;
 const show=()=>{const w=words[n++%words.length];cap.textContent=w;cap.classList.toggle('hot',hot.has(w));};show();if(!calm)setInterval(show,520);
})();

// Use cases: each tile opens Gumbo with its request.
document.querySelectorAll('.uc-tile[data-request]').forEach(t=>t.addEventListener('click',()=>openWith(t.dataset.request)));

// Pricing: Max comes in two sizes, as in the app.
(function maxSize(){
 const plan=document.getElementById('maxPlan');if(!plan)return;
 const sizes={max:{amt:'$100',cr:'4,500 credits',x:'3.6x',cs:'1,000',mem:'Remembers your style across 20 projects'},max20:{amt:'$200',cr:'18,000 credits',x:'14x',cs:'5,000',mem:'Remembers your style across all your projects'}};
 plan.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{const v=sizes[b.dataset.size];
  plan.querySelectorAll('[data-size]').forEach(o=>o.setAttribute('aria-checked',String(o===b)));
  for(const k of Object.keys(v))plan.querySelector('.'+k).textContent=v[k];}));
})();

const seen=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){e.target.classList.add('in');seen.unobserve(e.target);}},{threshold:.15});
document.querySelectorAll('.reveal').forEach(n=>seen.observe(n));
