const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

// Exercise the actual inline preparation functions without audio or microphone hardware.
const html=readFileSync(require.resolve('../index.html'),'utf8');
const functions=html.slice(html.indexOf('  async function resumeLocalAudio(){'),html.indexOf('  function buildGraph(){'));

function harness({permission='granted',audioAllowed=true,captureAllowed=true,mode='local',permissionsSupported=true}={}){
  const calls={capture:0,stopped:0,resume:0,wake:0};
  let allowed=audioAllowed;
  const audio={state:'suspended',resume:async()=>{
    calls.resume++;
    if(allowed) audio.state='running';
    else return new Promise(()=>{});
  }};
  const context={mode,ctx:null,microphoneAuthorized:false,preparingLocal:false,
    preparationMessage:'',micStream:null,monitoringStarting:false,
    navigator:{
      permissions:permissionsSupported ? {query:async()=>({state:permission})} : undefined,
      mediaDevices:{getUserMedia:async()=>{
        calls.capture++;
        if(!captureAllowed) throw new Error('NotAllowedError');
        allowed=true;
        return {getTracks:()=>[{stop:()=>calls.stopped++}]};
      }}
    },
    ensureAudioContext:()=>{ context.ctx=audio; return true; },
    requestWakeLock:()=>calls.wake++,updateUI:()=>{},renderConnection:()=>{},
    setTimeout:fn=>{ queueMicrotask(fn); return 1; },clearTimeout:()=>{}
  };
  vm.createContext(context);
  vm.runInContext(functions,context);
  return {context,calls,audio};
}

test('previously granted permissions prepare audio silently without starting listening',async()=>{
  const h=harness();
  await h.context.prepareLocal(false);
  assert.equal(h.audio.state,'running');
  assert.equal(h.context.microphoneAuthorized,true);
  assert.equal(h.calls.capture,0);
  assert.equal(h.context.micStream,null);
  assert.equal(h.context.preparationMessage,'');
});

test('granted microphone access can unlock audio automatically and is immediately released',async()=>{
  const h=harness({audioAllowed:false});
  await h.context.prepareLocal(false);
  assert.equal(h.audio.state,'running');
  assert.equal(h.calls.capture,1);
  assert.equal(h.calls.stopped,1);
  assert.equal(h.context.micStream,null);
});

test('startup never prompts for new microphone access',async()=>{
  for(const permission of ['prompt','denied']){
    const h=harness({permission,audioAllowed:false});
    await h.context.prepareLocal(false);
    assert.equal(h.calls.capture,0);
    assert.equal(h.context.microphoneAuthorized,false);
    assert.match(h.context.preparationMessage,/Touchez/);
  }
});

test('one preparation gesture grants microphone access without enabling surveillance',async()=>{
  const h=harness({permission:'prompt',audioAllowed:false});
  await h.context.prepareLocal(true);
  assert.equal(h.context.microphoneAuthorized,true);
  assert.equal(h.calls.capture,1);
  assert.equal(h.calls.stopped,1);
  assert.equal(h.context.micStream,null);
  assert.equal(h.audio.state,'running');
});

test('permission denial leaves a recoverable status rather than an unhandled rejection',async()=>{
  const h=harness({permission:'prompt',captureAllowed:false});
  await h.context.prepareLocal(true);
  assert.equal(h.context.microphoneAuthorized,false);
  assert.equal(h.context.preparingLocal,false);
  assert.match(h.context.preparationMessage,/Préparation incomplète/);
});

test('Remote mode never initializes audio or requests the microphone',async()=>{
  const h=harness({mode:'remote'});
  await h.context.prepareLocal(true);
  assert.equal(h.context.ctx,null);
  assert.equal(h.calls.capture,0);
  assert.equal(h.calls.resume,0);
});

test('switching to Remote during a permission request releases the temporary stream',async()=>{
  const h=harness({permission:'prompt'});
  h.context.navigator.mediaDevices.getUserMedia=async()=>{
    h.context.mode='remote';
    return {getTracks:()=>[{stop:()=>h.calls.stopped++}]};
  };
  await h.context.prepareLocal(true);
  assert.equal(h.calls.stopped,1);
  assert.equal(h.context.microphoneAuthorized,false);
});

test('unsupported Permissions API still supports explicit one-step preparation',async()=>{
  const h=harness({permissionsSupported:false});
  await h.context.prepareLocal(false);
  assert.equal(h.calls.capture,0);
  await h.context.prepareLocal(true);
  assert.equal(h.context.microphoneAuthorized,true);
  assert.equal(h.calls.stopped,1);
});

test('a remote surveillance command accepts previously granted permission without local listening first',async()=>{
  const h=harness();
  Object.assign(h.context,{isStarting:false,infiniteMode:false,autoEnabled:false,
    document:{visibilityState:'visible'},
    enableAutoMonitoring:async()=>{ h.context.autoEnabled=true; }});
  vm.runInContext(html.slice(html.indexOf('  async function executeLocalCommand('),
    html.indexOf('  function dispatchCommand(')),h.context);
  await h.context.executeLocalCommand('auto',true,true);
  assert.equal(h.context.autoEnabled,true);
  assert.equal(h.context.microphoneAuthorized,true);
});

test('remote surveillance never prompts for missing permission',async()=>{
  const h=harness({permission:'prompt'});
  Object.assign(h.context,{isStarting:false,infiniteMode:false,autoEnabled:false,
    document:{visibilityState:'visible'}});
  vm.runInContext(html.slice(html.indexOf('  async function executeLocalCommand('),
    html.indexOf('  function dispatchCommand(')),h.context);
  await assert.rejects(h.context.executeLocalCommand('auto',true,true),/Préparer ce téléphone/);
  assert.equal(h.calls.capture,0);
});
