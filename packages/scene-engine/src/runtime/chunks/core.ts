import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import * as Remotion from 'remotion';
import * as Shim from '../remotion-shim';
import * as Shapes from '@remotion/shapes';
import * as Paths from '@remotion/paths';
import * as LayoutUtils from '@remotion/layout-utils';
import * as Transitions from '@remotion/transitions';
import * as Fade from '@remotion/transitions/fade';
import * as Slide from '@remotion/transitions/slide';
import * as Wipe from '@remotion/transitions/wipe';
import * as Flip from '@remotion/transitions/flip';
import * as ClockWipe from '@remotion/transitions/clock-wipe';
import * as None from '@remotion/transitions/none';
import * as Iris from '@remotion/transitions/iris';
import * as ZoomInOut from '@remotion/transitions/zoom-in-out';
import * as PushCut from '@remotion/transitions/push-cut';
import * as Swap from '@remotion/transitions/swap';
import * as Engine from '../api';
import * as Pending from '../pending';
import * as Config from '../config';
import {installRegistry} from '../registry';
import {mount} from '../host';

const registry=installRegistry();
const modules:Record<string,unknown>={
 'react':React,'react/jsx-runtime':JSXRuntime,'react-dom':ReactDOM,
 // Scenes get the shim (silent audio, exact-seek video); other chunks' libraries get Remotion itself.
 'remotion':Shim,'__remotion':Remotion,
 '@remotion/shapes':Shapes,'@remotion/paths':Paths,'@remotion/layout-utils':LayoutUtils,
 '@remotion/transitions':Transitions,'@remotion/transitions/fade':Fade,'@remotion/transitions/slide':Slide,'@remotion/transitions/wipe':Wipe,'@remotion/transitions/flip':Flip,'@remotion/transitions/clock-wipe':ClockWipe,'@remotion/transitions/none':None,'@remotion/transitions/iris':Iris,'@remotion/transitions/zoom-in-out':ZoomInOut,'@remotion/transitions/push-cut':PushCut,'@remotion/transitions/swap':Swap,
 '@dream/engine':Engine,'__engine/pending':Pending,'__engine/config':Config,
};
for(const [name,value] of Object.entries(modules))registry.define(name,()=>value);
document.addEventListener('DOMContentLoaded',()=>mount(registry),{once:true});
