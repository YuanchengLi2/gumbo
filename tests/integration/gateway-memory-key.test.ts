import {it,expect} from 'vitest';
import {memoryKey} from '../../supabase/functions/dream-gateway/memory-key';

// The key that wraps Gumbo for Chrome's memory on the user's computer: the same for an account every time, different
// between accounts and between gateway secrets, 32 bytes.
it('gives each account its own stable 32-byte memory key',async()=>{
 const a=await memoryKey('secret-one','user-a'),again=await memoryKey('secret-one','user-a'),b=await memoryKey('secret-one','user-b'),other=await memoryKey('secret-two','user-a');
 expect(a).toBe(again);expect(a).not.toBe(b);expect(a).not.toBe(other);
 expect(Buffer.from(a,'base64')).toHaveLength(32);
});
