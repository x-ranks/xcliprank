import { extractRangeVideoFrames } from "./video-range-frames";
import { runVideoTool } from "./video-tools";
export { runVideoTool, ensureVideoTools } from "./video-tools";
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
  const extracted=await extractRangeVideoFrames(url,{maxBytes:Math.min(options?.maxBytes??32*1024*1024,32*1024*1024)});
  const vectors:number[][]=[];
  for(const frame of extracted.frames)vectors.push(await extractPersonalFrame(frame));
  return combinePersonalFrames(vectors);
}
