export type FreePublicationMetrics={candidates:number;saved:number;promoted:number;unavailable:number;contentOrReview:number;tier:number;knownPostOrMedia:number;batchDuplicate:number;insertRace:number};
const publicationKeys=["candidates","saved","promoted","unavailable","contentOrReview","tier","knownPostOrMedia","batchDuplicate","insertRace"] as const;
function validPublication(p:FreePublicationMetrics|null|undefined){
  if(p==null)return true;
  return typeof p==="object"&&!Array.isArray(p)&&publicationKeys.every(k=>Number.isSafeInteger(p[k])&&p[k]>=0&&p[k]<=100)&&
    p.saved+p.promoted+p.unavailable+p.contentOrReview+p.tier+p.knownPostOrMedia+p.batchDuplicate+p.insertRace===p.candidates;
}
export type FreeScanMetrics = {
  lastPublication?: FreePublicationMetrics|null;
  trackingSince: number; lastSuccessAt: number; lastOutcome: "running" | "success" | "no_new" | "empty" | "error";
  lastFetched: number | null; lastNew: number | null; lastSaved: number | null;
  fetchedTotal: number; newTotal: number; successCount: number; failureCount: number; consecutiveFailures: number;
  lastDurationMs: number | null;
  recentVideos: {id:string;at:string;url:string}[];
};
export const newFreeMetrics = (now:number):FreeScanMetrics => ({trackingSince:now,lastSuccessAt:0,lastOutcome:"running",lastFetched:null,lastNew:null,lastSaved:null,
  fetchedTotal:0,newTotal:0,successCount:0,failureCount:0,consecutiveFailures:0,lastDurationMs:null,recentVideos:[]});
export function validFreeMetrics(m:FreeScanMetrics) {
  return !!m&&validPublication(m.lastPublication)&&[m.trackingSince,m.lastSuccessAt,m.fetchedTotal,m.newTotal,m.successCount,m.failureCount,m.consecutiveFailures].every(n=>Number.isSafeInteger(n)&&n>=0)&&
    [m.lastFetched,m.lastNew,m.lastSaved,m.lastDurationMs].every(n=>n===null||Number.isSafeInteger(n)&&n>=0)&&
    ["running","success","no_new","empty","error"].includes(m.lastOutcome)&&Array.isArray(m.recentVideos)&&m.recentVideos.length<=10&&
    m.recentVideos.every(v=>/^\d{2,20}$/.test(v.id)&&Number.isFinite(Date.parse(v.at))&&/^https:\/\/x\.com\/[a-z0-9_]{1,15}\/status\/\d{2,20}$/i.test(v.url));
}

export type FreeRun = {at:number;finishedAt:number;outcome:"running"|"completed"|"skipped"|"paused"|"error";reason:string|null;processed:number;fetched:number;saved:number;failed:number;empty:number};
