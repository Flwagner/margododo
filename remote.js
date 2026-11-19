"use strict";
(function(){
  const COMMAND_TOPIC='margododo-commands';
  const STATE_TOPIC='margododo-state';
  const MAX_AGE_MS=15000;
  const REQUEST_TIMEOUT_MS=10000;
  // The Local phone keeps the Remote fresh with one message every 15 minutes
  // instead of a request/reply round-trip every 5 minutes.
  const HEARTBEAT_MS=15*60*1000;
  // A stream reconnect does not republish an unchanged state within this delay.
  const LOCAL_REPUBLISH_MS=60*1000;
  // The Remote only asks for the state when the cached one is old enough.
  const PROBE_MIN_AGE_MS=2*60*1000;
  const PROBE_TIMEOUT_MS=10000;
  // Accept a new Local session shortly after a probe (reload, new phone).
  const PROBE_GRACE_MS=15000;
  const PROBE_BACKOFF_MS=[30000,60000,120000,300000];
  const MAX_PROBE_FAILURES=3;
  const CONNECT_DEBOUNCE_MS=1500;
  const FRESH_MS=20*60*1000;
  // ntfy sends a keepalive every 45 seconds, even when no state changes.
  const STREAM_TIMEOUT_MS=90000;
  const RECOVERY_MS=30000;
  const BUDGET_KEY='margododo.ntfyBudget';
  const BUDGET_LIMIT=250;
  const BUDGET_ECONOMY=200;
  const BUDGET_STRICT=240;
  const DAY_MS=24*60*60*1000;

  // A live-only subscription and non-cached publications prevent command replay.
  window.MargododoRemote=class {
    constructor(options){
      this.options=options;
      this.mode=null;
      this.source=null;
      this.connected=false;
      this.pending=null;
      this.state=null;
      this.lastSeen=0;
      this.error='';
      this.session=crypto.randomUUID();
      this.peer=null;
      this.sequence=0;
      this.peerSequence=-1;
      this.seen=new Set();
      this.queue=Promise.resolve();
      this.lastSnapshot='';
      this.publishTimer=null;
      this.generation=0;
      this.heartbeatAt=0;
      this.lastPublish=0;
      this.publishing=0;
      this.announced=false;
      this.probeInFlight=false;
      this.probeSentAt=0;
      this.probeFailures=0;
      this.nextProbeAt=0;
      this.probeTimer=null;
      this.connectTimer=null;
      this.streamLostAt=0;
      this.recoveryProbe=false;
      this.budget=this.loadBudget();
    }

    start(mode){
      this.close();
      this.mode=mode;
      this.resume=()=>{
        if(document.visibilityState!=='visible') return;
        this.maybeProbe();
        if(!this.connected || Date.now()-this.streamSeen>STREAM_TIMEOUT_MS){
          if(!this.streamLostAt) this.streamLostAt=this.streamSeen;
          this.scheduleConnect();
        }
      };
      document.addEventListener('visibilitychange',this.resume);
      window.addEventListener('online',this.resume);
      window.addEventListener('pageshow',this.resume);
      this.connect();
      this.uiTimer=setInterval(()=>{
        if(this.source && Date.now()-this.streamSeen>STREAM_TIMEOUT_MS){
          if(!this.streamLostAt) this.streamLostAt=this.streamSeen;
          this.connect();
        }
        if(mode==='local' && document.visibilityState==='visible' && this.connected &&
          !this.publishing && this.heartbeatAt && Date.now()>=this.heartbeatAt){
          this.publishState(null,'',{force:true,heartbeat:true});
        }
        this.options.onChange();
      },1000);
    }

    scheduleConnect(){
      if(this.connectTimer) return;
      this.connectTimer=setTimeout(()=>{
        this.connectTimer=null;
        // A pageshow/visibilitychange fired while the stream was still opening
        // must not reopen a connection that has become healthy in the meantime.
        if(this.connected && Date.now()-this.streamSeen<STREAM_TIMEOUT_MS) return;
        this.connect();
      },CONNECT_DEBOUNCE_MS);
    }

    connect(){
      clearTimeout(this.connectTimer);
      this.connectTimer=null;
      if(this.source) this.source.close();
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.recoveryTimer);
      this.connected=false;
      this.cancelProbe();
      this.interruptPending();
      const mode=this.mode;
      const generation=this.generation;
      if(!('EventSource' in window)){
        this.error='Télécommande non supportée par ce navigateur.';
        this.options.onChange();
        return;
      }
      const topic=mode==='local' ? COMMAND_TOPIC : STATE_TOPIC;
      const source=new EventSource('https://ntfy.sh/'+topic+'/sse');
      this.source=source;
      this.streamSeen=Date.now();
      const active=()=>generation===this.generation && source===this.source;
      source.addEventListener('keepalive',()=>{
        if(active()) this.streamSeen=Date.now();
      });
      source.onopen=()=>{
        if(!active()) return;
        this.streamSeen=Date.now();
        this.reconnectDelay=1000;
        this.connected=true;
        this.error='';
        // After a real outage, catch up on a change that was published while
        // the stream was down. Short blips do not spend a probe.
        const interrupted=this.streamLostAt>0 && Date.now()-this.streamLostAt>10000;
        this.streamLostAt=0;
        if(mode==='remote') this.maybeProbe(this.recoveryProbe || interrupted);
        else if(Date.now()-this.lastPublish>=LOCAL_REPUBLISH_MS) this.stateChanged(true);
        this.recoveryProbe=false;
        this.options.onChange();
      };
      source.onerror=()=>{
        if(!active()) return;
        this.connected=false;
        this.streamLostAt=this.streamLostAt || Date.now();
        this.interruptPending();
        this.cancelProbe();
        // Also recover from CLOSED streams (EventSource only retries CONNECTING).
        source.close();
        this.source=null;
        this.reconnectDelay=Math.min((this.reconnectDelay || 1000)*2,RECOVERY_MS);
        this.reconnectTimer=setTimeout(()=>this.connect(),this.reconnectDelay);
        this.options.onChange();
      };
      source.onmessage=(event)=>{
        if(!active()) return;
        this.streamSeen=Date.now();
        let message;
        try{
          const envelope=JSON.parse(event.data);
          if(envelope.event!=='message') return;
          message=JSON.parse(envelope.message);
        }catch(e){ return; }
        if(!message || message.version!==1 || typeof message.id!=='string' ||
          typeof message.sender!=='string' || !Number.isFinite(message.sentAt) ||
          Math.abs(Date.now()-message.sentAt)>MAX_AGE_MS) return;
        if(mode==='local' && message.kind==='command'){
          if(this.seen.has(message.id)) return;
          this.seen.add(message.id);
          if(this.seen.size>200) this.seen.delete(this.seen.values().next().value);
          this.queue=this.queue.then(async()=>{
            if(generation!==this.generation || Date.now()-message.sentAt>MAX_AGE_MS) return;
            if(message.target && message.target!==this.session) return;
            if(!message.target && message.action!=='state') return;
            let error='';
            try{ await this.options.onCommand(message.action,message.value); }
            catch(e){ error=e.message || 'Commande impossible.'; }
            if(generation===this.generation) await this.publishState(message,error);
          }).catch(()=>{});
        }else if(mode==='remote' && message.kind==='state'){
          this.receiveState(message);
        }
      };
      this.options.onChange();
    }

    cancelProbe(){
      clearTimeout(this.probeTimer);
      this.probeTimer=null;
      this.probeInFlight=false;
      this.probeSentAt=0;
    }

    interruptPending(){
      if(!this.pending) return;
      clearTimeout(this.pending.timer);
      this.pending=null;
      this.error='Connexion interrompue. Commande non confirmée.';
    }

    recoverState(){
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer=setTimeout(()=>{
        if(this.mode==='remote' && document.visibilityState==='visible' && !this.pending){
          this.recoveryProbe=true;
          this.connect();
        }
      },RECOVERY_MS);
    }

    close(){
      this.generation++;
      document.removeEventListener('visibilitychange',this.resume);
      window.removeEventListener('online',this.resume);
      window.removeEventListener('pageshow',this.resume);
      if(this.source) this.source.close();
      clearTimeout(this.reconnectTimer);
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.connectTimer);
      clearInterval(this.uiTimer);
      clearTimeout(this.publishTimer);
      this.cancelProbe();
      if(this.pending) clearTimeout(this.pending.timer);
      this.pending=null;
      this.source=null;
      this.connected=false;
      this.state=null;
      this.peer=null;
      this.lastSeen=0;
      this.peerSequence=-1;
      this.lastSnapshot='';
      this.error='';
      this.heartbeatAt=0;
      this.lastPublish=0;
      this.announced=false;
      this.recoveryProbe=false;
      this.streamLostAt=0;
      this.seen.clear();
      this.queue=Promise.resolve();
    }

    async publish(topic,payload){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
      try{
        const response=await fetch('https://ntfy.sh/'+topic+'?cache=no&firebase=no&priority=min',{
          method:'POST',
          body:JSON.stringify(Object.assign({version:1,id:crypto.randomUUID(),sender:this.session,sentAt:Date.now()},payload)),
          signal:controller.signal
        });
        if(!response.ok) throw new Error('ntfy HTTP '+response.status);
        this.trackBudget(response);
      }finally{ clearTimeout(timer); }
    }

    loadBudget(){
      try{
        const raw=localStorage.getItem(BUDGET_KEY);
        if(!raw) return null;
        const value=JSON.parse(raw);
        if(value && Number.isFinite(value.count) && Number.isFinite(value.since)) return value;
      }catch(e){}
      return null;
    }

    saveBudget(budget){
      try{ localStorage.setItem(BUDGET_KEY,JSON.stringify(budget)); }catch(e){}
    }

    trackBudget(response){
      let limit=BUDGET_LIMIT, remaining=null;
      try{
        const header=response.headers && response.headers.get('RateLimit');
        if(header){
          const q=/q=(\d+)/.exec(header);
          const r=/r=(\d+)/.exec(header);
          if(q) limit=parseInt(q[1],10);
          if(r) remaining=parseInt(r[1],10);
        }
      }catch(e){}
      if(Number.isFinite(remaining)){
        // The server count is shared by both phones of the same connection.
        this.budget={count:Math.max(0,limit-remaining),limit:limit,since:Date.now()};
      }else{
        const previous=this.loadBudget();
        const fresh=previous && Date.now()-previous.since<DAY_MS;
        this.budget={
          count:(fresh ? previous.count : 0)+1,
          limit:limit,
          since:fresh ? previous.since : Date.now()
        };
      }
      this.saveBudget(this.budget);
    }

    budgetCount(){
      const budget=this.budget;
      if(!budget || !Number.isFinite(budget.count)) return 0;
      if(!Number.isFinite(budget.since) || Date.now()-budget.since>=DAY_MS) return 0;
      return budget.count;
    }

    budgetInfo(){
      const budget=this.budget;
      if(!budget || !Number.isFinite(budget.count)) return null;
      if(!Number.isFinite(budget.since) || Date.now()-budget.since>=DAY_MS) return null;
      return {
        count:budget.count,
        limit:Number.isFinite(budget.limit) ? budget.limit : BUDGET_LIMIT
      };
    }

    heartbeatInterval(){
      const count=this.budgetCount();
      if(count>=BUDGET_STRICT) return 60*60*1000;
      if(count>=BUDGET_ECONOMY) return 30*60*1000;
      return HEARTBEAT_MS;
    }

    async publishState(command,error,options){
      if(this.mode!=='local' || !this.connected) return;
      const force=!!(options && options.force);
      const snapshot=this.options.getState();
      const serialized=JSON.stringify(snapshot);
      if(!command && !force && serialized===this.lastSnapshot) return;
      const generation=this.generation;
      const sequence=++this.sequence;
      const announce=!this.announced;
      // An in-flight update may replace the acknowledged state remotely.
      this.lastSnapshot='';
      this.lastPublish=Date.now();
      this.heartbeatAt=this.lastPublish+this.heartbeatInterval();
      this.publishing++;
      const payload={
        kind:'state',state:snapshot,sequence:sequence,
        replyTo:command ? command.id : null,
        recipient:command ? command.sender : null,error:error || ''
      };
      if(announce) payload.announce=true;
      try{
        await this.publish(STATE_TOPIC,payload);
        if(generation!==this.generation || sequence!==this.sequence) return;
        this.lastSnapshot=serialized;
        if(announce) this.announced=true;
        this.error='';
      }catch(e){
        if(generation!==this.generation || sequence!==this.sequence) return;
        this.error='Retour d’état ntfy indisponible ('+e.message+').';
      }finally{
        this.publishing--;
      }
      this.options.onChange();
    }

    stateChanged(force){
      // Coalesce UI updates, never publish the timer or microphone on each tick.
      clearTimeout(this.publishTimer);
      if(this.mode==='local') this.publishTimer=setTimeout(()=>{
        this.publishTimer=null;
        this.publishState(null,'',{force:!!force});
      },200);
    }

    // Ask the Local phone for its state at most once per PROBE_MIN_AGE_MS.
    // Probes have no pending timeout: an unanswered probe never replays itself.
    maybeProbe(force){
      if(this.mode!=='remote' || document.visibilityState!=='visible') return;
      if(!this.connected || this.probeInFlight) return;
      if(!force){
        if(this.probeFailures>=MAX_PROBE_FAILURES) return;
        if(this.nextProbeAt && Date.now()<this.nextProbeAt) return;
        if(this.state && Date.now()-this.lastSeen<PROBE_MIN_AGE_MS) return;
      }
      const generation=this.generation;
      this.probeInFlight=true;
      this.probeSentAt=Date.now();
      this.publish(COMMAND_TOPIC,{
        kind:'command',action:'state',value:null,target:null,probe:true
      }).then(()=>{
        if(generation!==this.generation || !this.probeInFlight) return;
        this.probeTimer=setTimeout(()=>{
          this.probeTimer=null;
          if(generation!==this.generation || !this.probeInFlight) return;
          this.probeInFlight=false;
          this.probeSentAt=0;
          this.probeFailures++;
          this.nextProbeAt=Date.now()+
            PROBE_BACKOFF_MS[Math.min(this.probeFailures,PROBE_BACKOFF_MS.length)-1];
          this.error=this.probeFailures>=MAX_PROBE_FAILURES
            ? 'Téléphone chambre injoignable. Actualisez son état.'
            : 'Téléphone chambre sans réponse. Actualisez son état.';
          this.options.onChange();
        },PROBE_TIMEOUT_MS);
      }).catch((e)=>{
        if(generation!==this.generation) return;
        this.probeInFlight=false;
        this.probeSentAt=0;
        this.probeFailures++;
        this.nextProbeAt=Date.now()+
          PROBE_BACKOFF_MS[Math.min(this.probeFailures,PROBE_BACKOFF_MS.length)-1];
        this.error='Envoi ntfy impossible ('+e.message+').';
        this.options.onChange();
      });
      this.options.onChange();
    }

    request(action,value){
      if(this.mode!=='remote') return;
      if(action==='state'){ this.maybeProbe(true); return; }
      if(this.pending) return;
      if(!this.connected){ this.error='Connexion ntfy indisponible.'; this.options.onChange(); return; }
      const id=crypto.randomUUID();
      const generation=this.generation;
      const pending={id,action,timer:setTimeout(()=>{
        if(this.pending!==pending) return;
        this.pending=null;
        this.error='Téléphone chambre sans réponse. Commande non confirmée.';
        this.lastSeen=0;
        this.recoverState();
        this.options.onChange();
      },REQUEST_TIMEOUT_MS)};
      this.pending=pending;
      this.error='';
      this.options.onChange();
      this.publish(COMMAND_TOPIC,{
        id,kind:'command',action,value,target:this.peer
      }).catch((e)=>{
        if(generation!==this.generation || this.pending!==pending) return;
        clearTimeout(pending.timer);
        this.pending=null;
        this.error='Envoi ntfy impossible ('+e.message+'). Commande non confirmée.';
        this.recoverState();
        this.options.onChange();
      });
    }

    receiveState(message){
      if(message.recipient && message.recipient!==this.session) return;
      const s=message.state;
      if(!s || typeof s.playing!=='boolean' || typeof s.autoEnabled!=='boolean' ||
        typeof s.infinite!=='boolean' || !Number.isFinite(s.durationMs) ||
        s.durationMs<60000 || s.durationMs>7200000 || !Number.isFinite(s.endTime) ||
        !Number.isInteger(message.sequence)) return;
      // Settings are optional so an older Local build keeps working.
      if(s.volume!==undefined && (!Number.isInteger(s.volume) || s.volume<0 || s.volume>100)) return;
      if(s.sensitivity!==undefined && (!Number.isInteger(s.sensitivity) || s.sensitivity<0 || s.sensitivity>100)) return;
      const reply=this.pending && message.replyTo===this.pending.id;
      // Accept a state from a sender announced after a reload, or shortly
      // after a probe. Other unknown senders stay ignored (single Local phone).
      const probing=!reply && this.probeSentAt>0 && Date.now()-this.probeSentAt<PROBE_GRACE_MS;
      const announce=!reply && message.announce===true;
      if(!reply && !probing && !announce && this.peer!==null && message.sender!==this.peer) return;
      if(!reply && message.sender===this.peer && message.sequence<=this.peerSequence) return;
      if(message.sender===this.peer && message.sequence<this.peerSequence){
        if(reply){
          clearTimeout(this.pending.timer);
          this.pending=null;
          this.error=typeof message.error==='string' ? message.error : '';
          this.options.onChange();
        }
        return;
      }
      this.peer=message.sender;
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.probeTimer);
      this.probeTimer=null;
      this.probeInFlight=false;
      this.probeSentAt=0;
      this.probeFailures=0;
      this.nextProbeAt=0;
      this.peerSequence=message.sequence;
      this.state=s;
      this.lastSeen=Date.now();
      if(reply){
        clearTimeout(this.pending.timer);
        this.pending=null;
        this.error=typeof message.error==='string' ? message.error : '';
      }else if(!this.pending) this.error='';
      this.options.onChange();
    }

    isFresh(){ return !!this.state && this.lastSeen>0 && this.connected && Date.now()-this.lastSeen<FRESH_MS; }
  };
})();
