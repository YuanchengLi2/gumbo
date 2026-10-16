import {app} from 'electron';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {AppSettingsSchema,type AppSettings} from '@dream/contracts';

/** Settings live in the profile folder (settings.json) and reach the project service as environment: the creator profile
 * the agent reads with every request, and the providers switched off. */
const file=()=>join(app.getPath('userData'),'settings.json');
export function loadSettings():AppSettings{try{return AppSettingsSchema.parse(JSON.parse(readFileSync(file(),'utf8')));}catch{return AppSettingsSchema.parse({});}}
export function saveSettings(patch:unknown):AppSettings{
 // A change names only what changed (one profile field, the switched-off providers); the whole is validated after merging.
 const current=loadSettings(),change=(patch&&typeof patch==='object'?patch:{}) as {profile?:object;disabledProviders?:unknown};
 const next=AppSettingsSchema.parse({profile:{...current.profile,...change.profile},disabledProviders:change.disabledProviders??current.disabledProviders});
 const temporary=file()+'.partial';writeFileSync(temporary,JSON.stringify(next,null,2));renameSync(temporary,file());return next;
}
export const settingsEnv=(s:AppSettings)=>({DREAM_CREATOR_PROFILE:JSON.stringify(s.profile),DREAM_DISABLED_PROVIDERS:s.disabledProviders.join(',')});
