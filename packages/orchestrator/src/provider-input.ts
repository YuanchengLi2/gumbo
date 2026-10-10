/** JSON has null but no undefined. Treat null as omitted only for optional,
 * non-nullable fields; required values and intentionally nullable data stay strict. */
export function normalizeOptionalNulls(value:any,schema:any):any{
 if(!schema||value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(item=>normalizeOptionalNulls(item,schema.items));
 const result:any={...value},required=new Set(schema.required??[]);
 const nullable=(property:any):boolean=>property?.type==='null'||Array.isArray(property?.type)&&property.type.includes('null')||property?.enum?.includes(null)||(property?.anyOf??property?.oneOf??[]).some(nullable)||property&&Object.keys(property).length===0;
 for(const [key,item] of Object.entries(value)){const property=schema.properties?.[key];if(item===null&&property&&!required.has(key)&&!nullable(property))delete result[key];else result[key]=normalizeOptionalNulls(item,property??schema.additionalProperties);}
 return result;
}
