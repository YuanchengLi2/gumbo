export async function activateAccess(db:any,user:{id:string;email?:string;is_anonymous?:boolean}){
 const {data,error}=await db.rpc(user.is_anonymous?'dream_activate_guest':'dream_activate_account',user.is_anonymous?{p_user:user.id}:{p_user:user.id,p_email:user.email??''});
 if(error)throw error;
 return Boolean(data);
}
