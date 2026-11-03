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
      await pool.query("UPDATE rimuru_command_catalog SET enabled=$1,updated_by='owner',updated_at=now() WHERE command_name=$2",[body.enabled,body.name]);
      await pool.query("INSERT INTO rimuru_command_audit(actor_id,command_name,action,details) VALUES('owner',$1,$2,$3::jsonb)",[body.name,body.enabled?"enabled":"disabled",JSON.stringify({source:"control-centre"})]);
    } else if(body.kind==="setting" && typeof body.key==="string" && body.key.length<80) {
      await pool.query("INSERT INTO rimuru_bot_settings(setting_key,setting_value,updated_by,updated_at) VALUES($1,$2::jsonb,'owner',now()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by='owner',updated_at=now()",[body.key,JSON.stringify(body.value)]);
    } else return NextResponse.json({error:"Invalid update."},{status:400});
    return NextResponse.json({ok:true});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Update failed."},{status:500}); }
}