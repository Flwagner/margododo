const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

const html=readFileSync(require.resolve('../index.html'),'utf8');
const source=html.slice(html.indexOf('  function initNightMode(){'),html.indexOf('  registerSW();',html.indexOf('  function initNightMode(){')));

function harness(mode='local'){
  let now=0;
  let nextId=0;
  const timers=new Map();
  const listeners={};
  const screenListeners={};
  const classes=new Set();
  const previousFocus={isConnected:true,focus(){ document.activeElement=this; }};
  const screen={hidden:true,addEventListener(type,callback){ screenListeners[type]=callback; },
    focus(){ document.activeElement=this; }};
  const main={inert:false};
  const theme={content:'#0a0e1a'};
  const banner={inert:false};
  const document={
    visibilityState:'visible',activeElement:previousFocus,
    getElementById:()=>screen,
    querySelector:selector=>selector==='main' ? main : theme,
    documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},
    addEventListener(type,callback){ listeners[type]=callback; }
  };
  const context={
    mode,document,updateBanner:banner,
    setTimeout(callback,delay){ const id=++nextId; timers.set(id,{at:now+delay,callback}); return id; },
    clearTimeout(id){ timers.delete(id); }
  };
  vm.createContext(context);
  vm.runInContext(source+'\nconst resetNightMode=initNightMode();',context);
  function advance(ms){
    now+=ms;
    for(const [id,timer] of timers){
      if(timer.at<=now){ timers.delete(id); timer.callback(); }
    }
  }
  function wake(){
    let prevented=false;
    let stopped=false;
    screenListeners.click({preventDefault(){ prevented=true; },stopPropagation(){ stopped=true; }});
    assert.equal(prevented,true);
    assert.equal(stopped,true);
  }
  return {context,document,screen,main,theme,banner,classes,previousFocus,timers,advance,wake,
    activity:type=>listeners[type](),
    reset:()=>vm.runInContext('resetNightMode()',context)};
}

test('Local turns fully black after 30 seconds without changing audio or visibility',()=>{
  const h=harness();
  h.advance(29999);
  assert.equal(h.screen.hidden,true);
  h.advance(1);
  assert.equal(h.screen.hidden,false);
  assert.equal(h.main.inert,true);
  assert.equal(h.banner.inert,true);
  assert.equal(h.theme.content,'#000000');
  assert.equal(h.classes.has('night-mode'),true);
  assert.equal(h.document.activeElement,h.screen);
  assert.equal(h.document.visibilityState,'visible');
});

test('local interactions restart the inactivity delay',()=>{
  for(const type of ['pointerdown','pointermove','keydown','input','scroll']){
    const h=harness();
    h.advance(20000);
    h.activity(type);
    h.advance(29999);
    assert.equal(h.screen.hidden,true,type);
    h.advance(1);
    assert.equal(h.screen.hidden,false,type);
  }
});

test('waking tap is consumed and restores controls, focus, theme and timeout',()=>{
  const h=harness();
  h.advance(30000);
  h.activity('pointerdown');
  assert.equal(h.screen.hidden,false,'keep the overlay until click to avoid click-through');
  assert.equal(h.timers.size,0);
  h.wake();
  assert.equal(h.screen.hidden,true);
  assert.equal(h.main.inert,false);
  assert.equal(h.banner.inert,false);
  assert.equal(h.document.activeElement,h.previousFocus);
  assert.equal(h.theme.content,'#0a0e1a');
  assert.equal(h.classes.has('night-mode'),false);
  h.advance(30000);
  assert.equal(h.screen.hidden,false);
});

test('Remote is never masked; switching modes clears or restarts the timer',()=>{
  const h=harness('remote');
  h.advance(60000);
  assert.equal(h.screen.hidden,true);
  assert.equal(h.timers.size,0);
  h.context.mode='local';
  h.reset();
  h.advance(30000);
  assert.equal(h.screen.hidden,false);
  h.context.mode='remote';
  h.reset();
  assert.equal(h.screen.hidden,true);
  assert.equal(h.main.inert,false);
  h.activity('pointerdown');
  h.advance(60000);
  assert.equal(h.screen.hidden,true);
  assert.equal(h.timers.size,0);
});

test('hidden pages do not start night mode; returning starts a fresh delay',()=>{
  const h=harness();
  h.advance(10000);
  h.document.visibilityState='hidden';
  h.activity('visibilitychange');
  assert.equal(h.timers.size,0);
  h.advance(60000);
  assert.equal(h.screen.hidden,true);
  h.document.visibilityState='visible';
  h.activity('visibilitychange');
  h.advance(29999);
  assert.equal(h.screen.hidden,true);
  h.advance(1);
  assert.equal(h.screen.hidden,false);
});

test('remote updates and background activity do not reveal the night screen',()=>{
  const h=harness();
  h.advance(30000);
  h.reset();
  h.document.visibilityState='hidden';
  h.activity('visibilitychange');
  h.document.visibilityState='visible';
  h.activity('visibilitychange');
  assert.equal(h.screen.hidden,false);
  assert.equal(h.timers.size,0);
});
