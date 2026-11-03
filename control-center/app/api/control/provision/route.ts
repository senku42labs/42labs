import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { isAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/secret";
export const runtime = "nodejs";
const endpoint="https://backboard.railway.com/graphql/v2";
async function railway(token:string,query:string,variables:Record<string,unknown>) {
  const response=await fetch(endpoint,{method:"POST",headers:{"Project-Access-Token":token,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),cache:"no-store"});
  const payload=await response.json();
  if(!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || "Railway API request failed.");
  return payload.data;
}
export async function POST(req:Request) {
  if(!await isAdmin()) return NextResponse.json({error:"Unauthorized"},{status:401});
  const token=process.env.RAILWAY_API_TOKEN;
  if(!token) return NextResponse.json({error:"Railway provisioning is locked until you add a Railway Project Token as the encrypted RAILWAY_API_TOKEN environment variable on this Vercel project. No resource was created."},{status:503});
  const projectId=process.env.RAILWAY_PROJECT_ID; const environmentId=process.env.RAILWAY_ENVIRONMENT_ID;
  const repo=process.env.RAILWAY_SOURCE_REPO||"senku42labs/42labs";
  const branch=process.env.RAILWAY_SOURCE_BRANCH||"main";
  if(!projectId||!environmentId) return NextResponse.json({error:"RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID must be configured."},{status:503});
  let serviceId:string|undefined, volumeId:string|undefined;
  try {
    const body=await req.json(); const name=String(body.name||"").trim().slice(0,48);
    if(!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,47}$/.test(name)) return NextResponse.json({error:"Server name must be 3–48 letters, numbers, spaces, _ or -."},{status:400});
    const apiKey=randomBytes(32).toString("hex");
    const created=await railway(token,`mutation($input: ServiceCreateInput!){serviceCreate(input:$input){id name}}`,{input:{projectId,environmentId,name,source:{repo}}});
    const service=created.serviceCreate; serviceId=service?.id;
    if(!serviceId) throw new Error("Railway did not return a service id.");
    await railway(token,`mutation($id:String!,$input:ServiceConnectInput!){serviceConnect(id:$id,input:$input){id}}`,{id:serviceId,input:{repo,branch}});
    const volume=await railway(token,`mutation($input: VolumeCreateInput!){volumeCreate(input:$input){id name}}`,{input:{projectId,environmentId,serviceId,mountPath:"/data",name:name+" sessions",sizeMB:500}});
    volumeId=volume.volumeCreate?.id;
    if(!volumeId) throw new Error("Railway did not return a persistent volume id.");
    const domainResult=await railway(token,`mutation($input: ServiceDomainCreateInput!){serviceDomainCreate(input:$input){domain}}`,{input:{serviceId,environmentId}});
    const domain=domainResult.serviceDomainCreate?.domain;
    if(!domain) throw new Error("Railway did not return a public worker domain.");
    await railway(token,`mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$serviceId,environmentId:$environmentId,input:$input)}`,{serviceId,environmentId,input:{rootDirectory:"/worker",startCommand:"npm start",healthcheckPath:"/health"}});
    await railway(token,`mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}`,{input:{projectId,environmentId,serviceId,variables:{AUTH_DIR:"/data/whatsapp-auth",COMMAND_CONFIG_PATH:"/data/command-config.json",RIMURU_API_KEY:apiKey,RIMURU_REGISTRY_DATABASE_URL:process.env.RIMURU_REGISTRY_DATABASE_URL||"",RIMURU_BOT_NAME:"RIMURU TEMPEST MD",PORT:"3000"}}});
    await railway(token,`mutation($serviceId:String!,$environmentId:String!){serviceInstanceDeployV2(serviceId:$serviceId,environmentId:$environmentId)}`,{serviceId,environmentId});
    const pool=db();
    await pool.query("INSERT INTO rimuru_servers(id,name,worker_url,status,capacity,active_dashboard_users,paired_whatsapp_accounts,railway_volume_id) VALUES($1,$2,$3,'offline',1,0,0,$4)",[serviceId,name,"https://"+domain,volumeId]);
    await pool.query("INSERT INTO rimuru_server_secrets(server_id,encrypted_api_key) VALUES($1,$2)",[serviceId,encryptSecret(apiKey)]);
    await pool.query("INSERT INTO rimuru_server_audit(actor_id,action,server_id,details) VALUES('owner','server.provisioned',$1,$2::jsonb)",[serviceId,JSON.stringify({name,volumeId,domain,repo,branch})]);
    return NextResponse.json({ok:true,serviceId,volumeId,workerUrl:"https://"+domain,message:"Railway worker and isolated 500 MB session volume created. Deployment is starting; the dashboard will show it online after its health check passes."},{status:202});
  } catch(e) {
    if(serviceId) {
      try { if(volumeId) await railway(token,`mutation($volumeId:String!){volumeDelete(volumeId:$volumeId)}`,{volumeId}); } catch {}
      try { await railway(token,`mutation($id:String!){serviceDelete(id:$id)}`,{id:serviceId}); } catch {}
    }
    return NextResponse.json({error:e instanceof Error?e.message:"Provisioning failed."},{status:502});
  }
}