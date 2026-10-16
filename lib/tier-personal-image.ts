import sharp from "sharp";
import { PERSONAL_FEATURE_SPEC, projectEmbedding } from "./tier-personal-core";
let network: Promise<import("nsfwjs").NSFWJS> | null = null;
let queue: Promise<unknown> = Promise.resolve();
export { PERSONAL_FEATURE_SPEC };
export async function extractPersonalImage(url: string): Promise<number[]> {
  const source=new URL(url);
  if(source.protocol!=="https:"||source.hostname!=="pbs.twimg.com"||source.username||source.password||source.port)throw Error("UNSUPPORTED_IMAGE_URL");
  const response=await fetch(source,{signal:AbortSignal.timeout(6000),redirect:"error",cache:"no-store"});
  if(!response.ok||!response.headers.get("content-type")?.startsWith("image/"))throw Error("IMAGE_UNAVAILABLE");
  const reader=response.body?.getReader();if(!reader)throw Error("EMPTY_IMAGE");
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3*1024*1024)throw Error("IMAGE_TOO_LARGE");chunks.push(value);} }
  finally {await reader.cancel();}
  return extractPersonalFrame(Buffer.concat(chunks));
}
export async function extractPersonalFrame(bytes:Buffer):Promise<number[]> {
  const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).rotate().resize(224,224,{fit:"contain",background:{r:0,g:0,b:0}}).removeAlpha().toColourspace("srgb").raw().toBuffer({resolveWithObject:true});
  if(info.channels!==3)throw Error("IMAGE_CHANNELS");
  // Serialize CPU inference and retain one frozen network; it never learns or calls X API.
  const operation=queue.then(async()=>{
    const tf=await import("@tensorflow/tfjs");
    if(!network)network=(async()=>{await tf.setBackend("cpu");await tf.ready();return (await import("nsfwjs")).load("MobileNetV2");})();
    let model:import("nsfwjs").NSFWJS;
    try {model=await network;}catch(e){network=null;throw e;}
    const input=tf.tensor3d(new Uint8Array(data),[224,224,3],"int32");
    let output:import("@tensorflow/tfjs").Tensor|null=null;
    try {output=model.infer(input,"flatten_1");return projectEmbedding(Array.from(await output.data()));}
    finally {output?.dispose();input.dispose();}
  });
  queue=operation.catch(()=>undefined);
  return operation;
}
