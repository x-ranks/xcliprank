import { readAuthorState } from "./author-status-store";
import { readPostState } from "./post-status-store";
import { readCuratedRemovals } from "./curated-removals";
export async function availabilityDashboard(options:{directory?:string;curatedDirectory?:string}={}){
 const [authors,posts,manual]=await Promise.all([readAuthorState(options.directory),readPostState(options.directory),readCuratedRemovals(options.curatedDirectory)]);
 const entries=Object.entries(posts.entries),authorEntries=Object.entries(authors.entries);
 return {generatedAt:Date.now(),provider:"fxtwitter",nextBatchAt:posts.nextBatchAt,cooldownUntil:Math.max(posts.cooldownUntil,authors.cooldownUntil),cycleStartedAt:posts.cycleStartedAt,cycleCompletedAt:posts.cycleCompletedAt,
  lastPostCheckedAt:Math.max(0,...entries.map(([,e])=>e.checkedAt)),lastAuthorCheckedAt:Math.max(0,...authorEntries.map(([,e])=>e.checkedAt)),
  counts:{posts:entries.length,blocked:entries.filter(([,e])=>e.blocked).length,pending:entries.filter(([,e])=>!e.blocked&&e.missingSince>0).length,suspended:authorEntries.filter(([,e])=>e.status==="suspended").length,manual:manual.length},
  posts:entries.filter(([,e])=>e.blocked||e.missingSince>0).sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,500).map(([id,e])=>({id,...e})),
  authors:authorEntries.sort((a,b)=>b[1].checkedAt-a[1].checkedAt).slice(0,500).map(([key,e])=>({key,...e})),manual};
}
