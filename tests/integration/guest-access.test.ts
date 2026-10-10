import {it,expect,vi} from 'vitest';
import {activateAccess} from '../../supabase/functions/dream-gateway/access';
it('activates guests by authenticated identity without an invitation',async()=>{const rpc=vi.fn().mockResolvedValue({data:true});expect(await activateAccess({rpc},{id:'guest-id',is_anonymous:true})).toBe(true);expect(rpc).toHaveBeenCalledWith('dream_activate_guest',{p_user:'guest-id'});});
it('retains existing activation and propagates inactive status',async()=>{const rpc=vi.fn().mockResolvedValue({data:false});expect(await activateAccess({rpc},{id:'member',email:'member@example.invalid'})).toBe(false);expect(rpc).toHaveBeenCalledWith('dream_activate_account',{p_user:'member',p_email:'member@example.invalid'});});
