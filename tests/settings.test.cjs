const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');

// Exercise the real local command handler, including the new remote settings.
const html=readFileSync(require.resolve('../index.html'),'utf8');
const functions=html.slice(
  html.indexOf('  async function executeLocalCommand('),
  html.indexOf('  function dispatchCommand(')
);

function element(value){
  return {value:String(value),textContent:'',disabled:false,
    setAttribute(){},classList:{toggle(){}}};
}

function harness(overrides={}){
  const calls={saved:0,resets:0,meter:0,ui:0,gain:[]};
  const context={
    mode:'local',isStarting:false,monitoringStarting:false,
    infiniteMode:false,durationMs:30*60000,volume:0.6,sensitivity:50,
    autoEnabled:false,microphoneAuthorized:true,
    ctx:{currentTime:1,state:'running'},
    masterVolume:{gain:{setValueAtTime:(value)=>{ calls.gain.push(value); }}},
    durationSlider:element(30),volumeSlider:element(60),sensitivitySlider:element(50),
    volumeValue:element('60 %'),sensitivityValue:element('50 %'),
    saveSettings:()=>calls.saved++,resetDetectionWindow:()=>calls.resets++,
    updateSoundMeter:()=>calls.meter++,updatePresetActive:()=>{},
    updateDurationLabel:()=>{},updateUI:()=>calls.ui++,
    disableAutoMonitoring:()=>{},enableAutoMonitoring:async()=>{},
    startAudio:async()=>true,stopAudio:()=>{},reschedule:()=>{},
    document:{visibilityState:'visible'},
    navigator:{permissions:{query:async()=>({state:'granted'})}},
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(functions,context);
  return {context,calls};
}

test('a remote volume command applies the percentage to the running audio',async()=>{
  const h=harness();
  await h.context.executeLocalCommand('volume',35,true);
  assert.equal(h.context.volume,0.35);
  assert.equal(h.context.volumeSlider.value,'35');
  assert.equal(h.context.volumeValue.textContent,'35 %');
  assert.deepEqual(h.calls.gain,[0.35]);
  assert.equal(h.calls.saved,1);
  assert.equal(h.calls.ui,1);
});

test('a remote sensitivity command resets the detection window and republishes',async()=>{
  const h=harness();
  await h.context.executeLocalCommand('sensitivity',20,true);
  assert.equal(h.context.sensitivity,20);
  assert.equal(h.context.sensitivitySlider.value,'20');
  assert.equal(h.context.sensitivityValue.textContent,'20 %');
  assert.equal(h.calls.resets,1);
  assert.equal(h.calls.meter,1);
  assert.equal(h.calls.saved,1);
  assert.equal(h.calls.ui,1);
});

test('settings commands are validated before touching the local state',async()=>{
  for(const value of [101,-1,50.5,'50',null]){
    for(const action of ['volume','sensitivity']){
      const h=harness();
      await assert.rejects(h.context.executeLocalCommand(action,value,true),
        new RegExp(action==='volume' ? 'Volume invalide' : 'Sensibilité invalide'),
        action+' '+JSON.stringify(value));
      assert.equal(h.context.volume,0.6,action+' volume unchanged');
      assert.equal(h.context.sensitivity,50,action+' sensitivity unchanged');
      assert.equal(h.calls.saved,0);
      assert.equal(h.calls.ui,0);
    }
  }
});

test('settings commands also work from the local phone',async()=>{
  const h=harness({volume:0.2,sensitivity:80});
  await h.context.executeLocalCommand('volume',90,false);
  await h.context.executeLocalCommand('sensitivity',10,false);
  assert.equal(h.context.volume,0.9);
  assert.equal(h.context.sensitivity,10);
  assert.deepEqual(h.calls.gain,[0.9]);
});

test('unknown commands still report an error',async()=>{
  const h=harness();
  await assert.rejects(h.context.executeLocalCommand('unknown',null,true),/Commande inconnue/);
});
