import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
function key() {
  const secret=process.env.RIMURU_SESSION_SECRET||"";
  if(secret.length<32) throw new Error("Session secret is not configured.");
  return createHash("sha256").update(secret).digest();
}
export function encryptSecret(value:string) {
  const iv=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
}
export function decryptSecret(value:string) {
  const [ivText,tagText,dataText]=value.split(".");
  if(!ivText||!tagText||!dataText) throw new Error("Stored server secret is malformed.");
  const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(ivText,"base64url"));
  decipher.setAuthTag(Buffer.from(tagText,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText,"base64url")),decipher.final()]).toString("utf8");
}