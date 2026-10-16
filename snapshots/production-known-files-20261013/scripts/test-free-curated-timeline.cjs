const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),m={exports:{}};
const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/fxtwitter-curated.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
new Function('require','module','exports',code)(require,m,m.exports);
const {parseFreeMediaPage,fetchFreeMediaPage}=m.exports,author={id:'12345',username:'fixture',name:'Fixture',expectedTier:'S'};
const post=id=>({type:'status',provider:'twitter',id,author:{id:author.id,protected:false},text:'mock',created_timestamp:Math.floor(Date.now()/1000)-60,possibly_sensitive:false,
 media:{videos:[{type:'video',format:'video/mp4',url:'https://video.twimg.com/mock.mp4'}]}});
const parse=results=>parseFreeMediaPage({code:200,results},author,true);
(async()=>{
 const own=post('30001'),rp={...post('40001'),author:{id:'99999',protected:false},reposted_by:{id:author.id}};
 let p=parse([own,own,rp]);assert.equal(p.timeline.trusted,true);assert.deepEqual(p.timeline.ids,['30001']);assert.equal(p.posts.length,1);assert.equal(p.timeline.counts.duplicates,1);assert.equal(p.timeline.counts.reposts,1);
 p=parse([rp]);assert.equal(p.timeline.trusted,true);assert.deepEqual(p.timeline.ids,[]);assert.equal(p.posts.length,0);
 for(const [bad,count]of [[{...own,type:undefined},'type'],[{...own,provider:undefined},'provider'],[{...own,id:30001},'id'],[{...own,author:undefined},'author'],[{...own,author:{id:'99999'}},'foreign'],[{...rp,reposted_by:{id:'99999'}},'repostIdentity'],[{...own,text:'conflicting'},'conflict']]){
  p=parse([own,bad]);assert.equal(p.timeline.trusted,false,count);assert.equal(p.timeline.counts[count],1,count);
 }
 const reply={...own,replying_to:{screen_name:'someone',status:'20001'}};
 assert.equal(parseFreeMediaPage({code:200,results:[reply]},author).posts.length,0);assert.equal(parse([reply]).posts.length,1);
 const calls=[];const fetcher=async url=>{calls.push(new URL(url));return Response.json({code:200,results:[own],cursor:{bottom:null}})};
 await fetchFreeMediaPage(author,100,null,fetcher,undefined,100,true);assert.equal(calls.at(-1).searchParams.get('with_replies'),'1');
 await fetchFreeMediaPage(author,100,null,fetcher);assert.equal(calls.at(-1).searchParams.has('with_replies'),false);
 await fetchFreeMediaPage(author,100,'OLD_MEDIA_CURSOR',fetcher,undefined,100,true);assert(calls.at(-1).pathname.endsWith('/media'));assert.equal(calls.at(-1).searchParams.has('with_replies'),false);
 const continuation=async url=>{calls.push(new URL(url));return Response.json({code:200,results:[own],cursor:{bottom:'NEXT'}})};
 let next=await fetchFreeMediaPage(author,100,null,continuation,undefined,100,true);assert.equal(next.nextCursor,'xclip-statuses-replies-v1:NEXT');
 next=await fetchFreeMediaPage(author,100,next.nextCursor,continuation,undefined,100,true);assert.equal(calls.at(-1).searchParams.get('cursor'),'NEXT');assert.equal(calls.at(-1).searchParams.get('with_replies'),'1');
 next=await fetchFreeMediaPage(author,100,'xclip-statuses-v1:OLD_NEXT',continuation,undefined,100,true);assert.equal(calls.at(-1).searchParams.get('cursor'),'OLD_NEXT');assert.equal(calls.at(-1).searchParams.has('with_replies'),false);assert.equal(next.nextCursor,'xclip-statuses-v1:NEXT');
 // Same-page explicit conversation chain: foreign parents/children never become own video candidates or boundaries.
 const parent={...post('41001'),author:{id:'99991',protected:false}},child={...post('41002'),author:{id:'99992',protected:false},replying_to:{status:own.id}};
 const ownReply={...own,replying_to:{status:parent.id}};p=parse([parent,ownReply,child]);
 assert.equal(p.timeline.trusted,true);assert.equal(p.timeline.counts.context,2);assert.deepEqual(p.timeline.ids,[own.id]);assert.equal(p.posts.length,1);assert.equal(p.posts[0].author_id,author.id);
 assert.equal(parseFreeMediaPage({code:200,results:[parent,ownReply,child]},author).timeline.trusted,false); // bulk default not broadened
 const grandparent={...parent,id:'41003'},parentLink={...parent,replying_to:{status:grandparent.id}};
 p=parse([grandparent,parentLink,ownReply,child]);assert.equal(p.timeline.counts.context,3);assert.equal(p.timeline.trusted,true);
 p=parse([parent,child]);assert.equal(p.timeline.trusted,false);assert.equal(p.timeline.counts.context,0); // no own anchor
 p=parse([ownReply,{...parent,replying_to:{status:'77777'}},{...child,replying_to:{status:'88888'}}]);assert.equal(p.timeline.trusted,false);assert.equal(p.timeline.counts.foreign,1);
 p=parse([ownReply,parent,{...parent,text:'conflict'}]);assert.equal(p.timeline.trusted,false); // conflicting ID cannot prove context
 // Exact production count shape, with verified reply links supplied synthetically.
 const originals=Array.from({length:5},(_,i)=>post(String(42000+i))),context=Array.from({length:4},(_,i)=>({...parent,id:String(43000+i),replying_to:i?{status:String(42999+i)}:null}));
 originals[0].replying_to={status:'43003'};
 const reposts=Array.from({length:16},(_,i)=>({...parent,id:String(44000+i),reposted_by:{id:author.id}}));
 p=parse([...originals,...context,...reposts]);assert.equal(p.rawCount,25);assert.equal(p.timeline.counts.own,5);assert.equal(p.timeline.counts.reposts,16);assert.equal(p.timeline.counts.context,4);assert.equal(p.timeline.counts.foreign,0);assert.equal(p.posts.length,5);
 console.log('PASS TIMELINE: attributed reposts and identical pinned duplicates; foreign/malformed/conflicting rows refused; fixed request host; own reply opt-in; legacy bulk/media behavior retained. All HTTP mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
