import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { midiToNote, noteToMidi, parseSequence, compareSequences, clampKeyboardStartMidi, assignMidiHands } from './music.js';
import { midiNotesToMusicXML } from './midi-to-musicxml.js';
import GradePlanner from './GradePlannerSimple.jsx';
import { isPlayableSheetMusicItem, isSheetMusicLibraryItem, loadBrowserScoreLibrary, saveBrowserScoreLibrary } from './score-library.js';
import KeystoneLearnEngine from './KeystoneLearnEngine.jsx';
import { isMeaningfulPracticeSession, getPracticeSeconds, calculatePracticeStreak, getQualifyingPracticeDays } from './practice-history.js';

const KEYMAP = {a:'C4',w:'C#4',s:'D4',e:'D#4',d:'E4',f:'F4',t:'F#4',g:'G4',y:'G#4',h:'A4',u:'A#4',j:'B4',k:'C5'};
const EXAMPLES = [{name:'Warm-up scale',notes:'C4 D4 E4 F4 G4 A4 B4 C5'},{name:'Gentle arpeggio',notes:'C4 E4 G4 C5 G4 E4 C4'},{name:'Five-note pattern',notes:'C4 D4 E4 D4 C4'}];
function parseStandardMidi(buffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);let p=0;
 const ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
 if(bytes.length<14||ascii(0,4)!=='MThd')throw new Error('Not a standard MIDI file (missing MThd header).');
 const headerLength=view.getUint32(4);if(headerLength<6||8+headerLength>bytes.length)throw new Error('Incomplete MIDI header.');
 const format=view.getUint16(8),trackCount=view.getUint16(10),division=view.getUint16(12);
 if(format>2)throw new Error('Unsupported MIDI format.');if(!division||(division&0x8000))throw new Error('SMPTE-timed MIDI files are not supported yet.');
 p=8+headerLength;const rawNotes=[],tempos=[{tick:0,us:500000}];
 const readVar=st=>{let v=0,c=0,b;do{if(st.pos>=st.end||c++>4)throw new Error('Corrupt MIDI variable-length value.');b=bytes[st.pos++];v=(v<<7)|(b&127)}while(b&128);return v};
 for(let ti=0;ti<trackCount;ti++){
  if(p+8>bytes.length||ascii(p,4)!=='MTrk')throw new Error('MIDI track '+(ti+1)+' is missing or damaged.');
  const len=view.getUint32(p+4),st={pos:p+8,end:p+8+len};if(st.end>bytes.length)throw new Error('MIDI track '+(ti+1)+' is truncated.');p=st.end;let tick=0,running=0;const active=new Map();
  while(st.pos<st.end){tick+=readVar(st);if(st.pos>=st.end)break;let status=bytes[st.pos];if(status&128){st.pos++;if(status<240)running=status}else{if(!running)throw new Error('MIDI event has no running status.');status=running}
   if(status===255){if(st.pos>=st.end)break;const type=bytes[st.pos++],n=readVar(st);if(st.pos+n>st.end)throw new Error('Damaged MIDI meta event.');if(type===81&&n===3){const us=(bytes[st.pos]<<16)|(bytes[st.pos+1]<<8)|bytes[st.pos+2];if(us)tempos.push({tick,us})}st.pos+=n;continue}
   if(status===240||status===247){st.pos+=readVar(st);continue}
   const cmd=status&240,ch=status&15,n=(cmd===192||cmd===208)?1:2;if(st.pos+n>st.end)throw new Error('Truncated MIDI channel event.');
   const note=bytes[st.pos++],vel=n===2?bytes[st.pos++]:0;
   if(cmd===144&&vel>0){const k=ch+':'+note,q=active.get(k)||[];q.push({tick,note,velocity:vel,channel:ch,track:ti});active.set(k,q)}
   else if(cmd===128||(cmd===144&&vel===0)){const q=active.get(ch+':'+note);if(q?.length){const a=q.shift();rawNotes.push({...a,endTick:Math.max(a.tick,tick)})}}
  }
  for(const q of active.values())for(const a of q)rawNotes.push({...a,endTick:a.tick+Math.max(1,division/2)});
 }
 if(!rawNotes.length)throw new Error('No playable note events were found in this MIDI file.');
 tempos.sort((a,b)=>a.tick-b.tick);const map=tempos.filter((t,i)=>!i||t.tick!==tempos[i-1].tick);
 const secondsAt=target=>{let sec=0,last=0,us=500000;for(const t of map){if(t.tick>=target)break;sec+=(t.tick-last)*us/1e6/division;last=t.tick;us=t.us}return sec+(target-last)*us/1e6/division};
 const first=map.find(t=>t.tick===0)?.us||500000;
 const notes=rawNotes.map((n,i)=>({note:midiToNote(n.note),midi:n.note,time:secondsAt(n.tick),duration:Math.max(.04,secondsAt(n.endTick)-secondsAt(n.tick)),velocity:n.velocity/127,channel:n.channel,track:n.track,rest:false,id:'midi-'+n.track+'-'+i})).sort((a,b)=>a.time-b.time);return {format,division,bpm:60000000/first,notes:assignMidiHands(notes)};
}
const NOTATION_GUIDE = [
 {id:'dynamics',label:'Dynamics: pp, p, mp, mf, f, ff',help:'Very soft → very loud; these are volume instructions.'},
 {id:'crescendo',label:'Crescendo / diminuendo wedges',help:'Hairpin < grows louder; > grows softer over a passage.'},
 {id:'pedal',label:'Pedal markings',help:'Ped. means press sustain pedal; * or a release mark means lift it.'},
 {id:'rests',label:'Rests',help:'A rest symbol means silence for a specific duration.'},
 {id:'rhythm',label:'Note values, flags, beams and dots',help:'Whole, half, quarter, eighth notes and dots change duration.'},
 {id:'accidentals',label:'Sharps, flats, naturals and key signature',help:'♯ raises, ♭ lowers, ♮ cancels; key signature affects notes across the staff.'},
 {id:'articulation',label:'Staccato, accent, tenuto and other articulation',help:'Dots, wedges and lines above/below notes change how they are played.'},
 {id:'ties-slurs',label:'Ties and slurs',help:'A tie joins the same pitch across durations; a slur groups notes smoothly.'},
 {id:'tempo',label:'Tempo and metronome markings',help:'A number such as ♩ = 96 sets the beat speed; words may describe character.'},
 {id:'clefs',label:'Both hands / bass clef / grand staff',help:'Treble is usually the right hand; bass clef is usually the left hand.'},
 {id:'chords',label:'Chords or notes stacked vertically',help:'Two or more noteheads aligned vertically are played together.'},
 {id:'ornaments',label:'Trills, turns, grace notes or fermatas',help:'Decorations add notes or indicate a held/expressive pause.'}
];
function Staff({notes,expanded,bpm=84,timeSignature='4/4',fromStart=false,clef='treble'}) {
 const ref=useRef(null);
 const [renderError,setRenderError]=useState('');
 useEffect(()=>{
  if(!ref.current)return;
  ref.current.innerHTML='';
  setRenderError('');
  try {
   const visible=fromStart?notes.slice(0,12):notes.slice(-12);
   const width=Math.max(expanded?520:330,Math.min(900,visible.length*54+110));
   const renderer=new Renderer(ref.current,Renderer.Backends.SVG);
   renderer.resize(width,expanded?190:150);
   const ctx=renderer.getContext();
   const stave=new Stave(12,18,width-24);
   stave.addClef(clef).addTimeSignature(timeSignature).setContext(ctx).draw();
   const beatSeconds=60/Math.max(30,Number(bpm)||84);
   const durationCode=seconds=>{
    const beats=Math.max(.25,Math.min(4,seconds/beatSeconds));
    if(beats>=3.5)return 'w';
    if(beats>=1.65)return 'h';
    if(beats>=.78)return 'q';
    if(beats>=.36)return '8';
    return '16';
   };
   const tickables=[];
   visible.forEach((n,i)=>{
    const t=Number(n.time)||0,prev=visible[i-1],prevEnd=prev?(Number(prev.time)||0)+(Number(prev.duration)||beatSeconds*.9):t;
    const gap=t-prevEnd;
    if(i>0&&gap>beatSeconds*.6){
     const restBeats=gap/beatSeconds;
     const restCode=restBeats>=1.65?'h':restBeats>=.78?'q':restBeats>=.36?'8':'16';
     tickables.push(new StaveNote({keys:['b/4'],duration:restCode+'r'}));
    }
    const mm=String(n.note||midiToNote(n.midi)||'').match(/^([A-G])(#|b)?(-?\d+)$/);
    const key=mm?mm[1].toLowerCase()+(mm[2]||'')+'/'+mm[3]:'c/4';
    const duration=durationCode(Number(n.duration)>0?Number(n.duration):(Math.max(.12,((Number(visible[i+1]?.time)||t+beatSeconds)-t))*.9));
    tickables.push(new StaveNote({keys:[key],duration}));
   });
   if(tickables.length){
    const voice=new Voice({numBeats:Math.max(4,Math.ceil(tickables.length)),beatValue:4}).setStrict(false);
    voice.addTickables(tickables);
    new Formatter().joinVoices([voice]).format([voice],width-100);
    voice.draw(ctx,stave);
   }
  } catch(e) {
   setRenderError(e?.message||'The staff renderer could not draw these notes.');
  }
 },[notes,expanded,bpm,timeSignature,fromStart]);
 const fallbackNotes=(Array.isArray(notes)?notes:[]).filter(n=>n&&((n.note&&n.note!=='rest')||Number.isFinite(Number(n.midi))||n.rest));
 return <div className="staff-wrap"><div className="staff" ref={ref}/>{!notes.length&&<div className="staff-empty">Your detected notes will appear on the staff here.</div>}{renderError&&fallbackNotes.length>0&&<div className="staff-note-fallback" role="status"><strong>Note events</strong><div>{fallbackNotes.slice(0,48).map((n,i)=><span key={n.id||i}>{n.rest?'Rest':(n.note||midiToNote(n.midi))}{i<fallbackNotes.length-1?' · ':''}</span>)}</div><small>The note data is loaded; the visual staff renderer reported: {renderError}</small></div>}</div>
}
function renderLearnFallingNotes(notes,bpm){return notes.map((note,index,all)=>renderLearnFallingNote(note,index,all,bpm))}
function getLearnStaffNotes(notes,bpm){return notes.map((n,i,phrase)=>({id:n.id||i,note:n.note,midi:n.midi,rest:n.rest,beats:n.beats,time:Math.max(0,(Number(n._start||0)-Number(phrase[0]?._start||0))*(60/bpm)),duration:n.beats*60/bpm,staff:n.staff,part:n.part,voice:n.voice,hand:n.hand}))}
function getLearnHandStaffNotes(notes,hand){const hasGrandStaff=notes.some(n=>Number(n.staff)===2),parts=[...new Set(notes.map(n=>Number(n.part)).filter(Number.isFinite))].sort((a,b)=>a-b);if(parts.length>1)return notes.filter(n=>hand==='left'?parts.slice(1).includes(Number(n.part)):Number(n.part)===parts[0]);if(hasGrandStaff)return notes.filter(n=>hand==='left'?Number(n.staff)===2:(n.staff==null||Number(n.staff)===1));if(notes.some(n=>n.hand==='left'||n.hand==='right'))return notes.filter(n=>n.hand===hand);return notes.filter(n=>hand==='left'?Number(n.midi??noteToMidi(n.note))<60:Number(n.midi??noteToMidi(n.note))>=60)}
function renderLearnPitchLabels(){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'].map(note=><span key={note}>{note}</span>)}
function renderLearnTempoControl(bpm,setBpm){return <div className="learn-tempo-control"><span>Tempo · {bpm} BPM</span><input type="range" min="40" max="240" step="1" value={bpm} onChange={event=>setBpm(Number(event.target.value))} aria-label="Listen and Learn tempo"/></div>}
function renderLearnTempoWarning(scoreNotation){if(!scoreNotation?.sourceMusicXML||musicXmlHasTempo(scoreNotation.sourceMusicXML))return null;return <small className="learn-tempo-warning">The imported MusicXML did not preserve a printed tempo. Check the original page and set this slider to its marked BPM.</small>}
function renderLearnMicConnectButton(listening,startMic,micStream,playLearnPhrase,setLearnMessage){if(listening)return null;return <button className="btn" onClick={async()=>{await startMic();if(micStream.current)await playLearnPhrase();else setLearnMessage('Microphone permission is still off. Check your browser site settings and retry.')}}>🎙 Connect microphone</button>}
function renderLearnNoKeysHint(){return <p className="learn-no-keys">Microphone mode is best for one note at a time. For chords and both hands, connect a USB MIDI piano for direct, accurate note input. MIDI works in Chrome or Edge on HTTPS.</p>}
function renderLearnFullscreenControls(props){const {bpm,setBpm,scoreNotation,listening,startMic,micStream,playLearnPhrase,setLearnMessage,learnMidiConnected,disconnectLearnMidi,connectLearnMidi,level,finishLearnSession}=props;return <div className="learn-fullscreen-controls">{renderLearnTempoControl(bpm,setBpm)}{renderLearnTempoWarning(scoreNotation)}{renderLearnMicConnectButton(listening,startMic,micStream,playLearnPhrase,setLearnMessage)}<button className="btn" onClick={playLearnPhrase}>↻ Repeat sound</button><button className="btn" onClick={learnMidiConnected?disconnectLearnMidi:connectLearnMidi}>{learnMidiConnected?'Disconnect MIDI piano':'Connect MIDI piano'}</button><div className="learn-mic-meter"><span>Mic level</span><div><i style={{width:level+'%'}}/></div><b>{level}%</b></div><button className="btn btn-dark" onClick={finishLearnSession}>Finish lesson</button></div>}
function renderLearnFallingNote(n,i,phrase,bpm){if(n.rest)return null;const match=(n.note||'').match(/^([A-G])(#|b)?(-?\d)$/);const lane=match?Math.max(0,['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(match[1]+(match[2]||''))):0;const beatOffset=Math.max(0,Number(n._start||0)-Number(phrase[0]?._start||0));const beat=Math.max(.25,Number(n.beats)||1);return <div key={n.id||i} className={'falling-note '+(n.staff===2||n.hand==='left'?'falling-note-left':'falling-note-right')+(i===0?' falling-note-next':'')} style={{left:((lane+.5)/12*100)+'%',top:'0px',height:Math.max(28,beat*28)+'px',animationDuration:'2.2s',animationDelay:(beatOffset*60/bpm)+'s'}}><span>{n.note||'Rest'}</span></div>}
function musicXmlHasTempo(xml){return /<sound\b[^>]*\btempo=|<metronome[\s\S]*?<per-minute>/i.test(String(xml||''));}
function requireVexFormatter(){return (globalThis.VexFlow&&globalThis.VexFlow.Formatter)||class {joinVoices(v){return this} format(){} };}
function isValidMusicXML(xmlText){
 if(typeof xmlText!=='string'||!/<score-(?:partwise|timewise)\b/i.test(xmlText))return false;
 try{const doc=new DOMParser().parseFromString(xmlText,'application/xml');return !doc.querySelector('parsererror')&&!!doc.documentElement&&/^score-(?:partwise|timewise)$/i.test(doc.documentElement.localName)}catch{return false}
}
function normalizeMusicXMLTitle(xmlText,title){
 if(!xmlText)return xmlText;
 const parser=new DOMParser(),doc=parser.parseFromString(String(xmlText),'application/xml');
 if(doc.querySelector('parsererror'))return xmlText;
 const isGeneric=value=>!String(value||'').trim()||/^(untitled(?:\\s+score)?|score)$/i.test(String(value||'').trim());
 const existing=doc.querySelector('work-title')?.textContent||doc.querySelector('movement-title')?.textContent||'';
 if(!isGeneric(existing))return xmlText;
 const score=doc.querySelector('score-partwise');
 if(!score)return xmlText;
 let work=score.querySelector(':scope > work');
 if(!work){work=doc.createElement('work');score.insertBefore(work,score.firstChild)}
 let workTitle=work.querySelector(':scope > work-title');
 if(!workTitle){workTitle=doc.createElement('work-title');work.appendChild(workTitle)}
 const safeTitle=String(title||'Sheet music').trim()||'Sheet music';
 workTitle.textContent=safeTitle;
 const movement=doc.querySelector('movement-title');
 if(movement&&isGeneric(movement.textContent))movement.textContent=safeTitle;
 return new XMLSerializer().serializeToString(doc);
}
function ExpandedMusicXMLPlayer({xml,title='Sheet music',onClose}) {
 const host=useRef(null),rendererRef=useRef(null),partRef=useRef(null),playerRef=useRef(null),measureEventsRef=useRef([]);
 const [status,setStatus]=useState('Preparing score…'),[playing,setPlaying]=useState(false),[muted,setMuted]=useState(false),[activeMeasure,setActiveMeasure]=useState(0);
 const [activePage,setActivePage]=useState(1),[totalPages,setTotalPages]=useState(1);
 const activePageRef=useRef(1);
 function getRenderedScorePages(){
  if(!host.current)return [];
  let pages=[...host.current.querySelectorAll('[id^="osmdCanvasPage"]')];
  if(!pages.length)pages=[...host.current.querySelectorAll('.osmd-page,.osmdPage')];
  if(!pages.length){const svg=host.current.querySelector(':scope > svg');if(svg)pages=[svg];}
  return pages;
 }
 function showScorePage(pageNumber,scroll=true){
  const pages=getRenderedScorePages();
  const pageCount=Math.max(1,pages.length);
  const next=Math.max(1,Math.min(pageCount,Number(pageNumber)||1));
  const spreadStart=Math.floor((next-1)/2)*2+1;
  const spreadEnd=Math.min(pageCount,spreadStart+1);
  const pageContainer=pages[0]?.parentElement||host.current;
  if(host.current){
   host.current.classList.add('expanded-score-page-spread');
   host.current.style.width='100%';
   host.current.style.maxWidth='none';
   host.current.style.minWidth='0';
   host.current.style.margin='0 auto';
   host.current.style.boxSizing='border-box';
  }
  if(pageContainer){
   pageContainer.classList.add('expanded-score-pages-grid');
   pageContainer.style.display='grid';
   pageContainer.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
   pageContainer.style.alignItems='start';
   pageContainer.style.gap='clamp(16px,2vw,34px)';
   pageContainer.style.width='100%';
   pageContainer.style.maxWidth='1800px';
   pageContainer.style.margin='0 auto';
   pageContainer.style.boxSizing='border-box';
  }
  pages.forEach((page,index)=>{
   const visible=index+1>=spreadStart&&index+1<=spreadEnd;
   page.style.display=visible?'block':'none';
   page.style.width='100%';
   page.style.minWidth='0';
   page.style.maxWidth='none';
   page.style.margin='0';
   page.style.padding='0';
   page.style.border='0';
   page.style.boxShadow='0 2px 12px rgba(20,20,20,.10)';
   page.style.background='#fff';
   page.style.boxSizing='border-box';
   page.setAttribute('aria-hidden',visible?'false':'true');
   page.setAttribute('data-score-page',String(index+1));
  });
  activePageRef.current=next;
  setActivePage(next);
  if(scroll&&pages[spreadStart-1]){
   const root=host.current?.closest('.score-fullscreen-content')||host.current?.parentElement;
   if(root){
    const top=pages[spreadStart-1].getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop-10;
    root.scrollTo({top:Math.max(0,top),behavior:'smooth'});
   }
  }
 }
 useEffect(()=>{
  let cancelled=false,renderer=null;
  async function render(){
   try{
    if(!xml||!/<score-(?:partwise|timewise)\b/i.test(xml))throw new Error('This file does not contain valid MusicXML.');
    host.current.style.width='100%';host.current.style.maxWidth='none';host.current.style.minWidth='0';host.current.style.margin='0 auto';host.current.style.boxSizing='border-box';
    renderer=new OpenSheetMusicDisplay(host.current,{autoResize:false,pageFormat:'A4_P',newPageFromXML:true,newSystemFromNewPageInXML:true,drawTitle:true,drawSubtitle:true,drawComposer:true,drawPartNames:true,followCursor:false,cursorsOptions:[{type:3,color:'#f0b429',alpha:.38,follow:true}],pageBackgroundColor:'#ffffff',backend:'svg',stretchLastSystemLine:false,renderSingleHorizontalStaffline:false,drawMeasureNumbers:true,drawPartAbbreviations:false});
    await renderer.load(normalizeMusicXMLTitle(xml,title));if(cancelled)return;
    renderer.Zoom=1;renderer.render();rendererRef.current=renderer;
    renderer.enableOrDisableCursors(true);
    renderer.cursors?.forEach(cursor=>cursor.hide());
    const pages=getRenderedScorePages();setTotalPages(Math.max(1,pages.length));showScorePage(1,false);
    setStatus('Full score loaded');
   }catch(e){if(!cancelled)setStatus('Could not render score: '+(e?.message||String(e)));}
  }
  render();
  return()=>{cancelled=true;stop();try{renderer?.clear()}catch{}rendererRef.current=null;if(host.current)host.current.innerHTML=''};
 },[xml,title]);
 function stop(){try{Tone.Transport.stop();Tone.Transport.cancel();partRef.current?.dispose();playerRef.current?.dispose();rendererRef.current?.cursors?.forEach(cursor=>cursor.hide());}catch{}partRef.current=null;playerRef.current=null;setPlaying(false);setActiveMeasure(0);showScorePage(1,false)}
 function parseEvents(){
  const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Invalid MusicXML');
  const parts=[...doc.querySelectorAll('score-partwise > part')];if(!parts.length)throw new Error('No score parts found');
  const tempo=Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo')||doc.querySelector('metronome per-minute')?.textContent)||120;
  let numerator=4,denominator=4,divisions=1,barStarts=[],events=[];
  const first=parts[0];let elapsed=0;
  [...first.querySelectorAll(':scope > measure')].forEach((measure,index)=>{
   const attrs=measure.querySelector(':scope > attributes');const div=Number(attrs?.querySelector(':scope > divisions')?.textContent);if(div>0)divisions=div;
   const beats=Number(attrs?.querySelector(':scope > time > beats')?.textContent);const beatType=Number(attrs?.querySelector(':scope > time > beat-type')?.textContent);if(beats>0)numerator=beats;if(beatType>0)denominator=beatType;
   const beatsPerBar=numerator*4/denominator;barStarts.push({measure:index+1,seconds:elapsed*60/tempo});
   let cursor=0,max=0;
   [...measure.children].forEach(node=>{
    if(node.localName==='backup'||node.localName==='forward'){const d=Number(node.querySelector(':scope > duration')?.textContent)||0;cursor=node.localName==='backup'?Math.max(0,cursor-d):cursor+d;max=Math.max(max,cursor);return;}
    if(node.localName!=='note')return;
    const d=Number(node.querySelector(':scope > duration')?.textContent)||divisions,rest=!!node.querySelector(':scope > rest'),pitch=node.querySelector(':scope > pitch'),step=pitch?.querySelector(':scope > step')?.textContent,alter=Number(pitch?.querySelector(':scope > alter')?.textContent)||0,octave=pitch?.querySelector(':scope > octave')?.textContent,chord=!!node.querySelector(':scope > chord');
    const name=step&&octave!==undefined?step+(alter===1?'#':alter===-1?'b':alter===2?'##':alter===-2?'bb':'')+octave:null;
    const onset=chord?Math.max(0,cursor-d):cursor;
    if(name&&!rest)events.push({time:(elapsed+onset/divisions)*60/tempo,name,duration:Math.max(.06,d/divisions*60/tempo),measure:index+1,velocity:.82});
    if(!chord)cursor+=d;max=Math.max(max,cursor);
   });
   elapsed+=Math.max(max/divisions,beatsPerBar);
  });
  return {events,barStarts,tempo};
 }
 async function play(){
  if(playing){Tone.Transport.pause();setPlaying(false);return;}
  try{
   await Tone.start();
   if(Tone.Transport.state==='paused'){Tone.Transport.start();setPlaying(true);return;}
   stop();
   const data=parseEvents();if(!data.events.length)throw new Error('No playable notes in this score.');
   const player=new Tone.PolySynth(Tone.Synth).toDestination();player.volume.value=muted?-96:0;playerRef.current=player;
   const events=data.events.map(n=>({time:Math.round(n.time*data.tempo/60*Tone.Transport.PPQ)+'i',name:n.name,duration:Math.max(1,Math.round(n.duration*data.tempo/60*Tone.Transport.PPQ))+'i',velocity:n.velocity}));
   const part=new Tone.Part((time,n)=>player.triggerAttackRelease(n.name,n.duration,time,n.velocity),events);part.start(0);partRef.current=part;
   measureEventsRef.current=data.barStarts.map(bar=>Tone.Transport.scheduleOnce(()=>{
    setActiveMeasure(bar.measure);
    const osmd=rendererRef.current;
    // OSMD type 3 is the current-measure area. pageBackgroundColor makes
    // OSMD place its cursor above the SVG; FollowCursor remains disabled.
    const measureCursor=osmd?.cursors?.find(c=>Number(c.CursorOptions?.type)===3)||osmd?.cursors?.[0]||osmd?.cursor;
    try{
     if(measureCursor){
      const targetMeasureIndex=Math.max(0,bar.measure-1);
      let currentMeasureIndex=Number(measureCursor.Iterator?.CurrentMeasureIndex);
      if(!Number.isFinite(currentMeasureIndex)||targetMeasureIndex<currentMeasureIndex){
       measureCursor.reset();
       currentMeasureIndex=Number(measureCursor.Iterator?.CurrentMeasureIndex)||0;
      }
      measureCursor.show();
      let guard=0;
      while(Number(measureCursor.Iterator?.CurrentMeasureIndex)<targetMeasureIndex&&guard++<1000){
       if(typeof measureCursor.nextMeasure==='function')measureCursor.nextMeasure();
       else measureCursor.next();
      }
      measureCursor.update();
      const pageNumber=Number(measureCursor.updateCurrentPage?.()||measureCursor.currentPageNumber||1);
      if(pageNumber!==activePageRef.current)showScorePage(pageNumber,true);
     }
    }catch(error){console.error('Current-measure highlight failed',error);}
   },Math.round(bar.seconds*data.tempo/60*Tone.Transport.PPQ)+'i'));
   Tone.Transport.bpm.value=data.tempo;Tone.Transport.position=0;Tone.Transport.start();setPlaying(true);setStatus('Playing · '+data.tempo+' BPM');
   const end=Math.max(...data.events.map(n=>n.time+n.duration))+.2;
   Tone.Transport.scheduleOnce(()=>{stop();setStatus('Playback finished');},Math.round(end*data.tempo/60*Tone.Transport.PPQ)+'i');
  }catch(e){setStatus('Playback error: '+(e?.message||String(e)));stop();}
 }
 function toggleMute(){const next=!muted;setMuted(next);const volume=playerRef.current?.volume;if(volume)volume.value=next?-96:0;}
 return <section className="expanded-score-player"><div className="expanded-score-toolbar"><div className="expanded-score-controls"><button className="btn btn-dark" onClick={play}>{playing?'Ⅱ Pause':'▶ Play'}</button><button className="btn" onClick={stop}>■ Stop</button><button className="btn" onClick={toggleMute}>{muted?'Unmute':'Mute'}</button></div><div className="expanded-score-progress"><strong>{activeMeasure?('Bar '+activeMeasure):'Ready'}</strong><button type="button" className="btn expanded-score-page-button" disabled={activePage<=1} onClick={()=>showScorePage(activePage-1,true)} aria-label="Previous sheet music page">‹</button><span>Page {activePage} of {totalPages} · {status}</span><button type="button" className="btn expanded-score-page-button" disabled={activePage>=totalPages} onClick={()=>showScorePage(activePage+1,true)} aria-label="Next sheet music page">›</button></div></div><div ref={host} className="musicxml-rendered expanded-score-rendered"/></section>
}


function MusicXMLPreview({xml,title='Sheet music',onExpand}) {
 const host=useRef(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false,renderer=null;
  async function render(){
   try{
    if(!isValidMusicXML(xml))throw new Error('This score has no valid embedded MusicXML. Its editable note data is still saved, but a notation preview could not be generated.');
    renderer=new OpenSheetMusicDisplay(host.current,{autoResize:true,drawTitle:false,drawSubtitle:false,drawComposer:false,drawPartNames:false,backend:'svg',stretchLastSystemLine:true,renderSingleHorizontalStaffline:false});
    await renderer.load(normalizeMusicXMLTitle(xml,title));
    if(cancelled)return;
    renderer.Zoom=0.72;
    renderer.render();
   }catch(e){if(!cancelled)setError(e?.message||'Could not render notation');}
  }
  render();
  return()=>{cancelled=true;try{renderer?.clear()}catch{}if(host.current)host.current.innerHTML=''};
 },[xml,title]);
 return <div className="musicxml-preview-compact"><div ref={host} className="musicxml-rendered"/>{error&&<small role="status">{error}</small>}{onExpand&&<button type="button" className="btn btn-small" onClick={onExpand}>Expand sheet ↗</button>}</div>;
}

function LibraryScorePreview({item,onExpand}) {
 const name=String(item?.name||'').toLowerCase(),type=String(item?.type||item?.mimeType||'').toLowerCase(),kind=String(item?.kind||'').toLowerCase();
 const isMidi=/\.(mid|midi)$/i.test(name)||type==='audio/midi';
 const isImage=kind==='image'||/\.(png|jpe?g|webp|svg|gif|bmp|tiff?)$/i.test(name)||type.startsWith('image/');
 const isAudio=!isMidi&&(['recording','audio','audio-recording','recording-audio'].includes(kind)||/\.(mp3|m4a|mp4|webm|wav|wave|ogg|oga|aac|flac|aiff?|opus)$/i.test(name)||type.startsWith('audio/')||type.startsWith('video/'));
 const canExpand=!isAudio&&typeof onExpand==='function';
 return <div className={"personal-score-art library-file-type-icon "+(isImage?'is-image':isAudio?'is-audio':'is-music')+(canExpand?' is-expandable':'')} aria-label={isImage?'Image file':isAudio?'Audio recording':'Music file'} title={canExpand?'Double-click to open sheet music':'File type'} role={canExpand?'button':undefined} tabIndex={canExpand?0:undefined} onDoubleClick={canExpand?onExpand:undefined} onKeyDown={canExpand?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onExpand()}}:undefined} style={canExpand?{cursor:'zoom-in'}:undefined}>
  {isImage?<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="11" width="46" height="42" rx="6" fill="none" stroke="currentColor" strokeWidth="3"/><circle cx="23" cy="25" r="5" fill="currentColor"/><path d="M13 47l14-14 9 9 7-7 9 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>:isAudio?<svg viewBox="0 0 72 64" aria-hidden="true"><path d="M5 24h8m-8 8h8m-8 8h8m46-16h8m-8 8h8m-8 8h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55"/><circle cx="36" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="3.5"/><circle cx="36" cy="32" r="6" fill="currentColor"/></svg>:<span className="library-music-note" aria-hidden="true">♫</span>}
 </div>;
}

// Sequence tokens support note durations and rests: C4/q D4/h R/q E4/e. Plain notes default to quarters.
function parseMusicSequence(input){const lengths={w:4,whole:4,h:2,half:2,q:1,quarter:1,e:.5,eighth:.5,s:.25,sixteenth:.25};return String(input).trim().split(/[\s,;]+/).filter(Boolean).map((token,index)=>{const m=token.match(/^([A-Ga-g][#b♯♭]?[-]?\d+|r|rest)(?:[/:=](whole|half|quarter|eighth|sixteenth|w|h|q|e|s))?$/i);if(!m)return null;const rest=/^(r|rest)$/i.test(m[1]),midi=rest?null:noteToMidi(m[1]),beats=lengths[(m[2]||'q').toLowerCase()]||1;return {token,note:rest?'rest':m[1],midi,rest,beats,index};}).filter(Boolean)}
function encodeMusicCoach(score){
 // A .musiccoach file is the native container; its notation payload may still
 // contain original MusicXML. Never discard that payload based on sourceFormat.
 const nativeNotation={...(score?.notation||{})};
 if(typeof nativeNotation.sourceMusicXML==='string')nativeNotation.sourceMusicXML=nativeNotation.sourceMusicXML.trim();
 const nativeScore={...score,format:'musiccoach',version:2,notation:nativeNotation};
 return 'MUSICCOACH-SCORE/2\\n'+JSON.stringify(nativeScore,null,2);
}
function scoreNotesToMusicXML(score){
 const notes=Array.isArray(score?.notes)?score.notes.filter(n=>n.note&&!n.rest):[];
 if(!notes.length)return '';
 const mk=(hand,id,clef)=>{const ns=notes.filter(n=>(n.hand||((Number(n.midi??noteToMidi(n.note))<60)?'left':'right'))===hand).sort((a,b)=>(Number(a.time)||0)-(Number(b.time)||0));const body=ns.map(n=>{const m=String(n.note).match(/^([A-G])(#|b)?(-?\d+)$/i);if(!m)return '';return '<note><pitch><step>'+m[1].toUpperCase()+'</step>'+(m[2]==='#'?'<alter>1</alter>':m[2]==='b'?'<alter>-1</alter>':'')+'<octave>'+m[3]+'</octave></pitch><duration>'+Math.max(1,Math.round((Number(n.duration)||.5)*8))+'</duration><type>eighth</type></note>';}).join('');return '<part id="'+id+'"><measure number="1"><attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'+clef+'</sign><line>'+(clef==='G'?2:4)+'</line></clef></attributes>'+body+'</measure></part>';};
 return '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Right hand</part-name></score-part><score-part id="P2"><part-name>Left hand</part-name></score-part></part-list>'+mk('right','P1','G')+mk('left','P2','F')+'</score-partwise>';
}
function decodeMusicCoach(text){
 const source=String(text||'').replace(/^\uFEFF/,'').trimStart();
 const headers=['MUSICCOACH-SCORE/2\n','PIANOCOACH-MIX/1\n'];
 const header=headers.find(value=>source.startsWith(value));
 let score;
 try{score=JSON.parse(header?source.slice(header.length):source)}catch{throw new Error('This .musiccoach file is not valid JSON score data.')}
 if(score?.format!=='musiccoach'||!Array.isArray(score.notes))throw new Error('The .musiccoach score data is incomplete or invalid.');
 return score;
}
export default function App(){
 const [page,setPage]=useState('Dashboard');
 const [compactViewport,setCompactViewport]=useState(()=>typeof window!=='undefined'&&window.innerWidth<900);
 const [continueOnSmallScreen,setContinueOnSmallScreen]=useState(false);
 useEffect(()=>{const update=()=>{const compact=window.innerWidth<900;setCompactViewport(compact);if(!compact)setContinueOnSmallScreen(false)};update();window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update)},[]);
 const [practiceMode,setPracticeMode]=useState(()=>{try{return localStorage.getItem('pc_practice_mode')==='learn'?'learn':'normal'}catch{return 'normal'}});
 const [fullscreenScore,setFullscreenScore]=useState(null);
 const [libraryFullscreenItem,setLibraryFullscreenItem]=useState(null);
 const [cookieChoice,setCookieChoice]=useState(()=>{try{const v=JSON.parse(localStorage.getItem('pc_cookie_consent')||'null');return v?.choice==='accept'?v:null}catch{return null}});
 const [cookiePrefs,setCookiePrefs]=useState(()=>{try{return JSON.parse(localStorage.getItem('pc_cookie_prefs')||'{"essential":true,"preferences":false,"analytics":false}')}catch{return {essential:true,preferences:false,analytics:false}}});
 const [cookieSettingsOpen,setCookieSettingsOpen]=useState(false);
 const [practiceStarted,setPracticeStarted]=useState(false),[songTitle,setSongTitle]=useState(''),[practiceMinutes,setPracticeMinutes]=useState('15'),[reflection,setReflection]=useState(''),[practiceFeedback,setPracticeFeedback]=useState(''),[remainingSeconds,setRemainingSeconds]=useState(0);
 const [libraryFiles,setLibraryFiles]=useState(()=>{try{const value=JSON.parse(localStorage.getItem('pc_files')||'[]');return (Array.isArray(value)?value:[]).filter(isSheetMusicLibraryItem)}catch{return[]}});
 const [libraryHydrated,setLibraryHydrated]=useState(false),[scoreLibraryExpanded,setScoreLibraryExpanded]=useState(false);
 const [extraTool,setExtraTool]=useState('keyboard');
 const [keyboardStart,setKeyboardStart]=useState('C3'),[keyboardOctaves,setKeyboardOctaves]=useState(3);
 const [musicChat,setMusicChat]=useState([]),[musicChatInput,setMusicChatInput]=useState(''),[musicChatBusy,setMusicChatBusy]=useState(false);
 const [archiveResults,setArchiveResults]=useState([]),[commonsResults,setCommonsResults]=useState([]),[sourceSearchStatus,setSourceSearchStatus]=useState('');
 const [libraryPlayback,setLibraryPlayback]=useState({id:null,kind:'',paused:true});
 const audioLibraryRefs=useRef({}),songAudioRefs=useRef({}),tempoDetectionCacheRef=useRef({});


 const musicDataInputRef=useRef(null);
 const [scoreNotation,setScoreNotation]=useState(null),[scoreSourceAsset,setScoreSourceAsset]=useState(null);
 const [loadedScoreNotes,setLoadedScoreNotes]=useState([]);
 const [musicCoachBusy,setMusicCoachBusy]=useState(false),[musicCoachStatus,setMusicCoachStatus]=useState('Upload a clear PNG/PDF score, MusicXML, MIDI or an MP3, M4A, WAV, MP4 or WebM recording to create an editable .musiccoach file.'),[musicCoachAnalysis,setMusicCoachAnalysis]=useState(''),[musicCoachNotes,setMusicCoachNotes]=useState([]);
 const [scoreDropActive,setScoreDropActive]=useState(false);
 useEffect(()=>{const hasFiles=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');const preventBrowserOpen=e=>{if(hasFiles(e))e.preventDefault()};window.addEventListener('dragover',preventBrowserOpen);window.addEventListener('drop',preventBrowserOpen);return()=>{window.removeEventListener('dragover',preventBrowserOpen);window.removeEventListener('drop',preventBrowserOpen)}},[]);
 const [conversionSavedNotice,setConversionSavedNotice]=useState(false),[songTempo,setSongTempo]=useState(120),[songMeter,setSongMeter]=useState('4/4'),[songTempoStatus,setSongTempoStatus]=useState('Source tempo is detected when a recording starts playing.');
 const songTempoRef=useRef(songTempo),songMeterRef=useRef(songMeter);
 useEffect(()=>{songTempoRef.current=songTempo;songMeterRef.current=songMeter},[songTempo,songMeter]);
 useEffect(()=>{
  const apply=(id,audio)=>{
   if(!audio)return;
   audio.playbackRate=getSongPlaybackRate(songTempo,songMeter,tempoDetectionCacheRef.current[id]||120);
   audio.preservesPitch=true;
   audio.webkitPreservesPitch=true;
  };
  Object.entries(songAudioRefs.current||{}).forEach(([id,audio])=>apply(id,audio));
  Object.entries(audioLibraryRefs.current||{}).forEach(([id,audio])=>apply(id,audio));
 },[songTempo,songMeter]);
 const [musicCoachMarkings,setMusicCoachMarkings]=useState([]);
 const [events,setEvents]=useState([]);
 const [expected,setExpected]=useState('C4 D4 E4 G4');
 const [mode,setMode]=useState('Free practice');
 const [bpm,setBpm]=useState(84);
  const [timeSignature,setTimeSignature]=useState('4/4');
 const [sheetPianoOpen,setSheetPianoOpen]=useState(false),[learnListenMode,setLearnListenMode]=useState(false),[learnBarProgress,setLearnBarProgress]=useState(0),[learnMessage,setLearnMessage]=useState('Turn on Listen & Learn to practise a bar at a time.'),[learnSeconds,setLearnSeconds]=useState(0),[learnPhraseOffset,setLearnPhraseOffset]=useState(0),[learnView,setLearnView]=useState('staff'),[learnHand,setLearnHand]=useState('both'),[learnChunkDivision,setLearnChunkDivision]=useState(1);
 const [activeScoreId,setActiveScoreId]=useState(null);
 const [learnMidiConnected,setLearnMidiConnected]=useState(false),[learnMidiName,setLearnMidiName]=useState(''),[learnAnimationKey,setLearnAnimationKey]=useState(0);
 const [volume,setVolume]=useState(65);
 const [status,setStatus]=useState('Ready to play');
 const [micStatus,setMicStatus]=useState('Microphone is off');
 const [level,setLevel]=useState(0);
 const [listening,setListening]=useState(false);
 const [recording,setRecording]=useState(null),[isRecording,setIsRecording]=useState(false),[isAnalyzing,setIsAnalyzing]=useState(false),[recordingSeconds,setRecordingSeconds]=useState(0),[audioError,setAudioError]=useState('');
 const [metronome,setMetronome]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [heldKeys,setHeldKeys]=useState({});
 const [search,setSearch]=useState('');
 const [liveFeedback,setLiveFeedback]=useState(false);
 const [tutorQuestion,setTutorQuestion]=useState('');
 const [tutorAnswer,setTutorAnswer]=useState('');
 const [tutorBusy,setTutorBusy]=useState(false);
 const [tutorStatus,setTutorStatus]=useState('AI tutor loads on demand.');
 const [songQuery,setSongQuery]=useState('');
 const [songResults,setSongResults]=useState([]),[referenceSong,setReferenceSong]=useState(null),[referenceStatus,setReferenceStatus]=useState('Song reference not loaded');
 const [practiceReferenceResults,setPracticeReferenceResults]=useState([]),[practiceReferenceOpen,setPracticeReferenceOpen]=useState(false),[practiceReferenceBusy,setPracticeReferenceBusy]=useState(false),[practiceReferenceError,setPracticeReferenceError]=useState('');
 const [songBusy,setSongBusy]=useState(false);
 const [practiceScoreName,setPracticeScoreName]=useState('');
 const [practiceLibraryPicker,setPracticeLibraryPicker]=useState(false),[practiceLibrarySearch,setPracticeLibrarySearch]=useState('');
 const [practiceScoreError,setPracticeScoreError]=useState('');
 const [scoreImageUrl,setScoreImageUrl]=useState('');
 const [cameraOpen,setCameraOpen]=useState(false),[cameraError,setCameraError]=useState(''),[cameraBusy,setCameraBusy]=useState(false);
 const cameraVideoRef=useRef(null),cameraStreamRef=useRef(null);
 useEffect(()=>()=>{if(cameraStreamRef.current)cameraStreamRef.current.getTracks().forEach(track=>track.stop());},[]);
 const [scoreImageName,setScoreImageName]=useState('');
 const [scoreIsPdf,setScoreIsPdf]=useState(false);
 const [scoreOcrStatus,setScoreOcrStatus]=useState('No score loaded yet. Upload a PDF/image or import MusicXML to begin.');
 const [scoreOcrWarning,setScoreOcrWarning]=useState('');
 const [sessions,setSessions]=useState(()=>{try{const value=JSON.parse(localStorage.getItem('pc_sessions')||'[]');return Array.isArray(value)?value:[]}catch{return[]}});
 const [editingSessionId,setEditingSessionId]=useState(null),[libraryTab,setLibraryTab]=useState('recordings');
 const [saved,setSaved]=useState(()=>{try{const value=JSON.parse(localStorage.getItem('pc_studies')||'[]');return Array.isArray(value)?value:[]}catch{return[]}});
 const synth=useRef(null), mic=useRef(null), analyser=useRef(null), micStream=useRef(null), raf=useRef(null), beatLoop=useRef(null), sequenceLoop=useRef(null), startTime=useRef(0), sessionEvents=useRef([]), recorderRef=useRef(null), chunksRef=useRef([]), recordingTimer=useRef(null), autoAnalyzeRef=useRef(false), analyseBlobRef=useRef(null), practiceTimerRef=useRef(null), midiPlaybackRef=useRef(null);
 const [targetIndex,setTargetIndex]=useState(0);
 const learnProgressRef=useRef(0),learnPhraseOffsetRef=useRef(0),learnNoteLockRef=useRef(0),learnModeRef=useRef(false),learnChordHitsRef=useRef({key:'',hits:[]}),learnMidiAccessRef=useRef(null);
 const learnMicInputRef=useRef(null),learnMicActiveNoteRef=useRef(null),learnMicCandidateRef=useRef(null),learnMicCandidateFramesRef=useRef(0),learnMicLastSeenRef=useRef(0);
 const heldKeysRef=useRef({});
 const heldComputerKeysRef=useRef({});
 const targets=useMemo(()=>parseMusicSequence(expected),[expected]);
 const actual=events;
 const loadedScoreMusicXML=useMemo(()=>{
  if(isValidMusicXML(scoreNotation?.sourceMusicXML))return scoreNotation.sourceMusicXML;
  if(!loadedScoreNotes.length)return '';
  try{return midiNotesToMusicXML(loadedScoreNotes,bpm,timeSignature,songTitle||'Piano Coach score')}catch{return ''}
 },[scoreNotation,loadedScoreNotes,bpm,timeSignature,songTitle]);
 const comparison=useMemo(()=>compareSequences(expected,actual),[expected,actual]);
 useEffect(()=>{Tone.getDestination().volume.value=20*Math.log10(Math.max(.01,volume/100));},[volume]);
 useEffect(()=>{try{localStorage.setItem('pc_practice_mode',practiceMode)}catch{}},[practiceMode]);
 useEffect(()=>{try{localStorage.setItem('pc_sessions',JSON.stringify(sessions))}catch(e){setStatus('Practice sessions could not be saved in this browser. Export a .musicdata backup and free some storage.')}},[sessions]);
 useEffect(()=>{try{localStorage.setItem('pc_studies',JSON.stringify(saved))}catch{}},[saved]);
 useEffect(()=>{let active=true;loadBrowserScoreLibrary().then(items=>{if(!active)return;setLibraryFiles(Array.isArray(items)?items:[]);setLibraryHydrated(true)}).catch(()=>{if(active)setLibraryHydrated(true)});return()=>{active=false}},[]);
 useEffect(()=>{if(!libraryHydrated)return;saveBrowserScoreLibrary(libraryFiles).catch(error=>setStatus(error.message||'This score could not be saved in browser storage. Export a .musicdata backup.'))},[libraryFiles,libraryHydrated]);
 useEffect(()=>{if(!practiceStarted||remainingSeconds<=0)return;practiceTimerRef.current=setInterval(()=>setRemainingSeconds(v=>{if(v<=1){clearInterval(practiceTimerRef.current);practiceTimerRef.current=null;stopRecording();stopMic();setStatus('Practice time is up · reviewing your recording');return 0}return v-1}),1000);return()=>{if(practiceTimerRef.current)clearInterval(practiceTimerRef.current)}},[practiceStarted,remainingSeconds>0]);
 useEffect(()=>{if(!learnListenMode)return;const id=setInterval(()=>setLearnSeconds(v=>{const next=v+1;if(next===900)setLearnMessage('15-minute practice goal reached. You can continue, save for later or finish whenever you are ready.');return next}),1000);return()=>clearInterval(id)},[learnListenMode]);
 useEffect(()=>()=>{stopMic();stopPlayback();stopMetro();stopMidiLibraryPlayback();if(synth.current)synth.current.dispose();},[]);
 async function ensureSynth(){
  await Tone.start();
  if(!synth.current)synth.current=new Tone.PolySynth(Tone.Synth,{maxPolyphony:32,oscillator:{type:'triangle'},envelope:{attack:.015,decay:.22,sustain:.18,release:1.1},volume:-9}).toDestination();
  return synth.current;
 }
 async function playNote(note,duration='8n'){
  const midi=typeof note==='number'?note:noteToMidi(note);
  if(midi===null||midi<21||midi>108)return;
  const s=await ensureSynth();const n=midiToNote(midi);
  s.triggerAttackRelease(n,duration);
 }
 async function playSequence(){
  stopPlayback(); if(!targets.length){setStatus('Enter notes such as C4/q D4/h R/q first.');return}
  await ensureSynth();setPlaying(true);setStatus('Playing score with note values and rests');
  let elapsed=0;const beat=60/bpm;const scheduled=[];
  targets.forEach((item,index)=>{const at=elapsed*beat;if(!item.rest&&item.midi!==null)scheduled.push(Tone.Transport.scheduleOnce(time=>{synth.current?.triggerAttackRelease(midiToNote(item.midi),Math.max(.08,item.beats*beat*.88),time);Tone.Draw.schedule(()=>setTargetIndex(index),time)},'+'+at));elapsed+=item.beats;});
  scheduled.push(Tone.Transport.scheduleOnce(()=>{Tone.Transport.stop();Tone.Transport.cancel();setPlaying(false);setStatus('Score playback finished')},'+'+(elapsed*beat+.05)));
  Tone.Transport.bpm.value=bpm;Tone.Transport.start();sequenceLoop.current={dispose:()=>{scheduled.forEach(id=>{try{Tone.Transport.clear(id)}catch{}})}};
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
   micStream.current=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
   const ctx=Tone.getContext().rawContext;
   if(ctx.state==='suspended')await ctx.resume();
   mic.current=ctx.createMediaStreamSource(micStream.current);analyser.current=ctx.createAnalyser();analyser.current.fftSize=8192;analyser.current.smoothingTimeConstant=0;mic.current.connect(analyser.current);
   setListening(true);setMicStatus('Microphone connected · play one note clearly to test pitch detection');setStatus('Microphone active — waiting for input');
   startTime.current=Date.now();sessionEvents.current=sessionEvents.current.filter(e=>e.source!=='microphone');sampleMic();if(practiceStarted&&!learnModeRef.current)setTimeout(()=>{if(micStream.current&&!isRecording&&!learnModeRef.current)startRecording()},350);
  }catch(e){setMicStatus(e.name==='NotAllowedError'?'Microphone permission denied. Allow access in your browser settings.':'Could not start microphone: '+e.message)}
 }
 function sampleMic(){
  if(!analyser.current||!micStream.current)return;
  const data=new Float32Array(analyser.current.fftSize);analyser.current.getFloatTimeDomainData(data);
  let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];const rms=Math.sqrt(sum/data.length);setLevel(Math.min(100,Math.round(rms*320)));
  let detectedMidi=null;
  if(rms>.009){
   const freq=autoCorrelate(data,Tone.getContext().sampleRate);
   if(freq>65&&freq<1100){
    const midi=Math.round(69+12*Math.log2(freq/440));
    if(midi>=36&&midi<=96)detectedMidi=midi;
   }
  }
  if(learnModeRef.current&&learnMicInputRef.current){
   const now=Date.now();
   if(detectedMidi!==null){
    learnMicLastSeenRef.current=now;
    if(learnMicCandidateRef.current===detectedMidi)learnMicCandidateFramesRef.current++;
    else{learnMicCandidateRef.current=detectedMidi;learnMicCandidateFramesRef.current=1;}
    // Require a stable pitch over several audio frames to reject piano transients
    // and short-lived harmonic jumps before passing a note to the learning engine.
    if(learnMicCandidateFramesRef.current>=4&&learnMicActiveNoteRef.current!==detectedMidi){
     if(learnMicActiveNoteRef.current!==null)learnMicInputRef.current?.noteUp(learnMicActiveNoteRef.current);
     learnMicActiveNoteRef.current=detectedMidi;
     learnMicInputRef.current?.noteDown(detectedMidi);
     const note=midiToNote(detectedMidi),event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi:detectedMidi,time:((now-startTime.current)/1000).toFixed(2),timeMs:now,source:'microphone'};
     sessionEvents.current.push(event);setEvents([...sessionEvents.current]);
    }
   }else{
    learnMicCandidateRef.current=null;learnMicCandidateFramesRef.current=0;
    if(learnMicActiveNoteRef.current!==null&&now-learnMicLastSeenRef.current>180){
     learnMicInputRef.current?.noteUp(learnMicActiveNoteRef.current);learnMicActiveNoteRef.current=null;
    }
   }
  }else if(detectedMidi!==null){
   const note=midiToNote(detectedMidi),last=sessionEvents.current[sessionEvents.current.length-1];
   if(!last||last.note!==note||Date.now()-last.timeMs>500){
    const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi:detectedMidi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'microphone'};
    sessionEvents.current.push(event);setEvents([...sessionEvents.current]);
    const micCount=sessionEvents.current.filter(e=>e.source==='microphone').length,expectedNote=targets[Math.min(micCount-1,targets.length-1)];
    if(liveFeedback&&targets.length){const matched=expectedNote?.midi===detectedMidi;setTargetIndex(Math.min(micCount,targets.length));setStatus(matched?'Live feedback · correct '+note:'Live feedback · heard '+note+' · expected '+(expectedNote?midiToNote(expectedNote.midi):'end of sequence'));}
    else setStatus('Detected '+note);
   }
  }
  raf.current=requestAnimationFrame(sampleMic);
 }
 function stopMic(){
  if(recorderRef.current&&recorderRef.current.state!=='inactive'){try{recorderRef.current.stop()}catch{}}
  if(recordingTimer.current)clearInterval(recordingTimer.current);recordingTimer.current=null;
  if(raf.current)cancelAnimationFrame(raf.current);raf.current=null;
  if(learnMicActiveNoteRef.current!==null){learnMicInputRef.current?.noteUp(learnMicActiveNoteRef.current);learnMicActiveNoteRef.current=null;}
  learnMicCandidateRef.current=null;learnMicCandidateFramesRef.current=0;learnMicLastSeenRef.current=0;
  micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;
  try{mic.current?.disconnect();analyser.current?.disconnect()}catch{}
  mic.current=null;analyser.current=null;setListening(false);setIsRecording(false);setLevel(0);setMicStatus('Microphone is off');
 }

 function startRecording(){
  if(!micStream.current){setAudioError('Enable the microphone before recording.');return}
  if(typeof MediaRecorder==='undefined'){setAudioError('Recording is not supported in this browser.');return}
  try{
   chunksRef.current=[];
   const type=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t));
   const rec=new MediaRecorder(micStream.current,type?{mimeType:type}:undefined);
   recorderRef.current=rec;
   rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};
   rec.onstop=()=>{
    const blob=new Blob(chunksRef.current,{type:rec.mimeType||'audio/webm'});
    setRecording(blob);setIsRecording(false);
    const recordingExtension=/mp4/i.test(blob.type)?'.m4a':'.webm';
    try{
     const reader=new FileReader();
     reader.onload=()=>{
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const item={id:Date.now(),name:(songTitle||'Practice recording')+' '+stamp+recordingExtension,type:blob.type||'audio/webm',size:blob.size,data:reader.result,added:new Date().toISOString(),kind:'recording'};
      setLibraryFiles(v=>[item,...v]);
     };
     reader.readAsDataURL(blob);
    }catch{}
    if(recordingTimer.current)clearInterval(recordingTimer.current);
    recordingTimer.current=null;
    setStatus('Recording ready · converting into sheet music…');
    if(autoAnalyzeRef.current){autoAnalyzeRef.current=false;analyseBlobRef.current?.(blob)}
   };
   rec.start();setIsRecording(true);setRecordingSeconds(0);setAudioError('');
   setStatus('Recording microphone audio · max 3 minutes');
   recordingTimer.current=setInterval(()=>setRecordingSeconds(n=>{
    if(n>=179){if(recorderRef.current?.state==='recording')stopRecording();setAudioError('Recording reached the 3-minute safety limit. Your recording is being analysed now.');return 180}
    return n+1;
   }),1000);
  }catch(e){setAudioError('Could not start recording: '+e.message)}
 }
 function stopRecording(){if(recorderRef.current&&recorderRef.current.state!=='inactive'){autoAnalyzeRef.current=true;recorderRef.current.stop()}else setIsRecording(false);if(recordingTimer.current)clearInterval(recordingTimer.current);recordingTimer.current=null}
 function detectRecordedPitch(buffer,sampleRate){
  let rms=0;for(const v of buffer)rms+=v*v;rms=Math.sqrt(rms/buffer.length);if(rms<.015)return null;
  let bestOffset=-1,bestCorrelation=0;const minOffset=Math.floor(sampleRate/1000),maxOffset=Math.min(Math.floor(sampleRate/65),buffer.length-1);
  for(let offset=minOffset;offset<=maxOffset;offset+=2){let correlation=0,count=0;for(let i=0;i<buffer.length-offset;i+=4){correlation+=1-Math.abs(buffer[i]-buffer[i+offset]);count++}correlation/=Math.max(1,count);if(correlation>bestCorrelation){bestCorrelation=correlation;bestOffset=offset}}
  return bestOffset>0&&bestCorrelation>.55?sampleRate/bestOffset:null
 }
 async function analyseRecording(){
  if(!recording||isAnalyzing)return;
  if(typeof analyseBlobRef.current!=='function'){setAudioError('The recording-to-score converter is not ready. Please retry.');return}
  await analyseBlobRef.current(recording);
 }
 analyseBlobRef.current=async(blob)=>{setIsAnalyzing(true);setAudioError('');setPracticeFeedback('Listening to your performance and preparing personalised feedback…');setStatus('Analysing performance automatically…');let referenceSummary='No reference recording was available for this piece.';let audioNativeFeedback='';try{const transcription=await transcribeAudioBlob(blob,message=>setStatus('Converting your recording · '+message));const recordingBpm=Math.max(20,Number(transcription.bpm)||Number(bpm)||120);const ev=transcription.notes.map((n,i)=>({...n,id:'rec-'+Date.now()+'-'+i,time:Number(n.time).toFixed(2),timeMs:Date.now()+Math.round(n.time*1000),source:'recording'}));sessionEvents.current=ev;setEvents(ev);const meter=String(timeSignature||'4/4').split('/').map(Number),beatsPerBar=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));let generatedScore=null;if(ev.length){const recordingTitle=songTitle||'Practice recording';const scoreNotes=ev.map((n,i)=>({...n,id:n.id||'rec-'+i,beats:Math.max(.0625,(Number(n.duration)||60/recordingBpm)/(60/recordingBpm)),measure:Math.floor((Number(n.time)||0)/(60/recordingBpm*beatsPerBar))+1,rest:false}));const notation={sourceFormat:'Audio transcription',sourceMusicXML:midiNotesToMusicXML(scoreNotes,recordingBpm,timeSignature,recordingTitle),notationEvents:[],technicalSupport:['polyphonic audio transcription','detected pitch and onset timing','left and right hand grand-staff layout','multi-measure notation']};generatedScore={format:'musiccoach',version:2,title:recordingTitle,bpm:recordingBpm,timeSignature,created:new Date().toISOString(),source:'Local recording transcription',notes:scoreNotes,notation};setScoreNotation(notation);setScoreSourceAsset(null);setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false);setLoadedScoreNotes(scoreNotes);setMusicCoachNotes(scoreNotes);setSongTitle(recordingTitle);setBpm(recordingBpm);setSongTempo(recordingBpm);setMusicCoachStatus('Recording converted into '+scoreNotes.length+' note events and saved as a full editable sheet music score.');const scoreJson=encodeMusicCoach(generatedScore);const scoreData='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(scoreJson)));setLibraryTab('practice-scores');setLibraryFiles(v=>[{id:Date.now(),name:generatedScore.title+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:new Blob([scoreJson]).size,data:scoreData,added:new Date().toISOString(),kind:'practice-score',score:generatedScore},...v.filter(x=>x.name!==generatedScore.title+'.musiccoach')]);setConversionSavedNotice(true);}let refInfo=referenceSong;if(!refInfo&&songTitle.trim())refInfo=await loadSongReference(songTitle);if(refInfo?.preview){setReferenceStatus('Comparing with reference preview: '+refInfo.title+'…');try{const audioResponse=await fetch(refInfo.preview);if(!audioResponse.ok)throw Error('Could not fetch reference audio');const refNotes=await transcribeAudioBlob(await audioResponse.blob(),message=>setReferenceStatus('Analysing reference audio · '+message)),comparison=compareToSongReference(ev,refNotes.notes);if(!comparison)throw Error('Not enough notes to compare');referenceSummary='Reference audio excerpt '+refInfo.title+' by '+refInfo.artist+': best aligned pitch-class match '+comparison.score+'% across '+comparison.total+' notes. Best-matching passage: '+Math.floor(comparison.matchedStartSeconds/60)+':'+String(Math.floor(comparison.matchedStartSeconds%60)).padStart(2,'0')+'–'+Math.floor(comparison.matchedEndSeconds/60)+':'+String(Math.floor(comparison.matchedEndSeconds%60)).padStart(2,'0')+'. This is pitch-class matching, not a full rhythm, octave or expression grade.';setReferenceStatus('Reference comparison complete · '+comparison.score+'% approximate similarity')}catch(e){referenceSummary='Reference comparison unavailable: '+e.message;setReferenceStatus(referenceSummary)}}else setReferenceStatus(referenceSummary);if(!ev.length){const msg='I could not confidently detect notes in this recording. Try recording with the piano closer to the microphone, reduce background noise, and play a short passage clearly.';setPracticeFeedback(msg);setAudioError(msg);setStatus('Analysis finished · no clear notes detected');return}setStatus('Running local audio review…');try{audioNativeFeedback=await requestLocalAudioCoachFeedback(blob,songTitle||'Untitled practice',expected,ev);setTutorStatus('Local audio model review complete.')}catch(audioErr){audioNativeFeedback='Local audio model review unavailable: '+audioErr.message;setTutorStatus(audioNativeFeedback)}const targetCheck=compareSequences(expected,ev);const times=ev.map(n=>Number(n.time)).filter(Number.isFinite),gaps=times.slice(1).map((t,i)=>t-times[i]).filter(t=>t>.06&&t<3),medianGap=gaps.length?[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)]:null,durations=ev.map(n=>Number(n.duration)).filter(d=>Number.isFinite(d)&&d>0),pitches=ev.map(n=>Number(n.midi)).filter(Number.isFinite),evidence='Piece: '+(songTitle||'Untitled practice')+'. This feedback is based on audio processed by a polyphonic audio-to-note model, not just keyboard note data. Detected '+ev.length+' note events. First events with onset times and detected note lengths: '+ev.slice(0,100).map(n=>n.note+' at '+Number(n.time).toFixed(2)+'s'+(Number(n.duration)>0?' for '+Number(n.duration).toFixed(2)+'s':'')).join(', ')+'. Estimated median onset spacing: '+(medianGap?medianGap.toFixed(2)+' seconds':'not enough reliable onsets')+'. Detected pitch range: '+(pitches.length?midiToNote(Math.min(...pitches))+' to '+midiToNote(Math.max(...pitches)):'unavailable')+'. '+(durations.length?'Median detected note duration: '+[...durations].sort((a,b)=>a-b)[Math.floor(durations.length/2)].toFixed(2)+' seconds. ':'')+'Target notes entered by learner: '+(expected||'none')+'. Target comparison: '+JSON.stringify(targetCheck)+'. Reference comparison: '+JSON.stringify(referenceSummary)+'. '+referenceSummary;try{if(!window.PianoCoachAI)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/ai-tutor.js';script.onload=resolve;script.onerror=()=>reject(new Error('AI tutor script failed to load'));document.head.appendChild(script)});if(!window.PianoCoachAI?.ask)throw new Error('AI tutor is not available');const result=await window.PianoCoachAI.ask('You are the learner’s piano coach. The recording was analysed locally in the browser. Use only the measured waveform and note/onset/duration evidence below; do not claim subjective listening or infer musical expression that was not measured. Give 2–3 concrete next steps. AUDIO MODEL REVIEW: '+audioNativeFeedback+'\nTRANSCRIPTION EVIDENCE: '+evidence,{max_new_tokens:120,onProgress:p=>setStatus(p?.message||'AI is preparing feedback from audio review…')});setPracticeFeedback((audioNativeFeedback?'Direct audio review: '+audioNativeFeedback+'\n\n':'')+(result.answer||'The AI did not return feedback. '+evidence));setTutorStatus('Automatic post-recording feedback complete.');setStatus('Analysis and AI feedback complete · '+ev.length+' note events')}catch(aiError){const fallback=targetCheck?.total?'Detected '+ev.length+' note events. Entered-target comparison: '+targetCheck.correct+' of '+targetCheck.total+' target notes matched. '+referenceSummary+' AI feedback could not load ('+aiError.message+'). Try again with a connection, or use Ask AI tutor below.':'Detected '+ev.length+' note events. '+referenceSummary+' AI feedback could not load ('+aiError.message+'). The detector can estimate pitches, but cannot reliably judge expression or full polyphonic accuracy.';setPracticeFeedback(fallback);setStatus('Pitch analysis complete · AI feedback unavailable');setTutorStatus('Automatic AI feedback unavailable: '+aiError.message)}}catch(e){const fallbackEvents=(sessionEvents.current||[]).filter(n=>n.note&&n.midi!=null).map((n,i)=>({...n,id:n.id||'fallback-'+i,time:Number(n.time)||i*.5,duration:Number(n.duration)||60/bpm,source:'microphone'}));if(fallbackEvents.length){const fallbackScore={format:'musiccoach',version:1,title:(songTitle||'Practice recording')+' (pitch tracker draft)',bpm,timeSignature,created:new Date().toISOString(),source:'Live microphone pitch-tracker fallback · review accuracy',notes:fallbackEvents.map((n,i)=>({...n,beats:Math.max(.25,(Number(n.duration)||60/bpm)/(60/bpm)),measure:Math.floor((Number(n.time)||0)/(60/bpm*Math.max(1,Number(timeSignature.split('/')[0]))))+1,rest:false}))};const json=encodeMusicCoach(fallbackScore),data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(json)));setLibraryTab('practice-scores');setLibraryFiles(v=>[{id:Date.now(),name:fallbackScore.title+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:json.length,data,added:new Date().toISOString(),kind:'practice-score',score:fallbackScore},...v.filter(x=>x.name!==fallbackScore.title+'.musiccoach')]);setPracticeFeedback('Advanced audio transcription failed: '+e.message+' A draft .musiccoach score was saved from the live single-note pitch tracker. Please review it; overlapping chords may be missing.');setStatus('Saved a pitch-tracker draft score')}else{setAudioError('Automatic analysis failed: '+e.message);setPracticeFeedback('The recording analysis failed: '+e.message);setStatus('Analysis failed')}}finally{setIsAnalyzing(false)}};
 function playRecording(){if(!recording)return;const url=URL.createObjectURL(recording),audio=new Audio(url);audio.onended=()=>URL.revokeObjectURL(url);audio.onerror=()=>{URL.revokeObjectURL(url);setAudioError('Recording playback failed.')};audio.play().catch(()=>{URL.revokeObjectURL(url);setAudioError('Recording playback was blocked by the browser.')})}
 function autoCorrelate(buf,sampleRate){
  let rms=0;for(let i=0;i<buf.length;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/buf.length);if(rms<.006)return -1;
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
 async function askTutor(){
  if(!tutorQuestion.trim()||tutorBusy)return;setTutorBusy(true);setTutorAnswer('');setTutorStatus('Loading the on-device AI model; first use may download model files.');
  try{const assistant=await ensurePianoCoachAI();const prompt='Piano practice data: mode '+mode+'; target '+expected+'; recent detected notes '+events.slice(-20).map(e=>e.note+' at '+e.time+'s').join(', ')+'; pitch match '+comparison.correct+' of '+comparison.total+' target notes. Learner asks: '+tutorQuestion+'. Give specific, encouraging advice using only this evidence.';const result=await Promise.race([assistant.ask(prompt,{onProgress:p=>setTutorStatus(p.message||'AI is working…')}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('The AI tutor did not respond within 90 seconds. Please retry.')),90000))]);setTutorAnswer(result.answer);setTutorStatus('Local AI ready · '+(result.device||'browser model'));}catch(e){setTutorStatus('AI unavailable: '+e.message)}finally{setTutorBusy(false)}
 }
function changeSongTempo(value){
  const next=Math.max(20,Math.min(240,Number(value)||120));
  songTempoRef.current=next;
  setSongTempo(next);
  setBpm(next);
  Tone.Transport.bpm.value=next;
  Object.entries(songAudioRefs.current||{}).forEach(([id,audio])=>{if(audio){audio.playbackRate=getSongPlaybackRate(next,songMeterRef.current,tempoDetectionCacheRef.current[id]);audio.preservesPitch=true;audio.webkitPreservesPitch=true}});
  Object.entries(audioLibraryRefs.current||{}).forEach(([id,audio])=>{if(audio){audio.playbackRate=getSongPlaybackRate(next,songMeterRef.current,tempoDetectionCacheRef.current[id]);audio.preservesPitch=true;audio.webkitPreservesPitch=true}});
 }
 function getSongPlaybackRate(tempo,meter,sourceTempo){
 const [numeratorRaw,denominatorRaw]=String(meter||'4/4').split('/');
 const numerator=Number(numeratorRaw)||4,denominator=Number(denominatorRaw)||4;
 const compound=denominator===8&&numerator>=6&&numerator%3===0;
 const targetQuarterBpm=(Number(tempo)||120)*(compound?1.5:4/denominator);
 const referenceBpm=Number(sourceTempo)>0?Number(sourceTempo):120;
 return Math.max(.1,Math.min(4,targetQuarterBpm/referenceBpm));
}
async function detectSongTempo(song){
 if(!song?.preview)return null;
 if(tempoDetectionCacheRef.current[song.id])return tempoDetectionCacheRef.current[song.id];
 const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return null;
 let ctx;
 try{
  const response=await fetch(song.preview,{mode:'cors'});if(!response.ok)throw new Error('Audio source unavailable');
  const decoded=await (ctx=new AudioCtx()).decodeAudioData(await response.arrayBuffer());
  const sampleRate=decoded.sampleRate,hop=Math.max(256,Math.floor(sampleRate*.01));
  const length=Math.min(Math.floor(decoded.length/hop),Math.floor(90/.01)),envelope=new Float32Array(length);
  for(let i=0;i<length;i++){const a=i*hop,b=Math.min(decoded.length,a+hop);let energy=0,count=0;for(let ch=0;ch<decoded.numberOfChannels;ch++){const channel=decoded.getChannelData(ch);for(let j=a;j<b;j+=2){energy+=channel[j]*channel[j];count++}}envelope[i]=count?Math.sqrt(energy/count):0}
  const onset=new Float32Array(length);for(let i=1;i<length;i++)onset[i]=Math.max(0,envelope[i]-envelope[i-1]);
  const frame=hop/sampleRate,minLag=Math.max(1,Math.floor(60/180/frame)),maxLag=Math.min(length-2,Math.ceil(60/55/frame));
  let bestLag=0,bestScore=0;
  for(let lag=minLag;lag<=maxLag;lag++){let score=0,energy=0;for(let i=lag;i<length;i++){score+=onset[i]*onset[i-lag];energy+=onset[i]*onset[i]}score=energy?score/energy:0;if(score>bestScore){bestScore=score;bestLag=lag}}
  if(!bestLag||bestScore<.035)throw new Error('No reliable beat pattern found');
  const detected=Math.round(60/(bestLag*frame));if(detected<55||detected>180)throw new Error('Tempo estimate outside reliable range');
  tempoDetectionCacheRef.current[song.id]=detected;setSongTempoStatus('Detected recording tempo: '+detected+' BPM');
  const audio=songAudioRefs.current[song.id];if(audio){audio.playbackRate=getSongPlaybackRate(songTempoRef.current,songMeterRef.current,detected);audio.preservesPitch=true;audio.webkitPreservesPitch=true}
  return detected;
 }catch(e){setSongTempoStatus('Could not detect source tempo · original speed retained');return null}
 finally{if(ctx)await ctx.close().catch(()=>{})}
}
function stopOtherMusic(except){
 for(const audio of Object.values(songAudioRefs.current||{})){if(audio&&audio!==except){try{audio.pause();audio.currentTime=0}catch{}}}
 for(const audio of Object.values(audioLibraryRefs.current||{})){if(audio&&audio!==except){try{audio.pause();audio.currentTime=0}catch{}}}
 stopPlayback();stopMetro();if(midiPlaybackRef.current)stopMidiLibraryPlayback();
 setLibraryPlayback({id:null,kind:'',paused:true});
}
function useMusicForPractice(song){
 if(!song)return;stopOtherMusic(null);
 setReferenceSong(song);setSongTitle(song.title||'Selected recording');
 setReferenceStatus('Ready to practise with '+(song.title||'this recording')+'. Start a practice session to compare your performance with this recording.');
 setPracticeStarted(false);setPracticeMode('normal');setPage('Practice');
 setStatus('Music selected for practice: '+(song.title||'recording'));
}
async function searchSongs(){
 const query=songQuery.trim();if(!query||songBusy)return;
 setSongBusy(true);setArchiveResults([]);setCommonsResults([]);setSongResults([]);
 setSourceSearchStatus('Searching for playable audio recordings…');
 setSongTempoStatus('Source tempo is detected when a recording starts playing.');
 const url='https://archive.org/advancedsearch.php?q='+encodeURIComponent('('+query+') AND mediatype:audio')+'&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&rows=20&page=1&output=json';
 try{
  const response=await fetch(url);if(!response.ok)throw new Error('Internet Archive returned HTTP '+response.status);
  const docs=(await response.json())?.response?.docs||[];
  const tracks=await Promise.all(docs.filter(x=>x.identifier).map(async item=>{
   try{const meta=await fetch('https://archive.org/metadata/'+encodeURIComponent(item.identifier));if(!meta.ok)return null;
    const data=await meta.json(),files=(data.files||[]).filter(f=>/\.(mp3|ogg|wav|m4a|flac|opus|aiff?)$/i.test(f.name||'')&&(!f.size||Number(f.size)>50000)&&!f.name?.includes('__ia_thumb'));
    const file=files.sort((a,b)=>Number(b.size||0)-Number(a.size||0))[0];if(!file)return null;
    const artist=Array.isArray(item.creator)?item.creator.join(', '):(item.creator||'Internet Archive contributor');
    return {id:item.identifier,title:item.title||item.identifier,artist,creator:artist,year:item.year||'',album:'Internet Archive · audio recording',preview:'https://archive.org/download/'+encodeURIComponent(item.identifier)+'/'+file.name.split('/').map(encodeURIComponent).join('/'),url:'https://archive.org/details/'+encodeURIComponent(item.identifier)};
   }catch{return null}
  }));
  const playable=tracks.filter(Boolean);setSongResults(playable);setArchiveResults(playable);setCommonsResults([]);
  setSourceSearchStatus(playable.length?'Found '+playable.length+' playable audio recording'+(playable.length===1?'':'s')+'. Use Find sheet music links separately to locate notation.':'No playable audio files were found. Try another title or composer.');
 }catch(error){setSourceSearchStatus('Music search failed: '+(error.message||String(error))+' Try again.')}
 finally{setSongBusy(false)}
}
function uploadScoreImage(file){if(!file)return;const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');if(!isPdf&&!['image/png','image/jpeg','image/webp'].includes(file.type)){setStatus('Choose a PDF, PNG, JPEG or WebP score file.');return}if(file.size>25*1024*1024){setStatus('Score files must be smaller than 25 MB.');return}if(scoreImageUrl.startsWith('blob:'))URL.revokeObjectURL(scoreImageUrl);setScoreImageUrl(URL.createObjectURL(file));setScoreImageName(file.name);setScoreIsPdf(isPdf);const reader=new FileReader();reader.onload=()=>setLibraryFiles(v=>[{id:Date.now(),name:file.name,type:file.type||'application/pdf',size:file.size,data:reader.result,added:new Date().toISOString(),kind:'score'},...v.filter(x=>x.name!==file.name)]);reader.readAsDataURL(file);setScoreOcrStatus(isPdf?'PDF loaded. Run local HOMR recognition to create editable notation; inspect every converted page.':'Image loaded. Run local HOMR recognition to create editable notation; accuracy depends on scan quality.');setScoreOcrWarning('Recognition runs in your browser and may need manual correction.');setStatus('Score loaded and saved to Library')}
  async function recognizeScoreImage(){
   if(!scoreImageUrl)return;
   setScoreOcrStatus('Preparing the score for on-device recognition…');setScoreOcrWarning('');
   try{
    const response=await fetch(scoreImageUrl);if(!response.ok)throw new Error('Could not read the uploaded source image.');
    const blob=await response.blob(),fallback=scoreIsPdf?'application/pdf':'image/png';
    const file=new File([blob],scoreImageName||('score.'+(scoreIsPdf?'pdf':'png')),{type:blob.type||fallback});
    await convertScoreToMusicCoach(file,{target:'Score converter',download:false});
   }catch(e){setScoreOcrStatus('Could not start local recognition: '+e.message);setScoreOcrWarning('Your source file is still available in the Library. Try the Sheet Music Converter with a clean PDF or PNG.')}
  }
  function importMusicXML(file,options={}){
  if(!file)return;
  file.text().then(text=>{
   let score;
   if(file.name.toLowerCase().endsWith('.musiccoach')){
    score=decodeMusicCoach(text);
    if(score.format!=='musiccoach'||!Array.isArray(score.notes))throw new Error('This is not a valid .musiccoach score.');
    // Older .musiccoach exports may have stored only the first of two conflicting
    // HOMR time signatures. Prefer the final time signature in the embedded source XML.
    if(score.notation?.sourceMusicXML){try{const sourceDoc=new DOMParser().parseFromString(score.notation.sourceMusicXML,'application/xml');const times=[...sourceDoc.querySelectorAll('part > measure:first-of-type attributes > time')];const active=times[times.length-1];if(active){const n=active.querySelector('beats')?.textContent,d=active.querySelector('beat-type')?.textContent;if(n&&d)score.timeSignature=n+'/'+d;}}catch{}}
   }else{
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('The MusicXML file is not valid XML.');
    const root=xml.getElementsByTagName('score-partwise')[0];
    const parts=[...(root?.children||[])].filter(el=>el.localName==='part');
    if(!parts.length)throw new Error('No part was found in the MusicXML file.');
    const firstPart=parts[0];
    const getText=(node,selector,fallback='')=>node?.querySelector(selector)?.textContent??fallback;
    const firstMeasure=firstPart.querySelector(':scope > measure');
    const firstAttributes=firstMeasure?.querySelector(':scope > attributes');
    const timeElements=[...(firstMeasure?.querySelectorAll(':scope > attributes > time')||[])];
    const activeTime=timeElements[timeElements.length-1]||firstAttributes;
    const beats=getText(activeTime,'beats','4'),beatType=getText(activeTime,'beat-type','4');
    const tempo=Number(xml.querySelector('sound[tempo]')?.getAttribute('tempo')||firstPart.querySelector('metronome per-minute')?.textContent)||bpm;
    const notes=[],notationEvents=[],markTypes=['dynamics','wedge','pedal','metronome','words','rehearsal','articulations','ornaments','technical','fermata','slur','tied','tuplet','arpeggiate','glissando','slide','other-dynamics','other-technical'];
    const partMeasures=parts.map(part=>[...part.children].filter(el=>el.localName==='measure'));
    const measureCount=Math.max(...partMeasures.map(ms=>ms.length));
    const partDivisions=parts.map(()=>1);
    let elapsedBeats=0,measureIndex=0;
    for(let mi=0;mi<measureCount;mi++){
     measureIndex++;
     let measureLengthBeats=0;
     for(let pi=0;pi<parts.length;pi++){
      const measure=partMeasures[pi][mi];if(!measure)continue;
      let divisions=partDivisions[pi],cursor=0,maxCursor=0;
      for(const child of [...measure.children]){
       if(child.localName==='attributes'){
        const d=Number(child.querySelector(':scope > divisions')?.textContent);
        if(d>0)divisions=d;
        partDivisions[pi]=divisions;
        for(const el of [...child.querySelectorAll('*')])if(['key','time','clef','transpose','divisions','staves'].includes(el.localName)){
         const value=['clef','key','time'].includes(el.localName)?Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]).concat([...el.children].map(c=>[c.localName,c.textContent]))):el.children.length?Object.fromEntries([...el.children].map(c=>[c.localName,c.textContent])):el.textContent;
         notationEvents.push({measure:Number(measure.getAttribute('number')||measureIndex),beat:cursor/divisions,type:el.localName,value,part:pi+1});
        }
       }else if(child.localName==='backup'||child.localName==='forward'){
        const d=Number(getText(child,'duration','0'));
        cursor=child.localName==='backup'?Math.max(0,cursor-d):cursor+d;
        maxCursor=Math.max(maxCursor,cursor);
       }else if(child.localName==='direction'){
        const offset=Number(getText(child,'offset','0'))/divisions,at=Math.max(0,cursor/divisions+offset);
        for(const type of markTypes)for(const el of [...child.querySelectorAll('direction-type '+type)])notationEvents.push({measure:Number(measure.getAttribute('number')||measureIndex),beat:at,type,value:type==='dynamics'?[...el.children].map(x=>x.localName):type==='wedge'||type==='pedal'?Object.fromEntries([...el.attributes].map(a=>[a.name,a.value])):el.textContent||Object.fromEntries([...el.attributes].map(a=>[a.name,a.value])),part:pi+1});
        const sound=child.querySelector('sound');
        if(sound){const attrs=Object.fromEntries([...sound.attributes].map(a=>[a.name,a.value]));notationEvents.push({measure:measureIndex,beat:at,type:'sound',value:attrs,part:pi+1});if(attrs.tempo)notationEvents.push({measure:measureIndex,beat:at,type:'tempo',value:Number(attrs.tempo),part:pi+1});}
       }else if(child.localName==='note'){
        const rest=!!child.querySelector(':scope > rest'),pitch=child.querySelector(':scope > pitch'),step=getText(pitch,'step'),alter=Number(getText(pitch,'alter','0')),octave=getText(pitch,'octave'),duration=Number(getText(child,'duration',String(divisions))),type=getText(child,'type','quarter'),dots=child.querySelectorAll(':scope > dot').length,chord=!!child.querySelector(':scope > chord'),grace=!!child.querySelector(':scope > grace'),beatsValue=duration/divisions;
        if(!rest&&(!step||octave==='')){if(!chord){cursor+=duration;maxCursor=Math.max(maxCursor,cursor)}continue;}
        const onsetDivisions=chord?Math.max(0,cursor-duration):cursor;
        const accidental=alter===1?'#':alter===-1?'b':alter===2?'##':alter===-2?'bb':'';
        const noteName=rest?'rest':step+accidental+octave;
        const n={id:'xml-'+measureIndex+'-'+notes.length,note:noteName,midi:rest?null:noteToMidi(noteName),rest,beats:beatsValue,duration:beatsValue*60/Math.max(30,tempo),time:(elapsedBeats+onsetDivisions/divisions)*60/Math.max(30,tempo),measure:Number(measure.getAttribute('number')||measureIndex),beat:onsetDivisions/divisions,voice:getText(child,'voice','1'),staff:Number(getText(child,'staff','1')),part:pi+1,hand:parts.length>1?(pi===0?'right':'left'):(Number(getText(child,'staff','1'))===2?'left':(noteToMidi(noteName)<60?'left':'right')),type,dots,accidental:getText(child,'accidental')||null,grace,chord,ties:[...child.querySelectorAll(':scope > tie')].map(t=>t.getAttribute('type')),notations:[]};
        const notation=child.querySelector(':scope > notations');
        if(notation)for(const el of [...notation.querySelectorAll('*')]){
         const entry={type:el.localName,attributes:Object.fromEntries([...el.attributes].map(a=>[a.name,a.value])),text:el.children.length?undefined:el.textContent};
         n.notations.push(entry);
         if(!el.children.length)notationEvents.push({measure:n.measure,beat:n.beat,type:el.localName,value:entry,staff:n.staff,voice:n.voice,noteIndex:notes.length,part:pi+1});
        }
        notes.push(n);
        if(!chord){cursor+=duration;maxCursor=Math.max(maxCursor,cursor);}
       }else if(child.localName==='barline'){
        for(const el of [...child.querySelectorAll('*')])if(['bar-style','repeat','ending'].includes(el.localName)){const value=['repeat','ending'].includes(el.localName)?Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]).concat([...el.children].map(c=>[c.localName,c.textContent]))):el.textContent;notationEvents.push({measure:Number(measure.getAttribute('number')||measureIndex),beat:cursor/divisions,type:el.localName,value,part:pi+1});}
       }
      }
      measureLengthBeats=Math.max(measureLengthBeats,maxCursor/divisions);
     }
     elapsedBeats+=measureLengthBeats;
    }
    notes.sort((a,b)=>a.time-b.time||a.part-b.part||a.staff-b.staff||a.voice.localeCompare(b.voice));
    const rawTitle=xml.querySelector('work-title')?.textContent||xml.querySelector('movement-title')?.textContent||'';const fileTitle=file.name.replace(/\.(musicxml|xml)$/i,'').trim();const title=(!rawTitle.trim()||/^(untitled(?:\s+score)?|score)$/i.test(rawTitle.trim()))?(fileTitle||'Imported score'):rawTitle.trim();const normalizedSourceMusicXML=normalizeMusicXMLTitle(text,title);
    const key=firstPart.querySelector('attributes key');
    score={format:'musiccoach',version:2,title,timeSignature:beats+'/'+beatType,bpm:tempo,created:new Date().toISOString(),source:'MusicXML import',notes,notation:{sourceFormat:'MusicXML',sourceMusicXML:normalizedSourceMusicXML,key:key?{fifths:Number(getText(key,'fifths','0')),mode:getText(key,'mode','major')}:null,clefs:parts.flatMap((p,pi)=>[...p.querySelectorAll('clef')].map(c=>({sign:getText(c,'sign'),line:getText(c,'line'),staff:c.getAttribute('number')||'1',part:pi+1}))),notationEvents,partCount:parts.length,technicalSupport:['multi-part and grand-staff timing','backup/forward cursor movement','rests, durations, dots and chords','accidentals, ties and voices','dynamics, articulation and notation events']},sourceAsset:options.sourceAsset||null};
   }
   if(!Array.isArray(score.notes)||score.notes.length===0)throw new Error('No note events were found in this file. Check that it contains a Piano Coach score or pitched MusicXML notes.');
   const fallbackScoreTitle=file.name.replace(/\.(musiccoach|musicxml|xml)$/i,'').trim()||'Imported score';if(!score.title||/^(untitled(?:\s+score)?|score)$/i.test(String(score.title).trim()))score.title=fallbackScoreTitle;if(score.notation?.sourceMusicXML)score.notation.sourceMusicXML=normalizeMusicXMLTitle(score.notation.sourceMusicXML,score.title);
   setScoreNotation(score.notation||null);setScoreSourceAsset(score.sourceAsset||null);setSongTitle(score.title||fallbackScoreTitle);setBpm(Number(score.bpm)||bpm);setTimeSignature(score.timeSignature||'4/4');
   const notes=(score.notes||[]).map((n,i)=>({...n,id:n.id||'score-'+i,midi:n.midi??(n.rest?null:noteToMidi(n.note)),source:'score'}));
   setLoadedScoreNotes(notes);setMusicCoachNotes(notes);setMusicCoachAnalysis(score.analysis||'');setEvents(notes);sessionEvents.current=notes;setLearnHand('both');
   setExpected(notes.map(n=>n.rest?'R/'+(n.beats>=4?'w':n.beats>=2?'h':n.beats>=1?'q':'e'):n.note+'/'+(n.beats>=4?'w':n.beats>=2?'h':n.beats>=1?'q':'e')).join(' '));
   if(score.sourceAsset?.data){setScoreImageUrl(score.sourceAsset.data);setScoreImageName(score.sourceAsset.name||file.name);setScoreIsPdf(score.sourceAsset.mimeType==='application/pdf')}else{setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false)}
   const json=encodeMusicCoach(score),data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(json)));
   setLibraryFiles(v=>[{id:Date.now(),name:(score.title||'Imported score')+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:new Blob([json]).size,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==(score.title||'Imported score')+'.musiccoach')].sort((a,b)=>new Date(b.added||0)-new Date(a.added||0)));
   
   setConversionSavedNotice(true);
   setPracticeMode(options.practiceMode||'normal');setPage(options.target||'Sheet music');setActiveScoreId(Date.now());setScoreOcrStatus('Loaded '+notes.length+' note/rest events and '+(score.notation?.notationEvents?.length||0)+' notation markings. '+(score.sourceAsset?'A source-score preview is embedded.':''));setMusicCoachStatus('Loaded '+file.name+' as a .musiccoach score. Original notation and the embedded source preview are retained where available.');setStatus('Saved to Library · '+(score.title||fallbackScoreTitle))
  }).catch(e=>{setScoreOcrStatus('Music file import failed: '+e.message);setMusicCoachStatus('Import failed: '+e.message)})
 }
 function exportMusicCoach(){
 const fallback=parseMusicSequence(expected).map((n,i)=>({id:'n'+i,note:n.note,midi:n.midi,rest:n.rest,beats:n.beats,time:i*(60/bpm),duration:n.beats*60/bpm,measure:Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1}));
 const notesBase=(scoreSourceAsset||scoreNotation?.sourceMusicXML)?loadedScoreNotes:(events.length?events:fallback);
 const score={format:'musiccoach',version:2,title:songTitle||scoreImageName.replace(/\.[^.]+$/,'')||'My piano score',bpm,timeSignature,created:new Date().toISOString(),source:'Piano Coach',sourceAsset:scoreSourceAsset||null,notes:notesBase.map((n,i)=>({...n,id:n.id||'n'+i,measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1})),notation:scoreNotation||{sourceFormat:'Piano Coach sequence',notationEvents:[],technicalSupport:['rests','note durations']}};
 const json=encodeMusicCoach(score),url=URL.createObjectURL(new Blob([json],{type:'application/vnd.musiccoach.score+json'})),a=document.createElement('a');a.href=url;a.download=score.title.replace(/[^a-z0-9-_ ]/gi,'').trim()+'.musiccoach';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 const data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(json)));
 setLibraryFiles(v=>[{id:Date.now(),name:score.title+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:json.length,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==score.title+'.musiccoach')]);setLibraryTab('scores');setStatus('Editable .musiccoach score with notation metadata saved to Library')
}
function stopScoreCamera(){
 if(cameraStreamRef.current){cameraStreamRef.current.getTracks().forEach(track=>track.stop());cameraStreamRef.current=null;}
 if(cameraVideoRef.current)cameraVideoRef.current.srcObject=null;
 setCameraOpen(false);
}
async function openScoreCamera(){
 setCameraError('');
 if(!navigator.mediaDevices?.getUserMedia){setCameraError('Camera access is not available in this browser. Use HTTPS or choose an image file instead.');setCameraOpen(true);return;}
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
  cameraStreamRef.current=stream;
  setCameraOpen(true);
  requestAnimationFrame(()=>{if(cameraVideoRef.current){cameraVideoRef.current.srcObject=stream;cameraVideoRef.current.play().catch(()=>{});}});
 }catch(error){
  const reason=error?.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings, then try again.':error?.name==='NotFoundError'?'No camera was found on this device. You can upload a photo instead.':error?.name==='NotReadableError'?'The camera is already being used by another app. Close that app and try again.':'Could not open the camera: '+(error?.message||'Unknown camera error');
  setCameraError(reason);setCameraOpen(true);
 }
}
async function captureScorePhoto(){
 const video=cameraVideoRef.current;
 if(!video||!video.videoWidth||!video.videoHeight){setCameraError('The camera is not ready yet. Wait for the preview, then try again.');return;}
 setCameraBusy(true);setCameraError('');
 try{
  const canvas=document.createElement('canvas');
  canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Could not prepare the camera image.');
  context.drawImage(video,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not capture the photo.')),'image/jpeg',.94));
  const file=new File([blob],'music-sheet-photo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg',{type:'image/jpeg',lastModified:Date.now()});
  stopScoreCamera();
  await convertScoreToMusicCoach(file,{target:'Score converter',download:false});
 }catch(error){setCameraError(error?.message||'Could not capture the photo.');}
 finally{setCameraBusy(false);}
}
async function convertScoreToMusicCoach(file,options={}){
  if(!file||musicCoachBusy)return;
  setMusicCoachStatus('Checking '+file.name+'…');
  const ext=file.name.toLowerCase();
  if(/\.(mid|midi)$/i.test(file.name)){await handleMidiUpload(file,{...options,target:options.target||'Score converter'});return}
  if(/\.(mp3|m4a|wav|mp4|webm)$/i.test(file.name)){
   setMusicCoachBusy(true);setMusicCoachAnalysis('');setMusicCoachNotes([]);
   try{
    const {transcribeAudioFile}=await import('./audio-to-score.js');
    const result=await transcribeAudioFile(file,message=>setMusicCoachStatus(message));
    const title=(file.name.replace(/\.(mp3|m4a|wav|mp4|webm)$/i,'').trim()||'Audio transcription');
    const midiFile=new File([result.midiBlob],title+'.mid',{type:'audio/midi'});
    const imported=await handleMidiUpload(midiFile,{...options,target:options.target||'Score converter'});
    if(imported===false)throw new Error('The generated MIDI could not be imported as a score.');
    setMusicCoachAnalysis('Audio transcription created an editable score from '+(result.noteCount||'the detected')+' note events. Review the notation carefully: overlapping instruments, dense mixes and expressive timing can need manual correction.');
    setMusicCoachStatus('Audio transcribed and converted into an editable .musiccoach score.');
    setStatus('Audio-to-sheet-music conversion completed');
   }catch(e){
    const detail=e?.message||String(e);
    setMusicCoachStatus('Audio transcription failed: '+detail);
    setMusicCoachAnalysis('No converted score was saved. Try a shorter, clearer recording with one prominent instrument. Your original file has not been uploaded.');
    setAudioError('Could not convert '+file.name+': '+detail);
    setStatus('Audio transcription failed');
   }finally{setMusicCoachBusy(false)}
   return;
  }
  if(ext.endsWith('.musicxml')||ext.endsWith('.xml')||ext.endsWith('.musiccoach')){importMusicXML(file,{target:options.target||'Score converter',download:false});return}
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const isImage=['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type)||/\.(png|jpe?g|webp|svg)$/i.test(file.name);
  if(!isPdf&&!isImage){setMusicCoachStatus('Choose a PDF, PNG, JPEG, WebP or SVG score.');return}
  if(file.size>25*1024*1024){setMusicCoachStatus('Choose a file smaller than 25 MB.');return}
  setMusicCoachBusy(true);setMusicCoachAnalysis('');setMusicCoachNotes([]);
  if(scoreImageUrl.startsWith('blob:'))URL.revokeObjectURL(scoreImageUrl);
  setScoreImageUrl(URL.createObjectURL(file));setScoreImageName(file.name);setScoreIsPdf(isPdf);
  try{
   setMusicCoachStatus('Starting on-device music recognition. First use downloads about 157 MB of model files, cached for later scans…');
   const {recognizeScoreFile}=await import('./score-ocr.js');
   const result=await recognizeScoreFile(file,message=>setMusicCoachStatus(message));
   setMusicCoachStatus('Recognised '+result.pages+' page(s). Combining the pages into one continuous score…');
   const title=file.name.replace(/\.[^.]+$/,'')||'Recognised score';
   const xmlFile=new File([result.musicXML],title+'.musicxml',{type:'application/vnd.recordare.musicxml+xml'});
   const sourceData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not preserve the original score file in the backup.'));reader.readAsDataURL(file)});
   const sourceExt=(file.name.split('.').pop()||'png').toLowerCase();const sourceMime=file.type||(isPdf?'application/pdf':({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',svg:'image/svg+xml'}[sourceExt]||'application/octet-stream'));const sourceAsset={name:file.name,mimeType:sourceMime,size:file.size,data:sourceData};
   setMusicCoachStatus('Recognition complete. Importing '+result.pages+' page(s) and building the .musiccoach file…');
   setMusicCoachAnalysis('Recognised with HOMR optical music recognition running locally in your browser. Review the rendered notation against the original score before relying on it. OMR can misread notes, rhythms, accidentals, rests and multiple voices; the original source is embedded so you can compare them.');
   importMusicXML(xmlFile,{target:options.target||'Score converter',download:options.download??true,sourceAsset});
   setMusicCoachStatus('Recognised '+result.pages+' page(s) with on-device HOMR. Review the original and converted score side by side.');setConversionSavedNotice(true);
   setStatus('On-device OMR completed · review the converted score');
  }catch(e){
   const detail=String(e?.message||e);
   const imageEngineFailed=/cv2\.error|opencv|resize.cpp|center_image_on_canvas/i.test(detail);
   setMusicCoachStatus(imageEngineFailed?'The local recognition model failed while preparing a staff image (OpenCV resize error). Your file was kept in the Library so you can retry with a straight, high-contrast PNG/JPEG scan with visible margins.':'Local music recognition failed: '+detail.slice(0,320));
   setMusicCoachAnalysis('No score was falsely marked as converted. Recognition runs on this device; the source file remains available for review. MusicXML/XML or MIDI files can be converted directly into editable notation without optical recognition.');
   try{saveLibraryFile(file)}catch{}
   setConversionSavedNotice(true);setStatus('Source saved to Library · conversion needs attention');
  }finally{setMusicCoachBusy(false)}
 }
 function exportMusicXml(){if(scoreNotation?.sourceMusicXML){const u=URL.createObjectURL(new Blob([scoreNotation.sourceMusicXML],{type:'application/vnd.recordare.musicxml+xml'})),a=document.createElement('a');a.href=u;a.download=(songTitle||'piano-coach-score')+'.musicxml';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);setStatus('Exported original MusicXML with technical notation intact');return}const notes=events.length?events:parseMusicSequence(expected);if(!notes.length){setStatus('Enter notes such as C4/q D4/h R/q before exporting.');return}const body=notes.map(n=>{const beats=Math.max(.125,Number(n.beats)||1),dur=Math.round(beats*8),type=beats>=4?'whole':beats>=2?'half':beats>=1?'quarter':beats>=.5?'eighth':'16th';if(n.rest)return '<note><rest/><duration>'+dur+'</duration><type>'+type+'</type></note>';const name=midiToNote(n.midi),m=name.match(/^([A-G])(#?)(-?\d+)$/);return '<note><pitch><step>'+m[1]+'</step>'+(m[2]?'<alter>1</alter>':'')+'<octave>'+m[3]+'</octave></pitch><duration>'+dur+'</duration><type>'+type+'</type></note>'}).join('');const parts=timeSignature.split('/'),xml='<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>'+String(songTitle||'Piano Coach score').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>8</divisions><time><beats>'+parts[0]+'</beats><beat-type>'+parts[1]+'</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>'+body+'</measure></part></score-partwise>';const u=URL.createObjectURL(new Blob([xml],{type:'application/vnd.recordare.musicxml+xml'})),a=document.createElement('a');a.href=u;a.download='piano-coach-score.musicxml';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);setStatus('Exported MusicXML; original technical notation is preserved when importing MusicXML first.')}function clearNotes(){sessionEvents.current=[];setEvents([]);setStatus('Detected notes cleared')}
 function undoNote(){sessionEvents.current.pop();setEvents([...sessionEvents.current]);setStatus('Last note removed')}
 function exportNotes(){
  const sourceNotes=events.length?events:(loadedScoreNotes.length?loadedScoreNotes:parseMusicSequence(expected).map((n,i)=>({...n,time:i*(60/bpm),duration:(n.beats||1)*60/bpm})));
  const notes=sourceNotes.filter(e=>!e.rest&&Number.isFinite(Number(e.midi))&&Number(e.midi)>=0&&Number(e.midi)<=127).sort((a,b)=>Number(a.time)-Number(b.time));
  if(!notes.length){setStatus('Play or track some notes before exporting a MIDI file.');return;}
  const vlq=n=>{let v=Math.max(0,Math.round(n))&0x0fffffff,bytes=[v&127];while((v>>=7)){bytes.unshift((v&127)|128)}return bytes;};
  const ascii=s=>Array.from(s,c=>c.charCodeAt(0));
  const track=[];let previousTick=0;const ppq=480;
  notes.forEach((e,i)=>{const tick=Math.round(Math.max(0,Number(e.time)||0)*ppq*2),midi=Math.round(Number(e.midi));track.push({tick,bytes:[0x90,midi,90]},{tick:tick+240,bytes:[0x80,midi,0]});});
  track.sort((a,b)=>a.tick-b.tick||a.bytes[0]-b.bytes[0]);const data=[];for(const ev of track){data.push(...vlq(ev.tick-previousTick),...ev.bytes);previousTick=ev.tick;}data.push(0,0xff,0x2f,0);
  const header=[...ascii('MThd'),0,0,0,6,0,0,0,1,(ppq>>8)&255,ppq&255],chunk=[...ascii('MTrk'),(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255,...data];
  const blob=new Blob([new Uint8Array([...header,...chunk])],{type:'audio/midi'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='piano-coach-performance.mid';a.click();URL.revokeObjectURL(url);setStatus('Exported a MIDI performance file');
 }
 function saveSession(){
  if(events.length){const practiceScore={format:'musiccoach',version:3,title:(songTitle||'Practice study')+' — '+new Date().toLocaleDateString(),bpm,timeSignature,created:new Date().toISOString(),source:'Practice session notes',notes:events.map((n,i)=>({...n,id:n.id||'practice-'+i,measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1})),notation:scoreNotation||{sourceFormat:'Piano Coach practice transcription',notationEvents:[],technicalSupport:['detected pitches','practice timing']}};const payload=encodeMusicCoach(practiceScore);const data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(payload)));const item={id:Date.now(),name:practiceScore.title+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:payload.length,data,added:practiceScore.created,kind:'practice-score',score:practiceScore};setLibraryFiles(prev=>[item,...prev.filter(x=>x.name!==item.name)]);}
  const plannedSeconds=Math.max(60,Number(practiceMinutes||15)*60),elapsedSeconds=Math.max(0,Math.min(plannedSeconds,plannedSeconds-remainingSeconds));
  const previous=sessions.find(s=>s.id===editingSessionId);const totalSeconds=(previous?.practiceSeconds||((+previous?.minutes||0)*60))+elapsedSeconds;
  const session={...(previous||{}),id:editingSessionId||Date.now(),date:previous?.date||new Date().toISOString(),lastPractisedAt:new Date().toISOString(),song:songTitle||mode,minutes:Math.round(totalSeconds/6)/10,practiceSeconds:totalSeconds,notes:events.length,reflection:reflection||events.length+' note events captured',feedback:practiceFeedback,expected,bpm,timeSignature,events:events.map(e=>({...e}))};
  setSessions(prev=>editingSessionId?prev.map(s=>s.id===editingSessionId?session:s):[session,...prev]);setStatus('Practice time saved: '+Math.floor(totalSeconds/60)+' minutes');setEditingSessionId(null);
 }
 function saveStudy(){const title=prompt('Name this score',songTitle||'My piano recording');if(!title?.trim())return;const id=Date.now(),parsed=events.length?events:parseMusicSequence(expected).map((n,i)=>({...n,id:'n'+i,time:i*60/bpm,duration:(n.beats||1)*60/bpm}));const score={format:'musiccoach',version:1,title:title.trim(),bpm,timeSignature,created:new Date().toISOString(),source:events.some(e=>e.source==='microphone')?'piano recording':'Piano Coach score',notes:parsed.map((n,i)=>({...n,id:n.id||'n'+i,rest:!!n.rest,beats:n.beats||Math.max(.25,(Number(n.duration)||60/bpm)/(60/bpm)),measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1}))};const json=encodeMusicCoach(score),data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(json)));setLibraryFiles(v=>[{id,name:title.trim()+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:json.length,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==title.trim()+'.musiccoach')]);setSaved(prev=>[{id,title:title.trim(),notes:expected},...prev]);setSongTitle(title.trim());setLibraryTab('scores');setPage('Sheet music');setStatus('Saved editable score to Library as '+title.trim()+'.musiccoach')}
 function useStudy(s){setExpected(s.notes);setSongTitle(s.title);setPage('Extras');setStatus('Loaded '+s.title+' into the standalone note tracker')}
 function normaliseArchiveText(value){return String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
 async function findPracticeReferences(title){
  const query=String(title||'').trim();
  if(!query){setPracticeReferenceOpen(true);setPracticeReferenceResults([]);setPracticeReferenceError('Enter a song title or composer first.');return [];}
  setPracticeReferenceOpen(true);setPracticeReferenceBusy(true);setPracticeReferenceResults([]);setPracticeReferenceError('Searching Internet Archive for playable recordings…');
  try{
   const searchUrl='https://archive.org/advancedsearch.php?q='+encodeURIComponent('('+query.replace(/[()]/g,' ') +') AND mediatype:audio')+'&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&rows=40&page=1&output=json';
   const response=await fetch(searchUrl);if(!response.ok)throw new Error('Internet Archive returned HTTP '+response.status);
   const docs=(await response.json())?.response?.docs||[];
   const wanted=normaliseArchiveText(query),tokens=wanted.split(/\s+/).filter(Boolean);
   const ranked=docs.filter(item=>item.identifier).map(item=>{
    const titleText=normaliseArchiveText(item.title),creatorText=normaliseArchiveText(Array.isArray(item.creator)?item.creator.join(' '):item.creator);
    const matched=tokens.filter(token=>(titleText+' '+creatorText).includes(token)).length;
    let matchScore=tokens.length?Math.round(matched/tokens.length*30):0;
    if(titleText===wanted)matchScore+=100;else if(titleText.startsWith(wanted))matchScore+=88;else if(titleText.includes(wanted))matchScore+=78;else if(wanted.includes(titleText))matchScore+=55;
    if(creatorText.includes(wanted))matchScore+=12;
    return {...item,matchScore};
   }).sort((a,b)=>b.matchScore-a.matchScore).slice(0,14);
   const candidates=await Promise.all(ranked.map(async item=>{
    try{
     const meta=await fetch('https://archive.org/metadata/'+encodeURIComponent(item.identifier));if(!meta.ok)return null;
     const data=await meta.json();
     const files=(data.files||[]).filter(file=>/\.(mp3|m4a|ogg|opus|wav|flac|aiff?)$/i.test(file.name||'')&&(!file.size||Number(file.size)>50000)&&!String(file.name||'').includes('__ia_thumb'));
     const priority=file=>({mp3:10,m4a:9,ogg:8,opus:7,wav:6,flac:5,aif:4,aiff:4}[(String(file.name||'').split('.').pop()||'').toLowerCase()]||0);
     files.sort((a,b)=>priority(b)-priority(a)||Number(b.size||0)-Number(a.size||0));
     const file=files[0];if(!file)return null;
     const artist=Array.isArray(item.creator)?item.creator.join(', '):(item.creator||'Internet Archive contributor');
     return {id:item.identifier,title:item.title||item.identifier,artist,creator:artist,year:item.year||'',album:'Internet Archive · audio recording',matchScore:item.matchScore,preview:'https://archive.org/download/'+encodeURIComponent(item.identifier)+'/'+file.name.split('/').map(encodeURIComponent).join('/'),url:'https://archive.org/details/'+encodeURIComponent(item.identifier)};
    }catch{return null}
   }));
   const playable=candidates.filter(Boolean).sort((a,b)=>b.matchScore-a.matchScore).slice(0,5);
   setPracticeReferenceResults(playable);
   setPracticeReferenceError(playable.length?'Found '+playable.length+' playable recordings. Preview a result and choose the correct version.':'No playable recordings were found for that title. Try the composer, an alternate title or a shorter search.');
   if(playable.length)setReferenceStatus('Found '+playable.length+' possible reference recordings. Choose the correct version below.');
   return playable;
  }catch(error){setPracticeReferenceError('Music search failed: '+(error?.message||String(error)));setReferenceStatus('Could not search Internet Archive: '+(error?.message||String(error)));return [];}
  finally{setPracticeReferenceBusy(false)}
 }
 function selectPracticeReference(song){if(!song?.preview)return;setReferenceSong(song);setReferenceStatus('Reference selected: '+song.title+' — '+song.artist+'. Ready for song likeness analysis.');setPracticeReferenceOpen(false);setPracticeReferenceError('');}
 function renderPracticeReferencePicker(){
  if(!practiceReferenceOpen)return null;
  return <div className="practice-reference-picker" style={{marginTop:12,padding:13,border:'1px solid #e8e2f0',borderRadius:14,background:'#fff'}}>
   <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><strong>Choose a reference recording</strong><button type="button" className="text-button" onClick={()=>setPracticeReferenceOpen(false)}>Close ✕</button></div>
   <p className="muted small">Internet Archive · up to five relevant playable recordings. Preview each one before selecting it.</p>
   {practiceReferenceBusy&&<p className="muted small" role="status">Searching a large public audio archive…</p>}
   <div style={{maxHeight:340,overflowY:'auto',display:'grid',gap:9}}>
    {practiceReferenceResults.map((song,index)=><article key={song.id} style={{padding:10,border:'1px solid #eee8f3',borderRadius:11,display:'grid',gap:7}}>
     <div style={{display:'flex',alignItems:'flex-start',gap:8}}><strong style={{flex:1}}>{index+1}. {song.title}</strong>{referenceSong?.id===song.id&&<span className="tag">SELECTED</span>}</div>
     <small className="muted">{song.artist}{song.year?' · '+song.year:''} · Internet Archive</small>
     <audio controls preload="none" src={song.preview} style={{width:'100%',maxWidth:420}} onPlay={e=>stopOtherMusic(e.currentTarget)}/>
     <button type="button" className="btn btn-dark" onClick={()=>selectPracticeReference(song)}>{referenceSong?.id===song.id?'Use selected recording':'Use this recording'}</button>
    </article>)}
   </div>
   {!practiceReferenceBusy&&practiceReferenceError&&<p className="muted small" role="status">{practiceReferenceError}</p>}
  </div>;
 }
 async function loadSongReference(title){
  if(referenceSong?.preview){setReferenceStatus('Reference ready: '+referenceSong.title);return referenceSong;}
  if(!String(title||'').trim()){setReferenceStatus('Enter a song title to find a reference recording.');return null;}
  const results=await findPracticeReferences(title),best=results[0];
  if(best&&best.matchScore>=120){setReferenceSong(best);setReferenceStatus('Automatically selected the strongest title match: '+best.title+' — '+best.artist+'. You can choose another result if needed.');return best;}
  return null;
 }
async function requestLocalAudioCoachFeedback(blob,title,targetNotes,detectedNotes=[]){
  // All waveform inspection and note-based measurements run in this browser tab; no recording is uploaded.
  const ctx=new AudioContext();
  try{
   const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
   let sumSquares=0,peak=0,clipped=0,count=0;
   for(let ch=0;ch<decoded.numberOfChannels;ch++){
    const samples=decoded.getChannelData(ch);
    for(let i=0;i<samples.length;i++){const v=Math.abs(samples[i]);sumSquares+=v*v;if(v>peak)peak=v;if(v>=.99)clipped++;count++}
   }
   const rms=count?Math.sqrt(sumSquares/count):0;
   const notes=(detectedNotes||[]).filter(n=>Number.isFinite(Number(n.midi))&&Number.isFinite(Number(n.time))).sort((a,b)=>Number(a.time)-Number(b.time));
   const gaps=notes.slice(1).map((n,i)=>Number(n.time)-Number(notes[i].time)).filter(g=>g>.04&&g<5);
   const durations=notes.map(n=>Number(n.duration)).filter(d=>Number.isFinite(d)&&d>0);
   const pitches=notes.map(n=>Number(n.midi));
   const median=arr=>arr.length?[...arr].sort((a,b)=>a-b)[Math.floor(arr.length/2)]:null;
   const gap=median(gaps),duration=median(durations),pitchRange=pitches.length?(midiToNote(Math.min(...pitches))+'–'+midiToNote(Math.max(...pitches))):'unavailable';
   const target=targetNotes?compareSequences(targetNotes,notes):null;
   const tips=[];
   if(rms<.015)tips.push('The recording level is quiet; move the microphone closer or increase input gain without causing distortion.');
   if(peak>.99||clipped/count>.01)tips.push('The waveform has clipped peaks; lower the input gain or move the microphone farther away.');
   if(notes.length<5)tips.push('Play a short, clear phrase with the piano prominent and background noise reduced.');
   if(gap!==null&&gap<.16)tips.push('The detected notes are closely spaced; practise the passage slowly with a steady pulse.');
   if(gap!==null&&gap>1.2)tips.push('There are long gaps between detected onsets; check for pauses or notes too quiet for the detector.');
   if(!tips.length)tips.push('Use the detected note sequence and onset spacing to practise a short phrase slowly, then repeat at a slightly faster tempo.');
   return 'On-device audio measurements for “'+title+'”: '+decoded.duration.toFixed(1)+' seconds, '+decoded.numberOfChannels+' channel(s), waveform RMS '+rms.toFixed(3)+', peak '+peak.toFixed(3)+', clipped samples '+(count?((100*clipped/count).toFixed(2)+'%'):'unavailable')+'. Local polyphonic transcription detected '+notes.length+' note events; pitch range '+pitchRange+'. '+(gap!==null?'Median onset spacing '+gap.toFixed(2)+' seconds. ':'Onset spacing unavailable. ')+(duration!==null?'Median detected note duration '+duration.toFixed(2)+' seconds. ':'')+'Target sequence comparison: '+JSON.stringify(target)+'. Suggested checks: '+tips.join(' ');
  }finally{await ctx.close().catch(()=>{})}
 }
 async function transcribeAudioBlob(blob,onProgress=()=>{}){
  if(!blob?.size)throw new Error('The recording is empty. Record a short passage and try again.');
  if(blob.size>100*1024*1024)throw new Error('This audio file is larger than the 100 MB browser safety limit.');
  const {transcribeAudioFile}=await import('./audio-to-score.js');
  const mime=String(blob.type||'audio/webm').toLowerCase();
  const ext=mime.includes('mpeg')?'.mp3':mime.includes('mp4')?'.m4a':mime.includes('m4a')?'.m4a':mime.includes('wav')?'.wav':'.webm';
  const ctx=new AudioContext();let audio;
  try{audio=await ctx.decodeAudioData(await blob.arrayBuffer())}catch(e){await ctx.close().catch(()=>{});throw new Error('Could not decode this recording in the browser: '+(e.message||e))}
  const chunk=160,overlap=4,stride=chunk-overlap,count=Math.max(1,Math.ceil(Math.max(0,audio.duration-overlap)/stride)),notes=[],tempos=[];
  const wav=(from,to)=>{
   const start=Math.floor(from*audio.sampleRate),end=Math.min(audio.length,Math.floor(to*audio.sampleRate)),length=end-start,buffer=new ArrayBuffer(44+length*2),v=new DataView(buffer);
   const put=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i))};
   put(0,'RIFF');v.setUint32(4,36+length*2,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,audio.sampleRate,true);v.setUint32(28,audio.sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,length*2,true);
   const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));
   for(let i=0;i<length;i++){let x=0;for(const c of channels)x+=c[start+i]||0;x=Math.max(-1,Math.min(1,x/channels.length));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}
   return new Blob([buffer],{type:'audio/wav'});
  };
  try{
   for(let i=0;i<count;i++){
    const from=i*stride,to=Math.min(audio.duration,from+chunk),split=count>1;
    onProgress(split?'Analysing section '+(i+1)+' of '+count+'…':'Preparing audio analysis…');
    const part=split?wav(from,to):blob,file=new File([part],'music-coach-'+(i+1)+(split?'.wav':ext),{type:split?'audio/wav':mime});
    const result=await transcribeAudioFile(file,msg=>onProgress(split?'Section '+(i+1)+'/'+count+' · '+msg:msg));
    const parsed=parseStandardMidi(await result.midiBlob.arrayBuffer());tempos.push(Number(parsed.bpm)||120);
    for(const n of parsed.notes){if(i>0&&Number(n.time)<overlap)continue;const time=Number(n.time)+from;if(Number.isFinite(n.midi)&&n.midi>=21&&n.midi<=108&&Number.isFinite(time)&&Number(n.duration)>.04)notes.push({id:'ref-'+i+'-'+notes.length,note:n.note,midi:n.midi,time,duration:Number(n.duration),source:'reference'})}
   }
  }finally{await ctx.close().catch(()=>{})}
  notes.sort((a,b)=>a.time-b.time);
  const clean=notes.filter((n,i,a)=>!i||n.midi!==a[i-1].midi||n.time-a[i-1].time>.08);
  tempos.sort((a,b)=>a-b);
  return {notes:clean,bpm:tempos[Math.floor(tempos.length/2)]||120,duration:audio.duration,sections:count};
 }
 function compareToSongReference(actualNotes,referenceNotes){if(!referenceNotes?.length||!actualNotes.length)return null;const a=actualNotes.map(n=>n.midi%12),b=referenceNotes.map(n=>n.midi%12);/* Find the practice phrase inside the complete, independently transcribed reference track. */const practiceIsShorter=a.length<=b.length,short=practiceIsShorter?a:b,long=practiceIsShorter?b:a;if(short.length<4)return null;let best=0,bestStart=0;const maxStart=Math.max(0,long.length-short.length);for(let start=0;start<=maxStart;start++){let matches=0;for(let i=0;i<short.length;i++)if(short[i]===long[start+i])matches++;const score=matches/short.length;if(score>best){best=score;bestStart=start}}const referenceStart=practiceIsShorter?referenceNotes[bestStart]:referenceNotes[0],referenceEnd=practiceIsShorter?referenceNotes[Math.min(referenceNotes.length-1,bestStart+short.length-1)]:referenceNotes[Math.min(referenceNotes.length-1,short.length-1)];return {score:Math.round(best*100),matched:Math.round(best*short.length),total:short.length,comparisonType:practiceIsShorter?"matched passage in full reference":"best matching passage",note:"Pitch-class alignment only; rhythm, octave and note lengths are not included.",offset:bestStart,matchedStartSeconds:Number(referenceStart?.time)||0,matchedEndSeconds:Number(referenceEnd?.time)||0}}
 function beginPractice(){setEvents([]);sessionEvents.current=[];setPracticeFeedback('');if(!referenceSong?.preview&&songTitle.trim())void loadSongReference(songTitle);else if(!songTitle.trim())setReferenceStatus('Add a song title to find an optional reference recording.');setPracticeStarted(true);setRemainingSeconds(Math.max(60,Number(practiceMinutes||15)*60));setStatus('Practice started · microphone will activate');startTime.current=Date.now();setTimeout(async()=>{await startMic();setTimeout(()=>{if(micStream.current)startRecording()},300)},350)}
 function disconnectLearnMidi(){const access=learnMidiAccessRef.current;if(access){for(const input of access.inputs.values())input.onmidimessage=null;access.onstatechange=null;}learnMidiAccessRef.current=null;setLearnMidiConnected(false);setLearnMidiName('');}
 async function connectLearnMidi(){if(!navigator.requestMIDIAccess){setLearnMessage('Web MIDI is not supported in this browser. Use Chrome or Edge on HTTPS, or continue with the microphone.');return;}try{const access=await navigator.requestMIDIAccess();if(!learnModeRef.current)return;const inputs=[...access.inputs.values()];if(!inputs.length){setLearnMessage('No MIDI piano was found. Connect your keyboard to this computer by USB, then retry.');return;}const onMessage=event=>{const data=event.data||[],command=(Number(data[0])||0)&0xf0,note=Number(data[1]),velocity=Number(data[2]);if(command!==0x90||velocity<=0||note<0||note>127)return;const name=midiToNote(note),entry={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note:name,midi:note,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'midi'};sessionEvents.current.push(entry);setEvents([...sessionEvents.current]);if(learnModeRef.current)checkLearnNote(name,note,'midi');};learnMidiAccessRef.current=access;inputs.forEach(input=>input.onmidimessage=onMessage);access.onstatechange=()=>{const current=[...access.inputs.values()];current.forEach(input=>input.onmidimessage=onMessage);if(!current.length){setLearnMidiConnected(false);setLearnMidiName('');setLearnMessage('MIDI piano disconnected. Reconnect it to continue accurate chord checking.');}};setLearnMidiConnected(true);setLearnMidiName(inputs.map(input=>input.name||input.manufacturer||'MIDI input').join(', '));setLearnMessage('MIDI piano connected. Chords and both hands can now be checked from individual key presses.');}catch(e){setLearnMessage('Could not connect MIDI: '+(e.message||'Check browser permissions and reconnect your piano.'));}}
 function finishLearnSession(completed=false,keystoneResult=null){
   learnModeRef.current=false;disconnectLearnMidi();setLearnListenMode(false);setSheetPianoOpen(false);
   stopMic();stopPlayback();stopMetro();releaseAllKeys();try{synth.current?.releaseAll(Tone.now());synth.current?.dispose();synth.current=null}catch{}
   const seconds=Math.max(0,learnSeconds);
   const resultHits=Array.isArray(keystoneResult?.hits)?keystoneResult.hits.length:(Number(keystoneResult?.hits)||0);
   const hasPracticeActivity=events.length>0||resultHits>0||learnPhraseOffsetRef.current>0;
   if(seconds>0&&hasPracticeActivity){
     const session={id:editingSessionId||Date.now(),date:new Date().toISOString(),lastPractisedAt:new Date().toISOString(),
       song:songTitle||'Listen & Learn lesson',minutes:Math.round(seconds/60*10)/10,practiceSeconds:seconds,notes:keystoneResult?.hits??events.length,
       reflection:'Listen & Learn lesson',feedback:completed?(keystoneResult?('Completed Keystone lesson · '+keystoneResult.score+'/100'):'Completed guided score practice'):'Saved to continue later',
       practiceMode:'learn',learnProgressBeat:learnPhraseOffsetRef.current,learnHand,learnChunkDivision,
       loadedScoreNotes:loadedScoreNotes.map(n=>({...n})),scoreNotation:scoreNotation||null,
       keystoneResult:keystoneResult||null,expected,bpm,timeSignature,events:events.map(e=>({...e}))};
     setSessions(prev=>[session,...prev.filter(s=>s.id!==session.id)]);
     setStatus(completed?'Listen & Learn completed · '+(keystoneResult?keystoneResult.score+'/100 · ':'')+Math.floor(seconds/60)+' min saved':'Listen & Learn saved · ready to continue later');
   }else setStatus('No practice activity was recorded, so this empty lesson was not saved.');
   setEditingSessionId(null);setPracticeStarted(false);setLearnSeconds(0);setLearnBarProgress(0);
 }
function skipLearnBar(){
  const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));
  const chunkBeats=barBeats/Math.max(1,learnChunkDivision),nextOffset=learnPhraseOffsetRef.current+chunkBeats,all=getLearnEvents().filter(n=>!n.rest&&n.midi!==null);
  const hasLater=all.some(n=>n._start>=nextOffset-0.0001);
  learnPhraseOffsetRef.current=nextOffset;learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};
  setLearnPhraseOffset(nextOffset);setLearnBarProgress(0);setLearnAnimationKey(v=>v+1);
  setLearnMessage(hasLater?(learnChunkDivision>1?'Section skipped. The next section is ready.':'Bar skipped. The next bar is ready.'):'That was the final section. Finish or revisit your session.');
  if(hasLater)setTimeout(()=>{if(learnModeRef.current)playLearnPhrase()},250);
}
function resumeSavedSession(session){
  if(!session)return;
  setEditingSessionId(session.id);setSongTitle(session.song||'');setPracticeMinutes('15');
  setBpm(Number(session.bpm)||bpm);setTimeSignature(session.timeSignature||'4/4');setExpected(session.expected||'');
  const restored=(session.events||[]).map((e,i)=>({...e,id:'saved-'+session.id+'-'+i,midi:e.midi??noteToMidi(e.note)}));
  setEvents(restored);sessionEvents.current=restored;setReflection(session.reflection||'');setPracticeFeedback(session.feedback||'');
  if(session.practiceMode==='learn'){
    const notes=Array.isArray(session.loadedScoreNotes)?session.loadedScoreNotes:[];
    if(!notes.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))){setLoadedScoreNotes([]);setScoreNotation(null);setLearnListenMode(false);setSheetPianoOpen(false);setPracticeMode('normal');setPage('Practice');setLearnMessage('This saved lesson has no playable uploaded sheet music. Upload a score before starting Listen & Learn.');setStatus('Saved Listen & Learn lesson unavailable: no sheet music');return;}
    setLoadedScoreNotes(notes);setScoreNotation(session.scoreNotation||null);
    setLearnHand(session.learnHand||'both');setLearnChunkDivision([1,2,4].includes(Number(session.learnChunkDivision))?Number(session.learnChunkDivision):1);
    learnPhraseOffsetRef.current=0;learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};
    setLearnPhraseOffset(0);setLearnBarProgress(0);setLearnSeconds(Math.max(0,Number(session.practiceSeconds)||0));
    setPracticeMode('learn');setPracticeStarted(false);setLearnListenMode(true);setSheetPianoOpen(true);learnModeRef.current=true;
    setPage('Practice');setLearnMessage('Saved score reopened in Keystone. Choose the bar range and press Start to continue practising.');setStatus('Resuming Keystone Listen & Learn');return;
  }
  setPracticeMode('normal');setRemainingSeconds(15*60);setPracticeStarted(true);startTime.current=Date.now();
  setPage('Practice');setStatus('Revisiting saved practice session');
}
 function getLearnEvents(){
  const meter=String(timeSignature||'4/4').split('/').map(Number),beatsPerBar=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));
  if(!loadedScoreNotes?.length)return [];
  const source=loadedScoreNotes.slice();
  let selected=source;
  const hasStaffTwo=source.some(n=>Number(n.staff)===2);
  const parts=[...new Set(source.map(n=>Number(n.part)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const hasSeparateParts=parts.length>1;
  // Prefer explicit MusicXML parts/staves; for a single staff, split by pitch.
  if(learnHand==='right'){
    if(hasSeparateParts)selected=source.filter(n=>Number(n.part)===parts[0]);
    else if(hasStaffTwo)selected=source.filter(n=>n.staff==null||Number(n.staff)===1);
    else selected=source.filter(n=>n.rest||Number(n.midi??noteToMidi(n.note))>=60);
  }else if(learnHand==='left'){
    if(hasSeparateParts)selected=source.filter(n=>parts.slice(1).includes(Number(n.part)));
    else if(hasStaffTwo)selected=source.filter(n=>Number(n.staff)===2);
    else selected=source.filter(n=>n.rest||Number(n.midi??noteToMidi(n.note))<60);
  }
const measures=selected.map(n=>n.measure==null?NaN:Number(n.measure)).filter(Number.isFinite),firstMeasure=measures.length?Math.min(...measures):1;
  let cursor=0;
  return selected.map((n,i)=>{
    const hasMeasureBeat=n.measure!=null&&n.beat!=null&&Number.isFinite(Number(n.measure))&&Number.isFinite(Number(n.beat));
    const hasTime=n.time!=null&&Number.isFinite(Number(n.time));
    const start=hasMeasureBeat?(Number(n.measure)-firstMeasure)*beatsPerBar+Number(n.beat):(hasTime?Number(n.time)*Math.max(30,Number(bpm)||84)/60:cursor);
    const beats=Math.max(.125,Number(n.beats)||((Number(n.duration)||0)*Math.max(30,Number(bpm)||84)/60)||1);
    cursor=Math.max(cursor,start+beats);
    const midi=n.midi??(n.rest?null:noteToMidi(n.note)),hand=hasSeparateParts?(Number(n.part)===parts[0]?'right':'left'):hasStaffTwo?(Number(n.staff)===2?'left':'right'):(Number(midi)<60?'left':'right');return {...n,_start:start,_index:i,beats,rest:!!n.rest,midi,hand};
  }).filter(n=>n.rest||n.midi!==null).sort((a,b)=>a._start-b._start||Number(a.midi||0)-Number(b.midi||0));
}
function getLearnPhrase(){const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4)),goal=barBeats/Math.max(1,learnChunkDivision),offset=learnPhraseOffsetRef.current;return getLearnEvents().filter(n=>n._start>=offset-0.0001&&n._start<offset+goal-0.0001)}
 async function playLearnPhrase(){if(!learnModeRef.current)return;const phrase=getLearnPhrase();if(!phrase.length){setLearnMessage('You completed this score. Finish the lesson to save your practice.');return}await ensureSynth();if(!learnModeRef.current)return;stopPlayback();setLearnAnimationKey(v=>v+1);const origin=phrase[0]._start??0,now=Tone.now()+1.92;setLearnMessage('Playing the score at '+bpm+' BPM. Listen, then play the phrase.');phrase.forEach(n=>{if(!n.rest&&n.midi!==null){const beatOffset=n._start!==undefined?Math.max(0,n._start-origin):0;synth.current?.triggerAttackRelease(midiToNote(n.midi),Math.max(.12,(Number(n.beats)||1)*60/bpm*.92),now+beatOffset*60/bpm)}});setStatus('Playing score phrase at '+bpm+' BPM');}
 function toggleLearnSession(){
   if(learnListenMode){finishLearnSession();return}
   if(!loadedScoreNotes?.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))){setLearnMessage('Listen & Learn is locked until you upload sheet music containing playable notes. Open Sheet Music or the Sheet Music Converter and import a score first.');setStatus('Upload sheet music to enable Listen & Learn');return}
   setEditingSessionId(null);startTime.current=Date.now();learnModeRef.current=true;
   learnProgressRef.current=0;learnPhraseOffsetRef.current=0;learnNoteLockRef.current=0;learnChordHitsRef.current={key:'',hits:[]};
   setLearnBarProgress(0);setLearnPhraseOffset(0);setLearnSeconds(0);sessionEvents.current=[];setEvents([]);
   setSheetPianoOpen(true);setLearnListenMode(true);
   setLearnMessage('Keystone engine ready. Select Learn or Perform, then press Start.');
   setStatus('Keystone Listen & Learn ready');
 }
function stopLibraryAudioOnly(reset=true){
  for(const audio of Object.values(audioLibraryRefs.current||{})){if(!audio)continue;try{audio.pause();if(reset)audio.currentTime=0}catch{}}
  setLibraryPlayback(current=>current.kind==='audio'?{id:null,kind:'',paused:true}:current);
 }
 async function toggleLibraryAudio(item){
  const audio=audioLibraryRefs.current[item.id];
  if(!audio){setAudioError('The audio player for '+item.name+' is not ready yet.');return}
  if(libraryPlayback.id===item.id&&libraryPlayback.kind==='audio'&&!audio.paused){audio.pause();setLibraryPlayback({id:item.id,kind:'audio',paused:true});setStatus('Paused '+item.name);return}
  if(midiPlaybackRef.current)stopMidiLibraryPlayback();
  for(const other of Object.values(audioLibraryRefs.current||{})){if(other&&other!==audio){try{other.pause();other.currentTime=0}catch{}}}
  try{await audio.play();setLibraryPlayback({id:item.id,kind:'audio',paused:false});setStatus('Playing '+item.name);setAudioError('')}
  catch(e){setAudioError('Could not play '+item.name+': '+e.message)}
 }
 function stopLibraryItem(item){
  if(libraryPlayback.id!==item.id)return;
  if(libraryPlayback.kind==='tone')stopMidiLibraryPlayback();
  else{const audio=audioLibraryRefs.current[item.id];if(audio){try{audio.pause();audio.currentTime=0}catch{}}setLibraryPlayback({id:null,kind:'',paused:true});setStatus('Playback stopped')}
 }
 function isMidiLibraryFile(x){return /\.(mid|midi)$/i.test(x?.name||'')||x?.type==='audio/midi'}
 function isAudioLibraryFile(x){return !!(x?.type?.startsWith('audio/')||x?.type?.startsWith('video/')||/\.(mp3|m4a|mp4|aac|wav|ogg|oga|opus|flac|aiff?|mid|midi|weba|webm)$/i.test(x?.name||''))}
 async function playScoreLibraryFile(item){
  try{
   stopLibraryAudioOnly();
   if(midiPlaybackRef.current)stopMidiLibraryPlayback();
   await Tone.start();
   let score=item.score||null;
   if(!score&&item.data){
    const response=await fetch(item.data);
    if(!response.ok)throw new Error('The saved score data could not be read.');
    const raw=await response.text();
    if(/\.musiccoach$/i.test(item.name))score=decodeMusicCoach(raw);
    else{
     const xml=new DOMParser().parseFromString(raw,'application/xml');
     if(xml.querySelector('parsererror'))throw new Error('Invalid MusicXML');
     const parts=[...xml.querySelectorAll('score-partwise > part')];
     if(!parts.length)throw new Error('No musical parts were found in this MusicXML file.');
     const firstMeasure=parts[0].querySelector(':scope > measure');
     const tempo=Number(xml.querySelector('sound[tempo]')?.getAttribute('tempo')||parts[0].querySelector('metronome per-minute')?.textContent)||bpm;
     const beats=Number(firstMeasure?.querySelector('attributes time beats')?.textContent)||4;
     const beatType=Number(firstMeasure?.querySelector('attributes time beat-type')?.textContent)||4;
     const beatsPerBar=beats*4/beatType;
     const measures=parts.map(part=>[...part.querySelectorAll(':scope > measure')]);
     const partDivisions=parts.map(()=>1),notes=[];
     const measureCount=Math.max(...measures.map(items=>items.length));
     let elapsedBeats=0;
     for(let mi=0;mi<measureCount;mi++){
      let measureLength=0;
      for(let pi=0;pi<parts.length;pi++){
       const measure=measures[pi][mi];if(!measure)continue;
       let divisions=partDivisions[pi],cursor=0,maxCursor=0;
       for(const child of [...measure.children]){
        if(child.localName==='attributes'){
         const nextDivisions=Number(child.querySelector(':scope > divisions')?.textContent);
         if(nextDivisions>0)divisions=nextDivisions;
         partDivisions[pi]=divisions;
        }else if(child.localName==='backup'||child.localName==='forward'){
         const amount=Number(child.querySelector(':scope > duration')?.textContent)||0;
         cursor=child.localName==='backup'?Math.max(0,cursor-amount):cursor+amount;
         maxCursor=Math.max(maxCursor,cursor);
        }else if(child.localName==='note'){
         const rest=!!child.querySelector(':scope > rest'),pitch=child.querySelector(':scope > pitch');
         const durationDivisions=Number(child.querySelector(':scope > duration')?.textContent)||divisions;
         const chord=!!child.querySelector(':scope > chord'),step=pitch?.querySelector('step')?.textContent,alter=Number(pitch?.querySelector('alter')?.textContent)||0,octave=pitch?.querySelector('octave')?.textContent;
         const name=rest?'rest':step&&octave!==undefined?step+(alter===1?'#':alter===-1?'b':alter===2?'##':alter===-2?'bb':'')+octave:null;
         const onset=chord?Math.max(0,cursor-durationDivisions):cursor;
         if(name&&!rest)notes.push({note:name,time:(elapsedBeats+onset/divisions)*60/tempo,duration:durationDivisions/divisions*60/tempo,part:pi+1,staff:Number(child.querySelector('staff')?.textContent)||1,voice:child.querySelector('voice')?.textContent||'1'});
         if(!chord){cursor+=durationDivisions;maxCursor=Math.max(maxCursor,cursor);}
        }
       }
       measureLength=Math.max(measureLength,maxCursor/divisions);
      }
      elapsedBeats+=Math.max(measureLength,beatsPerBar);
     }
     score={title:item.name,bpm:tempo,timeSignature:beats+'/'+beatType,notes};
    }
   }
   if(!score||!Array.isArray(score.notes))throw new Error('This Library item does not contain a playable score.');
   const tempo=Math.max(30,Number(score.bpm)||bpm||84);
   const meter=String(score.timeSignature||timeSignature||'4/4').split('/').map(Number);
   const beatsPerBar=Math.max(1,(meter[0]||4)*4/(meter[1]||4));
   let cursor=0;
   const notes=score.notes.filter(n=>n.note&&!n.rest).map(n=>{
    const duration=Math.max(.06,Number(n.duration)||(Number(n.beats)||1)*60/tempo);
    const hasTime=n.time!=null&&Number.isFinite(Number(n.time));
    const at=hasTime?Math.max(0,Number(n.time)):n.measure!=null&&n.beat!=null?Math.max(0,((Number(n.measure)-1)*beatsPerBar+Number(n.beat))*60/tempo):cursor;
    cursor=Math.max(cursor,at+duration);
    return {time:at,name:n.note,duration,velocity:.82};
   }).sort((x,y)=>x.time-y.time);
   if(!notes.length)throw new Error('No playable note events were found in this score.');
   const ppq=Number(Tone.Transport.PPQ)||192;
   const targetTempo=Math.max(20,Math.min(240,Number(songTempo)||tempo));
   const transportNotes=notes.map(n=>({
    time:Math.max(0,Math.round(n.time*tempo/60*ppq))+'i',
    name:n.name,
    duration:Math.max(1,Math.round(n.duration*tempo/60*ppq))+'i',
    velocity:n.velocity
   }));
   const player=new Tone.PolySynth(Tone.Synth).toDestination();
   const part=new Tone.Part((time,n)=>player.triggerAttackRelease(n.name,n.duration,time,n.velocity),transportNotes);
   Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0;Tone.Transport.bpm.value=targetTempo;
   part.start(0);Tone.Transport.start();
   const endTicks=Math.round((Math.max(...notes.map(n=>n.time+n.duration))+.3)*tempo/60*ppq);
   const endId=Tone.Transport.scheduleOnce(()=>{
    part.dispose();player.dispose();Tone.Transport.stop();Tone.Transport.cancel();midiPlaybackRef.current=null;
    setLibraryPlayback(current=>current.id===item.id?{id:null,kind:'',paused:true}:current);
    setStatus('Score playback finished');
   },Math.max(1,endTicks)+'i');
   midiPlaybackRef.current={part,player,endId,itemId:item.id,paused:false};
   setLibraryPlayback({id:item.id,kind:'tone',paused:false});setAudioError('');setStatus('Playing '+item.name);
  }catch(e){setAudioError('Could not play score: '+(e?.message||String(e)));setStatus('Score playback failed')}
 }
async function toggleScoreLibraryPlayback(item){
  if(libraryPlayback.id===item.id&&libraryPlayback.kind==='tone'){
   if(libraryPlayback.paused)resumeMidiLibraryPlayback();else pauseMidiLibraryPlayback();
   return;
  }
  if(isMidiLibraryFile(item)){await playMidiLibraryFile(item);return;}
  await playScoreLibraryFile(item);
 }
async function playMidiLibraryFile(item){
  try{
   stopLibraryAudioOnly();if(midiPlaybackRef.current)stopMidiLibraryPlayback();
   await Tone.start();
   const response=await fetch(item.data);if(!response.ok)throw new Error('The MIDI file could not be read.');
   const parsed=parseStandardMidi(await response.arrayBuffer());
   const sourceTempo=Math.max(20,Number(parsed.bpm)||120);
   const ppq=Number(Tone.Transport.PPQ)||192;
   const targetTempo=Math.max(20,Math.min(240,Number(songTempoRef.current)||sourceTempo));
   const notes=parsed.notes.map(note=>({
    time:Math.max(0,Math.round(note.time*sourceTempo/60*ppq))+'i',
    name:note.note,
    duration:Math.max(1,Math.round(note.duration*sourceTempo/60*ppq))+'i',
    velocity:note.velocity
   }));
   const player=new Tone.PolySynth(Tone.Synth).toDestination();
   const part=new Tone.Part((time,n)=>player.triggerAttackRelease(n.name,n.duration,time,n.velocity),notes);
   Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0;Tone.Transport.bpm.value=targetTempo;
   part.start(0);Tone.Transport.start();
   const endSeconds=Math.max(...midi.tracks.flatMap(track=>track.notes.map(note=>note.time+note.duration)))+.3;
   const endTicks=Math.round(endSeconds*sourceTempo/60*ppq);
   const endId=Tone.Transport.scheduleOnce(()=>{
    part.dispose();player.dispose();Tone.Transport.stop();Tone.Transport.cancel();midiPlaybackRef.current=null;
    setLibraryPlayback(current=>current.id===item.id?{id:null,kind:'',paused:true}:current);
    setStatus('MIDI playback finished');
   },Math.max(1,endTicks)+'i');
   midiPlaybackRef.current={part,player,endId,itemId:item.id,paused:false,sourceTempo};
   setLibraryPlayback({id:item.id,kind:'tone',paused:false});setAudioError('');setStatus('Playing '+item.name);
  }catch(e){setAudioError('Could not play MIDI file: '+(e?.message||String(e)));setStatus('MIDI playback failed')}
 }
 function pauseMidiLibraryPlayback(){if(!midiPlaybackRef.current)return;try{Tone.Transport.pause();midiPlaybackRef.current.paused=true;setLibraryPlayback({id:midiPlaybackRef.current.itemId,kind:'tone',paused:true});setStatus('Playback paused')}catch(e){setAudioError('Could not pause playback: '+e.message)}}
 function resumeMidiLibraryPlayback(){if(!midiPlaybackRef.current)return;try{Tone.Transport.start();midiPlaybackRef.current.paused=false;setLibraryPlayback({id:midiPlaybackRef.current.itemId,kind:'tone',paused:false});setStatus('Resumed library playback')}catch(e){setAudioError('Could not resume playback: '+e.message)}}
 function stopMidiLibraryPlayback(){const p=midiPlaybackRef.current;if(!p)return;try{Tone.Transport.clear(p.endId);p.part.dispose();p.player.dispose();Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0}catch{}midiPlaybackRef.current=null;setLibraryPlayback(current=>current.kind==='tone'?{id:null,kind:'',paused:true}:current);setStatus('Playback stopped')}
 async function handleMidiUpload(file,options={}){
  if(!file)return;
  setMusicCoachBusy(true);setAudioError('');setMusicCoachStatus('Reading MIDI file…');
  try{
   const parsed=parseStandardMidi(await file.arrayBuffer());
   const meter=String(timeSignature||'4/4').split('/').map(Number);
   const beatsPerBar=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));
   const all=parsed.notes.map(note=>({...note,beats:Math.max(.0625,note.duration*parsed.bpm/60),measure:Math.floor(note.time*parsed.bpm/60/beatsPerBar)+1}));
   const title=file.name.replace(/\.(mid|midi)$/i,'').trim()||'MIDI score';
   const sourceMusicXML=midiNotesToMusicXML(all,parsed.bpm,timeSignature,title);
   const notation={sourceFormat:'MIDI',sourceMusicXML,notationEvents:[],technicalSupport:['MIDI note-on/note-off timing','left and right hand grand-staff layout','simultaneous chord grouping','multi-measure notation']};
   const score={format:'musiccoach',version:2,title,bpm:Math.round(parsed.bpm),timeSignature,created:new Date().toISOString(),source:'Imported MIDI',midiFormat:parsed.format,notes:all,notation};
   const json=encodeMusicCoach(score),data='data:application/vnd.musiccoach.score+json;base64,'+btoa(unescape(encodeURIComponent(json)));
   const item={id:Date.now(),name:title+'.musiccoach',type:'application/vnd.musiccoach.score+json',size:new Blob([json]).size,data,added:new Date().toISOString(),kind:'score',score};
   setScoreNotation(notation);setScoreSourceAsset(null);setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false);
   setLibraryFiles(v=>[item,...v.filter(x=>x.name!==item.name)].sort((a,b)=>new Date(b.added||0)-new Date(a.added||0)));
   setConversionSavedNotice(true);setSongTitle(title);setLearnHand('both');
   setEvents(all);sessionEvents.current=all;setLoadedScoreNotes(all);setMusicCoachNotes(all);
   setBpm(Math.round(parsed.bpm));setSongTempo(Math.round(parsed.bpm));
   setExpected(all.slice(0,100).map(n=>n.note+'/'+(n.beats>=3.5?'w':n.beats>=1.5?'h':n.beats>=.7?'q':'e')).join(' '));
   setPracticeMode(options.practiceMode||(options.target==='Practice'?'normal':'learn'));setPage(options.target||'Sheet music');setPracticeStarted(false);
   setMusicCoachStatus('Imported '+all.length+' MIDI notes across the full score. Grand-staff notation and editable playback were saved to your Library.');
   setStatus('MIDI imported successfully');return true;
  }catch(e){
   const message=e?.message||'Unknown MIDI import error';
   setMusicCoachStatus('MIDI import failed: '+message);setAudioError('Could not import '+file.name+': '+message);setStatus('MIDI import failed');return false;
  }finally{setMusicCoachBusy(false)}
 }
 function saveLibraryFile(file){
  if(!file)return;
  if(!isSheetMusicLibraryItem({name:file.name})){setStatus('Only sheet music files can be saved in this library.');return}
  const reader=new FileReader();
  reader.onload=()=>{const item={id:Date.now(),name:file.name,type:file.type||'application/octet-stream',size:file.size,data:reader.result,added:new Date().toISOString(),kind:'score-source'};setLibraryFiles(v=>[item,...v.filter(x=>x.name!==item.name)].sort((a,b)=>new Date(b.added||0)-new Date(a.added||0)));setConversionSavedNotice(true);setStatus('Saved to Library · '+file.name)};
  reader.onerror=()=>setStatus('Could not read '+file.name+'. Try exporting it again.');
  reader.readAsDataURL(file);
}
 function handleScoreUpload(file,options={}){
  if(!file)return;
  const name=file.name.toLowerCase(),target=options.target||'Sheet music';
  if(/\.(mp3|m4a|wav|mp4|webm)$/i.test(name)){setLoadedScoreNotes([]);setScoreNotation(null);setScoreSourceAsset(null);setLearnListenMode(false);setSheetPianoOpen(false);learnModeRef.current=false;convertScoreToMusicCoach(file,{...options,target,download:false});return}
  if(!isSheetMusicLibraryItem({name:file.name})){setStatus('Choose a sheet music file: MusicXML, MIDI, .musiccoach, PDF or a score image.');return}
  setLoadedScoreNotes([]);setScoreNotation(null);setScoreSourceAsset(null);setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false);setLearnListenMode(false);setSheetPianoOpen(false);learnModeRef.current=false;
  if(name.endsWith('.mid')||name.endsWith('.midi')){handleMidiUpload(file,{...options,target});return}
  if(name.endsWith('.musiccoach')||name.endsWith('.musicxml')||name.endsWith('.xml')){importMusicXML(file,{...options,target,download:!!options.download});return}
  if(file.type==='application/pdf'||name.endsWith('.pdf')||file.type.startsWith('image/')||/\.(png|jpe?g|webp|svg)$/i.test(name)){convertScoreToMusicCoach(file,{target,download:!!options.download});return}
  setStatus('This file type cannot be converted to sheet music.');
 }
 function downloadLibraryFile(item){const a=document.createElement('a');a.href=item.data;a.download=item.name;a.click()}
 function openLibraryScores(){setPage('Sheet music');setStatus('Opened your sheet music collection')}
 function deleteLibraryItem(item){if(libraryPlayback.id===item.id)stopLibraryItem(item);setLibraryFiles(v=>v.filter(f=>f.id!==item.id));setStatus('Deleted '+(item.name||'file')+' from your Library')}
 async function openLibrarySheetFullscreen(item){
  try{
   if(!item?.data)throw new Error('This Library item has no stored file data.');
   const response=await fetch(item.data);if(!response.ok)throw new Error('The saved file could not be read.');
   const ext=(item.name||'').toLowerCase();
   if(ext.endsWith('.pdf')||/pdf/i.test(item.type||'')){setLibraryFullscreenItem({kind:'pdf',src:item.data,title:item.name});return;}
   if(/\.(png|jpe?g|webp)$/i.test(ext)||item.type?.startsWith('image/')){setLibraryFullscreenItem({kind:'image',src:item.data,title:item.name});return;}
   let xmlText='';
   if(/\.(mid|midi)$/i.test(ext)){
    const parsed=parseStandardMidi(await response.arrayBuffer());
    xmlText=midiNotesToMusicXML(parsed.notes,parsed.bpm,'4/4',item.name||'Imported MIDI');
   }else{
    const raw=await response.text();
    if(ext.endsWith('.musiccoach')){
     const score=item.score||decodeMusicCoach(raw);
     const title=item.name||score.title||'Piano Coach score';
     const xml=score.notation?.sourceMusicXML||midiNotesToMusicXML(score.notes||[],score.bpm||120,score.timeSignature||'4/4',title);
     setFullscreenScore({xml,title});return;
    }else xmlText=raw;
   }
   if(!xmlText||!/<score-partwise|<score-timewise/i.test(xmlText))throw new Error('No renderable sheet notation was found in this file.');
   setFullscreenScore({xml:xmlText,title:item.name||'Sheet music'});
  }catch(e){setAudioError('Could not expand '+(item?.name||'file')+': '+(e.message||String(e)));}
 }
 async function choosePracticeLibraryScore(item){
  if(!item)return;
  try{
   let blob;
   if(item.data){
    const response=await fetch(item.data);
    if(!response.ok)throw new Error('The saved score could not be read.');
    blob=await response.blob();
   }else if(item.score){
    blob=new Blob([encodeMusicCoach(item.score)],{type:'application/vnd.musiccoach.score+json'});
   }else throw new Error('This Library item has no saved file data.');
   const file=new File([blob],item.name||'library-score.musiccoach',{type:item.type||blob.type||'application/octet-stream'});
   const title=(item.name||'Sheet music').replace(/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i,'');
   setPracticeScoreName(item.name||'Sheet music');
   setSongTitle(title);
   setPracticeScoreError('');
   setPracticeStarted(false);
   setPracticeLibraryPicker(false);
   setPage('Practice');
   setStatus('Loading '+(item.name||'score')+' into Practice…');
   handleScoreUpload(file,{target:'Practice',download:false});
  }catch(e){
   setStatus('Could not select score: '+(e?.message||String(e)));
  }
 }
 async function openLibraryScore(item){
  if(!item)return;
  if(!isPlayableSheetMusicItem(item)){setStatus('Listen & Learn accepts only structured .musiccoach, MusicXML or MIDI files. Photos, scans and PDFs must be converted first.');return;}
  try{
   let blob;
   if(item.data){const response=await fetch(item.data);if(!response.ok)throw new Error('The stored score could not be read.');blob=await response.blob();}
   else if(item.score){blob=new Blob([encodeMusicCoach(item.score)],{type:'application/vnd.musiccoach.score+json'});}
   else throw new Error('This saved score has no file data.');
   const file=new File([blob],item.name||'library-score.musiccoach',{type:item.type||blob.type||'application/octet-stream'});
   setPracticeScoreName(item.name||'Sheet music');setPracticeScoreError('');setPracticeStarted(false);setPracticeMode('learn');setPage('Practice');setStatus('Loading '+(item.name||'score')+' into Practice…');
   handleScoreUpload(file,{target:'Practice',download:false,practiceMode:'learn'});
  }catch(e){setStatus('Could not open score: '+e.message)}
 }
 function downloadMusicData(){
  const storage={};try{for(const key of ['pc_grade_plan','pc_cookie_prefs','pc_cookie_storage_enabled']){const value=localStorage.getItem(key);if(value!==null)storage[key]=value}}catch{}
  const payload={format:'PIANO-COACH-MUSICDATA',version:1,createdAt:new Date().toISOString(),app:'Piano Coach',state:{sessions,studies:saved,libraryFiles,events,expected,scoreNotation,scoreSourceAsset,loadedScoreNotes,scoreImageName,scoreIsPdf,musicCoachNotes,musicCoachMarkings,practiceScoreName,songTitle,practiceMode,practiceMinutes,reflection,practiceFeedback,preferences:{volume,bpm,expected,timeSignature,keyboardStart,keyboardOctaves} ,musicChat},localStorage:storage};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/vnd.piano-coach.musicdata+json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='piano-coach-backup-'+new Date().toISOString().slice(0,10)+'.musicdata';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('Complete .musicdata backup downloaded');
 }
 async function importMusicData(file){
  if(!file)return;
  try{
   if(file.size>300*1024*1024)throw new Error('This backup is unusually large (over 300 MB). Check that you selected a valid .musicdata file.');
   const payload=JSON.parse(await file.text());
   if(payload?.format!=='PIANO-COACH-MUSICDATA'||payload?.version!==1||!payload.state||typeof payload.state!=='object')throw new Error('This is not a supported Piano Coach .musicdata backup.');
   if(!confirm('Restore this Piano Coach backup? Saved sessions, scores, files and presets with matching names will be replaced.'))return;
   const st=payload.state,p=st.preferences||{};
   for(const k of ['pc_grade_plan','pc_cookie_prefs','pc_cookie_storage_enabled'])try{localStorage.removeItem(k)}catch{}
   if(payload.localStorage&&typeof payload.localStorage==='object')for(const k of ['pc_grade_plan','pc_cookie_prefs','pc_cookie_storage_enabled']){const v=payload.localStorage[k];if(typeof v==='string'&&v.length<2*1024*1024)try{localStorage.setItem(k,v)}catch{}}
   const nextSessions=Array.isArray(st.sessions)?st.sessions:[],nextStudies=Array.isArray(st.studies)?st.studies:[],nextFiles=(Array.isArray(st.libraryFiles)?st.libraryFiles:[]).filter(item=>isSheetMusicLibraryItem(item)&&(!item.data||(typeof item.data==='string'&&/^data:/i.test(item.data))));
   setSessions(nextSessions);setSaved(nextStudies);setLibraryFiles(nextFiles);
   if(Number.isFinite(p.volume))setVolume(p.volume);if(Number.isFinite(p.bpm))setBpm(p.bpm);if(typeof p.expected==='string')setExpected(p.expected);if(typeof p.timeSignature==='string')setTimeSignature(p.timeSignature);
   if(typeof p.keyboardStart==='string')setKeyboardStart(p.keyboardStart);if(Number.isFinite(p.keyboardOctaves))setKeyboardOctaves(Math.max(1,Math.min(5,p.keyboardOctaves)));
   setMusicChat(Array.isArray(st.musicChat)?st.musicChat:[]);setEvents(Array.isArray(st.events)?st.events:[]);sessionEvents.current=Array.isArray(st.events)?st.events:[];setScoreNotation(st.scoreNotation||null);setScoreSourceAsset(st.scoreSourceAsset||null);setLoadedScoreNotes(Array.isArray(st.loadedScoreNotes)?st.loadedScoreNotes:[]);setScoreImageName(typeof st.scoreImageName==='string'?st.scoreImageName:'');setScoreIsPdf(st.scoreIsPdf===true);setScoreImageUrl(st.scoreSourceAsset?.data||'');setMusicCoachNotes(Array.isArray(st.musicCoachNotes)?st.musicCoachNotes:[]);setMusicCoachMarkings(Array.isArray(st.musicCoachMarkings)?st.musicCoachMarkings:[]);if(typeof st.practiceScoreName==='string')setPracticeScoreName(st.practiceScoreName);if(typeof st.songTitle==='string')setSongTitle(st.songTitle);if(typeof st.practiceMode==='string')setPracticeMode(st.practiceMode);if(typeof st.practiceMinutes==='string')setPracticeMinutes(st.practiceMinutes);if(typeof st.reflection==='string')setReflection(st.reflection);if(typeof st.practiceFeedback==='string')setPracticeFeedback(st.practiceFeedback);
   try{localStorage.setItem('pc_sessions',JSON.stringify(nextSessions));localStorage.setItem('pc_studies',JSON.stringify(nextStudies));localStorage.removeItem('pc_files');localStorage.setItem('pc_cookie_consent',JSON.stringify({choice:'accept',at:new Date().toISOString(),restoredFromBackup:true}))}catch{}
   setCookieChoice({choice:'accept',at:new Date().toISOString(),restoredFromBackup:true});setCookieSettingsOpen(false);setPage('Dashboard');setStatus('Backup restored: '+nextFiles.length+' files, '+nextStudies.length+' studies and '+nextSessions.length+' sessions');
  }catch(e){setStatus('Could not restore backup: '+(e?.message||'invalid file'))}
 }
 function shiftKeyboardStart(delta){const midi=clampKeyboardStartMidi(keyboardStart,keyboardOctaves);const base=clampKeyboardStartMidi(midi+delta,keyboardOctaves);setKeyboardStart(midiToNote(base))}
 async function ensurePianoCoachAI(){
  if(window.PianoCoachAI?.ask)return window.PianoCoachAI;
  const existing=document.querySelector('script[data-piano-coach-ai]');
  if(existing)existing.remove();
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='/ai-tutor.js?load='+Date.now();script.async=true;
   const timer=setTimeout(()=>{script.remove();reject(new Error('The local music assistant took too long to load. Please retry.'))},90000);
   script.onload=()=>{clearTimeout(timer);resolve()};
   script.onerror=()=>{clearTimeout(timer);reject(new Error('Music assistant could not be loaded'))};
   document.head.appendChild(script);
  });
  if(!window.PianoCoachAI?.ask)throw new Error('The AI script loaded but did not initialise the assistant.');
  return window.PianoCoachAI;
 }
 async function sendMusicChat(){
  const question=musicChatInput.trim();if(!question||musicChatBusy)return;
  setMusicChat(v=>[...v,{role:'user',content:question}]);setMusicChatInput('');setMusicChatBusy(true);
  try{
   const assistant=await ensurePianoCoachAI();
   const result=await Promise.race([assistant.ask(question,{history:musicChat.slice(-8)}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('The assistant did not respond within 90 seconds. Please retry.')),90000))]);setMusicChat(v=>[...v,{role:'assistant',content:result.answer||'I could not produce an answer.'}]);
  }catch(e){setMusicChat(v=>[...v,{role:'assistant',content:'Assistant unavailable: '+e.message}])}finally{setMusicChatBusy(false)}
 }
 function startVoiceQuestion(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setTutorStatus('Voice input is not supported in this browser.');return}const rec=new SR();rec.lang='en-GB';rec.onresult=e=>setTutorQuestion(v=>(v+' '+e.results[0][0].transcript).trim());rec.start()}
 async function pressKey(note){if(heldKeysRef.current[note])return;heldKeysRef.current[note]=true;setHeldKeys(v=>({...v,[note]:true}));const midi=noteToMidi(note);if(midi!==null){if(learnListenMode){learnMicInputRef.current?.noteDown?.(midi)}else{const s=await ensureSynth();if(heldKeysRef.current[note])s.triggerAttack(midiToNote(midi));}}if(!startTime.current)startTime.current=Date.now();const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'keyboard'};sessionEvents.current.push(event);setEvents([...sessionEvents.current]);if(!learnListenMode)setStatus('Played '+note)}
 function checkLearnNote(note,midi,source='microphone'){
  const now=Date.now();if(source!=='midi'&&now-learnNoteLockRef.current<180)return;learnNoteLockRef.current=now;
  const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4)),goal=barBeats/Math.max(1,learnChunkDivision),offset=learnPhraseOffsetRef.current;
  const all=getLearnEvents().filter(n=>!n.rest&&n.midi!==null),phrase=all.filter(n=>n._start>=offset-0.0001&&n._start<offset+goal-0.0001),position=offset+learnProgressRef.current;
  const expectedEvent=phrase.find(n=>n._start>=position-0.0001)||phrase[0];
  if(!expectedEvent){const hasLater=all.some(n=>n._start>=offset+goal-0.0001);if(hasLater){learnPhraseOffsetRef.current=offset+goal;learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};setLearnPhraseOffset(offset+goal);setLearnBarProgress(0);setLearnMessage('This phrase has no playable notes in the selected hand. Moving to the next phrase…');setTimeout(()=>{if(learnModeRef.current)playLearnPhrase()},400)}else{setLearnMessage('There are no more playable notes in this piece. Finish the lesson to save your practice.')}return}
  const group=phrase.filter(n=>Math.abs(n._start-expectedEvent._start)<0.0001),required=[...new Set(group.map(n=>Number(n.midi)).filter(Number.isFinite))],groupKey=offset+':'+expectedEvent._start;
  let tracker=learnChordHitsRef.current;if(tracker.key!==groupKey)tracker={key:groupKey,hits:[]};
  if(!required.includes(Number(midi))){learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};setLearnBarProgress(0);setLearnMessage(learnChunkDivision>1?'Not quite — this section will repeat. Listen and try it again.':'Not quite — this bar will repeat. Listen and try it again.');setStatus('Learn mode · repeat this bar');setLearnAnimationKey(v=>v+1);setTimeout(()=>{if(learnModeRef.current)playLearnPhrase()},250);return}
  if(!tracker.hits.includes(Number(midi)))tracker.hits.push(Number(midi));learnChordHitsRef.current=tracker;
  if(tracker.hits.length<required.length){const remaining=required.filter(value=>!tracker.hits.includes(value)).map(value=>midiToNote(value));setLearnMessage('Correct — '+note+'. Now play '+remaining.join(' + ')+' to complete the chord.');setStatus('Learn mode · chord '+tracker.hits.length+'/'+required.length);return}
  learnChordHitsRef.current={key:'',hits:[]};
  const nextEvent=phrase.find(n=>n._start>expectedEvent._start+0.0001);
  if(nextEvent){const next=Math.max(0,nextEvent._start-offset);learnProgressRef.current=next;setLearnBarProgress(Math.min(goal,next));setLearnMessage(required.length>1?'Chord correct — '+required.map(m=>midiToNote(m)).join(' + ')+'. Keep going.':'Correct — '+note+'. Keep going.');setStatus('Learn mode · correct '+note);return}
  const hasLater=all.some(n=>n._start>=offset+goal-0.0001),nextOffset=hasLater?offset+goal:offset;
  learnPhraseOffsetRef.current=nextOffset;if(hasLater)learnProgressRef.current=0;setLearnPhraseOffset(nextOffset);setLearnBarProgress(hasLater?0:goal);
  setLearnMessage(hasLater?'Bar correct — the next bar is ready.':'Excellent! You completed the playable score line. Finish the lesson to save your practice.');
  setStatus(hasLater?'Learn mode · phrase complete':'Learn mode · score complete');
  if(hasLater)setTimeout(()=>{if(learnModeRef.current)playLearnPhrase()},500);
 }
 function keyboardDown(e){
  const active=document.activeElement;
  if(e.repeat||e.metaKey||e.ctrlKey||e.altKey||['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)||active?.isContentEditable)return;
  const key=KEYMAP[String(e.key||'').toLowerCase()];
  if(!key)return;
  const code=e.code||('key:'+String(e.key||'').toLowerCase());
  if(heldComputerKeysRef.current[code])return;
  const base=keyboardStartMidi+computerOctaveOffset;
  const target=base+(noteToMidi(key)-60);
  const note=midiToNote(Math.max(21,Math.min(108,target)));
  e.preventDefault();
  heldComputerKeysRef.current[code]=note;
  pressKey(note);
 }
 function releaseKey(note){
  if(!note)return;
  heldKeysRef.current[note]=false;
  const midi=noteToMidi(note);
  if(midi!==null){if(learnListenMode){learnMicInputRef.current?.noteUp?.(midi)}else if(synth.current){try{synth.current.triggerRelease(midiToNote(midi),Tone.now())}catch{}}}
  setHeldKeys(v=>({...v,[note]:false}));
 }
 function releaseAllKeys(){
  const notes=new Set([...Object.values(heldComputerKeysRef.current),...Object.keys(heldKeysRef.current).filter(n=>heldKeysRef.current[n])]);
  heldComputerKeysRef.current={};
  notes.forEach(note=>{heldKeysRef.current[note]=false;const midi=noteToMidi(note);if(midi!==null){if(learnListenMode){learnMicInputRef.current?.noteUp?.(midi)}else if(synth.current){try{synth.current.triggerRelease(midiToNote(midi),Tone.now())}catch{}}}});
  if(synth.current){try{synth.current.releaseAll(Tone.now())}catch{}}
  heldKeysRef.current={};
  setHeldKeys({});
 }
 useEffect(()=>{
  const up=e=>{
   const code=e.code||('key:'+String(e.key||'').toLowerCase());
   const note=heldComputerKeysRef.current[code];
   if(note){delete heldComputerKeysRef.current[code];releaseKey(note);}
  };
  window.addEventListener('keyup',up,true);
  window.addEventListener('blur',releaseAllKeys);
  window.addEventListener('pagehide',releaseAllKeys);
  const visibility=()=>{if(document.hidden)releaseAllKeys()};
  document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('keyup',up,true);window.removeEventListener('blur',releaseAllKeys);window.removeEventListener('pagehide',releaseAllKeys);document.removeEventListener('visibilitychange',visibility)};
 },[]);
 useEffect(()=>{window.addEventListener('keydown',keyboardDown,true);return()=>window.removeEventListener('keydown',keyboardDown,true)});
 useEffect(()=>{releaseAllKeys()},[keyboardStart,keyboardOctaves]);
 const allKeys=Array.from({length:88},(_,i)=>({midi:i+21,note:midiToNote(i+21),black:[1,3,6,8,10].includes((i+21)%12)}));
 const keyboardStartMidi=clampKeyboardStartMidi(keyboardStart,keyboardOctaves);
 const keyboardEndMidi=keyboardStartMidi+keyboardOctaves*12;
 const keyboardVisibleWhiteKeys=allKeys.filter(k=>!k.black&&k.midi>=keyboardStartMidi&&k.midi<keyboardEndMidi);
 const keyboardWhiteKeyPercent=100/Math.max(1,keyboardVisibleWhiteKeys.length);
 const virtualWhiteKeys=allKeys.filter(k=>!k.black&&k.midi>=48&&k.midi<=72);
 const virtualBlackKeys=allKeys.filter(k=>k.black&&k.midi>=48&&k.midi<=72);
 const computerOctaveOffset=0;

 const blackOffsets={'C#':0.62,'D#':1.62,'F#':3.62,'G#':4.62,'A#':5.62};
 const dashboardSessions=sessions.filter(isMeaningfulPracticeSession).sort((a,b)=>new Date(b.lastPractisedAt||b.date||0)-new Date(a.lastPractisedAt||a.date||0));
 const practiceDays=getQualifyingPracticeDays(dashboardSessions);
 const streak=calculatePracticeStreak(dashboardSessions);
 const nav=['Dashboard','Practice','Sheet music','Grade plan','Extras'];
 const sheetMusicFiles=libraryFiles.filter(isSheetMusicLibraryItem).sort((a,b)=>new Date(b.added||0)-new Date(a.added||0));
 const visibleSheetMusicFiles=scoreLibraryExpanded?sheetMusicFiles:sheetMusicFiles.slice(0,3);
 const renderLearnFullscreen = () => {
   if(!learnListenMode||!sheetPianoOpen)return null;
   const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));
   let cursor=0;
   const engineNotes=loadedScoreNotes;
   return <KeystoneLearnEngine xml={scoreNotation?.sourceMusicXML||''} notes={engineNotes} bpm={bpm} timeSignature={timeSignature} title={songTitle||'Your piece'} micInputRef={learnMicInputRef} onConnectMic={startMic} onDisconnectMic={stopMic} microphoneListening={listening} microphoneLevel={level} microphoneStatus={micStatus} onFinish={summary=>finishLearnSession(true,summary)} onClose={()=>finishLearnSession(false)} />;
  };
return <div className="shell"><aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('Dashboard')}}><img className="brand-logo-mark" src="/assets/piano-coach-logo-mark.svg" alt=""/> <span>Piano Coach<small>Listen · Learn · Play</small></span></a><div className="nav-label">WORKSPACE</div>{nav.map(n=><button key={n} className={'nav-item '+(page===n?'active':'')} onClick={()=>setPage(n)}><span>{({'Dashboard':'⌂','Practice':'♫','Sheet music':'♬','Score converter':'⇄','Grade plan':'◎','Extras':'✦'})[n]}</span>{n}</button>)}<div className="sidebar-tools"><button title="Download all data (.musicdata)" aria-label="Download all data" onClick={downloadMusicData}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3"/></svg></button><button title="Restore data from .musicdata" aria-label="Upload backup data" onClick={()=>musicDataInputRef.current?.click()}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3"/></svg></button><input ref={musicDataInputRef} type="file" accept=".musicdata,application/vnd.piano-coach.musicdata+json,application/json" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)importMusicData(f);e.target.value=''}}/><button title="Delete local data" aria-label="Delete local data" onClick={()=>{if(confirm('Deleting your saved website data will permanently remove your practice sessions, saved studies and Library items from this device. This cannot be undone. Delete your data?')){setSessions([]);setSaved([]);setLibraryFiles([]);for(const k of ['pc_sessions','pc_studies','pc_files'])localStorage.removeItem(k);setStatus('Local data cleared')}}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div><div className="sidebar-logo"><a href="https://jws.l.cd" target="_blank" rel="noopener noreferrer" aria-label="Open your requested website"><img src="/assets/user-corner-logo.svg" alt="Open website"/></a></div></aside>
 <main className="main">{compactViewport&&!continueOnSmallScreen&&<div className="device-size-overlay" role="dialog" aria-modal="true" aria-labelledby="device-size-title"><section className="device-size-card"><div className="device-size-icon">⌘</div><div className="eyebrow">BEST EXPERIENCE</div><h2 id="device-size-title">Use a computer or iPad for Piano Coach</h2><p>Some tools — especially Listen & Learn, sheet music conversion and the piano keyboard — need a larger screen to work comfortably. We recommend opening Piano Coach on a computer or iPad.</p><p className="device-size-warning">You can still continue on this screen, but parts of the app may be cramped or may not function as expected.</p><div className="device-size-actions"><button className="btn btn-dark" onClick={()=>setContinueOnSmallScreen(true)}>Continue on this screen</button><span>Recommended: screen width of 900px or more</span></div></section></div>}<header className="topbar"><div><div className="eyebrow">YOUR PERSONAL MUSIC STUDIO</div><h1>{page==='Practice'?'Play, listen, improve.':page==='Dashboard'?'A little practice goes a long way.':page}</h1></div><div className="top-actions"><span className="status-chip"><i/> {status}</span><button className="btn btn-dark" onClick={()=>{setPage('Practice');setStatus('Ready to play')}}>＋ New session</button></div></header>
 {page==='Practice'&&practiceLibraryPicker&&<div className="practice-library-picker-backdrop" role="dialog" aria-modal="true" aria-labelledby="practice-library-picker-title">
  <section className="practice-library-picker">
   <header className="practice-library-picker-header"><div><span className="eyebrow">YOUR COLLECTION</span><h2 id="practice-library-picker-title">Choose sheet music</h2><p className="muted">Select a piece from your saved Library. Your normal Library controls are hidden while choosing.</p></div><button type="button" className="btn" onClick={()=>setPracticeLibraryPicker(false)} aria-label="Close sheet music picker">✕ Close</button></header>
   <input className="search-input practice-library-picker-search" value={practiceLibrarySearch} onChange={e=>setPracticeLibrarySearch(e.target.value)} placeholder="Search your sheet music…"/>
   <div className="practice-library-picker-list">
    {libraryFiles.filter(x=>((x.kind==='score'||x.kind==='practice-score'||/musicxml|xml|pdf|image\//i.test(x.type)||/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i.test(x.name))&&(!x.type?.startsWith('audio/')||/\.(mid|midi)$/i.test(x.name)))&&x.name.toLowerCase().includes(practiceLibrarySearch.toLowerCase())).map(x=><article className="practice-library-picker-item" key={x.id}>
     <div className="practice-library-picker-icon">▤</div><div className="practice-library-picker-meta"><strong>{x.name}</strong><span>{Math.max(1,Math.round((Number(x.size)||0)/1024))} KB · {(x.type||x.name.split('.').pop()||'Sheet music').replace('application/','').replace('image/','').toUpperCase()}</span></div>
     <button type="button" className="btn btn-dark" onClick={()=>choosePracticeLibraryScore(x)}>Choose</button>
    </article>)}
    {!libraryFiles.some(x=>((x.kind==='score'||x.kind==='practice-score'||/musicxml|xml|pdf|image\//i.test(x.type)||/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i.test(x.name))&&(!x.type?.startsWith('audio/')||/\.(mid|midi)$/i.test(x.name)))&&x.name.toLowerCase().includes(practiceLibrarySearch.toLowerCase()))&&<div className="empty-state"><strong>{practiceLibrarySearch?'No matching sheet music':'Your Library is empty'}</strong><p>{practiceLibrarySearch?'Try another title or clear your search.':'Add sheet music in the Library first, then return here to choose it for Practice.'}</p><button type="button" className="btn" onClick={()=>setPracticeLibraryPicker(false)}>Back to Practice</button></div>}
   </div>
  </section>
 </div>}
 {page==='Practice'&&!practiceStarted&&<section className="panel practice-setup practice-setup-flow">
  <div className="practice-welcome"><div className="eyebrow">YOUR PRACTICE SPACE</div><h2>Let's get you playing</h2><p className="muted">Follow these three steps. You can change your choices later.</p></div>
  <div className="practice-step"><div className="practice-step-number">1</div><div className="practice-step-content"><div className="practice-step-heading"><div><span className="eyebrow">YOUR MUSIC</span><h3>What would you like to practise?</h3></div>{practiceScoreName&&<span className="practice-loaded-pill">✓ Score loaded</span>}</div>
   <label className="sequence-label">Piece name <span className="muted small">Optional · press Enter to find recordings</span><input value={songTitle} onChange={e=>{setSongTitle(e.target.value);if(referenceSong){setReferenceSong(null);setReferenceStatus('Song reference not loaded');}}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();findPracticeReferences(songTitle);}}} placeholder="e.g. Moonlight Sonata"/></label>
   <button type="button" className="text-button" disabled={!songTitle.trim()||practiceReferenceBusy} onClick={()=>findPracticeReferences(songTitle)}>{practiceReferenceBusy?'Searching…':'Find playable recordings ↗'}</button>
   {renderPracticeReferencePicker()}
   <div className="practice-music-choice">{practiceScoreName?<div className="practice-score-loaded"><strong>{practiceScoreName}</strong><span>Your sheet music is ready to use.</span></div>:<div><strong>No sheet music selected</strong><span>You can still practise with the microphone or keyboard.</span></div>}<button type="button" className="btn" onClick={()=>{setPracticeLibrarySearch('');setPracticeLibraryPicker(true)}}>{practiceScoreName?'Change sheet music':'Choose sheet music'} ↗</button></div>
  </div></div>
  <div className="practice-step"><div className="practice-step-number">2</div><div className="practice-step-content"><span className="eyebrow">PRACTICE STYLE</span><h3>How do you want to practise?</h3><div className="practice-style-options">
   <button type="button" className={'practice-style-card '+(practiceMode==='normal'?'selected':'')} aria-pressed={practiceMode==='normal'} onClick={()=>setPracticeMode('normal')}><span className="practice-style-icon">♫</span><strong>Free practice</strong><span>Play naturally, record your performance and review detected notes.</span><i>{practiceMode==='normal'?'Selected ✓':'Select free practice'}</i></button>
   <button type="button" className={'practice-style-card '+(practiceMode==='learn'?'selected':'')} aria-pressed={practiceMode==='learn'} onClick={()=>setPracticeMode('learn')}><span className="practice-style-icon">▤</span><strong>Listen & Learn</strong><span>Follow the score with falling notes, bar-by-bar guidance and MIDI or microphone input.</span><i>{practiceMode==='learn'?'Selected ✓':'Select Listen & Learn'}</i><span className="learn-beta-pill">BETA</span></button>
  </div></div></div>
  <div className="practice-step"><div className="practice-step-number">3</div><div className="practice-step-content"><span className="eyebrow">SESSION LENGTH</span><h3>How long would you like to practise?</h3><div className="practice-duration-options">{[5,10,15,20,30].map(m=><button type="button" key={m} className={Number(practiceMinutes)===m?'selected':''} aria-pressed={Number(practiceMinutes)===m} onClick={()=>setPracticeMinutes(String(m))}>{m} min</button>)}</div><details className="practice-advanced-settings"><summary>Advanced settings <span>Time signature</span></summary><label className="sequence-label">Time signature / beats per bar<select value={timeSignature} onChange={e=>setTimeSignature(e.target.value)}><option value="2/4">2/4 · 2 beats per bar</option><option value="3/4">3/4 · 3 beats per bar</option><option value="4/4">4/4 · 4 beats per bar</option><option value="6/8">6/8 · 6 eighth-beats per bar</option><option value="12/8">12/8 · 12 eighth-beats per bar</option></select></label></details></div></div>
  <div className="practice-start-row"><div><strong>Ready when you are</strong><span>{practiceMode==='learn'?'Listen & Learn will open your guided piano-roll lesson.':'Your microphone will connect when you start.'}</span></div><button className="btn btn-dark" onClick={()=>{if(practiceMode==='learn'){toggleLearnSession()}else{beginPractice()}}} disabled={!(Number(practiceMinutes)>0)||musicCoachBusy}>Start {practiceMode==='learn'?'Listen & Learn':'practice'} →</button></div>
  <p className="practice-privacy-note">Your microphone is only requested when the session begins. You can stop it at any time. PDF and image scores need converting before they can be played as notes.</p>
 </section>}
 {page==='Practice'&&practiceStarted&&practiceMode!=='learn'&&<section className="practice-guidance"><div className="practice-guidance-title"><span className="eyebrow">YOUR SESSION · {songTitle||'PRACTICE'}</span><strong>{!listening?'Step 1 of 3 · Connect your microphone':!isRecording?'Step 2 of 3 · Start playing':'Step 3 of 3 · Finish when you are ready'}</strong></div><div className="practice-guidance-steps"><span className={!listening?'current':'complete'}><b>1</b> Connect</span><span className={isRecording?'current':listening?'next':''}><b>2</b> Play & record</span><span><b>3</b> Review & save</span></div><button className="btn btn-dark practice-next-action" onClick={()=>{if(!listening)startMic();else if(!isRecording)startRecording();else stopRecording()}} disabled={isAnalyzing}>{!listening?'Enable microphone':!isRecording?'Start recording':'Stop recording' } →</button><p>{!listening?'Allow microphone access when your browser asks.':!isRecording?'Play your piece. Your detected notes will appear in the panel beside this one.':'When you stop, Piano Coach analyses the recording. You can then review feedback and save your session.'}</p></section>}{page==='Practice'&&practiceStarted&&practiceMode!=='learn'&&(loadedScoreMusicXML)&&<section className="panel practice-source-score"><div className="panel-head"><div><div className="eyebrow">YOUR SHEET MUSIC</div><h2>{songTitle||'Practice score'}</h2><p className="muted">Double-click the notation to expand it to fullscreen.</p></div><button className="btn" onClick={()=>setFullscreenScore({xml:loadedScoreMusicXML,title:songTitle||'Practice score'})}>Expand sheet ↗</button></div><MusicXMLPreview xml={loadedScoreMusicXML} title={songTitle||'Practice score'}/></section>}{page==='Practice'&&practiceStarted&&<><div className="practice-grid"><section className="panel studio-panel"><div className="panel-head"><div><div className="eyebrow">PRACTICE SESSION</div><h2>{songTitle||"Your practice"}</h2><p className="muted">Play your instrument while Piano Coach listens and records.</p></div><span className="tag">{bpm} BPM</span></div><div className="toolbar practice-metronome"><button className={'btn '+(metronome?'btn-tint':'')} onClick={toggleMetro}>{metronome?'Ⅱ Stop metronome':'◷ Metronome'}</button><label className="sequence-label">Tempo · {bpm} BPM<input type="range" min="40" max="240" value={bpm} onChange={e=>changeSongTempo(e.target.value)}/></label></div><div className="divider"/><div className="panel-head"><div><h3>Listen through your microphone</h3><p className="muted">Best for single-note pitch tracking. Chord transcription is not supported by this detector.</p></div><span className={'tag '+(listening?'tag-live':'')}>{listening?'LISTENING':'MIC OFF'}</span></div><div className="mic-row"><div className="meter"><div style={{width:level+'%'}}/></div><span className="muted">{level}% input</span>{!listening?<button className="btn btn-dark" onClick={startMic}>Enable microphone</button>:<button className="btn" onClick={stopMic}>Disconnect mic</button>}</div><p className="muted small">{micStatus}</p><div className="toolbar live-feedback-controls"><button type="button" className={"btn "+(liveFeedback?"btn-dark":"")} onClick={()=>setLiveFeedback(v=>!v)}>{liveFeedback?"✓ Live pitch feedback on":"Enable live pitch feedback"}</button><span className="muted small">{liveFeedback?"Immediate single-note checks are active. Detailed polyphonic AI review runs when you finish recording.":"Turn this on to compare detected notes with your target as you play."}</span></div><p className="session-timer">Time remaining <strong>{Math.floor(remainingSeconds/60).toString().padStart(2,'0')}:{(remainingSeconds%60).toString().padStart(2,'0')}</strong></p><div className="toolbar">{!isRecording?<button className="btn btn-danger" disabled={!listening} onClick={startRecording}>● Start recording</button>:<button className="btn btn-danger" onClick={stopRecording}>■ Stop recording · {recordingSeconds}s</button>}{recording&&<><button className="btn" onClick={playRecording}>▶ Play recording</button></>}<button className="btn btn-dark" onClick={()=>{saveSession();setPracticeStarted(false);setPage('Dashboard')}}>Finish & save session</button></div>{audioError&&<p className="audio-error" role="alert">{audioError}</p>}</section>
 <aside className="panel notes-panel"><div className="panel-head"><div><div className="eyebrow">LIVE TRANSCRIPTION</div><h2>Detected notes</h2></div><span className="count">{events.length}</span></div><p className="muted">Notes transcribed from your microphone recording, compared with a reference recording found from your song title when available.</p><div className="analysis-summary"><strong>Song likeness analysis</strong><p>{referenceStatus}</p>{referenceSong&&<p className="muted small">Reference: {referenceSong.title} — {referenceSong.artist}</p>}<button className="text-button" type="button" onClick={()=>findPracticeReferences(songTitle)}>Find recordings automatically</button>{renderPracticeReferencePicker()}</div>{isAnalyzing&&<p className="analysis-progress">Analysing your recording and detecting pitches…</p>}{events.length>0&&<div className="analysis-summary"><strong>Recording analysis</strong><p>{events.length} note events detected</p><p className="muted small">{[...new Set(events.map(n=>n.note))].join(' · ')}</p></div>}<Staff notes={events} expanded={expanded} bpm={bpm} timeSignature={timeSignature}/><button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'− Compact staff':'+ Expand staff'}</button><div className="notes-list">{events.slice(-12).reverse().map((e,i)=><div className="note-row" key={e.id}><span className="note-dot">{e.note.replace(/[0-9]/g,'')}</span><strong>{e.note}</strong><span className="muted">{e.time}s</span><span className="source">{e.source==='microphone'?'MIC':'KEY'}</span></div>)}{!events.length&&<div className="empty-state"><div className="music-icon">♫</div><strong>Your notes will appear here</strong><p>Play a key or enable your microphone to begin. The staff and event list update together.</p></div>}</div><div className="notes-actions"><button className="btn" onClick={undoNote} disabled={!events.length}>↶ Undo</button><button className="btn" onClick={exportMusicCoach} disabled={!events.length}>↓ Save .musiccoach</button><button className="btn btn-quiet" onClick={clearNotes} disabled={!events.length}>Clear</button></div></aside></div>
 <section className="panel compare-panel"><div className="panel-head"><div><div className="eyebrow">SESSION REVIEW</div><h2>Practice feedback</h2><p className="muted">The recording is analysed as audio first, then detected pitches, onsets and note lengths are used for feedback. The text AI does not directly hear the waveform; the audio model transcribes it.</p></div></div><label className="sequence-label">Your reflection<textarea value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="What felt good? What needs work?"/></label><div className="tutor-answer"><strong>Practice feedback</strong><p>{practiceFeedback||'Stop recording to automatically analyse your performance.'}</p></div><div className="divider"/><div className="panel-head"><div><h3>AI piano tutor</h3><p className="muted">Ask about this attempt. The local model loads when you first ask.</p></div><span className="tag">AUDIO-BASED REVIEW</span></div><div className="tutor-form"><input value={tutorQuestion} onChange={e=>setTutorQuestion(e.target.value)} placeholder="Ask about a bar, fingering, rhythm…"/><button className="btn" onClick={startVoiceQuestion} title="Speak your question">🎙</button><button className="btn btn-dark" disabled={tutorBusy||!tutorQuestion.trim()} onClick={askTutor}>{tutorBusy?'Thinking…':'Ask AI tutor'}</button></div><p className="muted small">{tutorStatus}</p>{tutorAnswer&&<div className="tutor-answer" role="status">{tutorAnswer}</div>}</section>{(scoreSourceAsset||scoreImageUrl||scoreNotation?.sourceMusicXML||loadedScoreNotes.length>0)&&<section className="panel practice-score-bottom"><div className="panel-head"><div><div className="eyebrow">YOUR SHEET MUSIC</div><h2>{songTitle||scoreImageName||'Practice score'}</h2><p className="muted">Scroll here to view the score you uploaded. The embedded preview stays with the .musiccoach file when available.</p>{scoreSourceAsset?.warning&&<p className="muted small">{scoreSourceAsset.warning}</p>}</div><button className="btn btn-dark" onClick={()=>setPage('Sheet music')}>Open sheet music workspace →</button></div>{scoreImageUrl?<div className="practice-source-preview">{scoreIsPdf?<iframe title="Uploaded sheet music PDF" src={scoreImageUrl} style={{width:'100%',minHeight:520,border:0}}/>:<img src={scoreImageUrl} alt={scoreImageName||'Uploaded sheet music'}/>}</div> :loadedScoreMusicXML?<MusicXMLPreview xml={loadedScoreMusicXML} title={songTitle||'Practice score'}/>:<><div className="musiccoach-native-preview"><Staff notes={loadedScoreNotes} expanded bpm={bpm} timeSignature={timeSignature}/></div><p className="muted small">Native Piano Coach score · {scoreNotation?.notationEvents?.length||0} notation markings preserved.</p><div className="editable-score"><Staff notes={parseMusicSequence(expected).map((n,i)=>({id:i,note:n.note,midi:n.midi,rest:n.rest,beats:n.beats,time:i*(60/bpm),duration:n.beats*60/bpm}))} expanded bpm={bpm} timeSignature={timeSignature}/></div></>}<div className="toolbar"><button className="btn" onClick={exportMusicCoach}>Save .musiccoach</button></div></section>}</>}
 {page==='Dashboard'&&<><section className="welcome panel"><div><span className="tag">YOUR MUSIC JOURNEY</span><h2 className="dashboard-tagline">Make time for music.</h2><p className="muted">A calm space to practise, explore sheet music and track your progress.</p><div className="dashboard-quick-actions"><button className="btn btn-dark dashboard-primary" onClick={()=>{setPracticeStarted(false);setPage('Practice');setStatus('Ready to play')}}>Start a practice session <span aria-hidden="true">→</span></button><button className="btn" onClick={()=>setPage('Sheet music')}>Open sheet music</button><button className="btn" onClick={()=>setPage('Score converter')}>Convert sheet music</button></div></div><div className="welcome-mark" aria-hidden="true">♫</div></section><section className="streak-card" aria-label="Practice streak"><div className="streak-flame" aria-hidden="true">🔥</div><div className="streak-copy"><span className="tag">YOUR DAILY STREAK</span><h2>{streak} {streak===1?'day':'days'} in a row</h2><p>{streak?'Amazing consistency — keep your music habit going!':'Start your streak today with a short practice session.'}</p><div className="streak-week" aria-label="Last seven days">{Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');const active=practiceDays.includes(key);return <div key={key} className={'streak-day '+(active?'done':'')}><span>{['S','M','T','W','T','F','S'][d.getDay()]}</span><b>{active?'✓':d.getDate()}</b></div>})}</div></div><button className="btn btn-dark streak-cta" onClick={()=>setPage('Practice')}>{streak?'Keep it going':'Start practising'} →</button></section><section className="learn-launch-card"><div className="learn-launch-icon" aria-hidden="true">♫</div><div className="learn-launch-copy"><span className="tag">GUIDED LEARNING · BETA</span><h2>Listen, learn and play</h2><p>Hear a short phrase, play it back, and track your learning as practice time.</p></div><button className="btn btn-dark" disabled={!loadedScoreNotes.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))} title={!loadedScoreNotes.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))?'Upload playable sheet music before starting a lesson':'Start Listen & Learn'} onClick={()=>{setPage('Sheet music');setSheetPianoOpen(true);if(!learnListenMode)toggleLearnSession()}}>Start a lesson →</button></section><section className="dashboard-overview"><div className="dashboard-section-title"><div><h2>Your progress</h2><p className="muted">A quick look at your work so far.</p></div></div><div className="stats-grid"><article className="stat-card"><span>Sessions</span><strong>{dashboardSessions.length}</strong></article><article className="stat-card"><span>Practice time</span><strong>{Math.round(dashboardSessions.reduce((a,s)=>a+getPracticeSeconds(s),0)/60*10)/10} <em>min</em></strong></article><article className="stat-card"><span>Saved studies</span><strong>{saved.length}</strong></article></div></section><section className="dashboard-sessions"><div className="dashboard-section-title"><div><h2>Recent practice</h2><p className="muted">Pick up where you left off.</p></div><button className="btn" onClick={()=>setPage('Practice')}>New session</button></div>{dashboardSessions.length?dashboardSessions.slice(0,3).map(s=><div className="list-item dashboard-session" key={s.id}><span className="list-icon" aria-hidden="true">♫</span><div><strong>{s.song||'Practice session'}</strong><small>{new Date(s.date).toLocaleDateString()} · {s.notes} note events</small></div><span className="dashboard-session-time">{Math.round((s.practiceSeconds??((s.minutes||0)*60))/60*10)/10} min</span><button className="btn" onClick={()=>resumeSavedSession(s)}>{s.practiceMode==='learn'?'Resume L&L':'Continue'}</button></div>):<div className="dashboard-empty"><div><strong>Ready when you are</strong><p>Your saved practice sessions will appear here.</p></div><button className="btn" onClick={()=>setPage('Practice')}>Start your first session</button></div>}</section></>}{page==='Sheet music'&&<div key="sheet-music-page" className="sheet-music-workspace">
<section className="panel personal-scores-panel">
 <div className="panel-head"><div><div className="eyebrow">YOUR COLLECTION</div><h2>Your music library</h2><p className="muted">Scores and recordings saved in this browser. Your music stays available between visits.</p></div><span className="tag">{sheetMusicFiles.length} saved</span></div>
 <label className="upload-score personal-score-upload"><span>Import sheet music</span><input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,.pdf,.png,.jpg,.jpeg,.webp,.svg,application/vnd.recordare.musicxml+xml,image/png,image/jpeg,image/webp,application/pdf,application/xml,text/xml" onChange={e=>{const file=e.target.files?.[0];if(file)handleScoreUpload(file,{target:'Sheet music',download:false});e.target.value=''}}/></label><div className="song-tempo-controls"><div className="song-tempo-value"><label htmlFor="song-tempo-slider">Tempo</label><strong>{songTempo} BPM</strong></div><input id="song-tempo-slider" type="range" min="20" max="240" step="1" value={songTempo} onChange={e=>changeSongTempo(e.target.value)}/><label className="song-meter-label">Time signature<select value={songMeter} onChange={e=>{const next=e.target.value;songMeterRef.current=next;setSongMeter(next);Object.entries(songAudioRefs.current).forEach(([id,audio])=>{if(audio){audio.playbackRate=getSongPlaybackRate(songTempoRef.current,next,tempoDetectionCacheRef.current[id]);audio.preservesPitch=true;audio.webkitPreservesPitch=true}});Object.entries(audioLibraryRefs.current).forEach(([id,audio])=>{if(audio){audio.playbackRate=getSongPlaybackRate(songTempoRef.current,next,tempoDetectionCacheRef.current[id]);audio.preservesPitch=true;audio.webkitPreservesPitch=true}})}}><option>4/4</option><option>2/4</option><option>3/4</option><option>4/8</option><option>6/8</option><option>3/8</option><option>2/2</option><option>3/2</option></select></label><span className="song-tempo-meta" role="status">{songTempoStatus}</span></div>
 <div className="personal-score-grid">
  {visibleSheetMusicFiles.length?visibleSheetMusicFiles.map((item,i)=>{const playable=isPlayableSheetMusicItem(item),audioItem=isAudioLibraryFile(item)&&!isMidiLibraryFile(item);return <article className="personal-score-card" key={item.id||item.name||i} onDoubleClick={()=>{if(!audioItem)openLibrarySheetFullscreen(item)}} title={audioItem?'Audio recording — use Play to listen':'Double-click to open this sheet music'}>
   <LibraryScorePreview item={item} onExpand={()=>openLibrarySheetFullscreen(item)}/>
   <div className="personal-score-meta"><strong title={item.name}>{item.name||'Untitled score'}</strong><span>{item.type||'Sheet music'} · {(item.size||0)>=1024*1024?((item.size||0)/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round((item.size||0)/1024))+' KB'}</span></div>
   <div className="personal-score-actions sheet-music-action-row">
    {audioItem?<><audio ref={el=>{if(el)audioLibraryRefs.current[item.id]=el;else delete audioLibraryRefs.current[item.id]}} src={item.data||undefined} preload="none" onEnded={()=>setLibraryPlayback({id:null,kind:'',paused:true})}/><button type="button" className="btn btn-dark icon-action compact-score-play" aria-label={libraryPlayback.id===item.id&&libraryPlayback.kind==="audio"&&!libraryPlayback.paused?'Pause recording':'Play recording'} disabled={!item.data} onClick={e=>{e.stopPropagation();toggleLibraryAudio(item)}}>{libraryPlayback.id===item.id&&libraryPlayback.kind==="audio"&&!libraryPlayback.paused?'Ⅱ':'▶'}</button><button type="button" className="btn icon-action compact-score-stop" aria-label="Stop recording" disabled={!item.data} onClick={e=>{e.stopPropagation();stopLibraryItem(item)}}>■</button></>:playable?<><button type="button" className="btn btn-dark icon-action compact-score-play" aria-label={libraryPlayback.id===item.id&&libraryPlayback.kind==="tone"&&!libraryPlayback.paused?'Pause':'Play'} onClick={e=>{e.stopPropagation();toggleScoreLibraryPlayback(item)}}>{libraryPlayback.id===item.id&&libraryPlayback.kind==="tone"&&!libraryPlayback.paused?'Ⅱ':'▶'}</button><button type="button" className="btn icon-action compact-score-stop" aria-label="Stop" onClick={e=>{e.stopPropagation();stopLibraryItem(item)}}>■</button></>:<span className="muted small">Source score · not directly playable</span>}
    <button type="button" className="text-button" onClick={e=>{e.stopPropagation();downloadLibraryFile(item)}}>Download</button>
    {playable?<button type="button" className="btn btn-dark learn-library-button" onClick={e=>{e.stopPropagation();setPracticeSetupStep(1);setPracticeMode('learn');setPracticeStarted(false);openLibraryScore(item);}}>Learn</button>:<button type="button" className="btn learn-library-button" disabled title="Convert this file to a Piano Coach score before learning">Learn</button>}
    <button type="button" className="icon-action delete-score-button" aria-label={'Delete '+item.name} title="Delete from library" onClick={e=>{e.stopPropagation();deleteLibraryItem(item)}}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg></button>
   </div>
  </article>}):<div className="personal-score-empty"><div className="music-icon">♫</div><strong>Your saved music will appear here</strong><p>Import MusicXML, MIDI, a .musiccoach score, PDF or a score image to begin.</p><button className="btn" onClick={()=>setPage('Score converter')}>Open sheet music converter →</button></div>}
 </div>
 {sheetMusicFiles.length>3&&<div className="library-expand-control"><button type="button" className="btn" onClick={()=>setScoreLibraryExpanded(value=>!value)}>{scoreLibraryExpanded?'Show fewer scores':'Show all '+sheetMusicFiles.length+' items'}</button></div>}

 <p className="muted small score-library-note">Scores and recordings are saved locally. Audio recordings can be played here; MIDI and native Piano Coach scores use notation playback. PDFs and images open as sheet music, but do not play as audio.</p>
 <div className="sheet-converter-cta"><div><strong>Got sheet music you want online?</strong><span>Convert your sheet music into an interactive score in Piano Coach.</span></div><button type="button" className="btn btn-dark" onClick={()=>setPage('Score converter')}>Visit the sheet music converter →</button></div>
</section></div>}
 {sheetPianoOpen&&!learnListenMode?(<div className="piano-modal-backdrop" role="dialog" aria-modal="true" aria-label="Piano playback and learning"><section className="panel piano-modal"><div className="panel-head"><div><div className="eyebrow">PIANO PLAYER</div><h2>{songTitle||'Your score'}</h2></div><button className="btn" onClick={()=>setSheetPianoOpen(false)}>Close ✕</button></div><p className="muted">Hear the score phrase, then repeat it on a real piano with microphone listening or on the laptop keyboard.</p><div className="toolbar"><button className="btn" onClick={()=>listening?stopMic():startMic()}>{listening?'Disconnect piano microphone':'🎙 Listen to my piano'}</button><button className="btn btn-dark" onClick={async()=>{const ns=parseMusicSequence(expected).slice(0,Math.max(1,Number(timeSignature.split('/')[0])*2));const s=await ensureSynth();let beat=0;for(const n of ns){if(!n.rest&&n.midi!=null)s.triggerAttackRelease(midiToNote(n.midi),Math.max(.12,n.beats*60/bpm),Tone.now()+beat*60/bpm);beat+=n.beats||1}setLearnMessage('Playing the score preview. Listen, then repeat the phrase.')}}>▶ Listen to score</button><button className="btn" disabled={!learnListenMode&&!loadedScoreNotes.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))} title={!learnListenMode&&!loadedScoreNotes.some(n=>!n.rest&&Number.isFinite(n.midi??noteToMidi(n.note)))?'Upload playable sheet music to enable Listen & Learn':''} onClick={()=>{if(learnListenMode){finishLearnSession()}else{toggleLearnSession();setLearnMessage('Play the current bar or section using the on-screen piano or your real piano MIDI keyboard. Lesson time counts towards practice.')}}}>{learnListenMode?'■ Finish lesson':'Start two-bar lesson'}</button></div><div className="virtual-piano-scroll"><div className="piano virtual-piano" style={{"--keyboard-white-key-width":(100/Math.max(1,virtualWhiteKeys.length))+"%"}} aria-label="Virtual piano keyboard">{virtualWhiteKeys.map(k=><button key={k.midi} className={"white-key "+(heldKeys[k.note]?"is-held":"")} style={{flex:"0 0 var(--keyboard-white-key-width)",width:"var(--keyboard-white-key-width)",minWidth:0}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)} aria-label={"Play "+k.note} title={k.note}><span>{k.note}</span></button>)}{virtualBlackKeys.map(k=><button key={k.midi} className={"black-key "+(heldKeys[k.note]?"is-held":"")} style={{left:(virtualWhiteKeys.filter(w=>w.midi<k.midi).length*(100/Math.max(1,virtualWhiteKeys.length)))+"%",width:(100/Math.max(1,virtualWhiteKeys.length))*.62+"%",transform:"translateX(-50%)"}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)} aria-label={"Play "+k.note} title={k.note}><span>{k.note}</span></button>)}</div></div><p className="muted small">For microphone practice, close this panel and start the microphone in Practice. Laptop keyboard mapping: A W S E D F T G Y H U J K.</p></section></div>):null}{renderLearnFullscreen()}{page==='Score converter'&&<section className="panel musiccoach-converter"><div className="toolbar extras-toolbar"><button className="btn" onClick={()=>{setPage('Extras');setExtraTool('keyboard')}}>Open online keyboard</button><button className="btn" onClick={()=>{setPage('Extras');setExtraTool('assistant')}}>♫ Music assistant</button><button className="btn btn-dark" disabled>Sheet music converter</button></div><div className="eyebrow">SCORE CONVERTER</div><h2>Sheet music converter</h2><p className="muted">Import MusicXML/XML, MIDI, MP3, M4A, MP4 or WebM files for conversion. Audio is transcribed locally into notes; PDF scans are processed page by page and combined into one continuous score. For image files, upload one clear page per image. PDF/image scans use on-device HOMR recognition; complex notation still needs checking against the original.</p><div className="converter-input-actions"><button type="button" className="btn btn-dark converter-camera-button" onClick={openScoreCamera} disabled={musicCoachBusy}> <span aria-hidden="true">▣</span> Convert from photo <span className="beta-pill">BETA</span></button>
 <label className={"upload-score musiccoach-upload"+(scoreDropActive?' is-drag-active':'')} onDragEnter={e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();setScoreDropActive(true)}}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';setScoreDropActive(true)}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setScoreDropActive(false)}} onDrop={e=>{e.preventDefault();e.stopPropagation();setScoreDropActive(false);const file=e.dataTransfer?.files?.[0];if(file)convertScoreToMusicCoach(file,{target:'Score converter',download:false})}}><span className="musiccoach-upload-icon" aria-hidden="true">⇧</span><strong>{musicCoachBusy?'Analysing your file…':'Drop a file here or choose from your device'}</strong><small>PDF, PNG, JPG, WebP, MusicXML, MIDI, MP3, M4A, WAV, MP4 or WebM</small><input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,.svg,.mp3,.m4a,.wav,.mp4,.webm,application/vnd.musiccoach.score+json,application/vnd.recordare.musicxml+xml,application/xml,text/xml,audio/midi,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm,video/mp4,video/webm,application/pdf,.pdf,image/png,image/jpeg,image/webp,image/svg+xml" disabled={musicCoachBusy} onChange={e=>{const f=e.target.files?.[0];if(f)convertScoreToMusicCoach(f,{target:'Score converter',download:false});e.target.value=''}}/></label></div>{(!musicCoachBusy&&scoreNotation)&&<details className="notation-guide"><summary id="notation-guide-title">Notation identification guide <span>Optional · expand</span></summary><p className="muted small">Tick any symbols you can see in the score. The AI will explain these markings and use your observations as context. They are <strong>not automatically recognised</strong>; the AI cannot see the original image.</p><div className="notation-guide-grid">{NOTATION_GUIDE.map(item=><label className="notation-guide-item" key={item.id}><input type="checkbox" checked={musicCoachMarkings.includes(item.id)} onChange={e=>setMusicCoachMarkings(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/><span><strong>{item.label}</strong><small>{item.help}</small></span></label>)}</div><p className="muted small">{musicCoachMarkings.length} marking group{musicCoachMarkings.length===1?"":"s"} selected. You can leave this blank if you are unsure.</p></details>}<p className="muted small">{musicCoachStatus}</p>{conversionSavedNotice&&<div className="conversion-saved-banner" role="status"><span><strong>✓ Saved to Library</strong> — your converted sheet music is ready. You can find it at the top of your Library.</span><button type="button" className="text-button" onClick={()=>setConversionSavedNotice(false)} aria-label="Close saved notice">Close ✕</button><button type="button" className="btn" onClick={()=>{setConversionSavedNotice(false);openLibraryScores()}}>Open Library</button></div>}{musicCoachBusy&&<div className="musiccoach-progress" role="status"><span/></div>}{cameraOpen&&<div className="score-camera-backdrop" role="dialog" aria-modal="true" aria-labelledby="score-camera-title"><section className="score-camera-dialog">
 <header className="score-camera-header"><div><span className="eyebrow">SHEET MUSIC CONVERTER · BETA</span><h3 id="score-camera-title">Photograph your sheet music</h3><p className="muted small">Fit the entire page inside the guide. The sheet must be clean and have <strong>no handwriting, highlighting, notes, folds or other markings</strong>. Keep it flat, sharply focused, straight-on and evenly lit with no glare or shadows.</p></div><button type="button" className="btn" onClick={stopScoreCamera}>✕ Close</button></header>
 {cameraError&&<p className="audio-error" role="alert">{cameraError}</p>}
 <div className="score-camera-preview"><div className="score-camera-frame" aria-hidden="true"><span/><span/><span/><span/></div>{cameraStreamRef.current?<video ref={cameraVideoRef} autoPlay muted playsInline aria-label="Live camera preview"/>:<div className="score-camera-placeholder">Camera preview will appear here</div>}</div>
 <div className="score-camera-actions"><button type="button" className="btn" onClick={stopScoreCamera}>Cancel</button><button type="button" className="btn btn-dark" onClick={captureScorePhoto} disabled={!cameraStreamRef.current||cameraBusy||musicCoachBusy}>{cameraBusy?'Capturing…':'Take photo & convert'}</button></div>
 <p className="muted small"><strong>Photo quality matters:</strong> use a clear, unmarked original sheet, show all four page edges, avoid angled shots, blur, glare and shadows. Photos are processed in this browser using the existing on-device music recognition.</p>
 </section></div>}
 {(scoreImageUrl||scoreNotation?.sourceMusicXML||loadedScoreNotes.length>0)&&<div className="score-review-grid">{scoreImageUrl&&<section className="score-review-card"><div className="eyebrow">ORIGINAL SCORE</div><div className="score-preview">{scoreIsPdf?<iframe title="Original score PDF" src={scoreImageUrl} style={{width:'100%',minHeight:420,border:0}}/>:<img src={scoreImageUrl} alt={scoreImageName||'Original score'}/>}<strong>{scoreImageName||'Original uploaded score'}</strong></div></section>}{(scoreNotation?.sourceMusicXML||loadedScoreNotes.length>0)&&<section className="score-review-card"><div className="eyebrow">CONVERTED NOTATION</div>{loadedScoreMusicXML?<MusicXMLPreview xml={loadedScoreMusicXML} title={songTitle||'Converted score'}/>:<div className="musiccoach-native-preview"><Staff notes={loadedScoreNotes} expanded bpm={bpm} timeSignature={timeSignature}/></div>}</section>}</div>}{musicCoachAnalysis&&<div className="tutor-answer"><strong>AI analysis</strong><p>{musicCoachAnalysis}</p></div>}<div className="toolbar"><button className="btn" onClick={()=>{setPage('Sheet music');setLibraryTab('scores')}}>View saved scores</button><button className="btn btn-dark" disabled={!(scoreNotation?.sourceMusicXML||loadedScoreNotes.length>0)} onClick={()=>{setPage('Sheet music');setLibraryTab('scores')}}>Review in Sheet Music</button></div></section>}{false&&page==='Extras'&&extraTool==='score'&&<div className="sheet-music-workspace"><section className="panel"><div className="eyebrow">SCORE TOOLS</div><h2>Work with your score</h2><p className="muted">Upload notation, inspect it, extract a draft note sequence, and send it to practice. Use Sheet music to search across catalogues and sources.</p><label className="upload-score">Upload score PDF or image<input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Extras'});e.target.value=''}}/></label><label className="upload-score">Import MusicXML or .musiccoach<input type="file" accept=".musiccoach,.musicxml,.xml,application/vnd.musiccoach.score+json,application/xml,text/xml" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Extras'});e.target.value=''}}/></label>{scoreImageUrl&&<div className="score-preview">{scoreIsPdf?<iframe title="Score preview" src={scoreImageUrl} style={{width:"100%",minHeight:360}}/>:<img src={scoreImageUrl} alt="Uploaded score"/>}<strong>{scoreImageName}</strong></div>}<label className="sequence-label">Notes from score<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4/q D4/h R/q E4/e"/></label><p className="muted small">Enter notes with durations: <b>/w</b> whole note, <b>/h</b> minim (half note), <b>/q</b> crotchet (quarter), <b>/e</b> quaver (eighth), and <b>R/q</b> for a quarter rest. Example: C4/q D4/h R/q E4/e.</p><div className="toolbar"><button className="btn" onClick={()=>{setPage("Practice");setPracticeStarted(false);setSongTitle(songTitle||scoreImageName.replace(/\.[^.]+$/,""));}}>Practise this score</button><button className="btn" onClick={saveStudy}>Save notes</button><button className="btn" onClick={exportMusicXml}>Convert .musiccoach → MusicXML</button><button className="btn" onClick={exportNotes}>Convert .musiccoach → MIDI</button></div><p className="muted small">{scoreOcrStatus}</p>{scoreOcrWarning&&<div className="tutor-answer">{scoreOcrWarning}</div>}<Staff notes={parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:i,note:n.token}))} expanded/></section><section className="panel"><h2>Note comparison</h2><p className="muted">Target sequence accuracy: {comparison.accuracy}%</p><button className="btn btn-dark" onClick={playSequence}>Play target sequence</button>{comparison.rows.slice(0,30).map((r,i)=><div className="list-item" key={i}><div><strong>{r.expected}</strong><small>Played: {r.played} · {r.status}</small></div></div>)}</section></div>}
 {page==='Grade plan'&&<GradePlanner sessions={sessions} onPracticePiece={(piece)=>{
  if(piece.scoreData){
    setSongTitle(piece.title);setPracticeMinutes('25');setPracticeStarted(false);setPracticeMode('learn');setPage('Practice');setStatus('Converting the uploaded grade piece into sheet music…');
    fetch(piece.scoreData).then(response=>{if(!response.ok)throw new Error('The attached score could not be read');return response.blob()}).then(blob=>{
      const name=piece.scoreName||piece.title+'.png';
      const extension=(name.match(/\.(musiccoach|musicxml|xml|pdf|png|jpe?g|webp)$/i)||[])[0]||'.png';
      const mime=piece.scoreType||blob.type||'image/png';
      const file=new File([blob],piece.title+extension,{type:mime});
      if(/\.(musiccoach|musicxml|xml)$/i.test(extension))importMusicXML(file,{target:'Practice',download:false});
      else convertScoreToMusicCoach(file,{target:'Practice',download:false});
    }).catch(error=>{setAudioError('Could not open the attached grade score: '+error.message);setStatus('Grade-piece conversion failed')});
    return;
  }
  setSongTitle(piece.title);setPracticeMinutes('25');setPracticeStarted(false);const pieceNotes=Array.isArray(piece.notes)?piece.notes:(Array.isArray(piece.score?.notes)?piece.score.notes:[]);setPracticeMode(pieceNotes.length?'learn':'normal');setScoreNotation(piece.score?.notation||null);setScoreSourceAsset(piece.score?.sourceAsset||null);if(pieceNotes.length){setLoadedScoreNotes(pieceNotes);setEvents(pieceNotes);sessionEvents.current=pieceNotes;setExpected(pieceNotes.map(n=>n.rest?'R/q':(n.note||'')+'/q').filter(Boolean).join(' '));setBpm(Number(piece.bpm||piece.score?.bpm)||bpm)}else{setLoadedScoreNotes([]);setEvents([]);sessionEvents.current=[];setExpected('')}if(piece.scoreData){setScoreImageUrl(piece.scoreData);setScoreImageName(piece.scoreName||'Grade piece score');setScoreIsPdf(String(piece.scoreType||'').includes('pdf'));}else{setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false);}setPage('Practice');setStatus('Practice set up for '+piece.title+' from your grade plan')
}}/>}
 {page==='Extras'&&<><section className="panel"><div className="eyebrow">EXTRAS</div><h2>Your music toolkit</h2><p className="muted">Tools you can use outside a timed practice session.</p><div className="toolbar extras-toolbar"><button className="btn btn-dark" onClick={()=>setExtraTool('keyboard')}>Open online keyboard</button><button className="btn" onClick={()=>setExtraTool('assistant')}>♫ Music assistant</button><button className="btn" onClick={()=>setPage('Score converter')}>Sheet music converter</button></div></section>{false&&extraTool==='score'&&<section className="panel"><div className="eyebrow">SCORE TOOLS</div><h2>Work with your score</h2><p className="muted">Upload MusicXML, XML or .musiccoach for editable notation, or enter a note sequence. PDF/image recognition is best-effort and may fail on difficult scans.</p><label className="upload-score">Import score file<input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,application/xml,text/xml" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Practice'});e.target.value=''}}/></label><label className="sequence-label">Notes from score<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4/q D4/h R/q E4/e"/></label><div className="toolbar"><button className="btn btn-dark" onClick={()=>{setPage('Practice');setPracticeStarted(false);setPracticeMode('learn')}}>Practise this score</button><button className="btn" onClick={saveStudy}>Save notes</button><button className="btn" onClick={exportMusicXml}>Export MusicXML</button><button className="btn" onClick={playSequence}>▶ Listen</button></div><Staff notes={parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:i,note:n.token}))} expanded/></section>}{extraTool==='assistant'&&<section className="panel music-chat-panel"><div className="music-chat-heading"><div><div className="eyebrow">MUSIC ASSISTANT</div><h2>Your music, explained.</h2><p className="muted">Ask about theory, technique, notation, practice or composition.</p></div><span className="tag">Piano Coach</span></div><div className="music-chat-thread">{musicChat.length===0&&<div className="music-chat-welcome"><div className="music-chat-orb">♫</div><h3>What would you like to learn?</h3><div className="music-chat-suggestions">{['Explain a diminished seventh chord','Help me practise sight-reading','How do crescendos work?','Suggest a piano warm-up'].map(q=><button className="btn" key={q} onClick={()=>setMusicChatInput(q)}>{q} ↗</button>)}</div></div>}{musicChat.map((m,i)=><div key={i} className={'music-chat-message '+m.role}><div className="music-chat-avatar">{m.role==='assistant'?'♫':'You'}</div><div className="music-chat-bubble">{m.content}</div></div>)}{musicChatBusy&&<div className="music-chat-message assistant"><div className="music-chat-avatar">♫</div><div className="music-chat-bubble">Thinking…</div></div>}</div><form className="music-chat-composer" onSubmit={e=>{e.preventDefault();sendMusicChat()}}><textarea value={musicChatInput} onChange={e=>setMusicChatInput(e.target.value)} placeholder="Ask your music assistant…" rows={2}/><button className="btn btn-dark" disabled={!musicChatInput.trim()||musicChatBusy}>{musicChatBusy?'Working…':'Send ↑'}</button></form></section>}{extraTool==='score'&&<section className="panel"><div className="toolbar"><button className="btn" onClick={()=>setExtraTool('keyboard')}>Back to keyboard</button><button className="btn" onClick={()=>setExtraTool('tracker')}>Open note tracker</button></div></section>}{extraTool==='keyboard'&&<section className="panel" id="extras-keyboard"><div className="panel-head"><div><div className="eyebrow">ONLINE KEYBOARD</div><h2>Play notes</h2><p className="muted">Hold a key to play it; release to stop. Played notes appear in the note list.</p></div><span className="tag">{keyboardOctaves} octaves</span></div><div className="keyboard-range-controls"><button className="btn" aria-label="Move keyboard down one semitone" onClick={()=>shiftKeyboardStart(-1)}>←</button><label>First key<input aria-label="First piano key" value={keyboardStart} onChange={e=>{const v=e.target.value.trim().toUpperCase().replace(/♯/g,"#").replace(/♭/g,"b");const midi=noteToMidi(v);if(midi!==null)setKeyboardStart(midiToNote(Math.max(21,Math.min(108-12*keyboardOctaves,midi))))}} onBlur={()=>{if(noteToMidi(keyboardStart)===null)setKeyboardStart("C3");else setKeyboardStart(midiToNote(keyboardStartMidi))}} placeholder="F3"/></label><button className="btn" aria-label="Move keyboard up one semitone" onClick={()=>shiftKeyboardStart(1)}>→</button><label>Visible range<select value={keyboardOctaves} onChange={e=>{const octaves=Number(e.target.value);setKeyboardStart(midiToNote(clampKeyboardStartMidi(keyboardStart,octaves)));setKeyboardOctaves(octaves)}}>{[2,3,4,5].map(n=><option key={n} value={n}>{n} octaves</option>)}</select></label><button className="btn" onClick={()=>shiftKeyboardStart(-12)}>− octave</button><button className="btn" onClick={()=>shiftKeyboardStart(12)}>+ octave</button></div><div className="piano-scroll"><div className="piano" style={{"--keyboard-white-key-width":keyboardWhiteKeyPercent+"%"}} aria-label="Piano keyboard">{allKeys.filter(k=>!k.black&&k.midi>=keyboardStartMidi&&k.midi<keyboardEndMidi).map(k=><button key={k.midi} className={"white-key "+(heldKeys[k.note]?"is-held ":"")+((k.midi>=keyboardStartMidi+computerOctaveOffset&&k.midi<keyboardStartMidi+computerOctaveOffset+12)?"central-key":"")} style={{flex:`0 0 ${keyboardWhiteKeyPercent}%`,width:`${keyboardWhiteKeyPercent}%`,minWidth:0}} aria-label={k.note} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}{allKeys.filter(k=>k.black&&k.midi>=keyboardStartMidi&&k.midi<keyboardEndMidi).map(k=><button key={k.midi} className={"black-key "+(heldKeys[k.note]?"is-held ":"")+((k.midi>=keyboardStartMidi+computerOctaveOffset&&k.midi<keyboardStartMidi+computerOctaveOffset+12)?"central-key":"")} aria-label={k.note} style={{left:(keyboardVisibleWhiteKeys.filter(w=>w.midi<k.midi).length*keyboardWhiteKeyPercent)+'%',width:(keyboardWhiteKeyPercent*.62)+'%',transform:'translateX(-50%)'}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}</div></div><div className="key-hint">Computer keys: A W S E D F T G Y H U J K · active notes highlight while held.</div><div className="played-notes" aria-live="polite"><strong>Notes played</strong>{events.filter(e=>e.source==='keyboard').slice(-12).length?events.filter(e=>e.source==='keyboard').slice(-12).map((e,i)=><span key={e.id||i} className="played-note">{e.note}</span>):<span className="muted small">Play a key to see its note here.</span>}</div><div className="toolbar"><button className="btn" onClick={clearNotes}>Clear notes</button><button className="btn" onClick={exportMusicCoach}>Save performance as .musiccoach</button></div></section>}{false&&extraTool==='tracker'&&<section className="panel" id="extras-note-tracker"><h2>Quick note tracker</h2><p className="muted">Enter notes manually without starting a practice session.</p><label className="sequence-label">Target notes<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4 D4 E4 G4"/></label><div className="toolbar"><button className="btn" onClick={()=>{const manual=parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:'manual-'+i,note:n.token,midi:n.midi,time:(i*.5).toFixed(2),source:'manual'}));sessionEvents.current=manual;setEvents(manual);setStatus('Manual notes added to the note tracker')}}>Track typed notes</button><button className="btn btn-dark" onClick={()=>listening?stopMic():startMic()}>{listening?'🎙 Stop microphone':'🎙 Start microphone'}</button></div><p className="muted small">Use the microphone button to hear notes played on a real piano. Allow microphone access when your browser asks.</p></section>}</>}
 {false&&<section className="panel"><div className="eyebrow">PREFERENCES & PRIVACY</div><h2>Settings</h2><div className="setting-row"><div><strong>Master volume</strong><p className="muted">Applies to piano playback and reference sounds.</p></div><input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(+e.target.value)}/><strong>{volume}%</strong></div><div className="setting-row"><div><strong>Default tempo</strong><p className="muted">Current practice tempo.</p></div><input type="range" min="40" max="180" value={bpm} onChange={e=>setBpm(+e.target.value)}/><strong>{bpm} BPM</strong></div><div className="privacy-box"><strong>Privacy-first by default</strong><p>Practice sessions and saved studies are stored in this browser. Microphone audio is analysed locally and is not uploaded by this application. This basic pitch tracker is designed for one note at a time and is not a polyphonic transcription model.</p></div><div className="toolbar"><button className="btn" onClick={()=>{const blob=new Blob([JSON.stringify({sessions,studies:saved,preferences:{volume,bpm}},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='piano-coach-data.json';a.click();URL.revokeObjectURL(u)}}>Export all data</button><button className="btn btn-danger" onClick={()=>{if(confirm('Clear all saved sessions and studies on this device? This cannot be undone.')){setSessions([]);setSaved([]);localStorage.removeItem('pc_sessions');localStorage.removeItem('pc_studies');setStatus('Local data cleared')}}}>Clear local data</button></div></section>}
 {libraryFullscreenItem&&<div className="score-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Expanded Library file"><section className="score-fullscreen-panel"><header><div><strong>{libraryFullscreenItem.title}</strong><small>Expanded from your Library</small></div><button className="btn btn-dark" onClick={()=>setLibraryFullscreenItem(null)}>Close ✕</button></header><div className="score-fullscreen-content">{libraryFullscreenItem.kind==='pdf'?<iframe title={libraryFullscreenItem.title} src={libraryFullscreenItem.src} style={{width:'100%',height:'100%',minHeight:'75vh',border:0}}/>:<img src={libraryFullscreenItem.src} alt={libraryFullscreenItem.title} style={{display:'block',maxWidth:'100%',maxHeight:'80vh',margin:'auto',objectFit:'contain'}}/>}</div></section></div>}{fullscreenScore&&<div className="score-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Expanded sheet music"><section className="score-fullscreen-panel"><header><div><strong>{fullscreenScore.title}</strong><small>Use Close to return to practice</small></div><button className="btn btn-dark" onClick={()=>setFullscreenScore(null)}>Close ✕</button></header><div className="score-fullscreen-content"><ExpandedMusicXMLPlayer xml={fullscreenScore.xml} title={fullscreenScore.title} onClose={()=>setFullscreenScore(null)}/></div></section></div>}<footer className="app-footer"><span>Made for curious musicians.</span><span>Audio stays on this device</span></footer>{(!cookieChoice||cookieSettingsOpen)&&<div className="cookie-backdrop" role="presentation"><section className="cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-title"><div className="eyebrow">YOUR PRIVACY</div><h2 id="cookie-title">Your cookie choices</h2><p>Piano Coach stores practice sessions, saved studies and Library files locally in this browser when you accept. Your data stays on this device unless you export a .musicdata backup. No third-party cookies or analytics are used.</p><div className="cookie-actions"><button className="btn btn-dark" onClick={()=>{const choice={choice:'accept',at:new Date().toISOString()};try{localStorage.setItem('pc_cookie_consent',JSON.stringify(choice));localStorage.setItem('pc_cookie_storage_enabled','true');localStorage.setItem('pc_sessions',JSON.stringify(sessions));localStorage.setItem('pc_studies',JSON.stringify(saved));localStorage.setItem('pc_files',JSON.stringify(libraryFiles))}catch{}setCookieChoice(choice);setCookieSettingsOpen(false)}}>Accept</button></div><p className="cookie-footnote">You can download a .musicdata backup from the bottom of the sidebar to keep your work safe.</p></section></div>}</main></div>
}