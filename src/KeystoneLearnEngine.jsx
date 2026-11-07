import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { createGrandPiano, loadGrandPiano } from './grand-piano.js';
import { buildKeystoneTimeline, midiName, parseKeystoneMusicXML, scoreNotesToKeystoneTimeline, isBlackKey } from './keystone-engine.js';

const COMPUTER_KEYS = 'zsxdcvgbhnjmq2w3er5t6y7u';
const KEYBOARD_HEIGHT = 116;
const midiFromKey = key => {
  const m = String(key || '').match(/^([A-G])(#|b)?(-?\d)$/i);
  if (!m) return null;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return 12 * (Number(m[3]) + 1) + semitones[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

export default function KeystoneLearnEngine({ xml, notes, bpm: initialBpm = 120, timeSignature = '4/4', title = 'Your piece', micInputRef, onConnectMic, onDisconnectMic, microphoneListening = false, microphoneLevel = 0, microphoneStatus = 'Microphone is off', onFinish, onClose }) {
  const parsed = useMemo(() => {
    if (xml) {
      try { return parseKeystoneMusicXML(xml); }
      catch (error) { return { error: error.message, timeline: scoreNotesToKeystoneTimeline(notes, initialBpm) }; }
    }
    return { timeline: scoreNotesToKeystoneTimeline(notes, initialBpm) };
  }, [xml, notes, initialBpm]);
  const timeline = useMemo(() => parsed.measures ? buildKeystoneTimeline(parsed) : (parsed.timeline || []), [parsed]);
  const canvasRef = useRef(null), stageRef = useRef(null), rafRef = useRef(0);
  const runRef = useRef(null), pressedRef = useRef(new Set()), voicesRef = useRef(new Map());
  const audioRef = useRef(null), pianoSamplerRef = useRef(null), midiRef = useRef(null), keyHeldRef = useRef({}), timersRef = useRef(new Set());
  const [mode, setMode] = useState('learn'), [hands, setHands] = useState('both');
  const [speed, setSpeed] = useState(1), [bpm, setBpm] = useState(Math.max(20, Number(initialBpm) || 120));
  const [fromBar, setFromBar] = useState(1), [toBar, setToBar] = useState(9999);
  const [keyStart, setKeyStart] = useState(48), [message, setMessage] = useState('Press Start when you are ready.');
  const [midiDeviceName, setMidiDeviceName] = useState('Not connected'), [midiConnected, setMidiConnected] = useState(false);
  const [result, setResult] = useState(null), [tick, setTick] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 900, height: 430 });

  const availableBars = useMemo(() => [...new Set(timeline.map(n => Number(n.measure) || 1))].sort((a,b)=>a-b), [timeline]);
  const maxBar = Math.max(1, ...availableBars);
  const selected = useMemo(() => timeline.filter(n => n.measure >= fromBar && n.measure <= toBar && (hands === 'both' || n.hand === hands)), [timeline, fromBar, toBar, hands]);
  const allVisible = useMemo(() => timeline.filter(n => n.measure >= fromBar && n.measure <= toBar), [timeline, fromBar, toBar]);
  const minMidi = allVisible.length ? Math.min(...allVisible.map(n=>n.midi)) : 48;
  const maxMidi = allVisible.length ? Math.max(...allVisible.map(n=>n.midi)) : 72;
  const keyRange = useMemo(() => {
    const low = Math.max(21, Math.floor(minMidi / 12) * 12);
    const high = Math.min(109, Math.max(low + 24, Math.ceil((maxMidi + 1) / 12) * 12));
    return { low, high };
  }, [minMidi, maxMidi]);
  const whiteKeys = useMemo(() => {
    const out=[]; for(let m=keyRange.low;m<keyRange.high;m++) if(!isBlackKey(m)) out.push(m);
    return out;
  }, [keyRange]);
  const whiteWidth = 100 / Math.max(1, whiteKeys.length);

  const sound = useCallback((midi, on) => {
    if(!Number.isFinite(midi)||midi<0||midi>127)return;
    if(!pianoSamplerRef.current)pianoSamplerRef.current=createGrandPiano(-7);
    const note=midiName(midi);
    if(on){
      Tone.start().then(()=>loadGrandPiano(pianoSamplerRef.current)).then(()=>{if(pressedRef.current.has(midi))pianoSamplerRef.current?.triggerAttack(note)}).catch(error=>{console.error('Grand piano samples failed to load:',error);});
    }else{
      try{pianoSamplerRef.current?.triggerRelease(note)}catch{}
    }
  }, []);

  const hit = useCallback((note, grade, extra) => {
    const run=runRef.current; if(!run)return;
    note.res=grade; note.hitAt=performance.now();
    if(run.mode==='learn' && note.d >= .8) { note.hold=1; note.he=note.t+Math.min(note.d*.6,1.2); }
    run.combo++; run.maxCombo=Math.max(run.maxCombo,run.combo);
    run.points += ({perfect:100,good:70,almost:40}[grade] || 0) * (1+Math.min(run.combo,40)/20);
    run.popup={text:grade==='perfect'?'Perfect':grade==='good'?'Good job':'Almost'+(extra?', a bit '+extra:''),at:performance.now(),good:true};
    setMessage(run.mode==='learn'?'Correct note. Keep going.':grade==='perfect'?'Right on the beat.':grade==='good'?'Good timing.':'A little early or late.');
    setTick(v=>v+1);
  }, []);
  const bad = useCallback((midi, text) => {
    const run=runRef.current;if(!run)return;
    run.wrong.push({midi,bar:(run.active.find(n=>!n.res)||{}).measure||0});
    run.combo=0;run.popup={text,at:performance.now(),good:false};run.shakeUntil=performance.now()+180;
    if(run.mode==='learn'){run.stall=true;const next=run.active.find(n=>!n.res);if(next)next.bad=1;}
    setMessage(run.mode==='learn'?text+' — play the correct note to continue.':text);
    setTick(v=>v+1);
  }, []);

  const noteDown = useCallback((midi) => {
    if(!Number.isFinite(midi)||midi<0||midi>127||pressedRef.current.has(midi))return;
    pressedRef.current.add(midi);sound(midi,true);
    const run=runRef.current;if(!run||run.done)return;
    if(run.mode==='perform'){
      let best=null;
      for(const n of run.active){if(n.midi!==midi||n.res)continue;const error=run.clock-n.t;if(Math.abs(error)<=.4&&(!best||Math.abs(error)<Math.abs(run.clock-best.t)))best=n;}
      if(best){const error=run.clock-best.t,abs=Math.abs(error);best.error=error;hit(best,abs<.12?'perfect':abs<.25?'good':'almost',error<0?'early':'late');}
      else if(run.clock>-.5)bad(midi,'Wrong note');
      return;
    }
    const broken=run.active.find(n=>n.broken&&n.midi===midi);
    if(broken){broken.broken=false;broken.upAt=0;run.stall=false;setMessage('Keep holding the note.');setTick(v=>v+1);return;}
    if(run.active.some(n=>n.broken)){setMessage('Press the held note again to continue.');return;}
    // Treat notes with the same onset as one chord. A chord may contain up to
    // 13 notes, and MIDI note-on events arrive one after another even when the
    // player physically presses them together.
    const next=run.active.find(n=>!n.res);
    const chord=next?run.active.filter(n=>!n.res&&Math.abs(n.t-next.t)<=.08):[];
    const pool=chord.filter(n=>n.midi===midi);
    const early=pool.length>0&&next.t-run.clock>.35*run.speed;
    if(pool.length&&(!early||run.stall)){
      const note=pool[0];const latency=note.arrivedAt?(performance.now()-note.arrivedAt)/1000:0;note.latency=latency;run.stall=false;
      if(run.clock<note.t)run.clock=note.t;
      hit(note,note.bad?'almost':latency<.4?'perfect':'good');
    }else if(early)bad(midi,'Too early — wait for the falling chord');
    else if(run.clock>=-.3)bad(midi,chord.some(n=>n.midi===midi)?'Not yet — follow the chord':'Wrong note');
  }, [bad, hit, sound]);

  const noteUp = useCallback((midi) => {
    pressedRef.current.delete(midi);sound(midi,false);
  }, [sound]);

  // Expose the engine's real note handlers to the microphone analyser in App.
  // This keeps microphone and MIDI input on the exact same Learn/Perform path.
  useEffect(() => {
    if(!micInputRef)return;
    micInputRef.current={noteDown,noteUp};
    return()=>{if(micInputRef.current?.noteDown===noteDown)micInputRef.current=null;};
  },[micInputRef,noteDown,noteUp]);

  const stopRun = useCallback(() => {
    runRef.current=null;pressedRef.current.forEach(m=>sound(m,false));pressedRef.current.clear();
    setMessage('Stopped. Press Start to try again.');setTick(v=>v+1);
  }, [sound]);

  const startRun = useCallback(async () => {
    if(runRef.current){stopRun();return;}
    if(!selected.length){setMessage('There are no playable notes in this hand and bar range.');return;}
    await Tone.start();
    const active=selected.map(n=>({...n,on:true,res:null,arrivedAt:null,played:false}));
    const activeIds=new Set(active.map(n=>n.orderIndex+':'+n.noteIndex+':'+n.t));
    const accompaniment=timeline.filter(n=>n.measure>=fromBar&&n.measure<=toBar&&!activeIds.has(n.orderIndex+':'+n.noteIndex+':'+n.t)).map(n=>({...n,played:false}));
    const start=Math.min(...active.map(n=>n.t)),end=Math.max(...active.map(n=>n.t+n.d));
    const sourceBpm=Math.max(20,Number(parsed.measures?.[0]?.bpm)||Number(initialBpm)||120),effectiveSpeed=speed*bpm/sourceBpm;
    runRef.current={mode,speed:effectiveSpeed,active,accompaniment,clock:start-3.2*effectiveSpeed,start,end,combo:0,maxCombo:0,points:0,wrong:[],auto:new Set(),stall:false,done:false,finishAt:0};
    setResult(null);setMessage(mode==='learn'?'Learn mode: the notes will wait for you.':'Perform mode: play along with the falling notes.');
    setTick(v=>v+1);
  }, [selected,timeline,fromBar,toBar,mode,speed,bpm,parsed,initialBpm,stopRun]);

  const finishRun = useCallback(() => {
    const run=runRef.current;if(!run||run.done)return;
    run.done=true;
    const hits=run.active.filter(n=>n.res);
    const total=run.active.length, score=Math.max(0,Math.round(100*(hits.reduce((sum,n)=>sum+({perfect:1,good:.8,almost:.5}[n.res]||0),0)-(run.mode==='perform'?run.wrong.length*.25:0))/Math.max(1,total)));
    const errors=hits.filter(n=>Number.isFinite(n.error)),mean=errors.length?errors.reduce((s,n)=>s+n.error,0)/errors.length:0;
    const bars={};run.active.filter(n=>!n.res||n.bad).forEach(n=>(bars[n.measure]??=new Set()).add(midiName(n.midi)));
    const trouble=Object.entries(bars).sort((a,b)=>b[1].size-a[1].size).slice(0,6).map(([bar,ns])=>({bar,notes:[...ns]}));
    const summary={score,hits:hits.length,total,perfect:hits.filter(n=>n.res==='perfect').length,good:hits.filter(n=>n.res==='good').length,almost:hits.filter(n=>n.res==='almost').length,wrong:run.wrong.length,maxCombo:run.maxCombo,mode:run.mode,hands,tempo:bpm,speed:run.speed,meanTimingMs:errors.length?Math.round(mean*1000):null,trouble};
    setResult(summary);setMessage('Finished. Review your result or start again.');runRef.current=null;setTick(v=>v+1);
  }, [hands,bpm]);

  useEffect(() => {
    const canvas=canvasRef.current,stage=stageRef.current;if(!canvas||!stage)return;
    const resize=()=>{const rect=stage.getBoundingClientRect(),d=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(rect.width*d));canvas.height=Math.max(1,Math.round(rect.height*d));canvas.getContext('2d').setTransform(d,0,0,d,0,0);setDimensions({width:rect.width,height:rect.height});};
    resize();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(stage);window.addEventListener('resize',resize);
    return()=>{observer?.disconnect();window.removeEventListener('resize',resize);};
  }, []);

  useEffect(() => {
    let active=true;
    const drawFrame=(ts)=>{
      if(!active)return;
      const canvas=canvasRef.current;if(!canvas){rafRef.current=requestAnimationFrame(drawFrame);return;}
      const ctx=canvas.getContext('2d'),W=dimensions.width,H=dimensions.height,fh=H-KEYBOARD_HEIGHT,pps=fh/3.2,now=performance.now(),run=runRef.current;
      const dt=Math.min(.05,(ts-(drawFrame.last||ts))/1000);drawFrame.last=ts;
      if(run&&!run.done){
        const advance=dt*run.speed;
        if(run.mode==='learn'){
          for(const n of run.active){if(n.hold&&!n.broken){if(run.clock>=n.he){n.hold=0;n.heldEnd=now;}else if(pressedRef.current.has(n.midi))n.upAt=0;else if(!n.upAt)n.upAt=now;else if(now-n.upAt>350){n.broken=true;n.upAt=0;run.stall=true;if(n.res==='perfect')n.res='good';setMessage('Keep the note held down. Press it again to continue.');}}}
          if(!run.stall){const next=run.active.find(n=>!n.res);run.clock=next?Math.min(run.clock+advance,Math.max(next.t,run.clock)):run.clock+advance;}
        }else run.clock+=advance;
        for(const n of run.active){if(!n.arrivedAt&&n.t<=run.clock)n.arrivedAt=now;if(run.mode==='perform'&&!n.res&&!n.missed&&run.clock>n.t+.4){n.missed=true;run.combo=0;}}
        for(const n of run.accompaniment){if(!n.played&&run.clock>=n.t){n.played=true;const id='accompaniment-'+n.orderIndex+'-'+n.noteIndex;sound(n.midi,true,id);const timer=window.setTimeout(()=>{timersRef.current.delete(timer);sound(n.midi,false,id);},Math.max(140,n.d*1000/run.speed));timersRef.current.add(timer);}}
        if(run.mode==='learn'&&run.active.every(n=>n.res&&!n.hold)){run.finishAt ||= now+700;if(now>run.finishAt)finishRun();}
        else if(run.mode==='perform'&&run.clock>run.end+.8)finishRun();
      }
      ctx.clearRect(0,0,W,H);ctx.fillStyle='#0d0c0a';ctx.fillRect(0,0,W,H);
      const gradient=ctx.createLinearGradient(0,fh-90,0,fh);gradient.addColorStop(0,'#e0b25a00');gradient.addColorStop(1,'#e0b25a22');ctx.fillStyle=gradient;ctx.fillRect(0,fh-90,W,90);
      const visibleWhites=[];for(let m=keyRange.low;m<keyRange.high;m++)if(!isBlackKey(m))visibleWhites.push(m);
      const whiteW=W/Math.max(1,visibleWhites.length);
      const geom=m=>{if(!isBlackKey(m))return[visibleWhites.indexOf(m)*whiteW,whiteW];return[(visibleWhites.indexOf(m-1)+1)*whiteW-whiteW*.3,whiteW*.6];};
      ctx.strokeStyle='#ffffff13';visibleWhites.forEach((_,i)=>{ctx.beginPath();ctx.moveTo(i*whiteW,0);ctx.lineTo(i*whiteW,fh);ctx.stroke();});
      const drawNotes=run?run.active:timeline.filter(n=>n.measure>=fromBar&&n.measure<=toBar&&(hands==='both'||n.hand===hands));
      const clock=run?run.clock:(drawNotes[0]?.t||0)-3.2;
      for(const n of drawNotes){const y2=fh-(n.t-clock)*pps,y1=y2-n.d*pps;if(y2<-4||y1>fh+4)continue;const [x,w]=geom(n.midi);let colour=n.res?(n.broken?'#ff9a8d':'#7fe0b4'):(n.missed?'#ff6b5e66':n.hand==='left'?'#4e9bd8':'#e0b25a');let alpha=1;if(n.res&&!n.hold)alpha=Math.max(0,1-(now-(n.heldEnd||n.hitAt||now))/450);ctx.globalAlpha=alpha;ctx.fillStyle=colour;const h=Math.max(12,y2-y1-3);ctx.beginPath();ctx.roundRect(x+2,y2-h-1,w-4,h,6);ctx.fill();if(h>20&&w>22){ctx.fillStyle='#17130b';ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillText(midiName(n.midi),x+w/2,y2-6);}ctx.globalAlpha=1;}
      const waiting=run&&run.mode==='learn'&&!run.done&&run.active.find(n=>!n.res&&n.t<=clock+.01);
      const targets=new Set(waiting?run.active.filter(n=>!n.res&&n.t<=clock+.01).map(n=>n.midi):[]);
      for(let m=keyRange.low;m<keyRange.high;m++){const [x,w]=geom(m),black=isBlackKey(m),held=pressedRef.current.has(m);ctx.fillStyle=held?'#e0b25a':targets.has(m)?'#f1d9a0':black?'#17150f':'#f3eee3';ctx.fillRect(x,fh,w-(black?0:1),black?KEYBOARD_HEIGHT*.6:KEYBOARD_HEIGHT);if(black){ctx.strokeStyle='#000';ctx.strokeRect(x,fh,w,KEYBOARD_HEIGHT*.6);}if(!black&&m%12===0){ctx.fillStyle='#8a8272';ctx.font='10px system-ui';ctx.fillText(midiName(m),x+4,H-5);}const keyIndex=m-keyStart;if(keyIndex>=0&&keyIndex<COMPUTER_KEYS.length){ctx.fillStyle=black?'#e0b25a':'#a8721a';ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.fillText(COMPUTER_KEYS[keyIndex].toUpperCase(),x+w/2,black?fh+KEYBOARD_HEIGHT*.6-8:H-23);ctx.textAlign='left';}}
      ctx.fillStyle='#ece6d9';ctx.font='600 27px system-ui';ctx.fillText(run?Math.round(run.points).toLocaleString():'KEYSTONE LEARN',16,36);
      if(run&&run.clock<-.2){ctx.font='600 62px system-ui';ctx.textAlign='center';ctx.fillText(String(Math.ceil(-run.clock/run.speed)),W/2,fh/2);ctx.textAlign='left';}
      if(run?.stall){ctx.fillStyle='#ff9a8d';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText('Paused — play the correct note to continue',W/2,fh-90);ctx.textAlign='left';}
      if(run?.popup&&now-run.popup.at<800){ctx.globalAlpha=1-(now-run.popup.at)/800;ctx.fillStyle=run.popup.good?'#7fe0b4':'#ff9a8d';ctx.font='600 26px system-ui';ctx.textAlign='center';ctx.fillText(run.popup.text,W/2,fh*.42);ctx.textAlign='left';ctx.globalAlpha=1;}
      if(run&&run.mode==='perform'){const progress=Math.max(0,Math.min(100,(run.clock-run.start)/(run.end-run.start||1)*100));ctx.fillStyle='#e0b25a';ctx.fillRect(0,0,W*progress/100,3);}
      rafRef.current=requestAnimationFrame(drawFrame);
    };
    rafRef.current=requestAnimationFrame(drawFrame);
    return()=>{active=false;cancelAnimationFrame(rafRef.current);};
  }, [dimensions,keyRange,fromBar,toBar,hands,keyStart,sound,finishRun,tick,timeline]);

  const canvasDown = useCallback((event) => {
    const rect=canvasRef.current.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,fh=rect.height-KEYBOARD_HEIGHT;
    if(y<fh)return;
    const whites=[];for(let m=keyRange.low;m<keyRange.high;m++)if(!isBlackKey(m))whites.push(m);
    const ww=rect.width/Math.max(1,whites.length);let hit=null;
    for(let m=keyRange.low;m<keyRange.high;m++){const wi=whites.indexOf(isBlackKey(m)?m-1:m);const left=isBlackKey(m)?(wi+1)*ww-ww*.3:wi*ww,width=isBlackKey(m)?ww*.6:ww;if(x>=left&&x<left+width&&(!isBlackKey(m)||y<fh+KEYBOARD_HEIGHT*.6)){if(isBlackKey(m)){hit=m;break;}hit??=m;}}
    if(hit!==null){event.currentTarget.setPointerCapture?.(event.pointerId);noteDown(hit);keyHeldRef.current[event.pointerId]=hit;}
  }, [keyRange,noteDown]);
  const canvasUp = useCallback((event) => {const midi=keyHeldRef.current[event.pointerId];if(midi!==undefined){noteUp(midi);delete keyHeldRef.current[event.pointerId];}}, [noteUp]);

  useEffect(() => {
    const onKeyDown=e=>{if(e.repeat||e.metaKey||e.ctrlKey||e.altKey||['INPUT','SELECT','TEXTAREA'].includes(e.target?.tagName))return;const index=COMPUTER_KEYS.indexOf(String(e.key||'').toLowerCase());if(index<0)return;const midi=keyStart+index;if(midi>=keyRange.low&&midi<keyRange.high){e.preventDefault();e.stopImmediatePropagation?.();e.stopPropagation();keyHeldRef.current[e.code]=midi;noteDown(midi);}};
    const onKeyUp=e=>{const midi=keyHeldRef.current[e.code];if(midi!==undefined){noteUp(midi);delete keyHeldRef.current[e.code];}};
    window.addEventListener('keydown',onKeyDown,true);window.addEventListener('keyup',onKeyUp,true);
    return()=>{window.removeEventListener('keydown',onKeyDown,true);window.removeEventListener('keyup',onKeyUp,true);Object.values(keyHeldRef.current).forEach(noteUp);keyHeldRef.current={};};
  }, [keyStart,keyRange,noteDown,noteUp]);

  const listenToSection = useCallback(async () => {
    if(!selected.length){setMessage('There are no playable notes in this section.');return;}
    try{
      await Tone.start();
      if(!pianoSamplerRef.current)pianoSamplerRef.current=createGrandPiano(-7);
      await loadGrandPiano(pianoSamplerRef.current);
      const sampler=pianoSamplerRef.current,origin=selected[0].t,when=Tone.now()+.12;
      selected.forEach(note=>sampler.triggerAttackRelease(midiName(note.midi),Math.max(.08,note.d),when+Math.max(0,note.t-origin)));
      setMessage('Listening to the selected section. When you are ready, press Start and play it back.');
    }catch(error){setMessage('Could not play the section preview: '+(error?.message||'Piano audio is unavailable.'));}
  },[selected]);
  const connectMidi = useCallback(async () => {
    if(!navigator.requestMIDIAccess){setMessage('Web MIDI is unavailable in this browser. Use Chrome or Edge on HTTPS, or play the on-screen keys.');return;}
    try{const access=await navigator.requestMIDIAccess();midiRef.current=access;const bind=()=>{const inputs=[...access.inputs.values()];inputs.forEach(input=>{input.onmidimessage=event=>{const [status,note,velocity]=event.data,cmd=status&0xf0;if(cmd===0x90&&velocity>0)noteDown(note);else if(cmd===0x80||(cmd===0x90&&velocity===0))noteUp(note);};});setMidiConnected(inputs.length>0);setMidiDeviceName(inputs.map(i=>i.name||i.manufacturer||'MIDI input').join(', ')||'No MIDI device found');};bind();access.onstatechange=bind;}catch(error){setMessage('Could not connect MIDI: '+error.message);}
  }, [noteDown,noteUp]);
  const disconnectMidi = useCallback(() => {const access=midiRef.current;if(access){for(const input of access.inputs.values())input.onmidimessage=null;access.onstatechange=null;}midiRef.current=null;setMidiConnected(false);setMidiDeviceName('Not connected');}, []);

  useEffect(() => () => {
    if(runRef.current)runRef.current=null;
    disconnectMidi();for(const timer of timersRef.current)clearTimeout(timer);timersRef.current.clear();
    try{pianoSamplerRef.current?.dispose();pianoSamplerRef.current=null;audioRef.current?.close();}catch{}
  }, [disconnectMidi]);

  const shiftKey = delta => setKeyStart(v=>Math.max(21,Math.min(108-COMPUTER_KEYS.length,v+delta)));
  const finish = () => { const run=runRef.current;if(run){const hits=run.active.filter(n=>n.res),summary={score:Math.max(0,Math.round(100*hits.reduce((sum,n)=>sum+({perfect:1,good:.8,almost:.5}[n.res]||0),0)/Math.max(1,run.active.length))),hits:hits.length,total:run.active.length,perfect:hits.filter(n=>n.res==='perfect').length,good:hits.filter(n=>n.res==='good').length,almost:hits.filter(n=>n.res==='almost').length,wrong:run.wrong.length,maxCombo:run.maxCombo,mode:run.mode,hands,tempo:bpm,speed:run.speed,trouble:[]};runRef.current=null;onFinish?.(summary);}else onFinish?.(result); };

  return <div className="keystone-engine" role="dialog" aria-modal="true" aria-label="Keystone Listen and Learn engine">
    <header className="keystone-head"><div><span className="eyebrow">LISTEN & LEARN · KEYSTONE ENGINE</span><h2>{title}</h2><p>{parsed.error?'Using the imported note events because the original MusicXML could not be parsed: '+parsed.error:'MusicXML timing, repeats and endings are loaded into the lesson.'}</p></div><button type="button" className="btn" onClick={onClose}>Close ✕</button></header>
    <div className="keystone-controls">
      <label>Mode<select value={mode} onChange={e=>{setMode(e.target.value);stopRun();}}><option value="learn">Learn</option><option value="perform">Perform</option></select></label>
      <label>Hands<select value={hands} onChange={e=>{setHands(e.target.value);stopRun();}}><option value="both">Both</option><option value="right">Right</option><option value="left">Left</option></select></label>
      <label>Speed · {speed.toFixed(1)}×<input type="range" min=".4" max="1.5" step=".1" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></label>
      <label>From bar<input type="number" min="1" max={maxBar} value={fromBar} onChange={e=>setFromBar(Math.max(1,Math.min(maxBar,Number(e.target.value)||1)))}/></label>
      <label>To bar<input type="number" min={fromBar} max={maxBar} value={toBar===9999?maxBar:toBar} onChange={e=>setToBar(Math.max(fromBar,Math.min(maxBar,Number(e.target.value)||maxBar)))}/></label>
      <label>Tempo · {bpm} BPM<input type="range" min="20" max="240" step="1" value={bpm} onChange={e=>setBpm(Number(e.target.value))}/></label>
      <div className="keystone-key-controls"><span>Keys start · {midiName(keyStart)}</span><button className="btn" onClick={()=>shiftKey(-12)}>«</button><button className="btn" onClick={()=>shiftKey(-1)}>‹</button><button className="btn" onClick={()=>shiftKey(1)}>›</button><button className="btn" onClick={()=>shiftKey(12)}>»</button><button className="btn" onClick={()=>setKeyStart(Math.max(21,Math.floor(minMidi/12)*12))}>Auto</button></div>
      <button className="btn" type="button" onClick={listenToSection}>▶ Listen to section</button><button className="btn btn-dark keystone-start" onClick={startRun}>{runRef.current?'Stop':'Start'}</button>
    </div>
    <div className="keystone-input-panel">
      <div className="keystone-input-heading"><div><strong>Play on your piano</strong><span>Use your computer microphone for acoustic piano notes, or connect a MIDI keyboard for more precise note and chord detection.</span></div><span className={'keystone-input-state '+(microphoneListening?'is-live':'')}>{microphoneListening?'MICROPHONE ON':'MICROPHONE OFF'}</span></div>
      <div className="keystone-input-actions">
        <button type="button" className={'btn '+(microphoneListening?'':'btn-dark')} onClick={microphoneListening?onDisconnectMic:onConnectMic} disabled={!onConnectMic}>{microphoneListening?'Disconnect microphone':'🎙 Enable microphone'}</button>
        <button type="button" className="btn" onClick={midiConnected?disconnectMidi:connectMidi}>{midiConnected?'Disconnect MIDI piano':'Connect MIDI piano'}</button>
        <div className="keystone-mic-meter"><span>Input level</span><div><i style={{width:Math.max(0,Math.min(100,microphoneLevel))+'%'}}/></div><b>{Math.round(microphoneLevel)}%</b></div>
      </div>
      <p className="keystone-input-status" role="status">{microphoneStatus}{microphoneListening?' · MIDI keyboards support chords of up to 13 simultaneous notes, including both hands. Microphone mode remains monophonic.':''}</p>
    </div>
    <div className="keystone-stage" ref={stageRef}><canvas ref={canvasRef} onPointerDown={canvasDown} onPointerUp={canvasUp} onPointerCancel={canvasUp} onLostPointerCapture={canvasUp}/></div>
    <div className="keystone-status" role="status">{message}</div>
    <div className="keystone-footer"><span>{timeline.length} note events · {availableBars.length} bars · {midiConnected?'MIDI connected: '+midiDeviceName:'MIDI not connected'}</span><span>Computer keys: Z S X D C V G B H N J M · Q 2 W 3 E R 5 T 6 Y 7 U</span></div>
    {result&&<section className="keystone-result"><div><strong>Score</strong><b>{result.score}</b></div><div><strong>Notes</strong><b>{result.hits}/{result.total}</b></div><div><strong>Perfect</strong><b>{result.perfect}</b></div><div><strong>Wrong keys</strong><b>{result.wrong}</b></div><div><strong>Best streak</strong><b>{result.maxCombo}</b></div>{result.trouble.length>0&&<div className="keystone-trouble"><strong>Where to practise</strong>{result.trouble.map(x=><span key={x.bar}>Bar {x.bar}: {x.notes.join(', ')}</span>)}</div>}<div className="keystone-result-actions"><button className="btn" onClick={()=>setResult(null)}>Dismiss result</button><button className="btn btn-dark" onClick={finish}>Finish lesson</button></div></section>}
    {!result&&<div className="keystone-finish-row"><button className="btn" onClick={onClose}>Continue later</button><button className="btn btn-dark" onClick={finish}>Finish lesson</button></div>}
  </div>;
}
