import path from "node:path";
import { spawn } from "node:child_process";
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
