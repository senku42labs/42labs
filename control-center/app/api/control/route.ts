import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  if (!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  try {
    const pool=db();
    const [servers,commands,settings,audit] = await Promise.all([
      pool.query("SELECT id,name,worker_url,status,capacity,active_dashboard_users,paired_whatsapp_accounts,last_heartbeat_at,created_at FROM rimuru_servers ORDER BY created_at"),
      pool.query("SELECT command_name,category,description,enabled,handler_type,config,updated_at FROM rimuru_command_catalog ORDER BY category,command_name"),
      pool.query("SELECT setting_key,setting_value,updated_at FROM rimuru_bot_settings ORDER BY setting_key"),
      pool.query("SELECT actor_id,action,server_id,details,created_at FROM rimuru_server_audit ORDER BY created_at DESC LIMIT 12")
    ]);
    return NextResponse.json({servers:servers.rows,commands:commands.rows,settings:settings.rows,audit:audit.rows});
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
      await pool.query("INSERT INTO rimuru_bot_settings(setting_key,setting_value,updated_by,updated_at) VALUES($1,$2::jsonb,'owner',now()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by='owner',updated_at=now()",[body.key,JSON.stringify(body.value)]);
    } else return NextResponse.json({error:"Invalid update."},{status:400});

    const workerUrl=process.env.RIMURU_WORKER_URL?.replace(/\\/$/,"");
    const workerKey=process.env.RIMURU_API_KEY;
    if(workerUrl && workerKey && (body.kind==="command" || (body.kind==="setting" && body.key==="prefix"))) {
      const configResponse=await fetch(workerUrl+"/api/commands/config",{headers:{Authorization:"Bearer "+workerKey},cache:"no-store"});
      if(!configResponse.ok) return NextResponse.json({ok:true,synced:false,warning:"Saved in the control-centre database, but the worker command API is not ready yet."},{status:202});
      const config=await configResponse.json();
      const enabledRows=await pool.query("SELECT command_name FROM rimuru_command_catalog WHERE enabled=true AND handler_type='built_in' ORDER BY command_name");
      const prefixResult=await pool.query("SELECT setting_value FROM rimuru_bot_settings WHERE setting_key='prefix'");
      const prefix=prefixResult.rows[0]?.setting_value;
      const nextConfig={enabled:enabledRows.rows.map((row:any)=>row.command_name),...(typeof prefix==="string"?{prefix}:{}),...(body.kind==="setting"&&body.key==="prefix"?{prefix:String(body.value)}:{})};
      const pushed=await fetch(workerUrl+"/api/commands/config",{method:"PUT",headers:{Authorization:"Bearer "+workerKey,"Content-Type":"application/json"},body:JSON.stringify(nextConfig),cache:"no-store"});
      if(!pushed.ok) return NextResponse.json({ok:true,synced:false,warning:"Saved in the control-centre database, but the worker rejected the live config."},{status:202});
    }
    return NextResponse.json({ok:true,synced:true});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Update failed."},{status:500}); }
}