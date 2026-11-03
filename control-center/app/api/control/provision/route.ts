import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
export const runtime = "nodejs";
const endpoint="https://backboard.railway.app/graphql/v2";
async function railway(token:string,query:string,variables:Record<string,unknown>) {
  const response=await fetch(endpoint,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),cache:"no-store"});
  const payload=await response.json();
  if(!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || "Railway API request failed.");
  return payload.data;
}
export async function POST(req:Request) {
  if(!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  const token=process.env.RAILWAY_API_TOKEN;
  if(!token) return NextResponse.json({error:"Provisioning is not enabled yet. Add RAILWAY_API_TOKEN as an encrypted production environment variable in the RIMURU control-centre project. No server was created."},{status:503});
  try {
    const body=await req.json(); const name=String(body.name||"").trim().slice(0,48);
    if(!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,47}$/.test(name)) return NextResponse.json({error:"Server name must be 3–48 letters, numbers, spaces, _ or -."},{status:400});
    const projectId=process.env.RAILWAY_PROJECT_ID; const environmentId=process.env.RAILWAY_ENVIRONMENT_ID;
    const repo=process.env.RAILWAY_SOURCE_REPO||"senku42labs/42labs";
    const branch=process.env.RAILWAY_SOURCE_BRANCH||"main";
    if(!projectId||!environmentId) return NextResponse.json({error:"RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID must be configured."},{status:503});
    const created=await railway(token,`mutation($input: ServiceCreateInput!){serviceCreate(input:$input){id name}}`,{input:{projectId,name,source:{repo,branch}}});
    const service=created.serviceCreate;
    if(!service?.id) throw new Error("Railway did not return a service id.");
    const volume=await railway(token,`mutation($input: VolumeCreateInput!){volumeCreate(input:$input){id name}}`,{input:{projectId,environmentId,serviceId:service.id,name:name+" sessions",mountPath:"/data",sizeMB:500}});
    const volumeId=volume.volumeCreate?.id;
    if(!volumeId) throw new Error("Railway did not return a persistent volume id.");
    await railway(token,`mutation($input: VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input){id}}`,{input:{projectId,environmentId,serviceId:service.id,variables:{AUTH_DIR:"/data/whatsapp-auth",RIMURU_API_KEY:crypto.randomUUID(),RIMURU_REGISTRY_DATABASE_URL:process.env.RIMURU_REGISTRY_DATABASE_URL||""}}});
    await railway(token,`mutation($input: ServiceInstanceDeployInput!){serviceInstanceDeploy(input:$input){id}}`,{input:{serviceId:service.id,environmentId}});
    await db().query("INSERT INTO rimuru_servers(id,name,worker_url,status,capacity,active_dashboard_users,paired_whatsapp_accounts) VALUES($1,$2,$3,'offline',1,0,0)",[service.id,name,"pending://"+service.id]);
    await db().query("INSERT INTO rimuru_server_audit(actor_id,action,server_id,details) VALUES('owner','server.provisioned',$1,$2::jsonb)",[service.id,JSON.stringify({name,volumeId,repo,branch})]);
    return NextResponse.json({ok:true,serviceId:service.id,volumeId,message:"Railway service and isolated volume created; deployment is starting. Add its public worker domain when Railway reports it ready."},{status:202});
  } catch(e) { return NextResponse.json({error:e instanceof Error?e.message:"Provisioning failed."},{status:502}); }
}