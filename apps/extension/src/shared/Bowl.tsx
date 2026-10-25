/** Gumbo's bowl: the brand mark, in paprika. */
export function Bowl({size=20}:{size?:number}){
 return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <path d="M10 30h44c0 13-9.8 23-22 23S10 43 10 30z" fill="var(--paprika)"/>
  <path d="M24 23c-2.6-3 2.6-5.2 0-8.6M32 23c-2.6-3 2.6-5.2 0-8.6M40 23c-2.6-3 2.6-5.2 0-8.6" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round"/>
 </svg>;
}
