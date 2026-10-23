import {describe,it,expect} from 'vitest';
import {handleFetchUrl,privateAddress} from '../../supabase/functions/dream-gateway/fetch-url';

/** The gateway's fetch-url, which reads web pages for Roux when Gumbo runs in a browser: public pages only, checked at
 * every redirect, text only and at most 2 MB. */
const names:Record<string,string[]>={'example.com':['93.184.215.14'],'rebind.example':['169.254.169.254'],'intranet.example':['10.0.0.8']};
const ports=(pages:Record<string,()=>Response>)=>({resolve:async(host:string)=>names[host]??[],fetch:(async(url:URL)=>{const page=pages[url.toString()];if(!page)throw new Error('not found');return page();}) as unknown as typeof fetch});

describe('gateway fetch-url',()=>{
 it('reads a public page and follows its redirects',async()=>{
  const result=await handleFetchUrl({url:'https://example.com/a'},ports({
   'https://example.com/a':()=>new Response(null,{status:301,headers:{location:'/b'}}),
   'https://example.com/b':()=>new Response('<title>Hi</title><p>Hello</p>',{headers:{'content-type':'text/html; charset=utf-8'}})}));
  expect(result).toEqual({status:200,body:{url:'https://example.com/b',status:200,contentType:'text/html; charset=utf-8',text:'<title>Hi</title><p>Hello</p>',truncated:false}});
 });
 it('refuses private, link-local and local names, also when a redirect leads there',async()=>{
  for(const url of ['http://localhost:8080/','http://127.0.0.1/','http://[::1]/','http://intranet.example/','http://metadata.google.internal/','file:///etc/passwd'])
   expect((await handleFetchUrl({url},ports({}))).status).toBe(400);
  const redirected=await handleFetchUrl({url:'https://example.com/go'},ports({'https://example.com/go':()=>new Response(null,{status:302,headers:{location:'http://rebind.example/latest/meta-data'}})}));
  expect(redirected).toEqual({status:400,body:{error:'Addresses on a local network are not read.'}});
  expect([privateAddress('192.168.1.4'),privateAddress('172.20.0.1'),privateAddress('8.8.8.8'),privateAddress('::ffff:10.1.2.3')]).toEqual([true,true,false,true]);
 });
 it('flags binary files and cuts long pages at 2 MB',async()=>{
  const binary=await handleFetchUrl({url:'https://example.com/v.mp4'},ports({'https://example.com/v.mp4':()=>new Response(new Uint8Array(10),{headers:{'content-type':'video/mp4'}})}));
  expect(binary.body).toMatchObject({binary:true,contentType:'video/mp4'});
  const long=await handleFetchUrl({url:'https://example.com/long'},ports({'https://example.com/long':()=>new Response('x'.repeat(3_000_000),{headers:{'content-type':'text/plain'}})}));
  expect((long.body as any).text.length).toBe(2_000_000);expect((long.body as any).truncated).toBe(true);
 });
 it('stops after five redirects',async()=>{
  const loop=await handleFetchUrl({url:'https://example.com/loop'},ports({'https://example.com/loop':()=>new Response(null,{status:302,headers:{location:'/loop'}})}));
  expect(loop).toEqual({status:400,body:{error:'The address redirects too many times.'}});
 });
});
