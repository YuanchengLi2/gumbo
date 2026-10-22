import {AppSettingsSchema,type AppSettings} from '@dream/contracts';

/** Settings live in this browser (localStorage), with the desktop app's shape and merge rules (main/app-settings.ts): a
 * change names only what changed, and the whole is validated after merging. */
const key='gumbo-settings';
export function loadSettings():AppSettings{try{return AppSettingsSchema.parse(JSON.parse(localStorage.getItem(key)??'{}'));}catch{return AppSettingsSchema.parse({});}}
export function saveSettings(patch:unknown):AppSettings{
 const current=loadSettings(),change=(patch&&typeof patch==='object'?patch:{}) as {profile?:object;disabledProviders?:unknown;improve?:unknown};
 const next=AppSettingsSchema.parse({profile:{...current.profile,...change.profile},disabledProviders:change.disabledProviders??current.disabledProviders,improve:change.improve??current.improve});
 localStorage.setItem(key,JSON.stringify(next));return next;
}
