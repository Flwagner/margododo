const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

function harness(mode='remote'){
  let now=1000000, nextId=0;
  const timers=new Map(), sources=[], publications=[], commands=[];
  class Events {
    constructor(){ this.listeners=new Map(); }
    addEventListener(type,callback){
      if(!this.listeners.has(type)) this.listeners.set(type,new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type,callback){ this.listeners.get(type)?.delete(callback); }
    emit(type){ for(const callback of this.listeners.get(type) || []) callback(); }
  }
  class Source extends Events {
    constructor(url){ super(); this.url=url; sources.push(this); }
    close(){ this.closed=true; }
    open(){ this.onopen(); }
    message(payload){ this.onmessage({data:JSON.stringify({event:'message',message:JSON.stringify(payload)})}); }
  }
  const window=new Events(), document=new Events();
  window.EventSource=Source;
  document.visibilityState='visible';
  const schedule=(callback,delay,interval=false)=>{
    const id=++nextId;
    timers.set(id,{callback,at:now+delay,interval:interval ? delay : 0});
    return id;
  };
  const context={window,document,EventSource:Source,AbortController,
    crypto:{randomUUID:()=>String(++nextId)},Date:{now:()=>now},
    setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),
    fetch:async(url,options)=>{ publications.push({url,...JSON.parse(options.body)}); return {ok:true}; }
  };
  vm.runInNewContext(readFileSync(require.resolve('../remote.js'),'utf8'),context);
  const state={playing:false,autoEnabled:false,infinite:false,durationMs:60000,endTime:0};
  const bridge=new window.MargododoRemote({getState:()=>state,onChange:()=>{},
    onCommand:async(...args)=>commands.push(args)});
  bridge.start(mode);
  function tick(ms){
    const end=now+ms;
    while(true){
      const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next) break;
      const [id,timer]=next;
      now=timer.at;
      if(timer.interval) timer.at+=timer.interval;
      else timers.delete(id);
      timer.callback();
    }
    now=end;
  }
  function reply(source=sources.at(-1),sender='local'){
    source.message({version:1,id:String(++nextId),sender,sentAt:now,kind:'state',
      state,sequence:1,replyTo:bridge.pending?.id,recipient:bridge.session});
  }
  return {bridge,sources,publications,commands,window,document,timers,state,tick,reply,
    now:()=>now,flush:async()=>{ for(let i=0;i<10;i++) await Promise.resolve(); }};
}

test('silent streams are replaced on both phones',()=>{
  for(const mode of ['local','remote']){
    const h=harness(mode), first=h.sources[0];
    first.open();
    if(mode==='remote') h.reply();
    h.tick(91000);
    assert.equal(first.closed,true);
    assert.equal(h.sources.length,2);
    assert.equal(h.bridge.connected,false);
    h.sources[1].open();
    assert.equal(h.bridge.connected,true);
    if(mode==='remote'){
      h.reply(h.sources[1],'reloaded-local');
      assert.equal(h.bridge.peer,'reloaded-local');
      assert.equal(h.bridge.isFresh(),true);
    }
  }
});

test('named ntfy keepalives keep an idle connection alive',()=>{
  const h=harness('local');
  h.sources[0].open();
  for(let i=0;i<20;i++){
    h.tick(45000);
    h.sources[0].emit('keepalive');
  }
  assert.equal(h.sources.length,1);
});

test('foreground, network recovery and pageshow reopen streams in both modes',()=>{
  for(const mode of ['local','remote']){
    const h=harness(mode);
    h.sources[0].open();
    h.document.visibilityState='hidden';
    h.document.emit('visibilitychange');
    assert.equal(h.sources.length,1);
    h.document.visibilityState='visible';
    h.document.emit('visibilitychange');
    h.window.emit('online');
    h.window.emit('pageshow');
    assert.equal(h.sources.length,4);
    assert.ok(h.sources.slice(0,-1).every(s=>s.closed));
  }
});

test('closed streams retry with capped backoff and ignore obsolete callbacks',()=>{
  const h=harness('local');
  const old=h.sources[0];
  for(const delay of [2000,4000,8000,16000,30000,30000]){
    h.sources.at(-1).onerror();
    const count=h.sources.length;
    h.tick(delay-1);
    assert.equal(h.sources.length,count);
    h.tick(1);
    assert.equal(h.sources.length,count+1);
  }
  h.sources.at(-1).open();
  old.onerror();
  old.open();
  h.tick(30000);
  assert.equal(h.bridge.connected,true);
  assert.equal(h.sources.length,7);
});

test('interrupted control commands are never replayed',()=>{
  const h=harness();
  h.sources[0].open();
  h.reply();
  h.bridge.request('play');
  assert.equal(h.bridge.pending.action,'play');
  h.sources[0].onerror();
  assert.equal(h.bridge.pending,null);
  assert.match(h.bridge.error,/non confirmée/);
  h.tick(2000);
  h.sources[1].open();
  assert.equal(h.bridge.pending.action,'state');
  assert.deepEqual(h.publications.map(p=>p.action),['state','play','state']);
});

test('unanswered requests trigger state recovery, not a replay of the action',()=>{
  const h=harness();
  h.sources[0].open();
  h.reply();
  h.bridge.request('stop');
  h.tick(10000);
  assert.equal(h.bridge.pending,null);
  assert.equal(h.bridge.isFresh(),false);
  h.tick(30000);
  h.sources[1].open();
  assert.deepEqual(h.publications.map(p=>p.action),['state','stop','state']);
});

test('closing removes lifecycle listeners and all recovery timers',()=>{
  const h=harness();
  h.sources[0].open();
  h.tick(10000);
  h.sources[0].onerror();
  h.bridge.close();
  h.window.emit('online');
  h.window.emit('pageshow');
  h.document.emit('visibilitychange');
  h.tick(600000);
  assert.equal(h.sources.length,1);
  assert.equal(h.timers.size,0);
});

test('local commands remain deduplicated across transport reconnections',async()=>{
  const h=harness('local');
  h.sources[0].open();
  const command={version:1,id:'command',sender:'remote',sentAt:h.now(),
    kind:'command',action:'play',target:h.bridge.session};
  h.sources[0].message(command);
  await h.flush();
  h.window.emit('online');
  h.sources[1].open();
  h.sources[1].message(command);
  await h.flush();
  assert.equal(h.commands.length,1);
});
