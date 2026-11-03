// Exercise real MP4 metadata, bounded range reads, and upstream failures offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const m = { exports: {} };
new Function('module','exports', ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/video-duration.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(m,m.exports);
const { parseMovieDuration, readVideoDuration, isAllowedVideoUrl } = m.exports;
function box(type, contents) {
  const b = Buffer.alloc(contents.length + 8); b.writeUInt32BE(b.length); b.write(type,4); contents.copy(b,8); return b;
}
function movie(seconds, version=0) {
  const b = Buffer.alloc(version ? 108 : 96); b[0] = version;
  const at = version ? 20 : 12; b.writeUInt32BE(1000, at);
  if (version) b.writeBigUInt64BE(BigInt(seconds * 1000),at+4); else b.writeUInt32BE(seconds * 1000,at+4);
  return box('moov',box('mvhd',b));
}
function ranged(data) {
  const calls = [];
  const fetch = async (url,opts) => {
    assert.equal(new URL(url).hostname,'video.twimg.com');
    assert.equal(opts.redirect,'error');
    const [,a,b] = opts.headers.Range.match(/bytes=(\d+)-(\d+)/);
    const start=Number(a), end=Math.min(Number(b),data.length-1);
    const bytes=data.subarray(start,end+1); calls.push({start,end,length:bytes.length});
    return new Response(bytes,{status:206,headers:{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':String(bytes.length)}});
  };
  return { fetch, calls };
}
(async()=>{
  for (const version of [0,1]) assert.equal(parseMovieDuration(movie(83,version)),83);
  const file=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('mdat',Buffer.alloc(3*1024*1024)),movie(83)]);
  const remote=ranged(file);
  assert.equal(await readVideoDuration('https://video.twimg.com/test.mp4',remote.fetch),83);
  assert.ok(remote.calls.some(c=>c.start>3*1024*1024),'tail movie metadata located by box offsets');
  assert.ok(remote.calls.reduce((n,c)=>n+c.length,0)<256*1024,'full video never downloaded');
  assert.equal(parseMovieDuration(Buffer.from('not mp4')),null);
  const unknown=movie(0); assert.equal(parseMovieDuration(unknown),null);
  assert.equal(isAllowedVideoUrl('https://video.twimg.com@127.0.0.1/video'),false);
  assert.equal(isAllowedVideoUrl('https://secret@video.twimg.com/video'),false);
  let fetched=false;
  assert.equal(await readVideoDuration('http://127.0.0.1/video',()=>{fetched=true;}),null);
  assert.equal(fetched,false);
  let canceled=false;
  const oversized=()=>new Response(new ReadableStream({cancel(){canceled=true;}}),
    {status:200,headers:{'content-length':String(5*1024*1024)}});
  assert.equal(await readVideoDuration('https://video.twimg.com/no-range.mp4',oversized),null);
  assert.equal(canceled,true,'upstream ignoring Range is canceled without body download');
  assert.equal(await readVideoDuration('https://video.twimg.com/broken.mp4',async()=>{throw new Error('offline');}),null);
  console.log('PASS: MP4 v0/v1, tail metadata, byte limits, invalid URLs and unavailable metadata');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-mp4-'));
  let realFixtures = 0;
  try {
    for (const mode of ['tail','faststart']) {
      const p=path.join(dir,mode+'.mp4');
      const args=['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=32x32:r=10','-t','3','-c:v','libx264','-pix_fmt','yuv420p'];
      if(mode==='faststart')args.push('-movflags','+faststart');
      const result=cp.spawnSync('ffmpeg',[...args,p]);
      if(result.error?.code==='ENOENT'){console.log('SKIP: ffmpeg fixture; synthetic format tests passed');break;}
      assert.equal(result.status,0,result.stderr?.toString());
      const mock=ranged(fs.readFileSync(p));
      assert.equal(await readVideoDuration('https://video.twimg.com/'+mode+'.mp4',mock.fetch),3);
      realFixtures++;
    }
    if (realFixtures === 2) console.log('PASS: actual FFmpeg MP4 movie-at-start and movie-at-end fixtures');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
