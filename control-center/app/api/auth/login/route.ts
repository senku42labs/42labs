import { NextResponse } from "next/server";
import { makeSession, verifyPassword, sessionCookieName } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.password !== "string" || !verifyPassword(body.password)) return NextResponse.json({error:"Invalid owner password."},{status:401});
    const response = NextResponse.json({ok:true});
    response.cookies.set(sessionCookieName,makeSession(),{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:8*60*60});
    return response;
  } catch (e) { return NextResponse.json({error:e instanceof Error?e.message:"Sign-in failed."},{status:500}); }
}