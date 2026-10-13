import {useEffect,useState} from 'react';

/** Light, dark, or whatever the system uses. The choice is remembered on this computer; the window's own controls (the
 * minimise, maximise and close buttons Windows draws) are recoloured to match the page behind them. */
export type ThemeChoice='light'|'dark'|'system';
const KEY='dream-theme',listeners=new Set<()=>void>();
const media=()=>window.matchMedia?.('(prefers-color-scheme: dark)');
export function themeChoice():ThemeChoice{try{const v=localStorage.getItem(KEY);return v==='light'||v==='dark'||v==='system'?v:'system';}catch{return 'system';}}
export const resolvedTheme=(choice=themeChoice()):'light'|'dark'=>choice==='system'?(media()?.matches?'dark':'light'):choice;
/** The page colour behind the window controls, as #rrggbb (Windows wants a plain colour). */
function chromeColour(){
 const value=getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim()||'#ffffff',canvas=document.createElement('canvas').getContext('2d');
 if(!canvas)return '#ffffff';canvas.fillStyle='#000';canvas.fillStyle=value;return /^#[0-9a-f]{6}$/i.test(canvas.fillStyle)?canvas.fillStyle:'#ffffff';
}
export function applyTheme(){
 const theme=resolvedTheme();document.documentElement.dataset.theme=theme;
 void window.dream?.setTheme(theme,chromeColour()).catch(()=>{});
}
export function setThemeChoice(choice:ThemeChoice){try{localStorage.setItem(KEY,choice);}catch{}applyTheme();listeners.forEach(l=>l());}
/** Applies the theme now and whenever the system theme changes; returns the current choice for menus. */
export function useTheme(){
 const [choice,setChoice]=useState(themeChoice);
 useEffect(()=>{applyTheme();const update=()=>setChoice(themeChoice()),system=()=>{if(themeChoice()==='system')applyTheme();},query=media();
  listeners.add(update);query?.addEventListener('change',system);return()=>{listeners.delete(update);query?.removeEventListener('change',system);};},[]);
 return choice;
}
