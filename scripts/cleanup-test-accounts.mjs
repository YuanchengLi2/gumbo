import {spawnSync} from 'node:child_process';
const ref='qewguvfkkwvdoqptiljd',url=`https://${ref}.supabase.co`;
const command=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase projects api-keys --project-ref ${ref} --output json`],{encoding:'utf8',windowsHide:true});
if(command.status!==0)throw new Error('Could not load test cleanup configuration.');
let keys;try{keys=JSON.parse(command.stdout);}catch{throw new Error('Invalid test cleanup configuration.');}
const key=keys.find(k=>k.name==='service_role')?.api_key;
const headers={apikey:key,Authorization:`Bearer ${key}`};
const response=await fetch(`${url}/auth/v1/admin/users?page=1&per_page=100`,{headers});if(!response.ok)throw new Error('Could not list acceptance accounts.');
const {users}=await response.json();let removed=0;
for(const user of users.filter(u=>/^dream-acceptance-[0-9a-f-]+@example\.invalid$/.test(u.email??''))){const invite=await fetch(`${url}/rest/v1/dream_invites?email=eq.${encodeURIComponent(user.email)}`,{method:'DELETE',headers});if(!invite.ok)throw new Error('Could not remove test invitation.');const deleted=await fetch(`${url}/auth/v1/admin/users/${user.id}`,{method:'DELETE',headers});if(!deleted.ok)throw new Error('Could not remove test account.');removed++;}
console.log(`Removed ${removed} temporary acceptance account(s).`);
