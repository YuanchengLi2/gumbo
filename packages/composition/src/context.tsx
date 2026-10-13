import React,{createContext,useContext,useMemo} from 'react';
import {resolve,type ResolvedTimeline} from '@dream/timeline';
import {audioManifest,type AudioSegment} from '@dream/compositor';
import type {CompositionProps} from './index';
const Context=createContext<{resolved:ResolvedTimeline;audio:AudioSegment[]}|null>(null);
export function CompositionData({props,children}:{props:CompositionProps;children:React.ReactNode}){const value=useMemo(()=>({resolved:resolve(props.timeline,props.footage),audio:audioManifest(props.timeline,props.footage)}),[props.timeline,props.footage]);return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useCompositionData(){const data=useContext(Context);if(!data)throw new Error('Composition data is unavailable.');return data;}
