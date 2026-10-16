import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
export type Removal={id:string;username:string;at:number};
const directory=()=>process.env.XCLIP_FREE_CURATED_STATE_DIR||path.join(os.homedir(),".xclip-free-curated");
export async function readCuratedRemovals(dir=directory()):Promise<Removal[]>{
 try{const file=path.join(dir,"manual-removals-v1.json");if((await fs.stat(file)).size>1024*1024)throw Error();const s=JSON.parse(await fs.readFile(file,"utf8"));
 if(s.version!==1||!Array.isArray(s.entries)||s.entries.length>5000||new Set(s.entries.map((e:Removal)=>e.id)).size!==s.entries.length||s.entries.some((e:Removal)=>!/^\d{2,20}$/.test(e.id)||!/^[a-z0-9_]{1,15}$/i.test(e.username)||!Number.isFinite(e.at)||e.at<0))throw Error();return s.entries;
 }catch(e:any){if(e.code==="ENOENT")return [];throw Error("MANUAL_REMOVALS_UNREADABLE");}
}
// Writers hold the common collector/management operation.lock.
export async function writeCuratedRemovals(entries:Removal[],dir=directory()){
 await fs.mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,"manual-removals-v1.json"),tmp=file+"."+randomBytes(8).toString("hex")+".tmp";
 try{await fs.writeFile(tmp,JSON.stringify({version:1,entries}),{flag:"wx",mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
}
export async function manualCuratedKeys(){return new Set((await readCuratedRemovals()).flatMap(e=>["id:"+e.id,"name:"+e.username.toLowerCase()]));}
