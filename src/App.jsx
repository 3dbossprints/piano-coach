import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';
import { midiToNote, noteToMidi, parseSequence, compareSequences } from './music.js';

const KEYMAP = {a:'C4',w:'C#4',s:'D4',e:'D#4',d:'E4',f:'F4',t:'F#4',g:'G4',y:'G#4',h:'A4',u:'A#4',j:'B4',k:'C5'};
const EXAMPLES = [{name:'Warm-up scale',notes:'C4 D4 E4 F4 G4 A4 B4 C5'},{name:'Gentle arpeggio',notes:'C4 E4 G4 C5 G4 E4 C4'},{name:'Five-note pattern',notes:'C4 D4 E4 D4 C4'}];
function Staff({notes,expanded}) {
 const ref=useRef(null);
 useEffect(()=>{
  if(!ref.current)return;
  ref.current.innerHTML='';
  try {
   const width=Math.max(expanded?520:330,Math.min(760,notes.length*48+90));
   const renderer=new Renderer(ref.current,Renderer.Backends.SVG);
   renderer.resize(width,expanded?190:150);
   const ctx=renderer.getContext();
   const stave=new Stave(12,18,width-24);
   stave.addClef('treble').addTimeSignature('4/4').setContext(ctx).draw();
   const pitch=notes.slice(-10).map(n=>{const mm=String(n.note).match(/^([A-G])(#?)(-?\d)$/);return mm?mm[1].toLowerCase()+(mm[2]||'')+'/'+mm[3]:'c/4'});
   if(pitch.length){
    const staveNotes=pitch.map(k=>new StaveNote({keys:[k],duration:'q'}));
    const voice=new Voice({numBeats:Math.max(4,staveNotes.length),beatValue:4}).setStrict(false);
    voice.addTickables(staveNotes);
    new Formatter().joinVoices([voice]).format([voice],width-100);
    voice.draw(ctx,stave);
   }
  } catch(e) { /* Keep the note list usable even if notation cannot render a rare spelling. */ }
 },[notes,expanded]);
 return <div className="staff-wrap"><div className="staff" ref={ref}/>{!notes.length&&<div className="staff-empty">Your detected notes will appear on the staff here.</div>}</div>
}
function requireVexFormatter(){return (globalThis.VexFlow&&globalThis.VexFlow.Formatter)||class {joinVoices(v){return this} format(){} };}
export default function App(){
 const [page,setPage]=useState('Practice');
 const [events,setEvents]=useState([]);
 const [expected,setExpected]=useState('C4 D4 E4 G4');
 const [mode,setMode]=useState('Free practice');
 const [bpm,setBpm]=useState(84);
 const [volume,setVolume]=useState(65);
 const [status,setStatus]=useState('Ready to play');
 const [micStatus,setMicStatus]=useState('Microphone is off');
 const [level,setLevel]=useState(0);
 const [listening,setListening]=useState(false);
 const [metronome,setMetronome]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [sustain,setSustain]=useState(false);
 const [search,setSearch]=useState('');
 const [sessions,setSessions]=useState(()=>{try{return JSON.parse(localStorage.getItem('pc_sessions')||'[]')}catch{return[]}});
 const [saved,setSaved]=useState(()=>{try{return JSON.parse(localStorage.getItem('pc_studies')||'[]')}catch{return[]}});
 const synth=useRef(null), mic=useRef(null), analyser=useRef(null), micStream=useRef(null), raf=useRef(null), beatLoop=useRef(null), sequenceLoop=useRef(null), startTime=useRef(0), sessionEvents=useRef([]);
 const [targetIndex,setTargetIndex]=useState(0);
 const targets=useMemo(()=>parseSequence(expected).filter(x=>x.midi!==null),[expected]);
 const actual=events;
 const comparison=useMemo(()=>compareSequences(expected,actual),[expected,actual]);
 useEffect(()=>{Tone.getDestination().volume.value=20*Math.log10(Math.max(.01,volume/100));},[volume]);
 useEffect(()=>{localStorage.setItem('pc_sessions',JSON.stringify(sessions));},[sessions]);
 useEffect(()=>{localStorage.setItem('pc_studies',JSON.stringify(saved));},[saved]);
 useEffect(()=>()=>{stopMic();stopPlayback();stopMetro();if(synth.current)synth.current.dispose();},[]);
 async function ensureSynth(){
  await Tone.start();
  if(!synth.current)synth.current=new Tone.PolySynth(Tone.Synth,{oscillator:{type:'triangle'},envelope:{attack:.015,decay:.22,sustain:.18,release:1.1},volume:-9}).toDestination();
  return synth.current;
 }
 async function playNote(note,duration='8n'){
  const midi=typeof note==='number'?note:noteToMidi(note);
  if(midi===null||midi<21||midi>108)return;
  const s=await ensureSynth();const n=midiToNote(midi);
  s.triggerAttackRelease(n,duration);
 }
 async function playSequence(){
  stopPlayback(); if(!targets.length){setStatus('Enter notes such as C4 D4 E4 first.');return}
  await ensureSynth();setPlaying(true);setStatus('Playing reference sequence');
  const step=60/bpm;let i=0;
  sequenceLoop.current= new Tone.Loop((time)=>{if(i>=targets.length){Tone.Transport.stop();Tone.Transport.cancel();setPlaying(false);setStatus('Reference sequence finished');return} synth.current?.triggerAttackRelease(midiToNote(targets[i].midi),'8n',time);Tone.Draw.schedule(()=>setTargetIndex(i),time);i++;},step);
  Tone.Transport.bpm.value=bpm;Tone.Transport.start();sequenceLoop.current.start(0);
 }
 function stopPlayback(){try{sequenceLoop.current?.dispose();sequenceLoop.current=null;Tone.Transport.stop();Tone.Transport.cancel()}catch{}setPlaying(false)}
 async function toggleMetro(){
  if(metronome){stopMetro();return}
  await Tone.start();beatLoop.current=new Tone.Loop((time)=>{const click=new Tone.MembraneSynth({pitchDecay:.01,octaves:2,envelope:{attack:.001,decay:.08,sustain:0,release:.02}}).toDestination();click.volume.value=-17;click.triggerAttackRelease('C6','32n',time);Tone.Draw.schedule(()=>click.dispose(),time+.15)},'4n');
  Tone.Transport.bpm.value=bpm;beatLoop.current.start(0);Tone.Transport.start();setMetronome(true);setStatus('Metronome on');
 }
 function stopMetro(){try{beatLoop.current?.dispose();beatLoop.current=null;if(!playing){Tone.Transport.stop();Tone.Transport.cancel()}}catch{}setMetronome(false)}
 async function startMic(){
  if(!navigator.mediaDevices?.getUserMedia){setMicStatus('Microphone is not supported by this browser.');return}
  try{
   micStream.current=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   const ctx=Tone.getContext().rawContext;
   mic.current=ctx.createMediaStreamSource(micStream.current);analyser.current=ctx.createAnalyser();analyser.current.fftSize=4096;mic.current.connect(analyser.current);
   setListening(true);setMicStatus('Listening · monophonic pitch tracking');setStatus('Microphone active — play one note at a time');
   startTime.current=Date.now();sampleMic();
  }catch(e){setMicStatus(e.name==='NotAllowedError'?'Microphone permission denied. Allow access in your browser settings.':'Could not start microphone: '+e.message)}
 }
 function sampleMic(){
  if(!analyser.current)return;
  const data=new Float32Array(analyser.current.fftSize);analyser.current.getFloatTimeDomainData(data);
  let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];const rms=Math.sqrt(sum/data.length);setLevel(Math.min(100,Math.round(rms*320)));
  if(rms>.012){
   const freq=autoCorrelate(data,Tone.getContext().sampleRate);
   if(freq>45&&freq<1500){
    const midi=Math.round(69+12*Math.log2(freq/440));
    if(midi>=21&&midi<=108){
     const note=midiToNote(midi),last=sessionEvents.current[sessionEvents.current.length-1];
     if(!last||last.note!==note||Date.now()-last.timeMs>500){
      const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'microphone'};
      sessionEvents.current.push(event);setEvents([...sessionEvents.current]);setStatus('Detected '+note);
     }
    }
   }
  }
  raf.current=requestAnimationFrame(sampleMic);
 }
 function stopMic(){
  if(raf.current)cancelAnimationFrame(raf.current);raf.current=null;
  micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;
  try{mic.current?.disconnect();analyser.current?.disconnect()}catch{}
  mic.current=null;analyser.current=null;setListening(false);setLevel(0);setMicStatus('Microphone is off');
 }
 function autoCorrelate(buf,sampleRate){
  let rms=0;for(let i=0;i<buf.length;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/buf.length);if(rms<.01)return -1;
  let r1=0,r2=buf.length-1,th=.2;
  for(let i=0;i<buf.length/2&&Math.abs(buf[i])<th;i++)r1=i;
  for(let i=1;i<buf.length/2&&Math.abs(buf[buf.length-i])<th;i++)r2=buf.length-i;
  const b=buf.slice(r1,r2),n=b.length,cor=new Float32Array(n);
  for(let lag=0;lag<n;lag++){let s=0;for(let j=0;j<n-lag;j++)s+=b[j]*b[j+lag];cor[lag]=s}
  let d=0;while(d+1<n&&cor[d]>cor[d+1])d++;
  let max=-1,period=-1;for(let i=d;i<n;i++){if(cor[i]>max){max=cor[i];period=i}}
  if(period<=0||max/cor[0]<.5)return -1;
  const x1=cor[period-1],x2=cor[period],x3=cor[period+1],a=(x1+x3-2*x2)/2,bv=(x3-x1)/2;
  const refined=period-(a?bv/(2*a):0);return sampleRate/refined;
 }
 function clearNotes(){sessionEvents.current=[];setEvents([]);setStatus('Detected notes cleared')}
 function undoNote(){sessionEvents.current.pop();setEvents([...sessionEvents.current]);setStatus('Last note removed')}
 function exportNotes(){
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),notes:events.map(({note,time,source})=>({note,time,source}))},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='piano-coach-notes.json';a.click();URL.revokeObjectURL(url);
 }
 function saveSession(){
  const mins=Math.max(1,Math.round((Date.now()-startTime.current)/60000));
  const session={id:Date.now(),date:new Date().toISOString(),song:mode,minutes:mins,notes:events.length,reflection:events.length+' note events captured'};
  setSessions([session,...sessions]);setStatus('Practice session saved on this device');
 }
 function saveStudy(){const title=prompt('Name this study','My note sequence');if(title?.trim()){setSaved([{id:Date.now(),title:title.trim(),notes:expected},...saved]);setStatus('Study saved')}}
 function useStudy(s){setExpected(s.notes);setPage('Practice');setMode('Note tracking');setStatus('Loaded '+s.title)}
 function pressKey(note){playNote(note);if(!startTime.current)startTime.current=Date.now();const midi=noteToMidi(note);const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'keyboard'};sessionEvents.current.push(event);setEvents([...sessionEvents.current]);setStatus('Played '+note)}
 function keyboardDown(e){if(e.repeat||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;const n=KEYMAP[e.key.toLowerCase()];if(n){e.preventDefault();pressKey(n)}}
 useEffect(()=>{window.addEventListener('keydown',keyboardDown);return()=>window.removeEventListener('keydown',keyboardDown)});
 const allKeys=Array.from({length:88},(_,i)=>({midi:i+21,note:midiToNote(i+21),black:[1,3,6,8,10].includes((i+21)%12)}));
 const blackOffsets={'C#':0.62,'D#':1.62,'F#':3.62,'G#':4.62,'A#':5.62};
 const nav=['Dashboard','Practice','Sheet music','Library','Settings'];
 return <div className="shell"><aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('Dashboard')}}><img src="/assets/piano-coach-logo.svg" alt=""/> <span>Piano Coach<small>Listen · Learn · Play</small></span></a><div className="nav-label">WORKSPACE</div>{nav.map(n=><button key={n} className={'nav-item '+(page===n?'active':'')} onClick={()=>setPage(n)}><span>{({'Dashboard':'⌂','Practice':'♫','Sheet music':'♬','Library':'▤','Settings':'⚙'})[n]}</span>{n}</button>)}<div className="sidebar-note"><span className="live-dot"/> Local-first studio<p>Your practice notes stay on this device.</p></div><a className="corner-brand" href="https://jws.l.cd" target="_blank" rel="noreferrer"><img src="/assets/user-corner-logo.svg" alt=""/>jws.l.cd</a></aside>
 <main className="main"><header className="topbar"><div><div className="eyebrow">YOUR PERSONAL MUSIC STUDIO</div><h1>{page==='Practice'?'Play, listen, improve.':page==='Dashboard'?'A little practice goes a long way.':page}</h1></div><div className="top-actions"><span className="status-chip"><i/> {status}</span><button className="btn btn-dark" onClick={()=>{setPage('Practice');setStatus('Ready to play')}}>＋ New session</button></div></header>
 {page==='Practice'&&<><div className="practice-grid"><section className="panel studio-panel"><div className="panel-head"><div><div className="eyebrow">PRACTICE STUDIO</div><h2>Your piano</h2><p className="muted">Play with your keyboard or use the keys below.</p></div><span className="tag">88 keys</span></div><div className="controls-row"><label>Mode<select value={mode} onChange={e=>setMode(e.target.value)}><option>Free practice</option><option>Note tracking</option><option>Compare</option></select></label><label>Tempo <strong>{bpm} BPM</strong><input type="range" min="40" max="180" value={bpm} onChange={e=>{setBpm(+e.target.value);Tone.Transport.bpm.value=+e.target.value}}/></label><label>Volume <strong>{volume}%</strong><input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(+e.target.value)}/></label></div><div className="piano-scroll"><div className="piano" aria-label="88-key piano keyboard">{allKeys.filter(k=>!k.black).map(k=><button key={k.midi} className="white-key" aria-label={k.note} onPointerDown={()=>pressKey(k.note)}><span>{k.note}</span></button>)}{allKeys.filter(k=>k.black).map(k=><button key={k.midi} className="black-key" aria-label={k.note} style={{left:(allKeys.filter(w=>!w.black&&w.midi<k.midi).length*23.5+14)+'px'}} onPointerDown={()=>pressKey(k.note)}><span>{k.note}</span></button>)}</div></div><div className="key-hint">Computer keys: A W S E D F T G Y H U J K · C4–C5</div><div className="toolbar"><button className={'btn '+(sustain?'btn-tint':'')} onClick={()=>setSustain(!sustain)}>{sustain?'✓ Sustain on':'♧ Sustain'}</button><button className={'btn '+(metronome?'btn-tint':'')} onClick={toggleMetro}>{metronome?'Ⅱ Stop metronome':'◷ Metronome'}</button><button className="btn" onClick={()=>playing?stopPlayback():playSequence()}>{playing?'Ⅱ Stop reference':'▶ Play reference'}</button></div><div className="divider"/><div className="panel-head"><div><h3>Listen through your microphone</h3><p className="muted">Best for single-note pitch tracking. Chord transcription is not supported by this detector.</p></div><span className={'tag '+(listening?'tag-live':'')}>{listening?'LISTENING':'MIC OFF'}</span></div><div className="mic-row"><div className="meter"><div style={{width:level+'%'}}/></div><span className="muted">{level}% input</span>{!listening?<button className="btn btn-dark" onClick={startMic}>Enable microphone</button>:<button className="btn btn-danger" onClick={stopMic}>Stop listening</button>}</div><p className="muted small">{micStatus}</p><div className="toolbar"><button className="btn btn-dark" onClick={saveSession}>Save session</button><button className="btn" onClick={saveStudy}>Save note study</button></div></section>
 <aside className="panel notes-panel"><div className="panel-head"><div><div className="eyebrow">LIVE TRANSCRIPTION</div><h2>Detected notes</h2></div><span className="count">{events.length}</span></div><p className="muted">Recent note events from the microphone or practice input.</p><Staff notes={events} expanded={expanded}/><button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'− Compact staff':'+ Expand staff'}</button><div className="notes-list">{events.slice(-12).reverse().map((e,i)=><div className="note-row" key={e.id}><span className="note-dot">{e.note.replace(/[0-9]/g,'')}</span><strong>{e.note}</strong><span className="muted">{e.time}s</span><span className="source">{e.source==='microphone'?'MIC':'KEY'}</span></div>)}{!events.length&&<div className="empty-state"><div className="music-icon">♫</div><strong>Your notes will appear here</strong><p>Play a key or enable your microphone to begin. The staff and event list update together.</p></div>}</div><div className="notes-actions"><button className="btn" onClick={undoNote} disabled={!events.length}>↶ Undo</button><button className="btn" onClick={exportNotes} disabled={!events.length}>↓ Export</button><button className="btn btn-quiet" onClick={clearNotes} disabled={!events.length}>Clear</button></div></aside></div>
 <section className="panel compare-panel"><div className="panel-head"><div><div className="eyebrow">PRACTICE WITH A GOAL</div><h2>{mode==='Compare'?'Compare your performance':'Note tracking'}</h2><p className="muted">Enter a target sequence using note names and octave numbers.</p></div><button className="btn" onClick={saveStudy}>Save study</button></div><label className="sequence-label">Expected notes<input value={expected} onChange={e=>{setExpected(e.target.value);setTargetIndex(0)}} placeholder="C4 D4 E4 G4"/></label><div className="examples">{EXAMPLES.map(x=><button className="example" key={x.name} onClick={()=>setExpected(x.notes)}>{x.name}<span>↗</span></button>)}</div><div className="comparison-summary"><div className="score"><span className="eyebrow">NOTE MATCH</span><strong>{comparison.accuracy}%</strong><span className="muted">{comparison.correct} correct of {comparison.total} target notes</span></div><div className="comparison-rows">{comparison.rows.slice(0,8).map((r,i)=><div className="comparison-row" key={i}><span>{r.expected}</span><span className="arrow">→</span><span>{r.played}</span><span className={'result '+r.status}>{r.status}</span></div>)}{!comparison.rows.length&&<p className="muted">Your comparison will appear here once you enter a target sequence and play notes.</p>}</div></div><p className="small muted">Matching is based on note order and pitch. Timing accuracy is not scored by this version.</p></section></>}
 {page==='Dashboard'&&<><section className="welcome panel"><div><span className="tag">YOUR MUSIC JOURNEY</span><h2>Small steps. Beautiful progress.</h2><p className="muted">Your practice history and saved studies, stored locally on this device.</p><button className="btn btn-dark" onClick={()=>setPage('Practice')}>Start practising →</button></div><div className="welcome-mark">♫</div></section><div className="stats-grid"><article className="stat-card"><span>Practice sessions</span><strong>{sessions.length}</strong><small>Saved on this device</small></article><article className="stat-card"><span>Total practice time</span><strong>{sessions.reduce((a,s)=>a+(+s.minutes||0),0)} <em>min</em></strong><small>From saved sessions</small></article><article className="stat-card"><span>Saved studies</span><strong>{saved.length}</strong><small>Your note sequences</small></article></div><section className="panel"><div className="panel-head"><div><h2>Recent sessions</h2><p className="muted">Real sessions saved from your practice studio.</p></div><button className="btn" onClick={()=>setPage('Practice')}>New session</button></div>{sessions.length?sessions.slice(0,5).map(s=><div className="list-item" key={s.id}><span className="list-icon">♫</span><div><strong>{s.song}</strong><small>{new Date(s.date).toLocaleString()} · {s.notes} note events</small></div><span className="push">{s.minutes} min</span></div>):<div className="empty-state"><div className="music-icon">◷</div><strong>No sessions yet</strong><p>Your real practice sessions will appear here after you save one.</p><button className="btn" onClick={()=>setPage('Practice')}>Start first session</button></div>}</section></>}
 {page==='Sheet music'&&<section className="panel"><div className="eyebrow">SCORE WORKSPACE</div><h2>Sheet music</h2><p className="muted">Create a note sequence here and send it to the practice studio. Accurate PDF-to-notes recognition is not included in this version.</p><label className="sequence-label">Paste a note sequence<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4 E4 G4 C5"/></label><div className="toolbar"><button className="btn btn-dark" onClick={()=>setPage('Practice')}>Practise this sequence</button><button className="btn" onClick={saveStudy}>Save to library</button></div><Staff notes={parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:i,note:n.token}))} expanded/></section>}
 {page==='Library'&&<section className="panel"><div className="panel-head"><div><div className="eyebrow">YOUR COLLECTION</div><h2>Music library</h2><p className="muted">Saved note sequences stored in this browser.</p></div><button className="btn btn-dark" onClick={saveStudy}>＋ Save current sequence</button></div><input className="search-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search saved studies…"/>{saved.filter(s=>s.title.toLowerCase().includes(search.toLowerCase())).map(s=><div className="list-item" key={s.id}><span className="list-icon">♫</span><div><strong>{s.title}</strong><small>{s.notes}</small></div><button className="btn" onClick={()=>useStudy(s)}>Open</button><button className="btn btn-quiet" onClick={()=>setSaved(saved.filter(x=>x.id!==s.id))}>Delete</button></div>)}{!saved.length&&<div className="empty-state"><div className="music-icon">▤</div><strong>Your library is ready</strong><p>Save a note sequence from the practice studio to see it here.</p><button className="btn" onClick={()=>setPage('Practice')}>Create a study</button></div>}</section>}
 {page==='Settings'&&<section className="panel"><div className="eyebrow">PREFERENCES & PRIVACY</div><h2>Settings</h2><div className="setting-row"><div><strong>Master volume</strong><p className="muted">Applies to piano playback and reference sounds.</p></div><input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(+e.target.value)}/><strong>{volume}%</strong></div><div className="setting-row"><div><strong>Default tempo</strong><p className="muted">Current practice tempo.</p></div><input type="range" min="40" max="180" value={bpm} onChange={e=>setBpm(+e.target.value)}/><strong>{bpm} BPM</strong></div><div className="privacy-box"><strong>Privacy-first by default</strong><p>Practice sessions and saved studies are stored in this browser. Microphone audio is analysed locally and is not uploaded by this application. This basic pitch tracker is designed for one note at a time and is not a polyphonic transcription model.</p></div><div className="toolbar"><button className="btn" onClick={()=>{const blob=new Blob([JSON.stringify({sessions,studies:saved,preferences:{volume,bpm}},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='piano-coach-data.json';a.click();URL.revokeObjectURL(u)}}>Export all data</button><button className="btn btn-danger" onClick={()=>{if(confirm('Clear all saved sessions and studies on this device? This cannot be undone.')){setSessions([]);setSaved([]);localStorage.removeItem('pc_sessions');localStorage.removeItem('pc_studies');setStatus('Local data cleared')}}}>Clear local data</button></div></section>}
 <footer className="app-footer"><span>Made for curious musicians.</span><span>Audio stays on this device · <a href="https://jws.l.cd" target="_blank" rel="noreferrer">jws.l.cd</a></span></footer></main></div>
}