import { spawn } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PERSONAL_FRAME_POSITIONS, combinePersonalFrames } from "./tier-personal-core";
import { extractPersonalFrame } from "./tier-personal-image";

function isAllowedVideoUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "video.twimg.com" || url.hostname.endsWith(".video.twimg.com"));
  } catch { return false; }
}

function binary(name:"ffmpeg"|"ffprobe") {
  const configured=process.env.XCLIP_FFMPEG_PATH;
  if(!configured)return name;
  if(name==="ffmpeg")return configured;
  return process.env.XCLIP_FFPROBE_PATH??path.join(path.dirname(configured),process.platform==="win32"?"ffprobe.exe":"ffprobe");
}
export function runVideoTool(name:"ffmpeg"|"ffprobe",args:string[],timeout=30000,maxBytes=1024*1024):Promise<Buffer> {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary(name),args,{shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let finished=false,size=0;const chunks:Buffer[]=[];
    const end=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(Buffer.concat(chunks));};
    const timer=setTimeout(()=>end(Error("VIDEO_DECODE_TIMEOUT")),timeout);
    child.on("error",e=>end((e as NodeJS.ErrnoException).code==="ENOENT"?Error("FFmpegとFFprobeが見つかりません。インストール後、PowerShellを開き直して開発サーバーを起動してください。"):e));
    child.stdout.on("data",(b:Buffer)=>{size+=b.length;if(size>maxBytes)end(Error("VIDEO_TOOL_OUTPUT_TOO_LARGE"));else chunks.push(b);});
    // Drain stderr without retaining URLs or full diagnostic output.
    child.stderr.on("data",()=>{});
    child.on("close",code=>end(code===0?undefined:Error("VIDEO_DECODE_FAILED")));
  });
}
export async function ensureVideoTools(){await runVideoTool("ffmpeg",["-version"],5000);await runVideoTool("ffprobe",["-version"],5000);}
export async function extractLocalVideoFrames(filename:string) {
  const metadata=JSON.parse((await runVideoTool("ffprobe",["-v","error","-protocol_whitelist","file,pipe","-show_entries","format=duration","-of","json",filename],10000)).toString());
  const duration=Number(metadata.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>3600)throw Error("INVALID_VIDEO_DURATION");
  const frames:Buffer[]=[];
  for(const position of PERSONAL_FRAME_POSITIONS){
    frames.push(await runVideoTool("ffmpeg",["-nostdin","-v","error","-protocol_whitelist","file,pipe","-ss",String(duration*position),"-i",filename,"-frames:v","1","-vf","scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2","-f","image2pipe","-c:v","mjpeg","pipe:1"]));
    if(!frames.at(-1)?.length)throw Error("VIDEO_FRAME_MISSING");
  }
  return {duration,times:PERSONAL_FRAME_POSITIONS.map(p=>p*duration),frames};
}
export async function extractPersonalVideo(url:string,options?:{maxBytes?:number}) {
  if(!isAllowedVideoUrl(url))throw Error("UNSUPPORTED_VIDEO_URL");
  await ensureVideoTools();
  const directory=await mkdtemp(path.join(tmpdir(),"xclip-tier-frames-"));
  const filename=path.join(directory,"input.mp4");
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:"error",cache:"no-store"});
    if(!response.ok){await response.body?.cancel();throw Error("VIDEO_HTTP_"+response.status);}
    if(!response.body)throw Error("VIDEO_UNAVAILABLE");
    const requested=options?.maxBytes??96*1024*1024;
    const max=Number.isFinite(requested)?Math.max(96*1024*1024,Math.min(256*1024*1024,requested)):96*1024*1024;
    if(Number(response.headers.get("content-length")??0)>max) {await response.body.cancel();throw Error("VIDEO_TOO_LARGE");}
    const reader=response.body.getReader(),file=await open(filename,"wx",0o600);let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error("VIDEO_TOO_LARGE");
      let offset=0;while(offset<value.length){const written=await file.write(value,offset,value.length-offset);if(!written.bytesWritten)throw Error("VIDEO_WRITE_FAILED");offset+=written.bytesWritten;}}}
    finally{await file.close();await reader.cancel();}
    const extracted=await extractLocalVideoFrames(filename);
    const vectors:number[][]=[];
    for(const frame of extracted.frames)vectors.push(await extractPersonalFrame(frame));
    return combinePersonalFrames(vectors);
  } finally {await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
