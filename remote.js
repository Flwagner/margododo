"use strict";
(function(){
  const COMMAND_TOPIC='margododo-commands';
  const STATE_TOPIC='margododo-state';
  const MAX_AGE_MS=15000;
  const REQUEST_TIMEOUT_MS=10000;
  const REFRESH_MS=5*60*1000;
  const FRESH_MS=6*60*1000;

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
    }

    start(mode){
      this.close();
      this.mode=mode;
      const generation=this.generation;
      if(!('EventSource' in window)){
        this.error='Télécommande non supportée par ce navigateur.';
        this.options.onChange();
        return;
      }
      const topic=mode==='local' ? COMMAND_TOPIC : STATE_TOPIC;
      const source=new EventSource('https://ntfy.sh/'+topic+'/sse');
      this.source=source;
      source.onopen=()=>{
        if(generation!==this.generation) return;
        this.connected=true;
        this.error='';
        this.lastSnapshot='';
        if(mode==='remote') this.request('state');
        else this.stateChanged();
        this.options.onChange();
      };
      source.onerror=()=>{
        if(generation!==this.generation) return;
        this.connected=false;
        if(this.pending){
          clearTimeout(this.pending.timer);
          this.pending=null;
          this.lastSeen=0;
          this.error='Connexion interrompue. Commande non confirmée.';
        }
        this.options.onChange();
      };
      source.onmessage=(event)=>{
        if(generation!==this.generation) return;
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
      this.refreshTimer=setInterval(()=>{
        if(mode==='remote' && document.visibilityState==='visible' && this.connected && !this.pending){
          this.request('state');
        }
      },REFRESH_MS);
      this.uiTimer=setInterval(()=>this.options.onChange(),1000);
      this.options.onChange();
    }

    close(){
      this.generation++;
      if(this.source) this.source.close();
      clearInterval(this.refreshTimer);
      clearInterval(this.uiTimer);
      clearTimeout(this.publishTimer);
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
      }finally{ clearTimeout(timer); }
    }

    async publishState(command,error){
      if(this.mode!=='local' || !this.connected) return;
      const snapshot=this.options.getState();
      const serialized=JSON.stringify(snapshot);
      if(!command && serialized===this.lastSnapshot) return;
      const generation=this.generation;
      const sequence=++this.sequence;
      // An in-flight update may replace the acknowledged state remotely.
      this.lastSnapshot='';
      try{
        await this.publish(STATE_TOPIC,{
          kind:'state',state:snapshot,sequence:sequence,
          replyTo:command ? command.id : null,
          recipient:command ? command.sender : null,error:error || ''
        });
        if(generation!==this.generation || sequence!==this.sequence) return;
        this.lastSnapshot=serialized;
        this.error='';
      }catch(e){
        if(generation!==this.generation || sequence!==this.sequence) return;
        this.error='Retour d’état ntfy indisponible ('+e.message+').';
      }
      this.options.onChange();
    }

    stateChanged(){
      // Coalesce UI updates, never publish the timer or microphone on each tick.
      clearTimeout(this.publishTimer);
      if(this.mode==='local') this.publishTimer=setTimeout(()=>this.publishState(),200);
    }

    request(action,value){
      if(this.mode!=='remote' || this.pending) return;
      if(!this.connected){ this.error='Connexion ntfy indisponible.'; this.options.onChange(); return; }
      if(action!=='state' && !this.isFresh()) return;
      const id=crypto.randomUUID();
      const generation=this.generation;
      const pending={id,action,timer:setTimeout(()=>{
        if(this.pending!==pending) return;
        this.pending=null;
        this.error='Téléphone chambre sans réponse. Commande non confirmée.';
        this.lastSeen=0;
        this.options.onChange();
      },REQUEST_TIMEOUT_MS)};
      this.pending=pending;
      this.error='';
      this.options.onChange();
      this.publish(COMMAND_TOPIC,{
        id,kind:'command',action,value,target:action==='state' ? null : this.peer
      }).catch((e)=>{
        if(generation!==this.generation || this.pending!==pending) return;
        clearTimeout(pending.timer);
        this.pending=null;
        this.error='Envoi ntfy impossible ('+e.message+'). Commande non confirmée.';
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
      const reply=this.pending && message.replyTo===this.pending.id;
      if(!reply && (message.sender!==this.peer || message.sequence<=this.peerSequence)) return;
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

    isFresh(){ return !!this.state && this.connected && Date.now()-this.lastSeen<FRESH_MS; }
  };
})();
