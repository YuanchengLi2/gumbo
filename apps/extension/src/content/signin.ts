/// <reference types="chrome" />
/** Runs on usegumbo.app/app/* before the page's own scripts. When the sign-in page returns there for the extension
 * (?ext=1&code=…), the code is taken out of the address before the web app can see it and handed to the extension,
 * which exchanges it with its own verifier and turns this tab into its welcome page. */
const here=new URL(location.href);
if(here.searchParams.get('ext')==='1'){
 const code=here.searchParams.get('code')??undefined,error=here.searchParams.get('error_description')??here.searchParams.get('error')??undefined;
 if(code||error){
  for(const name of ['ext','code','error','error_description','error_code','state'])here.searchParams.delete(name);
  history.replaceState(history.state,'',here.toString());
  void chrome.runtime.sendMessage({type:'auth.code',code,error});
 }
}
