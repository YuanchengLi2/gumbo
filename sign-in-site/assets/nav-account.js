/** Signed in to Gumbo on this site (the web app keeps its session here, as gumbo-session), the nav's button becomes the
 * account's picture: a click opens Gumbo; hovering, or focusing it, shows a menu for Gumbo, its settings, the plan and the
 * community. Signed out, or only trying as a guest, the button stays as it is. */
(()=>{
 let session=null;try{session=JSON.parse(localStorage.getItem('gumbo-session')||'null');}catch{}
 if(!session||!session.refresh_token||session.user?.is_anonymous)return;
 const button=document.querySelector('nav.nav > a.btn');if(!button)return;
 const email=String(session.user?.email||''),initial=(email.trim()[0]||'G').toUpperCase();
 const account=document.createElement('div');account.className='nav-account';
 const avatar=document.createElement('a');avatar.className='nav-avatar';avatar.href='/app/';avatar.textContent=initial;avatar.setAttribute('aria-label','Open Gumbo'+(email?` (${email})`:''));avatar.setAttribute('aria-haspopup','menu');
 const menu=document.createElement('div');menu.className='nav-menu';menu.setAttribute('role','menu');
 if(email){const who=document.createElement('span');who.className='nav-email';who.textContent=email;menu.append(who);}
 for(const [label,href] of [['Open Gumbo','/app/'],['Settings','/app/?settings=account'],['Plan and billing','/app/?settings=plan'],['Community','/community/']]){
  const item=document.createElement('a');item.setAttribute('role','menuitem');item.href=href;item.textContent=label;menu.append(item);}
 // Its look comes with it: the homepage keeps its own styles, apart from assets/site.css.
 const style=document.createElement('style');style.textContent=`.nav-account{position:relative;margin-left:8px}
.nav-avatar{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--chili,#E2552A);color:#FFF8EE;font:600 16px var(--sans);text-decoration:none}
.nav-avatar:hover,.nav-avatar:focus-visible{box-shadow:0 0 0 3px rgba(226,85,42,.22)}
.nav-menu{position:absolute;right:0;top:100%;padding-top:8px;min-width:210px;display:none;z-index:50}
.nav-menu::before{content:'';position:absolute;inset:8px 0 0;border:1.5px solid var(--line);border-radius:14px;background:var(--white,#fff);box-shadow:0 14px 40px rgba(42,26,18,.14);z-index:-1}
.nav-account:hover .nav-menu,.nav-account:focus-within .nav-menu{display:flex;flex-direction:column}
.nav-menu a,.nav-email{padding:9px 14px;font:500 14.5px var(--sans);color:var(--ink);text-decoration:none}
.nav-menu a:first-of-type{margin-top:4px}.nav-menu a:last-child{margin-bottom:6px}
.nav-menu a:hover{background:rgba(42,26,18,.05)}
.nav-email{display:block;color:var(--muted);font-size:13px;font-weight:400;border-bottom:1.5px solid var(--line);padding-top:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;document.head.append(style);
 account.append(avatar,menu);button.replaceWith(account);
 // The invitation to try without an account is for visitors: signed in, it opens Gumbo.
 for(const link of document.querySelectorAll('.announce a[href^="/app/?try=1"]')){link.href='/app/';link.textContent='Open Gumbo ›';}
})();
