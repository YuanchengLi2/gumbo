import {z} from 'zod';

/** Defaults belong to creation, never to an omitted field in an update. */
export function patchSchema<S extends z.ZodRawShape>(schema:z.ZodObject<S>):z.ZodType<Partial<z.output<z.ZodObject<S>>>>{
 const fields=Object.fromEntries(Object.entries(schema.shape).map(([key,value])=>[key,z.optional(value instanceof z.ZodDefault?value.removeDefault():value)]));
 return z.object(fields) as unknown as z.ZodType<Partial<z.output<z.ZodObject<S>>>>;
}
