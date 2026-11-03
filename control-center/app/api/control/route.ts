import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secret";
export const runtime = "nodejs";
async function refreshServerFleet(pool:any,servers:any[],secrets:any[]) {
  const secretMap=new Map(secrets.map((s:any)=>[s.server_id,s.encrypted_api_key]));
  const primaryId=process.env.RIMURU_PRIMARY_SERVER_ID;
  await Promise.all(servers.map(async (server:any)=>{
    try {
      const key=server.id===primaryId?process.env.RIMURU_API_KEY:secretMap.has(server.id)?decryptSecret(secretMap.get(server.id)):undefined;
      if(!key) throw new Error("Missing server API key");
      const base=String(server.worker_url).replace(/\/$/,"");
      const health=await fetch(base+"/health",{cache:"no-store",signal:AbortSignal.timeout(5000)});
      if(!health.ok) throw new Error("Worker health check failed");
      const response=await fetch(base+"/api/status",{headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error("Worker status check failed");
      const status=await response.json();
      await pool.query("UPDATE rimuru_servers SET status='online',paired_whatsapp_accounts=$1,last_heartbeat_at=now(),updated_at=now() WHERE id=$2",[status.status==="connected"?1:0,server.id]);
    } catch {
      await pool.query("UPDATE rimuru_servers SET status='offline',paired_whatsapp_accounts=0,updated_at=now() WHERE id=$1",[server.id]);
    }
  }));
}
export async function GET() {
  if (!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const pool=db();
    const [serversResult,commands,settings,audit,secrets] = await Promise.all([
      pool.query("SELECT s.id,s.name,s.worker_url,s.status,s.capacity,s.active_dashboard_users,s.paired_whatsapp_accounts,s.last_heartbeat_at,s.created_at,s.railway_volume_id,(SELECT count(*)::int FROM rimuru_user_presence p WHERE p.server_id=s.id AND p.session_expires_at>now()) AS active_dashboard_users FROM rimuru_servers s ORDER BY s.created_at"),
      pool.query("SELECT command_name,category,description,enabled,handler_type,config,updated_at FROM rimuru_command_catalog ORDER BY category,command_name"),
      pool.query("SELECT setting_key,setting_value,updated_at FROM rimuru_bot_settings ORDER BY setting_key"),
      pool.query("SELECT actor_id,action,server_id,details,created_at FROM rimuru_server_audit ORDER BY created_at DESC LIMIT 12"),
      pool.query("SELECT server_id,encrypted_api_key FROM rimuru_server_secrets")
    ]);
    await refreshServerFleet(pool,serversResult.rows,secrets.rows);
    const fresh=await pool.query("SELECT id,name,worker_url,status,capacity,active_dashboard_users,paired_whatsapp_accounts,last_heartbeat_at,created_at,railway_volume_id FROM rimuru_servers ORDER BY created_at");
    return NextResponse.json({servers:fresh.rows,commands:commands.rows,settings:settings.rows,audit:audit.rows});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Database query failed."},{status:500}); }
}
export async function PATCH(req:Request) {
  if (!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const body=await req.json(); const pool=db();
    if(body.kind==="command" && typeof body.name==="string" && typeof body.enabled==="boolean") {
      const current=await pool.query("SELECT handler_type FROM rimuru_command_catalog WHERE command_name=$1",[body.name]);
      if(!current.rowCount) return NextResponse.json({error:"Unknown command."},{status:404});
      if(body.enabled && current.rows[0].handler_type!=="built_in") return NextResponse.json({error:"This Knightbot reference command has no RIMURU worker handler yet."},{status:409});
      await pool.query("UPDATE rimuru_command_catalog SET enabled=$1,updated_by='owner',updated_at=now() WHERE command_name=$2",[body.enabled,body.name]);
      await pool.query("INSERT INTO rimuru_command_audit(actor_id,command_name,action,details) VALUES('owner',$1,$2,$3::jsonb)",[body.name,body.enabled?"enabled":"disabled",JSON.stringify({source:"control-centre"})]);
    } else if(body.kind==="setting" && typeof body.key==="string" && body.key.length<80) {
      if(body.key==="prefix" && (typeof body.value!=="string" || body.value.length<1 || body.value.length>3 || /\s/.test(body.value))) return NextResponse.json({error:"Prefix must be 1–3 non-space characters."},{status:400});
      await pool.query("INSERT INTO rimuru_bot_settings(setting_key,setting_value,updated_by,updated_at) VALUES($1,$2::jsonb,'owner',now()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by='owner',updated_at=now()",[body.key,JSON.stringify(body.value)]);
    } else return NextResponse.json({error:"Invalid update."},{status:400});

    const shouldSync=body.kind==="command" || (body.kind==="setting" && body.key==="prefix");
    if(shouldSync) {
      const [servers,secrets,enabledRows,prefixResult]=await Promise.all([
        pool.query("SELECT id,worker_url FROM rimuru_servers"),
        pool.query("SELECT server_id,encrypted_api_key FROM rimuru_server_secrets"),
        pool.query("SELECT command_name FROM rimuru_command_catalog WHERE enabled=true AND handler_type='built_in' ORDER BY command_name"),
        pool.query("SELECT setting_value FROM rimuru_bot_settings WHERE setting_key='prefix'")
      ]);
      const secretMap=new Map(secrets.rows.map((s:any)=>[s.server_id,s.encrypted_api_key]));
      const primaryId=process.env.RIMURU_PRIMARY_SERVER_ID;
      const prefix=prefixResult.rows[0]?.setting_value;
      const results=await Promise.all(servers.rows.map(async (server:any)=>{
        try {
          const key=server.id===primaryId?process.env.RIMURU_API_KEY:secretMap.has(server.id)?decryptSecret(secretMap.get(server.id)):undefined;
          if(!key) return false;
          const base=String(server.worker_url).replace(/\/$/,"");
          const configResponse=await fetch(base+"/api/commands/config",{headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(5000)});
          if(!configResponse.ok) return false;
          const config=await configResponse.json();
          const nextConfig={enabled:enabledRows.rows.map((row:any)=>row.command_name),...(typeof prefix==="string"?{prefix}:{}),...(body.kind==="setting"&&body.key==="prefix"?{prefix:String(body.value)}:{})};
          const pushed=await fetch(base+"/api/commands/config",{method:"PUT",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(nextConfig),cache:"no-store",signal:AbortSignal.timeout(5000)});
          return pushed.ok;
        } catch { return false; }
      }));
      if(results.some((ok:boolean)=>!ok)) return NextResponse.json({ok:true,synced:false,warning:"Saved in the RIMURU database. One or more worker nodes could not be updated; refresh server health and retry."},{status:202});
    }
    return NextResponse.json({ok:true,synced:true});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Update failed."},{status:500}); }
}