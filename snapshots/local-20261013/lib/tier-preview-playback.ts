import {createHash,randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir,mkdtemp,open,readdir,rename,rm,stat,utimes} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {Readable} from "node:stream";
import {runVideoTool} from "./tier-personal-video";
import {videoPreviewStatus} from "./tier-video-preview";
const folder=path.join(process.cwd(),".local-admin","tier-video-playback-cache");
const max=256*1024*1024;
let queue:Promise<unknown>=Promise.resolve();
async function target(id:number){
  if(!Number.isSafeInteger(id)||id<=0)throw Error("INVALID_PREVIEW_ID");
  const s=await videoPreviewStatus(),row=s.samples.find(v=>v.id===id);if(!row)throw Error("PREVIEW_VIDEO_NOT_AVAILABLE");
  const url=new URL(row.video);if(url.protocol!=="https:"||url.username||url.password||(url.port&&url.port!=="443")||!(url.hostname==="video.twimg.com"||url.hostname.endsWith(".video.twimg.com")))throw Error("UNSUPPORTED_VIDEO_URL");
  return {url:row.video,file:path.join(folder,createHash("sha256").update(String(id)+"|"+row.video).digest("hex")+".mp4")};
}
async function existing(file:string){try{const s=await stat(file);return s.size>0?s:null;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function reserveSlot(){
  await mkdir(folder,{recursive:true,mode:0o700});
  const files=await Promise.all((await readdir(folder)).filter(v=>/^[a-f0-9]{64}\.mp4$/.test(v)).map(async name=>({file:path.join(folder,name),info:await stat(path.join(folder,name))})));
  files.sort((a,b)=>a.info.mtimeMs-b.info.mtimeMs);
  while(files.length>=8){const old=files.shift()!;try{await rm(old.file);}catch{throw Error("CACHE_BUSY_CLOSE_OTHER_VIDEOS");}}
}
export async function preparePreviewPlayback(id:number){
  const work=queue.catch(()=>{}).then(async()=>{
    const item=await target(id);if(await existing(item.file)){await utimes(item.file,new Date(),new Date());return {ready:true,cached:true};}
    await reserveSlot();const dir=await mkdtemp(path.join(tmpdir(),"xclip-preview-playback-"));const input=path.join(dir,"input.mp4"),output=path.join(dir,"output.mp4");
    try{
      const response=await fetch(item.url,{headers:{"User-Agent":"Mozilla/5.0","Accept-Encoding":"identity"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(60000)});
      if(!response.ok||!response.body){await response.body?.cancel();throw Error("VIDEO_HTTP_"+response.status);}
      if(Number(response.headers.get("content-length")??0)>max){await response.body.cancel();throw Error("VIDEO_TOO_LARGE_256_MIB");}
      const file=await open(input,"wx",0o600),reader=response.body.getReader();let bytes=0;
      try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max)throw Error("VIDEO_TOO_LARGE_256_MIB");let offset=0;while(offset<part.value.length){const r=await file.write(part.value,offset,part.value.length-offset);if(!r.bytesWritten)throw Error("VIDEO_WRITE_FAILED");offset+=r.bytesWritten;}}}finally{await file.close();await reader.cancel();}
      await runVideoTool("ffmpeg",["-nostdin","-v","error","-y","-protocol_whitelist","file,pipe","-i",input,"-map","0:v:0","-map","0:a:0?","-c","copy","-avoid_negative_ts","make_zero","-movflags","+faststart","-f","mp4",output],60000);
      const ready=await stat(output);if(!ready.size||ready.size>max)throw Error("VIDEO_CACHE_SIZE_INVALID");
      // Use a temp file in the destination volume so Windows cross-volume moves work.
      const staged=item.file+"."+randomUUID()+".tmp";
      try{const {copyFile}=await import("node:fs/promises");await copyFile(output,staged);await rename(staged,item.file);}finally{await rm(staged,{force:true});}
      return {ready:true,cached:false};
    }finally{await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  });queue=work;return work;
}
export function playbackRange(raw:string|null,size:number):{start:number;end:number;partial:boolean}|null{
  if(!raw)return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/.exec(raw);if(!m||(!m[1]&&!m[2]))return null;
  const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const end=m[1]?(m[2]?Math.min(size-1,Number(m[2])):size-1):size-1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?{start,end,partial:true}:null;
}
export async function servePreviewPlayback(id:number,range:string|null,head=false){
  const {file}=await target(id),info=await existing(file);if(!info)return Response.json({error:"PREPARE_COMPATIBLE_PLAYBACK_FIRST"},{status:409});
  const part=playbackRange(range,info.size);if(!part)return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+info.size}});
  const headers=new Headers({"Content-Type":"video/mp4","Accept-Ranges":"bytes","Content-Length":String(part.end-part.start+1),"Cache-Control":"private, no-store"});
  if(part.partial)headers.set("Content-Range",`bytes ${part.start}-${part.end}/${info.size}`);
  const stream=head?null:Readable.toWeb(createReadStream(file,{start:part.start,end:part.end})) as ReadableStream;
  return new Response(stream,{status:part.partial?206:200,headers});
}
