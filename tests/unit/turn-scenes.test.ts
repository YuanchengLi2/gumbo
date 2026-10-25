import {describe,it,expect} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TurnScenes} from '../../apps/desktop/src/renderer/components/chat/RunStream';

const scene={id:'a_card',filename:'Intro card',kind:'video',durationSec:2,fps:30,width:1920,height:1080,originalPath:'',fingerprint:'x',scene:{format:'engine',revisionId:'r'.repeat(64),durationInFrames:60}} as any;
const clip={id:'a_talk',filename:'Talk',kind:'video',durationSec:180,fps:30,width:1920,height:1080,originalPath:'',fingerprint:'y'} as any;
const event=(media:any[])=>({id:'publication:c1',sequence:3,kind:'changes',text:'Updated the edit',status:'complete',media}) as any;

describe('scenes under the answer',()=>{
 it('shows the scenes a request put in the edit, once its steps fold away',()=>{
  const html=renderToStaticMarkup(React.createElement(TurnScenes,{events:[event([{id:'a_card',name:'Intro card',kind:'scene'},{id:'a_talk',name:'Talk',kind:'video'}])],assets:[scene,clip]}));
  expect(html).toContain('scene-peek');expect(html).toContain('Live scene · Intro card');expect(html).not.toContain('Talk');
 });
 it('shows nothing for a request that made no scene',()=>{
  expect(renderToStaticMarkup(React.createElement(TurnScenes,{events:[event([{id:'a_talk',name:'Talk',kind:'video'}])],assets:[clip]}))).toBe('');
 });
});
