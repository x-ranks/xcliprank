import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { serverRegistryDirectory } from "./free-curated-server-store";

export const X_DAY = 86400000, X_DAILY_AUTHORS = 24, X_PAGE_SIZE = 100;
export type XPosition = {
  sinceId: string; nextToken: string | null; endTime: string | null;
  startTime: string | null; newestId: string | null; warning: string | null;
  checkedAt: number; savedTotal: number; rawTotal: number;
};
export type XCuratedState = {
  version: 1; reservations: {id: string; at: number}[]; cooldownUntil: number;
  positions: Record<string, XPosition>; requests: number; rawPosts: number;
};
export const freshXState = (): XCuratedState => ({version:1,reservations:[],cooldownUntil:0,positions:{},requests:0,rawPosts:0});
const id = (v: unknown) => typeof v === "string" && /^\d{2,20}$/.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => v === null || typeof v === "string" && Number.isFinite(Date.parse(v));
export async function readXState(directory = serverRegistryDirectory()): Promise<XCuratedState> {
  try {
    const text = await fs.readFile(path.join(directory,"x-api-v1.json"),"utf8");
    if(Buffer.byteLength(text)>1024*1024)throw Error();
    const s = JSON.parse(text) as XCuratedState;
    if(s?.version!==1||!Array.isArray(s.reservations)||s.reservations.length>X_DAILY_AUTHORS||
      s.reservations.some(r=>!r||!id(r.id)||!count(r.at))||!count(s.cooldownUntil)||!count(s.requests)||!count(s.rawPosts)||
      !s.positions||Array.isArray(s.positions)||typeof s.positions!=="object"||Object.keys(s.positions).length>100||
      Object.entries(s.positions).some(([key,p])=>!id(key)||!p||!id(p.sinceId)||
        !(p.newestId===null||id(p.newestId))||!date(p.endTime)||!date(p.startTime)||
        !(p.nextToken===null||typeof p.nextToken==="string"&&p.nextToken.length>0&&p.nextToken.length<=4096)||
        p.nextToken!==null&&p.endTime===null||
        !(p.warning===null||typeof p.warning==="string"&&p.warning.length<=256)||
        !count(p.checkedAt)||!count(p.savedTotal)||!count(p.rawTotal)))throw Error();
    return s;
  } catch(e: any) {
    if(e.code==="ENOENT")return freshXState();
    throw Error("X_API_STATE_INVALID; existing quota and positions preserved");
  }
}
// Caller holds the SAME operation.lock used by sync and the former free collector.
export async function writeXState(state: XCuratedState,directory=serverRegistryDirectory()) {
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const temp=path.join(directory,`x-state-${randomBytes(8).toString("hex")}.tmp`);
  try{await fs.writeFile(temp,JSON.stringify(state),{mode:0o600,flag:"wx"});await fs.rename(temp,path.join(directory,"x-api-v1.json"));}
  finally{await fs.rm(temp,{force:true});}
}
export const activeReservations = (s:XCuratedState,now:number) => s.reservations.filter(r=>r.at>now-X_DAY);
