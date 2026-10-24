import {test,expect,type Page,type Route} from '@playwright/test';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';

/** usegumbo.app/community (sign-in-site/community): the board and what's new, read signed out, written signed in, and
 * the owner's status control. The site is served from its folder and Supabase's REST API by a stand-in that keeps rows
 * in memory and checks who is asking (the database's own rules are tests/integration/community.test.ts). Signing in
 * goes through the app, which sends the visitor back. */
const site=resolve('sign-in-site'),SITE='https://site.test',REST='https://qewguvfkkwvdoqptiljd.supabase.co/rest/v1/';
const maya='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const session=(id:string)=>({access_token:'token-'+id,refresh_token:'r',expires_at:Math.floor(Date.now()/1000)+3600,user:{id,email:'x@example.com'}});

async function serve(page:Page){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
 await page.route(`${SITE}/**`,route=>{let path=join(site,decodeURIComponent(new URL(route.request().url()).pathname));if(existsSync(path)&&statSync(path).isDirectory())path=join(path,'index.html');
  if(!existsSync(path))return route.fulfill({status:404,body:'missing'});
  route.fulfill({status:200,contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html',body:readFileSync(path)});});
 const db={posts:[
  {id:'aaaaaaaa-0000-4000-8000-000000000001',kind:'update',title:'Exports are 3x faster',body:'Motion graphics export faster.\n- Scenes draw ahead',status:'open',author_name:'Gumbo',votes:4,replies:0,created_at:'2026-10-24T12:00:00Z'},
  {id:'aaaaaaaa-0000-4000-8000-000000000002',kind:'idea',title:'Export to TikTok',body:'Straight from Gumbo.',status:'planned',author_name:'Sam',votes:7,replies:0,created_at:'2026-10-23T12:00:00Z'},
  {id:'aaaaaaaa-0000-4000-8000-000000000003',kind:'bug',title:'Preview stutters <b>sometimes</b>',body:'<script>alert(1)</script>',status:'open',author_name:'Lee',votes:2,replies:0,created_at:'2026-10-24T13:00:00Z'}] as any[],
  votes:[] as {post_id:string;voter:string}[],replies:[] as any[]};
 const who=(route:Route)=>{const auth=route.request().headers().authorization??'';return auth.startsWith('Bearer token-')?auth.slice('Bearer token-'.length):null;};
 await page.route(`${REST}**`,async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!,user=who(route),json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  const eq=(name:string)=>url.searchParams.get(name)?.replace(/^eq\./,'');
  if(req.method()!=='GET'&&!user)return json({message:'permission denied'},401);
  if(table==='dream_community_posts'){
   if(req.method()==='GET')return json(db.posts);
   if(req.method()==='POST'){const body=req.postDataJSON();if(body.kind==='update'&&user!==owner)return json({message:'P0001: Only Gumbo posts updates.'},400);
    const post={id:`bbbbbbbb-0000-4000-8000-${String(db.posts.length).padStart(12,'0')}`,status:'open',author_name:user===owner?'Gumbo':'Maya Rivera',votes:0,replies:0,created_at:new Date().toISOString(),...body};db.posts.push(post);return json([post],201);}
   if(req.method()==='PATCH'){if(user!==owner)return json([],200);const post=db.posts.find(p=>p.id===eq('id'));Object.assign(post,req.postDataJSON());return route.fulfill({status:204});}
  }
  if(table==='dream_community_votes'){
   if(req.method()==='GET')return json(db.votes.filter(v=>v.voter===user).map(v=>({post_id:v.post_id})));
   if(req.method()==='POST'){const {post_id}=req.postDataJSON();db.votes.push({post_id,voter:user!});db.posts.find(p=>p.id===post_id).votes++;return route.fulfill({status:201});}
   if(req.method()==='DELETE'){const post_id=eq('post_id');db.votes=db.votes.filter(v=>!(v.post_id===post_id&&v.voter===user));db.posts.find(p=>p.id===post_id).votes--;return route.fulfill({status:204});}
  }
  if(table==='dream_community_replies'){
   if(req.method()==='GET')return json(db.replies.filter(r=>r.post_id===eq('post_id')));
   if(req.method()==='POST'){const body=req.postDataJSON(),reply={id:`r${db.replies.length}`,author:user,author_name:'Maya Rivera',created_at:new Date().toISOString(),...body};db.replies.push(reply);db.posts.find(p=>p.id===body.post_id).replies++;return json([reply],201);}
  }
  if(table==='dream_accounts')return json(user?[{is_admin:user===owner}]:[]);
  return json({message:'unknown'},404);
 });
 return db;
}

test('the community page: read signed out, post, vote and reply signed in, statuses by the owner',async({page})=>{
 const db=await serve(page);
 // Signed out: the board, top first, without closed posts; what's new; what people wrote shown as text.
 await page.goto(`${SITE}/community/`);
 const board=page.locator('#board-posts');
 await expect(board.locator('article h3')).toHaveText(['Export to TikTok','Preview stutters <b>sometimes</b>']);
 await expect(board).toContainText('<script>alert(1)</script>');await expect(board.getByText('Planned')).toBeVisible();
 await page.getByRole('tab',{name:"What's new"}).click();
 await expect(page.locator('#update-posts article')).toHaveCount(1);await expect(page.locator('#update-posts li')).toHaveText('Scenes draw ahead');
 await page.getByRole('tab',{name:'Board'}).click();
 // Signing in goes through the app, remembering where to come back to.
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.waitForURL(`${SITE}/app/?signin=1`);
 expect(JSON.parse(await page.evaluate(()=>sessionStorage.getItem('gumbo-return')!))).toMatchObject({path:'/community/'});

 // Signed in: post an idea, upvote, reply.
 await page.evaluate(s=>localStorage.setItem('gumbo-session',JSON.stringify(s)),session(maya));
 await page.goto(`${SITE}/community/`);
 await page.getByRole('textbox',{name:'Title'}).fill('Auto-captions in Spanish');await page.getByRole('textbox',{name:'Details'}).fill('For my Spanish channel.');
 await expect(page.getByRole('combobox',{name:'Kind of post'}).locator('option')).toHaveText(['Idea','Bug','Question']);
 await page.getByRole('button',{name:'Post'}).click();
 await page.getByRole('button',{name:'New'}).click();
 await expect(board.locator('article h3').first()).toHaveText('Auto-captions in Spanish');
 expect(db.posts.at(-1)).toMatchObject({kind:'idea',title:'Auto-captions in Spanish',body:'For my Spanish channel.'});
 const tiktok=board.locator('article',{hasText:'Export to TikTok'}),up=tiktok.getByRole('button',{name:/Upvote/});
 await up.click();await expect(up).toHaveAttribute('aria-pressed','true');await expect(up).toContainText('8');expect(db.posts[1].votes).toBe(8);
 await up.click();await expect(up).toContainText('7');
 await tiktok.getByRole('button',{name:'Export to TikTok',exact:true}).click();
 await tiktok.getByRole('textbox',{name:'Your reply'}).fill('Yes please!');await tiktok.getByRole('button',{name:'Reply'}).click();
 await expect(tiktok.locator('.answer')).toBeVisible();await expect(tiktok.locator('.answer')).toContainText('Yes please!');await expect(tiktok).toContainText('1 reply');
 await expect(tiktok.getByRole('combobox',{name:'Status'})).toHaveCount(0);
 if(process.env.SHOTS_DIR){await page.setViewportSize({width:1280,height:900});await page.screenshot({path:process.env.SHOTS_DIR+'/community-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:process.env.SHOTS_DIR+'/community-phone.png'});await page.setViewportSize({width:1280,height:720});}

 // The owner: posts updates and sets a status.
 await page.evaluate(s=>localStorage.setItem('gumbo-session',JSON.stringify(s)),session(owner));
 await page.goto("about:blank");await page.goto(`${SITE}/community/#post-${db.posts[1].id}`);
 const opened=page.locator(`#post-${db.posts[1].id}`);
 await expect(opened.getByRole('combobox',{name:'Status'})).toBeVisible();
 await opened.getByRole('combobox',{name:'Status'}).selectOption('in_progress');
 await expect(opened.locator('.tag.in_progress')).toHaveText('In progress');expect(db.posts[1].status).toBe('in_progress');
 await expect(page.getByRole('combobox',{name:'Kind of post'}).locator('option')).toHaveText(['Idea','Bug','Question','Update']);
});

test('the app sends a visitor who signed in for the community page back to it',async({page})=>{
 await page.addInitScript(()=>{if(window!==window.top)return;sessionStorage.setItem('gumbo-return',JSON.stringify({path:'/community/#post-x',at:Date.now()}));
  localStorage.setItem('gumbo-session',JSON.stringify({access_token:'a',refresh_token:'r',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'u',email:'x@example.com'}}));});
 await page.goto('/app/?signin=1');
 await page.waitForURL(/\/community\/#post-x$/,{timeout:60_000});
});
