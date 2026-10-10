import React,{useState} from 'react';
import {Computer} from 'lucide-react';
import type {CommandFn} from '../../hooks/useProjectSession';
import {useEditor} from '../../store/editor';

export function ComputerAccessPrompt({command}:{command:CommandFn}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const allow=async()=>{const current=useEditor.getState().project;setBusy(true);setError('');try{
  await window.dream.grantComputer();
  const latest=useEditor.getState().project;
  if(latest?.meta.id===current?.meta.id&&latest?.experience?.turnId===current?.experience?.turnId&&latest?.aiStatus==='awaiting_file_permission'){
   if(!await command({type:'resume'}))setError('Access is allowed. Continue the request to try again.');
  }
 }catch(error){setError((error as Error).message);}finally{setBusy(false);}};
 return <section className="permission-prompt" aria-label="Computer access approval"><h3><Computer size={17}/> Let Dream find the files</h3><p>Allow Dream to search, read, and use files across this computer for your requests. You won’t need to select each file yourself.</p><p>Relevant content may be sent to Dream AI. Access stays enabled until you revoke it in Computer files.</p><button className="button primary" disabled={busy} onClick={()=>void allow()}>{busy?'Continuing…':'Allow computer access'}</button>{error&&<p role="alert">{error}</p>}</section>;
}
