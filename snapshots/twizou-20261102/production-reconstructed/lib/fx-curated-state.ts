import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { serverRegistryDirectory } from "./free-curated-server-store";
import { FREE_CURATED_AUTHOR_LIMIT, FREE_CURATED_POSITION_STATE_BYTES } from "./free-curated-limits";

export type FxPosition = { sinceId:string; cursor:string|null; upperId:string|null; seenCursorHashes:string[]; checkedAt:number; newestId?:string };
export type FxState = { version:1; positions:Record<string,FxPosition>; attempts:number; requests:number; rawPosts:number };
export const fxCursorHash=(cursor:string)=>createHash("sha256").update(cursor).digest("hex");
export const freshFxState = ():FxState => ({version:1,positions:{},attempts:0,requests:0,rawPosts:0});
const id=(s:unknown)=>typeof s==="string"&&/^\d{2,20}$/.test(s);
const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
export async function readFxState(directory=serverRegistryDirectory()):Promise<FxState>{
  try{
    const text=await fs.readFile(path.join(directory,"fx-patrol-v1.json"),"utf8");
    if(Buffer.byteLength(text)>FREE_CURATED_POSITION_STATE_BYTES)throw Error();
    const s=JSON.parse(text) as FxState;
    if(s?.version!==1||![s.attempts,s.requests,s.rawPosts].every(count)||!s.positions||Array.isArray(s.positions)||typeof s.positions!=="object"||Object.keys(s.positions).length>FREE_CURATED_AUTHOR_LIMIT||
      Object.entries(s.positions).some(([key,p])=>!id(key)||!p||!id(p.sinceId)||!(p.upperId===null||id(p.upperId))||!count(p.checkedAt)||
        !(p.cursor===null||typeof p.cursor==="string"&&/^xclip-statuses-(?:replies-)?v1:.+$/.test(p.cursor)&&p.cursor.length<=4096)||
        (p.cursor===null)!==(p.upperId===null)||p.upperId!==null&&BigInt(p.upperId)<BigInt(p.sinceId)||!Array.isArray(p.seenCursorHashes)||p.seenCursorHashes.length>200||
        p.seenCursorHashes.some(c=>typeof c!=="string"||!/^[a-f0-9]{64}$/.test(c))||new Set(p.seenCursorHashes).size!==p.seenCursorHashes.length||
        p.cursor!==null&&p.seenCursorHashes.at(-1)!==fxCursorHash(p.cursor)||p.cursor===null&&p.seenCursorHashes.length!==0||
        p.newestId!==undefined&&(!id(p.newestId)||p.cursor===null||BigInt(p.newestId)<BigInt(p.sinceId)||BigInt(p.newestId)>BigInt(p.upperId!))))throw Error();
    return s;
  }catch(e:any){if(e.code==="ENOENT")return freshFxState();throw Error("FX_PATROL_STATE_INVALID; existing positions and shared quota preserved");}
}
// The caller holds the common operation.lock. This file never contains X pagination tokens.
export async function writeFxState(s:FxState,directory=serverRegistryDirectory()){
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const temp=path.join(directory,`fx-patrol-${randomBytes(8).toString("hex")}.tmp`);
  try{await fs.writeFile(temp,JSON.stringify(s),{flag:"wx",mode:0o600});await fs.rename(temp,path.join(directory,"fx-patrol-v1.json"));}
  finally{await fs.rm(temp,{force:true});}
}
