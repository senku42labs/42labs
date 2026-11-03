import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
export const runtime="nodejs";
const endpoint="https://backboard.railway.com/graphql/v2";
async function railway(token:string,query:string,variables:Record<string,unknown>) {
  const response=await fetch(endpoint,{method:"POST",headers:{"Project-Access-Token":token,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),cache:"no-store"});
  const payload=await response.json();
  if(!response.ok||payload.errors?.length) throw new Error(payload.errors?.[0]?.message||"Railway API request failed.");
  return payload.data;
}
export async function DELETE(req:Request) {
  if(!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  const token=process.env.RAILWAY_API_TOKEN;
  if(!token) return NextResponse.json({error:"Add the encrypted RAILWAY_API_TOKEN before deleting Railway resources."},{status:503});
  try {
    const body=await req.json(); const id=String(body.id||"");
    if(!id) return NextResponse.json({error:"Server id is required."},{status:400});
    if(id===process.env.RIMURU_PRIMARY_SERVER_ID) return NextResponse.json({error:"The primary RIMURU worker cannot be deleted from this console."},{status:403});
    const pool=db(); const found=await pool.query("SELECT id,name,railway_volume_id FROM rimuru_servers WHERE id=$1",[id]);
    if(!found.rowCount) return NextResponse.json({error:"Server not found in the RIMURU registry."},{status:404});
    await railway(token,`mutation($id:String!){serviceDelete(id:$id)}`,{id});
    const volumeId=found.rows[0].railway_volume_id;
    if(volumeId) await railway(token,`mutation($volumeId:String!){volumeDelete(volumeId:$volumeId)}`,{volumeId});
    await pool.query("INSERT INTO rimuru_server_audit(actor_id,action,server_id,details) VALUES('owner','server.deleted',$1,$2::jsonb)",[id,JSON.stringify({name:found.rows[0].name,volumeId})]);
    await pool.query("DELETE FROM rimuru_servers WHERE id=$1",[id]);
    return NextResponse.json({ok:true,message:"Railway worker, session volume and registry entry deleted."});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Server deletion failed."},{status:502}); }
}