import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';
import { midiToNote, noteToMidi, parseSequence, compareSequences, clampKeyboardStartMidi, assignMidiHands } from './music.js';
import GradePlanner from './GradePlannerSimple.jsx';
import { isPlayableSheetMusicItem, isSheetMusicLibraryItem, loadBrowserScoreLibrary, saveBrowserScoreLibrary } from './score-library.js';

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
 useEffect(()=>{
  if(!ref.current)return;
  ref.current.innerHTML='';
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
    const mm=String(n.note||'').match(/^([A-G])(#|b)?(-?\d)$/);
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
  } catch(e) { /* Keep the note list usable if notation cannot render a rare spelling. */ }
 },[notes,expanded,bpm,timeSignature,fromStart]);
 return <div className="staff-wrap"><div className="staff" ref={ref}/>{!notes.length&&<div className="staff-empty">Your detected notes will appear on the staff here.</div>}</div>
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
function MusicXMLPreview({xml,title='Sheet music',onExpand}) {
 const ref=useRef(null);
 const [status,setStatus]=useState('Loading full sheet music…');
 useEffect(()=>{
  let cancelled=false,renderer=null;
  async function render(){
   try{
    let OSMD=window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
    if(!OSMD){
     await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-osmd="true"]');
      if(existing){
       if(window.opensheetmusicdisplay?.OpenSheetMusicDisplay){resolve();return}
       existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return;
      }
      const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.9.2/build/opensheetmusicdisplay.min.js';script.dataset.osmd='true';script.onload=resolve;script.onerror=()=>reject(new Error('The notation renderer could not be loaded'));document.head.appendChild(script);
     });
     OSMD=window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
    }
    if(!OSMD)throw new Error('The notation renderer is unavailable');
    if(cancelled||!ref.current)return;
    renderer=new OSMD(ref.current,{autoResize:true,drawTitle:true,drawSubtitle:true,drawComposer:true,drawPartNames:true,followCursor:false,backend:'svg',stretchLastSystemLine:false,renderSingleHorizontalStaffline:false});
    await renderer.load(normalizeMusicXMLTitle(xml,title));
    if(cancelled)return;
    renderer.render();setStatus(title+' · full notation rendered from MusicXML');
   }catch(e){if(!cancelled)setStatus('Could not render the full notation here. The original MusicXML is still preserved for export. '+e.message)}
  }
  render();
  return()=>{cancelled=true;if(ref.current)ref.current.innerHTML='';renderer=null};
 },[xml,title]);
 return <section className="musicxml-preview" onDoubleClick={()=>onExpand?.()} title={onExpand?"Double-click to expand sheet music":undefined}><p className="muted small" role="status">{status}</p><div ref={ref} className="musicxml-rendered"/></section>
}

// Sequence tokens support note durations and rests: C4/q D4/h R/q E4/e. Plain notes default to quarters.
function parseMusicSequence(input){const lengths={w:4,whole:4,h:2,half:2,q:1,quarter:1,e:.5,eighth:.5,s:.25,sixteenth:.25};return String(input).trim().split(/[\s,;]+/).filter(Boolean).map((token,index)=>{const m=token.match(/^([A-Ga-g][#b♯♭]?[-]?\d+|r|rest)(?:[/:=](whole|half|quarter|eighth|sixteenth|w|h|q|e|s))?$/i);if(!m)return null;const rest=/^(r|rest)$/i.test(m[1]),midi=rest?null:noteToMidi(m[1]),beats=lengths[(m[2]||'q').toLowerCase()]||1;return {token,note:rest?'rest':m[1],midi,rest,beats,index};}).filter(Boolean)}
function encodeMusicCoach(score){return 'PIANOCOACH-MIX/1\n'+JSON.stringify(score,null,2)}
function scoreNotesToMusicXML(score){
 const notes=Array.isArray(score?.notes)?score.notes.filter(n=>n.note&&!n.rest):[];
 if(!notes.length)return '';
 const mk=(hand,id,clef)=>{const ns=notes.filter(n=>(n.hand||((Number(n.midi??noteToMidi(n.note))<60)?'left':'right'))===hand).sort((a,b)=>(Number(a.time)||0)-(Number(b.time)||0));const body=ns.map(n=>{const m=String(n.note).match(/^([A-G])(#|b)?(-?\\d+)$/i);if(!m)return '';return '<note><pitch><step>'+m[1].toUpperCase()+'</step>'+(m[2]==='#'?'<alter>1</alter>':m[2]==='b'?'<alter>-1</alter>':'')+'<octave>'+m[3]+'</octave></pitch><duration>'+Math.max(1,Math.round((Number(n.duration)||.5)*8))+'</duration><type>eighth</type></note>';}).join('');return '<part id="'+id+'"><measure number="1"><attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>'+clef+'</sign><line>'+(clef==='G'?2:4)+'</line></clef></attributes>'+body+'</measure></part>';};
 return '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Right hand</part-name></score-part><score-part id="P2"><part-name>Left hand</part-name></score-part></part-list>'+mk('right','P1','G')+mk('left','P2','F')+'</score-partwise>';
}
function decodeMusicCoach(text){const source=String(text||'');const payload=source.startsWith('PIANOCOACH-MIX/1\n')?source.slice('PIANOCOACH-MIX/1\n'.length):source;return JSON.parse(payload)}
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
 const [libraryFiles,setLibraryFiles]=useState(()=>{try{return (JSON.parse(localStorage.getItem('pc_files')||'[]')||[]).filter(isSheetMusicLibraryItem)}catch{return[]}});
 const [libraryHydrated,setLibraryHydrated]=useState(false),[scoreLibraryExpanded,setScoreLibraryExpanded]=useState(false);
 const [extraTool,setExtraTool]=useState('keyboard');
 const [keyboardStart,setKeyboardStart]=useState('C3'),[keyboardOctaves,setKeyboardOctaves]=useState(3);
 const [musicChat,setMusicChat]=useState([]),[musicChatInput,setMusicChatInput]=useState(''),[musicChatBusy,setMusicChatBusy]=useState(false);
 const [archiveResults,setArchiveResults]=useState([]),[commonsResults,setCommonsResults]=useState([]),[sourceSearchStatus,setSourceSearchStatus]=useState('');
 const [libraryPlayback,setLibraryPlayback]=useState({id:null,kind:'',paused:true});
 const audioLibraryRefs=useRef({});
 const musicDataInputRef=useRef(null);
 const [scoreNotation,setScoreNotation]=useState(null),[scoreSourceAsset,setScoreSourceAsset]=useState(null);
 const [loadedScoreNotes,setLoadedScoreNotes]=useState([]);
 const [musicCoachBusy,setMusicCoachBusy]=useState(false),[musicCoachStatus,setMusicCoachStatus]=useState('Upload a clear PNG or PDF score to create an editable .musiccoach file.'),[musicCoachAnalysis,setMusicCoachAnalysis]=useState(''),[musicCoachNotes,setMusicCoachNotes]=useState([]);
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
 const [songBusy,setSongBusy]=useState(false);
 const [practiceScoreName,setPracticeScoreName]=useState('');
 const [practiceScoreError,setPracticeScoreError]=useState('');
 const [scoreImageUrl,setScoreImageUrl]=useState('');
 const [scoreImageName,setScoreImageName]=useState('');
 const [scoreIsPdf,setScoreIsPdf]=useState(false);
 const [scoreOcrStatus,setScoreOcrStatus]=useState('No score loaded yet. Upload a PDF/image or import MusicXML to begin.');
 const [scoreOcrWarning,setScoreOcrWarning]=useState('');
 const [sessions,setSessions]=useState(()=>{try{return JSON.parse(localStorage.getItem('pc_sessions')||'[]')}catch{return[]}});
 const [editingSessionId,setEditingSessionId]=useState(null),[libraryTab,setLibraryTab]=useState('recordings');
 const [saved,setSaved]=useState(()=>{try{return JSON.parse(localStorage.getItem('pc_studies')||'[]')}catch{return[]}});
 const synth=useRef(null), mic=useRef(null), analyser=useRef(null), micStream=useRef(null), raf=useRef(null), beatLoop=useRef(null), sequenceLoop=useRef(null), startTime=useRef(0), sessionEvents=useRef([]), recorderRef=useRef(null), chunksRef=useRef([]), recordingTimer=useRef(null), autoAnalyzeRef=useRef(false), analyseBlobRef=useRef(null), practiceTimerRef=useRef(null), midiPlaybackRef=useRef(null);
 const [targetIndex,setTargetIndex]=useState(0);
 const learnProgressRef=useRef(0),learnPhraseOffsetRef=useRef(0),learnNoteLockRef=useRef(0),learnModeRef=useRef(false),learnChordHitsRef=useRef({key:'',hits:[]}),learnMidiAccessRef=useRef(null);
 const heldKeysRef=useRef({});
 const heldComputerKeysRef=useRef({});
 const targets=useMemo(()=>parseMusicSequence(expected),[expected]);
 const actual=events;
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
  if(rms>.006){
   const freq=autoCorrelate(data,Tone.getContext().sampleRate);
   if(freq>45&&freq<1500){
    const midi=Math.round(69+12*Math.log2(freq/440));
    if(midi>=21&&midi<=108){
     const note=midiToNote(midi),last=sessionEvents.current[sessionEvents.current.length-1];
     if(!last||last.note!==note||Date.now()-last.timeMs>500){
      const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'microphone'};
      sessionEvents.current.push(event);setEvents([...sessionEvents.current]);if(learnModeRef.current){checkLearnNote(note,midi)}else{const micCount=sessionEvents.current.filter(e=>e.source==='microphone').length;const expectedNote=targets[Math.min(micCount-1,targets.length-1)];if(liveFeedback&&targets.length){const matched=expectedNote?.midi===midi;setTargetIndex(Math.min(micCount,targets.length));setStatus(matched?'Live feedback · correct '+note:'Live feedback · heard '+note+' · expected '+(expectedNote?midiToNote(expectedNote.midi):'end of sequence'));}else setStatus('Detected '+note)}
     }
    }
   }
  }
  raf.current=requestAnimationFrame(sampleMic);
 }
 function stopMic(){
  if(recorderRef.current&&recorderRef.current.state!=='inactive'){try{recorderRef.current.stop()}catch{}}
  if(recordingTimer.current)clearInterval(recordingTimer.current);recordingTimer.current=null;
  if(raf.current)cancelAnimationFrame(raf.current);raf.current=null;
  micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;
  try{mic.current?.disconnect();analyser.current?.disconnect()}catch{}
  mic.current=null;analyser.current=null;setListening(false);setIsRecording(false);setLevel(0);setMicStatus('Microphone is off');
 }

 function startRecording(){
  if(!micStream.current){setAudioError('Enable the microphone before recording.');return}
  if(typeof MediaRecorder==='undefined'){setAudioError('Recording is not supported in this browser.');return}
  try{chunksRef.current=[];const type=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t));const rec=new MediaRecorder(micStream.current,type?{mimeType:type}:undefined);recorderRef.current=rec;rec.ondataavailable=e=>{if(e.data?.size)chunksRef.current.push(e.data)};rec.onstop=()=>{const blob=new Blob(chunksRef.current,{type:rec.mimeType||'audio/webm'});setRecording(blob);setIsRecording(false);try{const reader=new FileReader();reader.onload=()=>{const stamp=new Date().toISOString().replace(/[:.]/g,'-');const item={id:Date.now(),name:(songTitle||'Practice recording')+' '+stamp+'.webm',type:blob.type||'audio/webm',size:blob.size,data:reader.result,added:new Date().toISOString(),kind:'recording'};setLibraryFiles(v=>[item,...v]);};reader.readAsDataURL(blob)}catch{}if(recordingTimer.current)clearInterval(recordingTimer.current);recordingTimer.current=null;setStatus('Recording ready · analysing automatically…');if(autoAnalyzeRef.current){autoAnalyzeRef.current=false;analyseBlobRef.current?.(blob)}};rec.start();setIsRecording(true);setRecordingSeconds(0);setAudioError('');setStatus('Recording microphone audio · max 3 minutes');recordingTimer.current=setInterval(()=>setRecordingSeconds(n=>{if(n>=179){if(recorderRef.current?.state==='recording')stopRecording();setAudioError('Recording reached the 3-minute safety limit. Your recording is being analysed now.');return 180}return n+1}),1000)}catch(e){setAudioError('Could not start recording: '+e.message)}
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
  setIsAnalyzing(true);setAudioError('');setStatus('Preparing polyphonic note analysis…');
  let ctx;
  try{
   // Spotify Basic Pitch detects overlapping notes/chords, unlike the live monophonic tracker.
   const mod=await import(/* @vite-ignore */ 'https://esm.sh/@spotify/basic-pitch@1.0.1?bundle');
   if(!mod.BasicPitch||!mod.outputToNotesPoly||!mod.noteFramesToTime)throw new Error('The polyphonic transcription model could not load.');
   ctx=new AudioContext();
   const decoded=await ctx.decodeAudioData(await recording.arrayBuffer());
   const mono=new Float32Array(decoded.length);
   for(let ch=0;ch<decoded.numberOfChannels;ch++){const channel=decoded.getChannelData(ch);for(let i=0;i<channel.length;i++)mono[i]+=channel[i]/decoded.numberOfChannels}
   const targetRate=22050;
   let resampled=mono;
   if(decoded.sampleRate!==targetRate){
    const offline=new OfflineAudioContext(1,Math.ceil(mono.length*targetRate/decoded.sampleRate),targetRate);
    const source=offline.createBufferSource(),buffer=offline.createBuffer(1,mono.length,decoded.sampleRate);
    buffer.copyToChannel(mono,0);source.buffer=buffer;source.connect(offline.destination);source.start();
    resampled=(await offline.startRendering()).getChannelData(0);
   }
   const bp=new mod.BasicPitch('https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json');
   const frames=[],onsets=[],contours=[];
   await bp.evaluateModel(resampled,(f,o,c)=>{if(f?.length)frames.push(...f);if(o?.length)onsets.push(...o);if(c?.length)contours.push(...c)},p=>setStatus('Transcribing notes · '+Math.round((p||0)*100)+'%'));
   const raw=mod.outputToNotesPoly(frames,onsets,.25,.25,5);
   const pitched=contours.length&&typeof mod.addPitchBendsToNoteEvents==='function'?mod.addPitchBendsToNoteEvents(contours,raw):raw;
   const events=mod.noteFramesToTime(pitched)
    .filter(n=>Number.isFinite(Number(n.pitchMidi))&&Number(n.pitchMidi)>=21&&Number(n.pitchMidi)<=108&&Number(n.startTimeSeconds)>=0&&Number(n.durationSeconds||0)>.07)
    .sort((a,b)=>Number(a.startTimeSeconds)-Number(b.startTimeSeconds)||Number(a.pitchMidi)-Number(b.pitchMidi))
    .map((n,i)=>{const midi=Math.round(Number(n.pitchMidi));return{id:'rec-'+Date.now()+'-'+i,note:midiToNote(midi),midi,time:Number(n.startTimeSeconds).toFixed(2),timeMs:Date.now()+Math.round(Number(n.startTimeSeconds)*1000),duration:Number(n.durationSeconds)||0,source:'recording',confidence:Number(n.amplitude)||null}});
   sessionEvents.current=events;setEvents(events);
   setStatus(events.length?'Polyphonic analysis complete · '+events.length+' note events':'No clear notes found in the recording');
   if(!events.length)setAudioError('No notes were detected. Try a clearer recording with the piano closer to the microphone and less background noise.');
  }catch(e){
   setAudioError('Could not analyse this recording: '+(e?.message||String(e))+' Check your connection if the transcription model could not download.');
   setStatus('Recording analysis failed');
  }finally{if(ctx)await ctx.close().catch(()=>{});setIsAnalyzing(false)}
 }
 analyseBlobRef.current=async(blob)=>{setIsAnalyzing(true);setAudioError('');setPracticeFeedback('Listening to your performance and preparing personalised feedback…');setStatus('Analysing performance automatically…');let referenceSummary='No reference recording was available for this piece.';let audioNativeFeedback='';try{const ev=(await transcribeAudioBlob(blob,p=>setStatus('Analysing your performance · '+Math.round((p||0)*100)+'%'))).map((n,i)=>({...n,id:'rec-'+Date.now()+'-'+i,time:Number(n.time).toFixed(2),timeMs:Date.now()+Math.round(n.time*1000),source:'recording'}));sessionEvents.current=ev;setEvents(ev);const generatedScore={format:'musiccoach',version:1,title:(songTitle||'Practice recording'),bpm,timeSignature,created:new Date().toISOString(),source:'Local recording transcription',notes:ev.map((n,i)=>({...n,id:n.id||'rec-'+i,beats:Math.max(.25,(Number(n.duration)||60/bpm)/(60/bpm)),measure:Math.floor((Number(n.time)||0)/(60/bpm*Math.max(1,Number(timeSignature.split('/')[0]))))+1,rest:false}))};const scoreJson=encodeMusicCoach(generatedScore);const scoreData='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(scoreJson)));setLibraryTab('practice-scores');setLibraryFiles(v=>[{id:Date.now(),name:generatedScore.title+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:scoreJson.length,data:scoreData,added:new Date().toISOString(),kind:'practice-score',score:generatedScore},...v.filter(x=>x.name!==generatedScore.title+'.musiccoach')]);let refInfo=referenceSong;if(!refInfo&&songTitle.trim())refInfo=await loadSongReference(songTitle);if(refInfo?.preview){setReferenceStatus('Comparing with reference preview: '+refInfo.title+'…');try{const audioResponse=await fetch(refInfo.preview);if(!audioResponse.ok)throw Error('Could not fetch reference audio');const refNotes=await transcribeAudioBlob(await audioResponse.blob(),p=>setReferenceStatus('Analysing reference audio · '+Math.round((p||0)*100)+'%')),comparison=compareToSongReference(ev,refNotes);if(!comparison)throw Error('Not enough notes to compare');referenceSummary='Reference audio excerpt '+refInfo.title+' by '+refInfo.artist+': best aligned pitch-class match '+comparison.score+'% across '+comparison.total+' notes. This is a short preview comparison, not a full-song accuracy grade; rhythm, note lengths, octave and expression are not included.';setReferenceStatus('Reference comparison complete · '+comparison.score+'% approximate similarity')}catch(e){referenceSummary='Reference comparison unavailable: '+e.message;setReferenceStatus(referenceSummary)}}else setReferenceStatus(referenceSummary);if(!ev.length){const msg='I could not confidently detect notes in this recording. Try recording with the piano closer to the microphone, reduce background noise, and play a short passage clearly.';setPracticeFeedback(msg);setAudioError(msg);setStatus('Analysis finished · no clear notes detected');return}setStatus('Running local audio review…');try{audioNativeFeedback=await requestLocalAudioCoachFeedback(blob,songTitle||'Untitled practice',expected,ev);setTutorStatus('Local audio model review complete.')}catch(audioErr){audioNativeFeedback='Local audio model review unavailable: '+audioErr.message;setTutorStatus(audioNativeFeedback)}const targetCheck=compareSequences(expected,ev);const times=ev.map(n=>Number(n.time)).filter(Number.isFinite),gaps=times.slice(1).map((t,i)=>t-times[i]).filter(t=>t>.06&&t<3),medianGap=gaps.length?[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)]:null,durations=ev.map(n=>Number(n.duration)).filter(d=>Number.isFinite(d)&&d>0),pitches=ev.map(n=>Number(n.midi)).filter(Number.isFinite),evidence='Piece: '+(songTitle||'Untitled practice')+'. This feedback is based on audio processed by a polyphonic audio-to-note model, not just keyboard note data. Detected '+ev.length+' note events. First events with onset times and detected note lengths: '+ev.slice(0,100).map(n=>n.note+' at '+Number(n.time).toFixed(2)+'s'+(Number(n.duration)>0?' for '+Number(n.duration).toFixed(2)+'s':'')).join(', ')+'. Estimated median onset spacing: '+(medianGap?medianGap.toFixed(2)+' seconds':'not enough reliable onsets')+'. Detected pitch range: '+(pitches.length?midiToNote(Math.min(...pitches))+' to '+midiToNote(Math.max(...pitches)):'unavailable')+'. '+(durations.length?'Median detected note duration: '+[...durations].sort((a,b)=>a-b)[Math.floor(durations.length/2)].toFixed(2)+' seconds. ':'')+'Target notes entered by learner: '+(expected||'none')+'. Target comparison: '+JSON.stringify(targetCheck)+'. Reference comparison: '+JSON.stringify(referenceSummary)+'. '+referenceSummary;try{if(!window.PianoCoachAI)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/ai-tutor.js';script.onload=resolve;script.onerror=()=>reject(new Error('AI tutor script failed to load'));document.head.appendChild(script)});if(!window.PianoCoachAI?.ask)throw new Error('AI tutor is not available');const result=await window.PianoCoachAI.ask('You are the learner’s piano coach. The recording was analysed locally in the browser. Use only the measured waveform and note/onset/duration evidence below; do not claim subjective listening or infer musical expression that was not measured. Give 2–3 concrete next steps. AUDIO MODEL REVIEW: '+audioNativeFeedback+'\nTRANSCRIPTION EVIDENCE: '+evidence,{max_new_tokens:120,onProgress:p=>setStatus(p?.message||'AI is preparing feedback from audio review…')});setPracticeFeedback((audioNativeFeedback?'Direct audio review: '+audioNativeFeedback+'\n\n':'')+(result.answer||'The AI did not return feedback. '+evidence));setTutorStatus('Automatic post-recording feedback complete.');setStatus('Analysis and AI feedback complete · '+ev.length+' note events')}catch(aiError){const fallback=targetCheck?.total?'Detected '+ev.length+' note events. Entered-target comparison: '+targetCheck.correct+' of '+targetCheck.total+' target notes matched. '+referenceSummary+' AI feedback could not load ('+aiError.message+'). Try again with a connection, or use Ask AI tutor below.':'Detected '+ev.length+' note events. '+referenceSummary+' AI feedback could not load ('+aiError.message+'). The detector can estimate pitches, but cannot reliably judge expression or full polyphonic accuracy.';setPracticeFeedback(fallback);setStatus('Pitch analysis complete · AI feedback unavailable');setTutorStatus('Automatic AI feedback unavailable: '+aiError.message)}}catch(e){const fallbackEvents=(sessionEvents.current||[]).filter(n=>n.note&&n.midi!=null).map((n,i)=>({...n,id:n.id||'fallback-'+i,time:Number(n.time)||i*.5,duration:Number(n.duration)||60/bpm,source:'microphone'}));if(fallbackEvents.length){const fallbackScore={format:'musiccoach',version:1,title:(songTitle||'Practice recording')+' (pitch tracker draft)',bpm,timeSignature,created:new Date().toISOString(),source:'Live microphone pitch-tracker fallback · review accuracy',notes:fallbackEvents.map((n,i)=>({...n,beats:Math.max(.25,(Number(n.duration)||60/bpm)/(60/bpm)),measure:Math.floor((Number(n.time)||0)/(60/bpm*Math.max(1,Number(timeSignature.split('/')[0]))))+1,rest:false}))};const json=encodeMusicCoach(fallbackScore),data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(json)));setLibraryTab('practice-scores');setLibraryFiles(v=>[{id:Date.now(),name:fallbackScore.title+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:json.length,data,added:new Date().toISOString(),kind:'practice-score',score:fallbackScore},...v.filter(x=>x.name!==fallbackScore.title+'.musiccoach')]);setPracticeFeedback('Advanced audio transcription failed: '+e.message+' A draft .musiccoach score was saved from the live single-note pitch tracker. Please review it; overlapping chords may be missing.');setStatus('Saved a pitch-tracker draft score')}else{setAudioError('Automatic analysis failed: '+e.message);setPracticeFeedback('The recording analysis failed: '+e.message);setStatus('Analysis failed')}}finally{setIsAnalyzing(false)}};
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
  try{if(!window.PianoCoachAI)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/ai-tutor.js';script.onload=resolve;script.onerror=()=>reject(new Error('AI tutor script failed to load'));document.head.appendChild(script)});const prompt='Piano practice data: mode '+mode+'; target '+expected+'; recent detected notes '+events.slice(-20).map(e=>e.note+' at '+e.time+'s').join(', ')+'; pitch match '+comparison.correct+' of '+comparison.total+' target notes. Learner asks: '+tutorQuestion+'. Give specific, encouraging advice using only this evidence.';const result=await window.PianoCoachAI.ask(prompt,{onProgress:p=>setTutorStatus(p.message||'AI is working…')});setTutorAnswer(result.answer);setTutorStatus('Local AI ready · '+(result.device||'browser model'));}catch(e){setTutorStatus('AI unavailable: '+e.message)}finally{setTutorBusy(false)}
 }
 function audioComSearchUrl(query){return 'https://audio.com/search?search_text='+encodeURIComponent(String(query||'').trim())+'&sort=relevance'}
async function searchSongs(){
  const query=songQuery.trim();
  if(!query||songBusy)return;
  setSongBusy(true);setArchiveResults([]);setCommonsResults([]);
  setSourceSearchStatus('Searching public score archives. Audio.com search is embedded below when a title is entered; use the direct link if the browser blocks the embedded player.');
  const urls=[
    'https://archive.org/advancedsearch.php?q='+encodeURIComponent('('+query+') AND mediatype:audio')+'&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&rows=12&page=1&output=json',
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch='+encodeURIComponent(query+' sheet music')+'&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=180&format=json&origin=*'
  ];
  try{
    const settled=await Promise.allSettled(urls.map(async url=>{const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status);return response.json()}));
    const failures=[];
    if(settled[0].status==='fulfilled'){
      const docs=settled[0].value?.response?.docs||[];
      setArchiveResults(docs.filter(x=>x.identifier).map(x=>({id:x.identifier,title:x.title||x.identifier,creator:Array.isArray(x.creator)?x.creator.join(', '):(x.creator||'Creator not listed'),year:x.year||'',url:'https://archive.org/details/'+encodeURIComponent(x.identifier)})));
    }else failures.push('Internet Archive was unavailable');
    if(settled[1].status==='fulfilled'){
      const pages=Object.values(settled[1].value?.query?.pages||{});
      setCommonsResults(pages.map(x=>({id:x.pageid,title:(x.title||'').replace(/^File:/,''),url:'https://commons.wikimedia.org/wiki/'+encodeURIComponent(x.title||''),thumb:x.thumbnail?.source})));
    }else failures.push('Wikimedia Commons was unavailable');
    const count=(settled[0].status==='fulfilled'?(settled[0].value?.response?.docs?.length||0):0)
      +(settled[1].status==='fulfilled'?Object.keys(settled[1].value?.query?.pages||{}).length:0);
    setSourceSearchStatus(count?'Found '+count+' public archive and shared-score results. '+(failures.length?failures.join('; ')+'. ':'')+'Audio.com is available via the direct search link.':'No public archive results were returned. '+(failures.length?failures.join('; ')+'. ':'')+'Try Audio.com directly or use a shorter title.');
  }catch(error){
    setSourceSearchStatus('Search failed: '+(error.message||String(error))+'. You can still search Audio.com directly.');
  }finally{setSongBusy(false)}
}
function uploadScoreImage(file){if(!file)return;const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');if(!isPdf&&!['image/png','image/jpeg','image/webp'].includes(file.type)){setStatus('Choose a PDF, PNG, JPEG or WebP score file.');return}if(file.size>25*1024*1024){setStatus('Score files must be smaller than 25 MB.');return}if(scoreImageUrl.startsWith('blob:'))URL.revokeObjectURL(scoreImageUrl);setScoreImageUrl(URL.createObjectURL(file));setScoreImageName(file.name);setScoreIsPdf(isPdf);const reader=new FileReader();reader.onload=()=>setLibraryFiles(v=>[{id:Date.now(),name:file.name,type:file.type||'application/pdf',size:file.size,data:reader.result,added:new Date().toISOString(),kind:'score'},...v.filter(x=>x.name!==file.name)]);reader.readAsDataURL(file);setScoreOcrStatus(isPdf?'PDF loaded. Run local HOMR recognition to create editable notation; inspect every converted page.':'Image loaded. Run local HOMR recognition to create editable notation; accuracy depends on scan quality.');setScoreOcrWarning('Recognition runs in your browser and may need manual correction.');setStatus('Score loaded and saved to Library')}
  async function recognizeScoreImage(){
   if(!scoreImageUrl)return;
   setScoreOcrStatus('Preparing the score for on-device recognition…');setScoreOcrWarning('');
   try{
    const response=await fetch(scoreImageUrl);if(!response.ok)throw new Error('Could not read the uploaded source image.');
    const blob=await response.blob(),fallback=scoreIsPdf?'application/pdf':'image/png';
    const file=new File([blob],scoreImageName||('score.'+(scoreIsPdf?'pdf':'png')),{type:blob.type||fallback});
    await convertScoreToMusicCoach(file,{target:'Score converter',download:true});
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
   const fallbackScoreTitle=file.name.replace(/\.(musiccoach|musicxml|xml)$/i,'').trim()||'Imported score';if(!score.title||/^(untitled(?:\s+score)?|score)$/i.test(String(score.title).trim()))score.title=fallbackScoreTitle;if(score.notation?.sourceMusicXML)score.notation.sourceMusicXML=normalizeMusicXMLTitle(score.notation.sourceMusicXML,score.title);
   setScoreNotation(score.notation||null);setScoreSourceAsset(score.sourceAsset||null);setSongTitle(score.title||fallbackScoreTitle);setBpm(Number(score.bpm)||bpm);setTimeSignature(score.timeSignature||'4/4');
   const notes=(score.notes||[]).map((n,i)=>({...n,id:n.id||'score-'+i,midi:n.midi??(n.rest?null:noteToMidi(n.note)),source:'score'}));
   setLoadedScoreNotes(notes);setMusicCoachNotes(notes);setMusicCoachAnalysis(score.analysis||'');setEvents(notes);sessionEvents.current=notes;setLearnHand('both');
   setExpected(notes.map(n=>n.rest?'R/'+(n.beats>=4?'w':n.beats>=2?'h':n.beats>=1?'q':'e'):n.note+'/'+(n.beats>=4?'w':n.beats>=2?'h':n.beats>=1?'q':'e')).join(' '));
   if(score.sourceAsset?.data){setScoreImageUrl(score.sourceAsset.data);setScoreImageName(score.sourceAsset.name||file.name);setScoreIsPdf(score.sourceAsset.mimeType==='application/pdf')}else{setScoreImageUrl('');setScoreImageName('');setScoreIsPdf(false)}
   const json=encodeMusicCoach(score),data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(json)));
   setLibraryFiles(v=>[{id:Date.now(),name:(score.title||'Imported score')+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:new Blob([json]).size,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==(score.title||'Imported score')+'.musiccoach')]);
   if(options.target==='Library')setLibraryTab('scores');
   if(options.download&&!file.name.toLowerCase().endsWith('.musiccoach')){const url=URL.createObjectURL(new Blob([json],{type:'application/vnd.piano-coach.musiccoach'})),a=document.createElement('a');a.href=url;a.download=(score.title||file.name.replace(/\.(musicxml|xml)$/i,'')||'converted-score')+'.musiccoach';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
   setPracticeMode('learn');setPage(options.target||'Sheet music');setActiveScoreId(Date.now());setScoreOcrStatus('Loaded '+notes.length+' note/rest events and '+(score.notation?.notationEvents?.length||0)+' notation markings. '+(score.sourceAsset?'A source-score preview is embedded.':''));setMusicCoachStatus('Loaded '+file.name+' as a .musiccoach score. Original notation and the embedded source preview are retained where available.');setStatus('Score opened with notation metadata preserved')
  }).catch(e=>{setScoreOcrStatus('Music file import failed: '+e.message);setMusicCoachStatus('Import failed: '+e.message)})
 }
 function exportMusicCoach(){
 const fallback=parseMusicSequence(expected).map((n,i)=>({id:'n'+i,note:n.note,midi:n.midi,rest:n.rest,beats:n.beats,time:i*(60/bpm),duration:n.beats*60/bpm,measure:Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1}));
 const notesBase=(scoreSourceAsset||scoreNotation?.sourceMusicXML)?loadedScoreNotes:(events.length?events:fallback);
 const score={format:'musiccoach',version:2,title:songTitle||scoreImageName.replace(/\.[^.]+$/,'')||'My piano score',bpm,timeSignature,created:new Date().toISOString(),source:'Piano Coach',sourceAsset:scoreSourceAsset||null,notes:notesBase.map((n,i)=>({...n,id:n.id||'n'+i,measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1})),notation:scoreNotation||{sourceFormat:'Piano Coach sequence',notationEvents:[],technicalSupport:['rests','note durations']}};
 const json=encodeMusicCoach(score),url=URL.createObjectURL(new Blob([json],{type:'application/vnd.piano-coach.musiccoach'})),a=document.createElement('a');a.href=url;a.download=score.title.replace(/[^a-z0-9-_ ]/gi,'').trim()+'.musiccoach';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 const data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(json)));
 setLibraryFiles(v=>[{id:Date.now(),name:score.title+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:json.length,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==score.title+'.musiccoach')]);setLibraryTab('scores');setStatus('Editable .musiccoach score with notation metadata saved to Library')
}
async function convertScoreToMusicCoach(file,options={}){
  if(!file||musicCoachBusy)return;
  const ext=file.name.toLowerCase();
  if(ext.endsWith('.musicxml')||ext.endsWith('.xml')||ext.endsWith('.musiccoach')){importMusicXML(file,{target:options.target||'Score converter',download:options.download??true});return}
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
   if(Number(result.pages)>1)throw new Error('Please upload one page at a time. This file contains '+result.pages+' pages; split it into single-page files and convert each page separately.');
   const title=file.name.replace(/\.[^.]+$/,'')||'Recognised score';
   const xmlFile=new File([result.musicXML],title+'.musicxml',{type:'application/vnd.recordare.musicxml+xml'});
   const sourceData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not preserve the original score file in the backup.'));reader.readAsDataURL(file)});
   const sourceExt=(file.name.split('.').pop()||'png').toLowerCase();const sourceMime=file.type||(isPdf?'application/pdf':({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',svg:'image/svg+xml'}[sourceExt]||'application/octet-stream'));const sourceAsset={name:file.name,mimeType:sourceMime,size:file.size,data:sourceData};
   setMusicCoachStatus('Recognition complete. Importing '+result.pages+' page(s) and building the .musiccoach file…');
   setMusicCoachAnalysis('Recognised with HOMR optical music recognition running locally in your browser. Review the rendered notation against the original score before relying on it. OMR can misread notes, rhythms, accidentals, rests and multiple voices; the original source is embedded so you can compare them.');
   importMusicXML(xmlFile,{target:options.target||'Score converter',download:options.download??true,sourceAsset});
   setMusicCoachStatus('Recognised '+result.pages+' page(s) with on-device HOMR. Review the original and converted score side by side.');
   setStatus('On-device OMR completed · review the converted score');
  }catch(e){
   const detail=String(e?.message||e);
   const imageEngineFailed=/cv2\.error|opencv|resize.cpp|center_image_on_canvas/i.test(detail);
   setMusicCoachStatus(imageEngineFailed?'The local recognition model failed while preparing a staff image (OpenCV resize error). Your file was kept in the Library so you can retry with a straight, high-contrast PNG/JPEG scan with visible margins.':'Local music recognition failed: '+detail.slice(0,320));
   setMusicCoachAnalysis('No score was falsely marked as converted. Recognition runs on this device; the source file remains available for review. MusicXML/XML or MIDI files can be converted directly into editable notation without optical recognition.');
   try{saveLibraryFile(file)}catch{}
   setStatus('Local music recognition failed · source preserved');
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
  if(events.length){const practiceScore={format:'musiccoach',version:3,title:(songTitle||'Practice study')+' — '+new Date().toLocaleDateString(),bpm,timeSignature,created:new Date().toISOString(),source:'Practice session notes',notes:events.map((n,i)=>({...n,id:n.id||'practice-'+i,measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1})),notation:scoreNotation||{sourceFormat:'Piano Coach practice transcription',notationEvents:[],technicalSupport:['detected pitches','practice timing']}};const payload=encodeMusicCoach(practiceScore);const data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(payload)));const item={id:Date.now(),name:practiceScore.title+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:payload.length,data,added:practiceScore.created,kind:'practice-score',score:practiceScore};setLibraryFiles(prev=>[item,...prev.filter(x=>x.name!==item.name)]);}
  const plannedSeconds=Math.max(60,Number(practiceMinutes||15)*60),elapsedSeconds=Math.max(0,Math.min(plannedSeconds,plannedSeconds-remainingSeconds));
  const previous=sessions.find(s=>s.id===editingSessionId);const totalSeconds=(previous?.practiceSeconds||((+previous?.minutes||0)*60))+elapsedSeconds;
  const session={...(previous||{}),id:editingSessionId||Date.now(),date:previous?.date||new Date().toISOString(),lastPractisedAt:new Date().toISOString(),song:songTitle||mode,minutes:Math.round(totalSeconds/6)/10,practiceSeconds:totalSeconds,notes:events.length,reflection:reflection||events.length+' note events captured',feedback:practiceFeedback,expected,bpm,timeSignature,events:events.map(e=>({...e}))};
  setSessions(prev=>editingSessionId?prev.map(s=>s.id===editingSessionId?session:s):[session,...prev]);setStatus('Practice time saved: '+Math.floor(totalSeconds/60)+' minutes');setEditingSessionId(null);
 }
 function saveStudy(){const title=prompt('Name this score',songTitle||'My piano recording');if(!title?.trim())return;const id=Date.now(),parsed=events.length?events:parseMusicSequence(expected).map((n,i)=>({...n,id:'n'+i,time:i*60/bpm,duration:(n.beats||1)*60/bpm}));const score={format:'musiccoach',version:1,title:title.trim(),bpm,timeSignature,created:new Date().toISOString(),source:events.some(e=>e.source==='microphone')?'piano recording':'Piano Coach score',notes:parsed.map((n,i)=>({...n,id:n.id||'n'+i,rest:!!n.rest,beats:n.beats||Math.max(.25,(Number(n.duration)||60/bpm)/(60/bpm)),measure:n.measure||Math.floor(i/Math.max(1,Number(timeSignature.split('/')[0])))+1}))};const json=encodeMusicCoach(score),data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(json)));setLibraryFiles(v=>[{id,name:title.trim()+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:json.length,data,added:new Date().toISOString(),kind:'score',score},...v.filter(x=>x.name!==title.trim()+'.musiccoach')]);setSaved(prev=>[{id,title:title.trim(),notes:expected},...prev]);setSongTitle(title.trim());setLibraryTab('scores');setPage('Sheet music');setStatus('Saved editable score to Library as '+title.trim()+'.musiccoach')}
 function useStudy(s){setExpected(s.notes);setSongTitle(s.title);setPage('Extras');setStatus('Loaded '+s.title+' into the standalone note tracker')}
 async function loadSongReference(title){
  setReferenceSong(null);
  setReferenceStatus(title?'Open Audio.com to find a recording for “'+title+'”. Audio.com search is external; no unverified track is selected automatically.':'No song title entered.');
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
 async function transcribeAudioBlob(blob,onProgress=()=>{}){if(blob.size>45*1024*1024)throw Error('This recording is too large to analyse safely. Please record a shorter practice (up to 3 minutes).');const mod=await import(/* @vite-ignore */ 'https://esm.sh/@spotify/basic-pitch@1.0.1?bundle');if(!mod.BasicPitch||!mod.outputToNotesPoly||!mod.noteFramesToTime)throw Error('Polyphonic transcription model failed to load');const ctx=new AudioContext();let decoded=null,mono=null,audio=null,frames=null,onsets=null,contours=null;try{decoded=await ctx.decodeAudioData(await blob.arrayBuffer());if(decoded.duration>185)throw Error('Recording is longer than the 3-minute safety limit.');mono=new Float32Array(decoded.length);for(let ch=0;ch<decoded.numberOfChannels;ch++){const channel=decoded.getChannelData(ch);for(let i=0;i<channel.length;i++)mono[i]+=channel[i]/decoded.numberOfChannels}let audio=mono;if(decoded.sampleRate!==22050){const off=new OfflineAudioContext(1,Math.ceil(mono.length*22050/decoded.sampleRate),22050),src=off.createBufferSource(),buf=off.createBuffer(1,mono.length,decoded.sampleRate);buf.copyToChannel(mono,0);src.buffer=buf;src.connect(off.destination);src.start();audio=(await off.startRendering()).getChannelData(0)}const bp=new mod.BasicPitch('https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json'),frames=[],onsets=[],contours=[];await bp.evaluateModel(audio,(f,o,p)=>{if(f?.length)frames.push(...f);if(o?.length)onsets.push(...o);if(p?.length)contours.push(...p)},onProgress);const raw=mod.outputToNotesPoly(frames,onsets,.25,.25,5),pitched=contours.length&&mod.addPitchBendsToNoteEvents?mod.addPitchBendsToNoteEvents(contours,raw):raw;return mod.noteFramesToTime(pitched).filter(n=>Number.isFinite(+n.pitchMidi)&&+n.pitchMidi>=21&&+n.pitchMidi<=108&&+(n.durationSeconds||0)>.07).sort((a,b)=>+a.startTimeSeconds-+b.startTimeSeconds).map((n,i)=>({id:'ref-'+i,note:midiToNote(Math.round(+n.pitchMidi)),midi:Math.round(+n.pitchMidi),time:+n.startTimeSeconds,duration:+n.durationSeconds||0,source:'reference'}))}finally{await ctx.close().catch(()=>{})}}
 function compareToSongReference(actualNotes,referenceNotes){if(!referenceNotes?.length||!actualNotes.length)return null;const a=actualNotes.map(n=>n.midi%12),b=referenceNotes.map(n=>n.midi%12);/* Catalogue previews are short excerpts. Align the shorter sequence inside the longer one so a full performance is not unfairly scored against only a 30-second preview. */const short=a.length<=b.length?a:b,long=a.length<=b.length?b:a;if(short.length<4)return null;let best=0,bestStart=0;const maxStart=Math.max(0,long.length-short.length);for(let start=0;start<=maxStart;start++){let matches=0;for(let i=0;i<short.length;i++)if(short[i]===long[start+i])matches++;const score=matches/short.length;if(score>best){best=score;bestStart=start}}return {score:Math.round(best*100),matched:Math.round(best*short.length),total:short.length,comparisonType:a.length===b.length?"sequence":"best matching excerpt",note:"Pitch-class alignment only; this is not a full-song or rhythm score.",offset:bestStart}}
 function beginPractice(){setEvents([]);sessionEvents.current=[];setPracticeFeedback('');setReferenceSong(null);setReferenceStatus('Looking up a reference recording from the song title…');setPracticeStarted(true);setRemainingSeconds(Math.max(60,Number(practiceMinutes||15)*60));setStatus('Practice started · microphone will activate');startTime.current=Date.now();loadSongReference(songTitle);setTimeout(async()=>{await startMic();setTimeout(()=>{if(micStream.current)startRecording()},300)},350)}
 function disconnectLearnMidi(){const access=learnMidiAccessRef.current;if(access){for(const input of access.inputs.values())input.onmidimessage=null;access.onstatechange=null;}learnMidiAccessRef.current=null;setLearnMidiConnected(false);setLearnMidiName('');}
 async function connectLearnMidi(){if(!navigator.requestMIDIAccess){setLearnMessage('Web MIDI is not supported in this browser. Use Chrome or Edge on HTTPS, or continue with the microphone.');return;}try{const access=await navigator.requestMIDIAccess();if(!learnModeRef.current)return;const inputs=[...access.inputs.values()];if(!inputs.length){setLearnMessage('No MIDI piano was found. Connect your keyboard to this computer by USB, then retry.');return;}const onMessage=event=>{const data=event.data||[],command=(Number(data[0])||0)&0xf0,note=Number(data[1]),velocity=Number(data[2]);if(command!==0x90||velocity<=0||note<0||note>127)return;const name=midiToNote(note),entry={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note:name,midi:note,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'midi'};sessionEvents.current.push(entry);setEvents([...sessionEvents.current]);if(learnModeRef.current)checkLearnNote(name,note,'midi');};learnMidiAccessRef.current=access;inputs.forEach(input=>input.onmidimessage=onMessage);access.onstatechange=()=>{const current=[...access.inputs.values()];current.forEach(input=>input.onmidimessage=onMessage);if(!current.length){setLearnMidiConnected(false);setLearnMidiName('');setLearnMessage('MIDI piano disconnected. Reconnect it to continue accurate chord checking.');}};setLearnMidiConnected(true);setLearnMidiName(inputs.map(input=>input.name||input.manufacturer||'MIDI input').join(', '));setLearnMessage('MIDI piano connected. Chords and both hands can now be checked from individual key presses.');}catch(e){setLearnMessage('Could not connect MIDI: '+(e.message||'Check browser permissions and reconnect your piano.'));}}
 function finishLearnSession(completed=false){
  learnModeRef.current=false;disconnectLearnMidi();setLearnListenMode(false);setSheetPianoOpen(false);
  stopMic();stopPlayback();stopMetro();releaseAllKeys();try{synth.current?.releaseAll(Tone.now());synth.current?.dispose();synth.current=null}catch{}
  const seconds=Math.max(0,learnSeconds);
  if(seconds>0||loadedScoreNotes.length>0||expected.trim()){
    const session={id:editingSessionId||Date.now(),date:new Date().toISOString(),lastPractisedAt:new Date().toISOString(),
      song:songTitle||'Listen & Learn lesson',minutes:Math.round(seconds/60*10)/10,practiceSeconds:seconds,notes:events.length,
      reflection:'Listen & Learn lesson',feedback:completed?'Completed guided score practice':'Saved to continue later',
      practiceMode:'learn',learnProgressBeat:learnPhraseOffsetRef.current,learnHand,learnChunkDivision,
      loadedScoreNotes:loadedScoreNotes.map(n=>({...n})),scoreNotation:scoreNotation||null,
      expected,bpm,timeSignature,events:events.map(e=>({...e}))};
    setSessions(prev=>[session,...prev.filter(s=>s.id!==session.id)]);
    setStatus(completed?'Listen & Learn completed · '+Math.floor(seconds/60)+' min saved':'Listen & Learn saved · ready to continue later');
  }else setStatus(completed?'Listen & Learn finished':'Listen & Learn closed');
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
    setLoadedScoreNotes(notes);setScoreNotation(session.scoreNotation||null);setLearnHand(session.learnHand||'both');setLearnChunkDivision([1,2,4].includes(Number(session.learnChunkDivision))?Number(session.learnChunkDivision):1);
    learnPhraseOffsetRef.current=Math.max(0,Number(session.learnProgressBeat)||0);learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};
    setLearnPhraseOffset(learnPhraseOffsetRef.current);setLearnBarProgress(0);setLearnSeconds(Math.max(0,Number(session.practiceSeconds)||0));
    setPracticeMode('learn');setPracticeStarted(true);setLearnListenMode(true);setSheetPianoOpen(true);learnModeRef.current=true;
    setPage('Practice');setLearnMessage('Welcome back. Your saved bar is ready to practise.');setStatus('Resuming Listen & Learn');
    setTimeout(async()=>{if(learnModeRef.current){startTime.current=Date.now();await startMic();if(learnModeRef.current)playLearnPhrase();else stopMic()}},250);return;
  }
  setPracticeMode('normal');setRemainingSeconds(15*60);setPracticeStarted(true);startTime.current=Date.now();
  setPage('Practice');setStatus('Revisiting saved practice session');
}
 function getLearnEvents(){
  const meter=String(timeSignature||'4/4').split('/').map(Number),beatsPerBar=Math.max(.5,(meter[0]||4)*4/(meter[1]||4));
  if(!loadedScoreNotes?.length){let cursor=0;const events=targets.map((n,i)=>{const midi=n.midi??(n.rest?null:noteToMidi(n.note)),ev={...n,_start:cursor,_index:i,beats:Number(n.beats)||1,rest:!!n.rest,midi,hand:Number(midi)<60?'left':'right'};cursor+=ev.beats;return ev});return learnHand==='both'?events:events.filter(n=>n.rest||n.hand===learnHand)}
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
 async function toggleLearnSession(){if(learnListenMode){finishLearnSession();return}if(!loadedScoreNotes?.length&&!parseMusicSequence(expected).length){setLearnMessage('Add notes or import a MusicXML score before starting.');return}setEditingSessionId(null);startTime.current=Date.now();learnModeRef.current=true;learnProgressRef.current=0;learnPhraseOffsetRef.current=0;learnNoteLockRef.current=0;learnChordHitsRef.current={key:'',hits:[]};setLearnBarProgress(0);setLearnPhraseOffset(0);const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4)),firstBar=getLearnEvents().filter(n=>!n.rest&&n._start<barBeats);setLearnChunkDivision(firstBar.length>16?4:firstBar.length>8?2:1);setLearnSeconds(0);sessionEvents.current=[];setEvents([]);setSheetPianoOpen(true);setLearnListenMode(true);setLearnMessage('Requesting microphone access…');setStatus('Starting Learn & Listen');try{await startMic();if(!learnModeRef.current){stopMic();return}if(micStream.current){setLearnMessage(learnHand==='both'&&!learnMidiConnected?'Listen to the phrase. For accurate simultaneous chords and both hands, connect your piano by USB MIDI; microphone mode detects one pitch at a time.':'Listen to the phrase, then play the notes on your piano.');await playLearnPhrase()}else{setLearnMessage('Microphone access is needed to check your playing. Allow access, then press Connect microphone.')}}catch(e){setLearnMessage('Could not start the microphone. Allow microphone access, then try again.')}}
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
 function isAudioLibraryFile(x){return !!(x?.type?.startsWith('audio/')||/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|aiff?|mid|midi|weba|webm)$/i.test(x?.name||''))}
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
   const player=new Tone.PolySynth(Tone.Synth).toDestination();
   const part=new Tone.Part((time,n)=>player.triggerAttackRelease(n.name,n.duration,time,n.velocity),notes);
   Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0;Tone.Transport.bpm.value=tempo;
   part.start(0);Tone.Transport.start();
   const end=Math.max(...notes.map(n=>n.time+n.duration))+.3;
   const endId=Tone.Transport.scheduleOnce(()=>{
    part.dispose();player.dispose();Tone.Transport.stop();Tone.Transport.cancel();midiPlaybackRef.current=null;
    setLibraryPlayback(current=>current.id===item.id?{id:null,kind:'',paused:true}:current);
    setStatus('Score playback finished');
   },end);
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
async function playMidiLibraryFile(item){try{stopLibraryAudioOnly();if(midiPlaybackRef.current)stopMidiLibraryPlayback();await Tone.start();const {Midi}=await import('https://esm.sh/@tonejs/midi@2.0.28');const raw=await (await fetch(item.data)).arrayBuffer();const midi=new Midi(raw);if(!midi.tracks.some(t=>t.notes.length))throw new Error('This MIDI file contains no playable note events.');const player=new Tone.PolySynth(Tone.Synth).toDestination();const notes=midi.tracks.flatMap(track=>track.notes.map(n=>({time:n.time,name:n.name,duration:n.duration,velocity:n.velocity})));const part=new Tone.Part((time,n)=>player.triggerAttackRelease(n.name,Math.max(.05,n.duration),time,n.velocity),notes);Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0;part.start(0);Tone.Transport.start();const endId=Tone.Transport.scheduleOnce(()=>{part.dispose();player.dispose();midiPlaybackRef.current=null;setLibraryPlayback(current=>current.id===item.id?{id:null,kind:'',paused:true}:current);setStatus('MIDI playback finished')},midi.duration+.25);midiPlaybackRef.current={part,player,endId,itemId:item.id,paused:false};setLibraryPlayback({id:item.id,kind:'tone',paused:false});setAudioError('');setStatus('Playing '+item.name)}catch(e){setAudioError('Could not play MIDI file: '+e.message)}}
 function pauseMidiLibraryPlayback(){if(!midiPlaybackRef.current)return;try{Tone.Transport.pause();midiPlaybackRef.current.paused=true;setLibraryPlayback({id:midiPlaybackRef.current.itemId,kind:'tone',paused:true});setStatus('Playback paused')}catch(e){setAudioError('Could not pause playback: '+e.message)}}
 function resumeMidiLibraryPlayback(){if(!midiPlaybackRef.current)return;try{Tone.Transport.start();midiPlaybackRef.current.paused=false;setLibraryPlayback({id:midiPlaybackRef.current.itemId,kind:'tone',paused:false});setStatus('Resumed library playback')}catch(e){setAudioError('Could not resume playback: '+e.message)}}
 function stopMidiLibraryPlayback(){const p=midiPlaybackRef.current;if(!p)return;try{Tone.Transport.clear(p.endId);p.part.dispose();p.player.dispose();Tone.Transport.stop();Tone.Transport.cancel();Tone.Transport.position=0}catch{}midiPlaybackRef.current=null;setLibraryPlayback(current=>current.kind==='tone'?{id:null,kind:'',paused:true}:current);setStatus('Playback stopped')}
 async function handleMidiUpload(file,options={}){
  if(!file)return;setMusicCoachBusy(true);setAudioError('');setMusicCoachStatus('Reading MIDI file…');
  try{
   const parsed=parseStandardMidi(await file.arrayBuffer());
   const all=parsed.notes.map(n=>({...n,beats:Math.max(.125,n.duration*parsed.bpm/60),measure:Math.floor(n.time*parsed.bpm/60/Math.max(1,Number(timeSignature.split('/')[0])))+1}));
   const title=file.name.replace(/\.(mid|midi)$/i,'').trim()||'MIDI score';
   const score={format:'musiccoach',version:2,title,bpm:Math.round(parsed.bpm),timeSignature,created:new Date().toISOString(),source:'Imported MIDI',midiFormat:parsed.format,notes:all};
   const json=encodeMusicCoach(score),data='data:application/vnd.piano-coach.musiccoach;base64,'+btoa(unescape(encodeURIComponent(json)));
   const item={id:Date.now(),name:title+'.musiccoach',type:'application/vnd.piano-coach.musiccoach',size:new Blob([json]).size,data,added:new Date().toISOString(),kind:'score',score};
   setLibraryFiles(v=>[item,...v.filter(x=>x.name!==item.name)]);setSongTitle(title);setLearnHand('both');setEvents(all);sessionEvents.current=all;setLoadedScoreNotes(all);setBpm(Math.round(parsed.bpm));setExpected(all.slice(0,100).map(n=>n.note+'/'+(n.beats>=3.5?'w':n.beats>=1.5?'h':n.beats>=.7?'q':'e')).join(' '));setPracticeMode('learn');setPage(options.target||'Sheet music');setPracticeStarted(false);
   setMusicCoachStatus('Imported '+all.length+' MIDI notes and saved an editable .musiccoach score.');setStatus('MIDI imported successfully');
  }catch(e){const message=e?.message||'Unknown MIDI import error';setMusicCoachStatus('MIDI import failed: '+message);setAudioError('Could not import '+file.name+': '+message);setStatus('MIDI import failed')}
  finally{setMusicCoachBusy(false)}
 }
 function saveLibraryFile(file){
  if(!file)return;
  if(!isSheetMusicLibraryItem({name:file.name})){setStatus('Only sheet music files can be saved in this library.');return}
  const reader=new FileReader();
  reader.onload=()=>{const item={id:Date.now(),name:file.name,type:file.type||'application/octet-stream',size:file.size,data:reader.result,added:new Date().toISOString(),kind:'score-source'};setLibraryFiles(v=>[item,...v.filter(x=>x.name!==item.name)]);setStatus('Saved '+file.name+' in this browser’s sheet music library')};
  reader.onerror=()=>setStatus('Could not read '+file.name+'. Try exporting it again.');
  reader.readAsDataURL(file);
}
 function handleScoreUpload(file,options={}){
  if(!file)return;
  const name=file.name.toLowerCase(),target=options.target||'Sheet music';
  if(!isSheetMusicLibraryItem({name:file.name})){setStatus('Choose a sheet music file: MusicXML, MIDI, .musiccoach, PDF or a score image.');return}
  if(name.endsWith('.mid')||name.endsWith('.midi')){handleMidiUpload(file,{target});return}
  if(name.endsWith('.musiccoach')||name.endsWith('.musicxml')||name.endsWith('.xml')){importMusicXML(file,{target,download:!!options.download});return}
  if(file.type==='application/pdf'||name.endsWith('.pdf')||file.type.startsWith('image/')||/\.(png|jpe?g|webp|svg)$/i.test(name)){convertScoreToMusicCoach(file,{target,download:!!options.download});return}
  setStatus('This file type cannot be converted to sheet music.');
 }
 function downloadLibraryFile(item){const a=document.createElement('a');a.href=item.data;a.download=item.name;a.click()}
 async function openLibrarySheetFullscreen(item){
  try{
   if(!item?.data)throw new Error('This Library item has no stored file data.');
   const response=await fetch(item.data);if(!response.ok)throw new Error('The saved file could not be read.');
   const ext=(item.name||'').toLowerCase();
   if(ext.endsWith('.pdf')||/pdf/i.test(item.type||'')){setLibraryFullscreenItem({kind:'pdf',src:item.data,title:item.name});return;}
   if(/\.(png|jpe?g|webp)$/i.test(ext)||item.type?.startsWith('image/')){setLibraryFullscreenItem({kind:'image',src:item.data,title:item.name});return;}
   let xmlText='';
   if(/\.(mid|midi)$/i.test(ext)){
    const {Midi}=await import('https://esm.sh/@tonejs/midi@2.0.28');
    const midi=new Midi(await response.arrayBuffer());
    const notes=midi.tracks.flatMap(t=>t.notes.map(n=>({note:n.name,time:n.time,duration:n.duration,midi:n.midi,hand:n.midi<60?'left':'right'})));
    xmlText=scoreNotesToMusicXML({title:item.name,notes});
   }else{
    const raw=await response.text();
    if(ext.endsWith('.musiccoach')){
     const score=item.score||decodeMusicCoach(raw);
     xmlText=score.sourceMusicXML||score.notation?.sourceMusicXML||score.musicxml||scoreNotesToMusicXML(score);
    }else xmlText=raw;
   }
   if(!xmlText||!/<score-partwise|<score-timewise/i.test(xmlText))throw new Error('No renderable sheet notation was found in this file.');
   setFullscreenScore({xml:xmlText,title:item.name||'Sheet music'});
  }catch(e){setAudioError('Could not expand '+(item?.name||'file')+': '+(e.message||String(e)));}
 }
 async function openLibraryScore(item){
  if(!item)return;
  if(!isPlayableSheetMusicItem(item)){setStatus('Listen & Learn accepts only structured .musiccoach, MusicXML or MIDI files. Photos, scans and PDFs must be converted first.');return;}
  try{
   let blob;
   if(item.data){const response=await fetch(item.data);if(!response.ok)throw new Error('The stored score could not be read.');blob=await response.blob();}
   else if(item.score){blob=new Blob([encodeMusicCoach(item.score)],{type:'application/vnd.piano-coach.musiccoach'});}
   else throw new Error('This saved score has no file data.');
   const file=new File([blob],item.name||'library-score.musiccoach',{type:item.type||blob.type||'application/octet-stream'});
   setPracticeScoreName(item.name||'Sheet music');setPracticeScoreError('');setPracticeStarted(false);setPracticeMode('learn');setPage('Practice');setStatus('Loading '+(item.name||'score')+' into Practice…');
   handleScoreUpload(file,{target:'Practice',download:false});
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
 async function sendMusicChat(){
  const question=musicChatInput.trim();if(!question||musicChatBusy)return;
  setMusicChat(v=>[...v,{role:'user',content:question}]);setMusicChatInput('');setMusicChatBusy(true);
  try{
   if(!window.PianoCoachAI){await new Promise((resolve,reject)=>{const old=document.querySelector('script[data-piano-coach-ai]');if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}const script=document.createElement('script');script.src='/ai-tutor.js';script.dataset.pianoCoachAi='true';script.onload=resolve;script.onerror=()=>reject(new Error('Music assistant could not be loaded'));document.head.appendChild(script)});}
   if(!window.PianoCoachAI?.ask)throw new Error('Music assistant is unavailable');
   const result=await window.PianoCoachAI.ask(question,{history:musicChat.slice(-8)});setMusicChat(v=>[...v,{role:'assistant',content:result.answer||'I could not produce an answer.'}]);
  }catch(e){setMusicChat(v=>[...v,{role:'assistant',content:'Assistant unavailable: '+e.message}])}finally{setMusicChatBusy(false)}
 }
 function startVoiceQuestion(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setTutorStatus('Voice input is not supported in this browser.');return}const rec=new SR();rec.lang='en-GB';rec.onresult=e=>setTutorQuestion(v=>(v+' '+e.results[0][0].transcript).trim());rec.start()}
 async function pressKey(note){if(heldKeysRef.current[note])return;heldKeysRef.current[note]=true;setHeldKeys(v=>({...v,[note]:true}));const midi=noteToMidi(note);if(midi!==null){const s=await ensureSynth();if(heldKeysRef.current[note])s.triggerAttack(midiToNote(midi));}if(!startTime.current)startTime.current=Date.now();const event={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),note,midi,time:((Date.now()-startTime.current)/1000).toFixed(2),timeMs:Date.now(),source:'keyboard'};sessionEvents.current.push(event);setEvents([...sessionEvents.current]);if(learnListenMode)checkLearnNote(note,midi);else setStatus('Played '+note)}
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
  if(midi!==null&&synth.current){try{synth.current.triggerRelease(midiToNote(midi),Tone.now())}catch{}}
  setHeldKeys(v=>({...v,[note]:false}));
 }
 function releaseAllKeys(){
  const notes=new Set([...Object.values(heldComputerKeysRef.current),...Object.keys(heldKeysRef.current).filter(n=>heldKeysRef.current[n])]);
  heldComputerKeysRef.current={};
  notes.forEach(note=>{heldKeysRef.current[note]=false;const midi=noteToMidi(note);if(midi!==null&&synth.current){try{synth.current.triggerRelease(midiToNote(midi),Tone.now())}catch{}}});
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
 const qualifyingSessions=sessions.filter(s=>Number(s.practiceSeconds??((Number(s.minutes)||0)*60))>=900);
 const practiceDays=[...new Set(qualifyingSessions.map(s=>{const d=new Date(s.lastPractisedAt||s.date);return Number.isNaN(d.getTime())?'':d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}).filter(Boolean))].sort().reverse();
 const dayKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const todayKey=dayKey(new Date()),yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
 let streak=0;
 if(practiceDays.includes(todayKey)||practiceDays.includes(dayKey(yesterday))){let cursor=new Date();if(!practiceDays.includes(todayKey))cursor.setDate(cursor.getDate()-1);while(practiceDays.includes(dayKey(cursor))){streak++;cursor.setDate(cursor.getDate()-1)}}
 const nav=['Dashboard','Practice','Sheet music','Grade plan','Extras'];
 const sheetMusicFiles=libraryFiles.filter(isSheetMusicLibraryItem);
 const visibleSheetMusicFiles=scoreLibraryExpanded?sheetMusicFiles:sheetMusicFiles.slice(0,3);
 const renderLearnFullscreen = () => {
  if(!learnListenMode||!sheetPianoOpen)return null;
  const meter=String(timeSignature||'4/4').split('/').map(Number),barBeats=Math.max(.5,(meter[0]||4)*4/(meter[1]||4)),chunkBeats=barBeats/Math.max(1,learnChunkDivision);
  const allNotes=getLearnEvents().filter(n=>!n.rest&&n.midi!==null),barNotes=getLearnPhrase().filter(n=>!n.rest&&n.midi!==null);
  const minMidi=allNotes.length?Math.min(...allNotes.map(n=>Number(n.midi))):48,maxMidi=allNotes.length?Math.max(...allNotes.map(n=>Number(n.midi))):72;
  const octaveCount=Math.max(1,Math.min(8,Math.ceil((maxMidi-minMidi+1)/12))),rawRangeStart=Math.floor(minMidi/12)*12,rangeStart=Math.max(21,Math.min(rawRangeStart,109-octaveCount*12)),rangeEnd=Math.min(109,rangeStart+octaveCount*12);
  const visibleKeys=allKeys.filter(k=>k.midi>=rangeStart&&k.midi<rangeEnd),whiteKeys=visibleKeys.filter(k=>!k.black),whiteWidth=100/Math.max(1,whiteKeys.length),noteWidth=100/Math.max(1,rangeEnd-rangeStart);
  const offset=learnPhraseOffsetRef.current,position=offset+learnProgressRef.current;
  const first=barNotes.find(n=>n._start>=position-0.0001)||barNotes[0],activeGroup=first?barNotes.filter(n=>Math.abs(n._start-first._start)<0.0001):[];
  const totalBars=Math.max(1,Math.ceil(allNotes.reduce((m,n)=>Math.max(m,n._start+(Number(n.beats)||1)),0)/barBeats)),barNumber=Math.min(totalBars,Math.floor(offset/barBeats)+1),chunkNumber=Math.floor((offset%barBeats)/chunkBeats)+1;
  const chooseHand=hand=>{setLearnHand(hand);setLearnChunkDivision(1);learnPhraseOffsetRef.current=0;learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};setLearnPhraseOffset(0);setLearnBarProgress(0);setLearnAnimationKey(v=>v+1);setLearnMessage(hand==='both'?'Both hands selected. Use MIDI for reliable simultaneous chord checking.':(hand==='left'?'Left hand selected. Practise the bass part.':'Right hand selected. Practise the melody.'));};
  return <div className="learn-fullscreen" role="dialog" aria-modal="true" aria-label="Listen and Learn piano practice">
    <header className="learn-fullscreen-head"><div><div className="eyebrow">PIANO COACH · LISTEN & LEARN <span className="learn-beta-pill">BETA</span></div><h2>{songTitle||'Your piece'}</h2><p>{learnMidiConnected?'MIDI piano connected · accurate chord input':listening?'Microphone connected · play the highlighted notes':'Connect a microphone or MIDI piano to begin'}</p></div><button className="learn-close" onClick={()=>finishLearnSession(false)} aria-label="Close and save for later">✕</button></header>
    <div className="learn-fullscreen-body learn-studio"><div className="learn-studio-strip"><span><i className="learn-studio-live"/> LIVE PRACTICE</span><span>{octaveCount} OCTAVES</span><span>{bpm} BPM</span><span>{learnHand==='both'?'BOTH HANDS':learnHand.toUpperCase()+' HAND'}</span></div>
      <section className="learn-top-panel">
        <div className="learn-top-copy"><span className="learn-live-dot"/><div><strong>{learnMessage}</strong><small>Bar {barNumber} of {totalBars}{learnChunkDivision>1?' · Section '+chunkNumber+'/'+learnChunkDivision:''} · {Math.floor(learnSeconds/60)}:{String(learnSeconds%60).padStart(2,'0')} elapsed</small></div></div>
        <div className="learn-top-actions"><button className="btn btn-dark" onClick={playLearnPhrase}>{learnChunkDivision>1?'▶ Hear this section':'▶ Hear this bar'}</button><button className="btn" onClick={skipLearnBar}>{learnChunkDivision>1?'Skip section →':'Skip bar →'}</button></div>
        <div className="learn-hand-controls" role="group" aria-label="Choose which hand to practise"><span>HANDS</span><button type="button" className={learnHand==='left'?'active':''} aria-pressed={learnHand==='left'} onClick={()=>chooseHand('left')}>Left</button><button type="button" className={learnHand==='right'?'active':''} aria-pressed={learnHand==='right'} onClick={()=>chooseHand('right')}>Right</button><button type="button" className={learnHand==='both'?'active':''} aria-pressed={learnHand==='both'} onClick={()=>chooseHand('both')}>Both</button></div>
        <label className="learn-chunk-control">Section size <select value={learnChunkDivision} onChange={e=>{const value=Number(e.target.value);setLearnChunkDivision(value);learnPhraseOffsetRef.current=Math.floor(learnPhraseOffsetRef.current/barBeats)*barBeats;learnProgressRef.current=0;learnChordHitsRef.current={key:'',hits:[]};setLearnPhraseOffset(learnPhraseOffsetRef.current);setLearnBarProgress(0);setLearnAnimationKey(v=>v+1);setLearnMessage(value===1?'Full bar selected.':value===2?'Half-bar sections selected.':'Quarter-bar sections selected.')}}><option value={1}>Full bar</option><option value={2}>Half a bar</option><option value={4}>Quarter of a bar</option></select></label><div className="learn-bar-progress"><i style={{width:Math.min(100,learnBarProgress/chunkBeats*100)+'%'}}/></div>
      </section>
      <section className="learn-roll-stage"><div className="learn-roll-stage-head"><div><span className="eyebrow">PIANO ROLL</span><strong>Follow the notes down to the keys</strong></div><div className="learn-hand-legend"><span><i className="legend-right"/> Right hand</span><span><i className="legend-left"/> Left hand</span></div></div><div className="learn-piano-roll" aria-label="Falling note piano roll"><div className="learn-roll-grid" style={{backgroundSize:whiteWidth+'% 100%,100% 38px'}}>
        {barNotes.map((n,i)=>{const midi=Number(n.midi),distance=Math.max(0,Number(n._start)-offset),height=Math.max(18,(Number(n.beats)||1)*38),isCurrent=activeGroup.some(x=>x.id===n.id||x._index===n._index),isBlack=!!visibleKeys.find(k=>k.midi===midi)?.black,whiteBefore=whiteKeys.filter(k=>k.midi<midi).length,left=isBlack?whiteBefore*whiteWidth-whiteWidth*.31:whiteBefore*whiteWidth,width=isBlack?whiteWidth*.62:whiteWidth,lead=1.8,delay=Math.max(0,distance*60/Math.max(30,bpm));return <div key={(n.id||n._index||i)+'-'+learnAnimationKey} className={'learn-roll-note '+(isCurrent?'is-current ':'')+(n.hand==='left'?'hand-left':'hand-right')} style={{left:left+'%',width:'calc('+width+'% - 2px)',top:'0px',height:height+'px','--note-height':height+'px','--fall-delay':delay+'s'}}><span>{n.note||midiToNote(midi)}</span></div>})}
        <div className="learn-roll-hitline"><span>PLAY HERE</span></div>
      </div></div></section>
      <section className="learn-keyboard-section"><div className="learn-keyboard-heading"><span>PLAYING KEYBOARD</span><span>{octaveCount} octave{octaveCount===1?'':'s'} · {midiToNote(rangeStart)}–{midiToNote(rangeEnd-1)}</span></div>
        <div className="piano-scroll learn-keyboard-scroll"><div className="piano learn-keyboard" style={{'--keyboard-white-key-width':whiteWidth+'%'}}>
          {whiteKeys.map(k=><button key={k.midi} className={'white-key '+(heldKeys[k.note]?'is-held':'')} style={{flex:'0 0 '+whiteWidth+'%',width:whiteWidth+'%',minWidth:0}} aria-label={k.note} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}
          {visibleKeys.filter(k=>k.black).map(k=><button key={k.midi} className={'black-key '+(heldKeys[k.note]?'is-held':'')} style={{left:(whiteKeys.filter(w=>w.midi<k.midi).length*whiteWidth)+'%',width:(whiteWidth*.62)+'%',transform:'translateX(-50%)'}} aria-label={k.note} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}
        </div></div><div className="learn-keyboard-hint">Play the highlighted notes on your piano, or use a connected MIDI keyboard. Microphone pitch detection checks one pitch at a time.</div>
      </section>
      <div className="learn-session-controls">{renderLearnTempoControl(bpm,setBpm)}<button className="btn" onClick={listening?stopMic:startMic}>{listening?'Disconnect microphone':'Connect microphone'}</button><button className="btn" onClick={learnMidiConnected?disconnectLearnMidi:connectLearnMidi}>{learnMidiConnected?'Disconnect MIDI':'Connect MIDI piano'}</button><button className="btn" onClick={()=>finishLearnSession(false)}>Continue later</button><button className="btn btn-dark" onClick={()=>finishLearnSession(true)}>Finish session</button></div>
      <p className="learn-session-footnote">Incorrect notes keep the current bar in place. Complete its notes to move forward, or skip the bar. Progress is saved when you continue later or finish.</p>
    </div>
  </div>;
};
return <div className="shell"><aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('Dashboard')}}><img className="brand-logo-mark" src="/assets/piano-coach-logo-mark.svg" alt=""/> <span>Piano Coach<small>Listen · Learn · Play</small></span></a><div className="nav-label">WORKSPACE</div>{nav.map(n=><button key={n} className={'nav-item '+(page===n?'active':'')} onClick={()=>{setPage(n)}}><span>{({'Dashboard':'⌂','Practice':'♫','Sheet music':'♬','Score converter':'⇄','Score tools':'▤','Library':'▥','Grade plan':'◎','Extras':'✦'})[n]}</span>{n}</button>)}<div className="sidebar-tools"><button title="Download all data (.musicdata)" aria-label="Download all data" onClick={downloadMusicData}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3"/></svg></button><button title="Restore data from .musicdata" aria-label="Upload backup data" onClick={()=>musicDataInputRef.current?.click()}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3"/></svg></button><input ref={musicDataInputRef} type="file" accept=".musicdata,application/vnd.piano-coach.musicdata+json,application/json" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)importMusicData(f);e.target.value=''}}/><button title="Delete local data" aria-label="Delete local data" onClick={()=>{if(confirm('Deleting your saved website data will permanently remove your practice sessions, saved studies and Library items from this device. This cannot be undone. Delete your data?')){setSessions([]);setSaved([]);setLibraryFiles([]);for(const k of ['pc_sessions','pc_studies','pc_files'])localStorage.removeItem(k);setStatus('Local data cleared')}}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div><div className="sidebar-logo"><a href="https://jws.l.cd" target="_blank" rel="noopener noreferrer" aria-label="Open your requested website"><img src="/assets/user-corner-logo.svg" alt="Open website"/></a></div></aside>
 <main className="main">{compactViewport&&!continueOnSmallScreen&&<div className="device-size-overlay" role="dialog" aria-modal="true" aria-labelledby="device-size-title"><section className="device-size-card"><div className="device-size-icon">⌘</div><div className="eyebrow">BEST EXPERIENCE</div><h2 id="device-size-title">Use a computer or iPad for Music Coach</h2><p>Some tools — especially Listen & Learn, sheet music conversion and the piano keyboard — need a larger screen to work comfortably. We recommend opening Music Coach on a computer or iPad.</p><p className="device-size-warning">You can still continue on this screen, but parts of the app may be cramped or may not function as expected.</p><div className="device-size-actions"><button className="btn btn-dark" onClick={()=>setContinueOnSmallScreen(true)}>Continue on this screen</button><span>Recommended: screen width of 900px or more</span></div></section></div>}<header className="topbar"><div><div className="eyebrow">YOUR PERSONAL MUSIC STUDIO</div><h1>{page==='Practice'?'Play, listen, improve.':page==='Dashboard'?'A little practice goes a long way.':page}</h1></div><div className="top-actions"><span className="status-chip"><i/> {status}</span><button className="btn btn-dark" onClick={()=>{setPage('Practice');setStatus('Ready to play')}}>＋ New session</button></div></header>
 {page==='Practice'&&!practiceStarted&&<section className="panel practice-setup"><div className="eyebrow">LET'S MAKE MUSIC</div><h2>What are you playing?</h2><p className="muted">Tell Piano Coach what you're working on so your feedback can be specific.</p><label className="sequence-label">Song or piece<input value={songTitle} onChange={e=>setSongTitle(e.target.value)} placeholder="e.g. Moonlight Sonata, grade piece…"/></label><label className="sequence-label">How long do you want to practise? (minutes)<input type="number" min="1" max="240" value={practiceMinutes} onChange={e=>setPracticeMinutes(e.target.value)}/></label><label className="sequence-label">Time signature / beats per bar<select value={timeSignature} onChange={e=>setTimeSignature(e.target.value)}><option value="2/4">2/4 · 2 beats per bar</option><option value="3/4">3/4 · 3 beats per bar</option><option value="4/4">4/4 · 4 beats per bar</option><option value="6/8">6/8 · 6 eighth-beats per bar</option><option value="12/8">12/8 · 12 eighth-beats per bar</option></select></label><div className="practice-library-link"><p className="muted small">Choose sheet music from your saved Sheet Music library. Uploads and conversion happen there, not in Practice.</p><button type="button" className="btn" onClick={()=>setPage('Sheet music')}>Open Sheet Music library ↗</button>{practiceScoreName&&<small className="practice-upload-success">Loaded score: {practiceScoreName}</small>}</div><div className="practice-mode-picker"><strong>How would you like to practise?</strong><div className="toolbar"><button type="button" className={"btn "+(practiceMode==='normal'?'btn-dark':'')} onClick={()=>setPracticeMode('normal')}>Normal practice</button><button type="button" className={"btn "+(practiceMode==='learn'?'btn-dark':'')} onClick={()=>setPracticeMode('learn')}>Listen & Learn <span className="learn-beta-pill">BETA</span></button></div><p className="muted small">{practiceMode==='learn'?'A Midiano-style falling-note piano roll with an automatically sized keyboard, bar-by-bar feedback and microphone or MIDI input.':'The usual practice workspace with microphone recording and feedback.'}</p></div><p className="muted small">MusicXML/XML and MIDI can be converted to editable notes. PDF/image recognition depends on the on-device recognition engine and may need correction.</p><button className="btn btn-dark" onClick={()=>{if(practiceMode==='learn'){toggleLearnSession()}else{beginPractice()}}} disabled={!(Number(practiceMinutes)>0)||musicCoachBusy}>Start {practiceMode==='learn'?'Listen & Learn':'practice'} →</button><p className="muted small">Your microphone permission is requested when the session starts. You can stop recording whenever you finish playing.</p></section>}
 {page==='Practice'&&practiceStarted&&practiceMode!=='learn'&&scoreNotation?.sourceMusicXML&&<section className="panel practice-source-score"><div className="panel-head"><div><div className="eyebrow">YOUR SHEET MUSIC</div><h2>{songTitle||'Practice score'}</h2><p className="muted">Double-click the notation to expand it to fullscreen.</p></div><button className="btn" onClick={()=>setFullscreenScore({xml:scoreNotation.sourceMusicXML,title:songTitle||'Practice score'})}>Expand sheet ↗</button></div><MusicXMLPreview xml={scoreNotation.sourceMusicXML} title={songTitle||'Practice score'} onExpand={()=>setFullscreenScore({xml:scoreNotation.sourceMusicXML,title:songTitle||'Practice score'})}/></section>}{page==='Practice'&&practiceStarted&&<><div className="practice-grid"><section className="panel studio-panel"><div className="panel-head"><div><div className="eyebrow">PRACTICE SESSION</div><h2>{songTitle||"Your practice"}</h2><p className="muted">Play your instrument while Piano Coach listens and records.</p></div><span className="tag">{bpm} BPM</span></div><div className="toolbar practice-metronome"><button className={'btn '+(metronome?'btn-tint':'')} onClick={toggleMetro}>{metronome?'Ⅱ Stop metronome':'◷ Metronome'}</button><label className="sequence-label">Tempo · {bpm} BPM<input type="range" min="40" max="240" value={bpm} onChange={e=>{setBpm(+e.target.value);Tone.Transport.bpm.value=+e.target.value}}/></label></div><div className="divider"/><div className="panel-head"><div><h3>Listen through your microphone</h3><p className="muted">Best for single-note pitch tracking. Chord transcription is not supported by this detector.</p></div><span className={'tag '+(listening?'tag-live':'')}>{listening?'LISTENING':'MIC OFF'}</span></div><div className="mic-row"><div className="meter"><div style={{width:level+'%'}}/></div><span className="muted">{level}% input</span>{!listening?<button className="btn btn-dark" onClick={startMic}>Enable microphone</button>:<button className="btn" onClick={stopMic}>Disconnect mic</button>}</div><p className="muted small">{micStatus}</p><div className="toolbar live-feedback-controls"><button type="button" className={"btn "+(liveFeedback?"btn-dark":"")} onClick={()=>setLiveFeedback(v=>!v)}>{liveFeedback?"✓ Live pitch feedback on":"Enable live pitch feedback"}</button><span className="muted small">{liveFeedback?"Immediate single-note checks are active. Detailed polyphonic AI review runs when you finish recording.":"Turn this on to compare detected notes with your target as you play."}</span></div><p className="session-timer">Time remaining <strong>{Math.floor(remainingSeconds/60).toString().padStart(2,'0')}:{(remainingSeconds%60).toString().padStart(2,'0')}</strong></p><div className="toolbar">{!isRecording?<button className="btn btn-danger" disabled={!listening} onClick={startRecording}>● Start recording</button>:<button className="btn btn-danger" onClick={stopRecording}>■ Stop recording · {recordingSeconds}s</button>}{recording&&<><button className="btn" onClick={playRecording}>▶ Play recording</button></>}<button className="btn btn-dark" onClick={()=>{saveSession();setPracticeStarted(false);setPage('Dashboard')}}>Finish & save session</button></div>{audioError&&<p className="audio-error" role="alert">{audioError}</p>}</section>
 <aside className="panel notes-panel"><div className="panel-head"><div><div className="eyebrow">LIVE TRANSCRIPTION</div><h2>Detected notes</h2></div><span className="count">{events.length}</span></div><p className="muted">Notes transcribed from your microphone recording, compared with a reference recording found from your song title when available.</p><div className="analysis-summary"><strong>Song likeness analysis</strong><p>{referenceStatus}</p>{referenceSong&&<p className="muted small">Reference: {referenceSong.title} — {referenceSong.artist}</p>}<a className="text-button" href={audioComSearchUrl(songTitle)} target="_blank" rel="noopener noreferrer">Find a recording on Audio.com ↗</a></div>{isAnalyzing&&<p className="analysis-progress">Analysing your recording and detecting pitches…</p>}{events.length>0&&<div className="analysis-summary"><strong>Recording analysis</strong><p>{events.length} note events detected</p><p className="muted small">{[...new Set(events.map(n=>n.note))].join(' · ')}</p></div>}<Staff notes={events} expanded={expanded} bpm={bpm} timeSignature={timeSignature}/><button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'− Compact staff':'+ Expand staff'}</button><div className="notes-list">{events.slice(-12).reverse().map((e,i)=><div className="note-row" key={e.id}><span className="note-dot">{e.note.replace(/[0-9]/g,'')}</span><strong>{e.note}</strong><span className="muted">{e.time}s</span><span className="source">{e.source==='microphone'?'MIC':'KEY'}</span></div>)}{!events.length&&<div className="empty-state"><div className="music-icon">♫</div><strong>Your notes will appear here</strong><p>Play a key or enable your microphone to begin. The staff and event list update together.</p></div>}</div><div className="notes-actions"><button className="btn" onClick={undoNote} disabled={!events.length}>↶ Undo</button><button className="btn" onClick={exportMusicCoach} disabled={!events.length}>↓ Save .musiccoach</button><button className="btn btn-quiet" onClick={clearNotes} disabled={!events.length}>Clear</button></div></aside></div>
 <section className="panel compare-panel"><div className="panel-head"><div><div className="eyebrow">SESSION REVIEW</div><h2>Practice feedback</h2><p className="muted">The recording is analysed as audio first, then detected pitches, onsets and note lengths are used for feedback. The text AI does not directly hear the waveform; the audio model transcribes it.</p></div></div><label className="sequence-label">Your reflection<textarea value={reflection} onChange={e=>setReflection(e.target.value)} placeholder="What felt good? What needs work?"/></label><div className="tutor-answer"><strong>Practice feedback</strong><p>{practiceFeedback||'Stop recording to automatically analyse your performance.'}</p></div><div className="divider"/><div className="panel-head"><div><h3>AI piano tutor</h3><p className="muted">Ask about this attempt. The local model loads when you first ask.</p></div><span className="tag">AUDIO-BASED REVIEW</span></div><div className="tutor-form"><input value={tutorQuestion} onChange={e=>setTutorQuestion(e.target.value)} placeholder="Ask about a bar, fingering, rhythm…"/><button className="btn" onClick={startVoiceQuestion} title="Speak your question">🎙</button><button className="btn btn-dark" disabled={tutorBusy||!tutorQuestion.trim()} onClick={askTutor}>{tutorBusy?'Thinking…':'Ask AI tutor'}</button></div><p className="muted small">{tutorStatus}</p>{tutorAnswer&&<div className="tutor-answer" role="status">{tutorAnswer}</div>}</section>{(scoreSourceAsset||scoreImageUrl||scoreNotation?.sourceMusicXML)&&<section className="panel practice-score-bottom"><div className="panel-head"><div><div className="eyebrow">YOUR SHEET MUSIC</div><h2>{songTitle||scoreImageName||'Practice score'}</h2><p className="muted">Scroll here to view the score you uploaded. The embedded preview stays with the .musiccoach file when available.</p>{scoreSourceAsset?.warning&&<p className="muted small">{scoreSourceAsset.warning}</p>}</div><button className="btn btn-dark" onClick={()=>setPage('Sheet music')}>Open sheet music workspace →</button></div>{scoreImageUrl?<div className="practice-source-preview">{scoreIsPdf?<iframe title="Uploaded sheet music PDF" src={scoreImageUrl} style={{width:'100%',minHeight:520,border:0}}/>:<img src={scoreImageUrl} alt={scoreImageName||'Uploaded sheet music'}/>}</div>:<><MusicXMLPreview xml={scoreNotation.sourceMusicXML} title={songTitle||'Sheet music'} onExpand={()=>setFullscreenScore({xml:scoreNotation.sourceMusicXML,title:songTitle||'Sheet music'})}/><p className="muted small">Structured MusicXML score · {scoreNotation?.notationEvents?.length||0} notation markings preserved.</p><div className="editable-score"><Staff notes={parseMusicSequence(expected).map((n,i)=>({id:i,note:n.note,midi:n.midi,rest:n.rest,beats:n.beats,time:i*(60/bpm),duration:n.beats*60/bpm}))} expanded bpm={bpm} timeSignature={timeSignature}/></div></>}<div className="toolbar"><button className="btn" onClick={exportMusicCoach}>Save .musiccoach</button><button className="btn" onClick={()=>setPage('Sheet music')}>Open full score tools</button></div></section>}</>}
 {page==='Dashboard'&&<><section className="welcome panel"><div><span className="tag">YOUR MUSIC JOURNEY</span><h2>Make time for music.</h2><p className="muted">A calm space to practise, explore sheet music and track your progress.</p><button className="btn btn-dark dashboard-primary" onClick={()=>{setPracticeStarted(false);setPage('Practice');setStatus('Ready to play')}}>Start a practice session <span aria-hidden="true">→</span></button></div><div className="welcome-mark" aria-hidden="true">♫</div></section><section className="streak-card" aria-label="Practice streak"><div className="streak-flame" aria-hidden="true">🔥</div><div className="streak-copy"><span className="tag">YOUR DAILY STREAK</span><h2>{streak} {streak===1?'day':'days'} in a row</h2><p>{streak?'Amazing consistency — keep your music habit going!':'Start your streak today with a short practice session.'}</p><div className="streak-week" aria-label="Last seven days">{Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=dayKey(d);const active=practiceDays.includes(key);return <div key={key} className={'streak-day '+(active?'done':'')}><span>{['S','M','T','W','T','F','S'][d.getDay()]}</span><b>{active?'✓':d.getDate()}</b></div>})}</div></div><button className="btn btn-dark streak-cta" onClick={()=>setPage('Practice')}>{streak?'Keep it going':'Start practising'} →</button></section><section className="learn-launch-card"><div className="learn-launch-icon" aria-hidden="true">♫</div><div className="learn-launch-copy"><span className="tag">GUIDED LEARNING · BETA</span><h2>Listen, learn and play</h2><p>Hear a short phrase, play it back, and track your learning as practice time.</p></div><button className="btn btn-dark" onClick={()=>{setPage('Sheet music');setSheetPianoOpen(true);if(!learnListenMode)toggleLearnSession()}}>Start a lesson →</button></section><section className="dashboard-overview"><div className="dashboard-section-title"><div><h2>Your progress</h2><p className="muted">A quick look at your work so far.</p></div></div><div className="stats-grid"><article className="stat-card"><span>Sessions</span><strong>{sessions.length}</strong></article><article className="stat-card"><span>Practice time</span><strong>{Math.round(sessions.reduce((a,s)=>a+(Number(s.minutes)||0),0)*10)/10} <em>min</em></strong></article><article className="stat-card"><span>Saved studies</span><strong>{saved.length}</strong></article></div></section><section className="dashboard-sessions"><div className="dashboard-section-title"><div><h2>Recent practice</h2><p className="muted">Pick up where you left off.</p></div><button className="btn" onClick={()=>setPage('Practice')}>New session</button></div>{sessions.length?sessions.slice(0,3).map(s=><div className="list-item dashboard-session" key={s.id}><span className="list-icon" aria-hidden="true">♫</span><div><strong>{s.song||'Practice session'}</strong><small>{new Date(s.date).toLocaleDateString()} · {s.notes} note events</small></div><span className="dashboard-session-time">{Math.round((s.practiceSeconds??((s.minutes||0)*60))/60*10)/10} min</span><button className="btn" onClick={()=>resumeSavedSession(s)}>{s.practiceMode==='learn'?'Resume L&L':'Continue'}</button></div>):<div className="dashboard-empty"><div><strong>Ready when you are</strong><p>Your saved practice sessions will appear here.</p></div><button className="btn" onClick={()=>setPage('Practice')}>Start your first session</button></div>}</section></>}{page==='Sheet music'&&<div key="sheet-music-page" className="sheet-music-workspace">
<section className="panel personal-scores-panel">
 <div className="panel-head"><div><div className="eyebrow">YOUR COLLECTION</div><h2>Your sheet music</h2><p className="muted">Saved in this browser. Import a score once and it stays in your library between visits.</p></div><span className="tag">{sheetMusicFiles.length} saved</span></div>
 <label className="upload-score personal-score-upload"><span>Import sheet music</span><input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,.pdf,.png,.jpg,.jpeg,.webp,.svg,application/vnd.recordare.musicxml+xml,image/png,image/jpeg,image/webp,application/pdf,application/xml,text/xml" onChange={e=>{const file=e.target.files?.[0];if(file)handleScoreUpload(file,{target:'Sheet music',download:false});e.target.value=''}}/></label>
 <div className="personal-score-grid">
  {visibleSheetMusicFiles.length?visibleSheetMusicFiles.map((item,i)=>{const playable=isPlayableSheetMusicItem(item);return <article className="personal-score-card" key={item.id||item.name||i} onDoubleClick={()=>openLibrarySheetFullscreen(item)} title="Double-click to expand sheet music">
   <div className="personal-score-art" aria-hidden="true"><span>{/\.pdf$/i.test(item.name)?'PDF':/\.(png|jpe?g|webp|svg)$/i.test(item.name)?'IMAGE':/\.(mid|midi)$/i.test(item.name)?'MIDI':/\.(musicxml|xml)$/i.test(item.name)?'𝄞':'♫'}</span><div className="personal-score-staff"><i/><i/><i/><i/><i/></div></div>
   <div className="personal-score-meta"><strong title={item.name}>{item.name||'Untitled score'}</strong><span>{item.type||'Sheet music'} · {(item.size||0)>=1024*1024?((item.size||0)/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round((item.size||0)/1024))+' KB'}</span></div>
   <div className="personal-score-actions">
    {playable&&<button className="btn btn-dark" onClick={()=>toggleScoreLibraryPlayback(item)}>{libraryPlayback.id===item.id&&libraryPlayback.kind==="tone"?(libraryPlayback.paused?"▶ Resume":"Ⅱ Pause"):"▶ Listen"}</button>}
    {playable&&libraryPlayback.id===item.id&&<button className="btn" onClick={()=>stopLibraryItem(item)}>■ Stop</button>}
    <button className="btn" onClick={()=>openLibrarySheetFullscreen(item)}>Expand sheet ↗</button>
    {playable&&<button className="btn btn-dark" onClick={()=>openLibraryScore(item)}>Listen & Learn <span className="learn-beta-pill">BETA</span></button>}
    <button className="btn" onClick={()=>downloadLibraryFile(item)}>Download</button>
    <button className="btn btn-quiet" onClick={()=>{if(confirm('Remove '+item.name+' from your sheet music library?'))setLibraryFiles(v=>v.filter(x=>x.id!==item.id))}}>Remove</button>
   </div>
  </article>}):<div className="personal-score-empty"><div className="music-icon">♫</div><strong>Your saved scores will appear here</strong><p>Import MusicXML, MIDI, a .musiccoach score, PDF or a score image to begin.</p><button className="btn" onClick={()=>setPage('Score converter')}>Open sheet music converter →</button></div>}
 </div>
 <div className="score-library-expand"><button className="btn" onClick={()=>setScoreLibraryExpanded(value=>!value)}>{scoreLibraryExpanded?'Show fewer files':'Expand to view all '+sheetMusicFiles.length+' files'}</button></div>
 <p className="muted small score-library-note">PDFs and images are kept as source scores; they are not audio. Listen is available only for MIDI and structured MusicXML / .musiccoach notation.</p>
</section><section className="panel"><div className="eyebrow">SHEET MUSIC SEARCH</div><h2>Find sheet music</h2><p className="muted">Search for a piece by title or composer, browse music catalogue results, and listen to previews where available. Import scores above to save them in your collection, then open them in Practice.</p><form className="song-search" onSubmit={e=>{e.preventDefault();searchSongs()}}><input value={songQuery} onChange={e=>setSongQuery(e.target.value)} placeholder="Piece title, composer or artist"/><button className="btn btn-dark" disabled={songBusy||!songQuery.trim()}>{songBusy?'Searching archives…':'Search archives'}</button><a className="btn" href={audioComSearchUrl(songQuery)} target="_blank" rel="noopener noreferrer">Search Audio.com ↗</a></form>{songQuery.trim()&&<section className="audio-com-preview"><div className="panel-head"><div><h3>Audio.com · recordings preview</h3><p className="muted small">Search and preview public recordings here. If Audio.com blocks the embedded view, open the search in a new tab.</p></div><a className="btn" href={audioComSearchUrl(songQuery)} target="_blank" rel="noopener noreferrer">Open Audio.com ↗</a></div><iframe title={'Audio.com search results for '+songQuery} src={audioComSearchUrl(songQuery)} loading="lazy" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin"/></section>}<div className="score-source-links"><strong>Search sheet-music sources</strong><p className="muted small">Open results from multiple catalogues. Availability and usage rights vary by piece.</p>{[{name:"IMSLP · public-domain scores",url:"https://imslp.org/index.php?title=Special:Search&search="+encodeURIComponent(songQuery)},{name:"MuseScore · community scores",url:"https://www.google.com/search?q="+encodeURIComponent("site:musescore.com "+songQuery+" sheet music")},{name:"Musicnotes · licensed sheet music",url:"https://www.google.com/search?q="+encodeURIComponent("site:musicnotes.com "+songQuery+" sheet music")},{name:"Sheet Music Plus · licensed scores",url:"https://www.google.com/search?q="+encodeURIComponent("site:sheetmusicplus.com "+songQuery+" sheet music")},{name:"Audio.com · search recordings",url:audioComSearchUrl(songQuery)},{name:"Audio.com · browse music",url:"https://audio.com/browse/music"},{name:"Google · all score sources",url:"https://www.google.com/search?q="+encodeURIComponent(songQuery+" sheet music score")}].map(source=><a key={source.name} href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a>)}</div>{sourceSearchStatus&&<p className="catalogue-search-status" role="status">{sourceSearchStatus}</p>}
{archiveResults.length>0&&<div className="catalogue-source-group"><h3>Internet Archive · audio recordings</h3><p className="muted small">Check each result’s source and reuse rights; public visibility does not mean every recording is public domain.</p>{archiveResults.map(item=><div className="list-item source-result" key={'archive-'+item.id}><span className="list-icon">◉</span><div><strong>{item.title}</strong><small>{item.creator}{item.year?' · '+item.year:''}</small></div><a className="btn" href={item.url} target="_blank" rel="noreferrer">Open archive ↗</a></div>)}</div>}
{commonsResults.length>0&&<div className="catalogue-source-group"><h3>Wikimedia Commons · shared media</h3><p className="muted small">Open a file page to confirm whether the image is a score and review licence/attribution requirements.</p>{commonsResults.map(item=><div className="list-item source-result" key={'commons-'+item.id}>{item.thumb&&<img className="song-art" src={item.thumb} alt="" loading="lazy"/>}<div><strong>{item.title}</strong><small>Wikimedia file · licence details on source page</small></div><a className="btn" href={item.url} target="_blank" rel="noreferrer">View file ↗</a></div>)}</div>}{songResults.map(song=><div className="list-item" key={song.id}>{song.art&&<img className="song-art" src={song.art} alt=""/>}<div><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></div>{song.url&&<a className="btn" href={song.url} target="_blank" rel="noreferrer">Open on Audio.com ↗</a>}{song.preview&&<audio controls preload="none" src={song.preview}/>}<button className="btn" onClick={()=>{setSongTitle(song.title);setStatus('Selected '+song.title+'. Search for a score or upload notation to compare against it.')}}>Use title</button></div>)}{songResults.length===0&&archiveResults.length===0&&commonsResults.length===0&&<div className="empty-state"><strong>Search Audio.com or browse public scores</strong><p>Audio.com search opens on its own site. Archive and Wikimedia score results appear here when available.</p><a className="btn btn-dark" href={audioComSearchUrl(songQuery)} target="_blank" rel="noopener noreferrer">Open Audio.com search ↗</a></div>}</section></div>}
 {sheetPianoOpen&&!learnListenMode?(<div className="piano-modal-backdrop" role="dialog" aria-modal="true" aria-label="Piano playback and learning"><section className="panel piano-modal"><div className="panel-head"><div><div className="eyebrow">PIANO PLAYER</div><h2>{songTitle||'Your score'}</h2></div><button className="btn" onClick={()=>setSheetPianoOpen(false)}>Close ✕</button></div><p className="muted">Hear the score phrase, then repeat it on a real piano with microphone listening or on the laptop keyboard.</p><div className="toolbar"><button className="btn" onClick={()=>listening?stopMic():startMic()}>{listening?'Disconnect piano microphone':'🎙 Listen to my piano'}</button><button className="btn btn-dark" onClick={async()=>{const ns=parseMusicSequence(expected).slice(0,Math.max(1,Number(timeSignature.split('/')[0])*2));const s=await ensureSynth();let beat=0;for(const n of ns){if(!n.rest&&n.midi!=null)s.triggerAttackRelease(midiToNote(n.midi),Math.max(.12,n.beats*60/bpm),Tone.now()+beat*60/bpm);beat+=n.beats||1}setLearnMessage('Playing the score preview. Listen, then repeat the phrase.')}}>▶ Listen to score</button><button className="btn" onClick={()=>{if(learnListenMode){finishLearnSession()}else{toggleLearnSession();setLearnMessage('Play the current bar or section using the on-screen piano or your real piano microphone. Lesson time counts towards practice.')}}}>{learnListenMode?'■ Finish lesson':'Start two-bar lesson'}</button></div><div className="virtual-piano-scroll"><div className="piano virtual-piano" style={{"--keyboard-white-key-width":(100/Math.max(1,virtualWhiteKeys.length))+"%"}} aria-label="Virtual piano keyboard">{virtualWhiteKeys.map(k=><button key={k.midi} className={"white-key "+(heldKeys[k.note]?"is-held":"")} style={{flex:"0 0 var(--keyboard-white-key-width)",width:"var(--keyboard-white-key-width)",minWidth:0}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)} aria-label={"Play "+k.note} title={k.note}><span>{k.note}</span></button>)}{virtualBlackKeys.map(k=><button key={k.midi} className={"black-key "+(heldKeys[k.note]?"is-held":"")} style={{left:(virtualWhiteKeys.filter(w=>w.midi<k.midi).length*(100/Math.max(1,virtualWhiteKeys.length)))+"%",width:(100/Math.max(1,virtualWhiteKeys.length))*.62+"%",transform:"translateX(-50%)"}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)} aria-label={"Play "+k.note} title={k.note}><span>{k.note}</span></button>)}</div></div><p className="muted small">For microphone practice, close this panel and start the microphone in Practice. Laptop keyboard mapping: A W S E D F T G Y H U J K.</p></section></div>):null}{renderLearnFullscreen()}{page==='Score converter'&&<section className="panel musiccoach-converter"><div className="toolbar extras-toolbar"><button className="btn" onClick={()=>{setPage('Extras');setExtraTool('keyboard')}}>Open online keyboard</button><button className="btn" onClick={()=>{setPage('Extras');setExtraTool('assistant')}}>♫ Music assistant</button><button className="btn" onClick={()=>{setPage('Extras');setExtraTool('score')}}>Open Score tools</button><button className="btn btn-dark" disabled>Sheet music converter</button></div><div className="eyebrow">SCORE CONVERTER</div><h2>Sheet music converter</h2><p className="muted">Import MusicXML/XML, MIDI or .musiccoach files for structured conversion. For scans, upload <strong>one clear page at a time</strong> (not a multi-page PDF or several pages in one image). PDF/image scans use on-device HOMR recognition; complex notation still needs checking against the original.</p><label className="upload-score musiccoach-upload"><span>{musicCoachBusy?'Analysing score…':'Choose score file (image, PDF or MusicXML)'}</span><input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,.svg,application/vnd.piano-coach.musiccoach,application/vnd.recordare.musicxml+xml,application/xml,text/xml,audio/midi,application/pdf,.pdf,image/png,image/jpeg,image/webp,image/svg+xml" disabled={musicCoachBusy} onChange={e=>{const f=e.target.files?.[0];if(f)convertScoreToMusicCoach(f,{target:'Score converter',download:true});e.target.value=''}}/></label><details className="notation-guide"><summary id="notation-guide-title">Notation identification guide for the AI <span>Optional · expand</span></summary><p className="muted small">Tick any symbols you can see in the score. The AI will explain these markings and use your observations as context. They are <strong>not automatically recognised</strong>; the AI cannot see the original image.</p><div className="notation-guide-grid">{NOTATION_GUIDE.map(item=><label className="notation-guide-item" key={item.id}><input type="checkbox" checked={musicCoachMarkings.includes(item.id)} onChange={e=>setMusicCoachMarkings(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/><span><strong>{item.label}</strong><small>{item.help}</small></span></label>)}</div><p className="muted small">{musicCoachMarkings.length} marking group{musicCoachMarkings.length===1?"":"s"} selected. You can leave this blank if you are unsure.</p></details><p className="muted small">{musicCoachStatus}</p>{musicCoachBusy&&<div className="musiccoach-progress" role="status"><span/></div>}{(scoreImageUrl||scoreNotation?.sourceMusicXML)&&<div className="score-review-grid">{scoreImageUrl&&<section className="score-review-card"><div className="eyebrow">ORIGINAL SCORE</div><div className="score-preview">{scoreIsPdf?<iframe title="Original score PDF" src={scoreImageUrl} style={{width:'100%',minHeight:420,border:0}}/>:<img src={scoreImageUrl} alt={scoreImageName||'Original score'}/>}<strong>{scoreImageName||'Original uploaded score'}</strong></div></section>}{scoreNotation?.sourceMusicXML&&<section className="score-review-card"><div className="eyebrow">CONVERTED NOTATION</div><MusicXMLPreview xml={scoreNotation.sourceMusicXML} title={songTitle||'Converted score'} onExpand={()=>setFullscreenScore({xml:scoreNotation.sourceMusicXML,title:songTitle||'Converted score'})}/></section>}</div>}{musicCoachAnalysis&&<div className="tutor-answer"><strong>AI analysis</strong><p>{musicCoachAnalysis}</p></div>}<div className="toolbar"><button className="btn" onClick={()=>setExtraTool('score')}>Open score tools</button><button className="btn" onClick={()=>{setPage('Sheet music');setLibraryTab('scores')}}>View saved scores</button><button className="btn btn-dark" onClick={()=>setPage('Sheet music')}>Review in Sheet Music</button></div></section>}{false&&page==='Extras'&&extraTool==='score'&&<div className="sheet-music-workspace"><section className="panel"><div className="eyebrow">SCORE TOOLS</div><h2>Work with your score</h2><p className="muted">Upload notation, inspect it, extract a draft note sequence, and send it to practice. Use Sheet music to search across catalogues and sources.</p><label className="upload-score">Upload score PDF or image<input type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Extras'});e.target.value=''}}/></label><label className="upload-score">Import MusicXML or .musiccoach<input type="file" accept=".musiccoach,.musicxml,.xml,application/vnd.piano-coach.musiccoach,application/xml,text/xml" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Extras'});e.target.value=''}}/></label>{scoreImageUrl&&<div className="score-preview">{scoreIsPdf?<iframe title="Score preview" src={scoreImageUrl} style={{width:"100%",minHeight:360}}/>:<img src={scoreImageUrl} alt="Uploaded score"/>}<strong>{scoreImageName}</strong></div>}<label className="sequence-label">Notes from score<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4/q D4/h R/q E4/e"/></label><p className="muted small">Enter notes with durations: <b>/w</b> whole note, <b>/h</b> minim (half note), <b>/q</b> crotchet (quarter), <b>/e</b> quaver (eighth), and <b>R/q</b> for a quarter rest. Example: C4/q D4/h R/q E4/e.</p><div className="toolbar"><button className="btn" onClick={()=>{setPage("Practice");setPracticeStarted(false);setSongTitle(songTitle||scoreImageName.replace(/\.[^.]+$/,""));}}>Practise this score</button><button className="btn" onClick={saveStudy}>Save notes</button><button className="btn" onClick={exportMusicXml}>Convert .musiccoach → MusicXML</button><button className="btn" onClick={exportNotes}>Convert .musiccoach → MIDI</button></div><p className="muted small">{scoreOcrStatus}</p>{scoreOcrWarning&&<div className="tutor-answer">{scoreOcrWarning}</div>}<Staff notes={parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:i,note:n.token}))} expanded/></section><section className="panel"><h2>Note comparison</h2><p className="muted">Target sequence accuracy: {comparison.accuracy}%</p><button className="btn btn-dark" onClick={playSequence}>Play target sequence</button>{comparison.rows.slice(0,30).map((r,i)=><div className="list-item" key={i}><div><strong>{r.expected}</strong><small>Played: {r.played} · {r.status}</small></div></div>)}</section></div>}
 {page==='Library'&&<section className="panel"><div className="panel-head"><div><div className="eyebrow">YOUR COLLECTION</div><h2>Music library</h2><p className="muted">Your recordings, scores created during practice, and imported sheet music—all in one place.</p></div></div><label className="upload-score">Add music or sheet music<input type="file" accept="audio/*,.mid,.midi,.musiccoach,.musicxml,.xml,image/*,application/pdf" onChange={e=>{const file=e.target.files?.[0];if(file&&(/\.(musiccoach|musicxml|xml|pdf|mid|midi)$/i.test(file.name)||file.type.startsWith('image/')))handleScoreUpload(file,{target:'Library'});else if(file)saveLibraryFile(file);e.target.value=''}}/></label><input className="search-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search this library…"/>{audioError&&<p className="audio-error" role="alert">{audioError}</p>}<div className="library-tabs" role="tablist" aria-label="Library categories"><button className={libraryTab==='recordings'?'active':''} onClick={()=>setLibraryTab('recordings')}>Recordings</button><button className={libraryTab==='scores'?'active':''} onClick={()=>setLibraryTab('scores')}>All sheet music</button><button className={libraryTab==='practice-scores'?'active':''} onClick={()=>setLibraryTab('practice-scores')}>Made from practice</button><button className={libraryTab==='from-recordings'?'active':''} onClick={()=>setLibraryTab('from-recordings')}>Find a score</button><button className={libraryTab==='music'?'active':''} onClick={()=>setLibraryTab('music')}>Other files</button></div>{libraryTab==='recordings'&&<><h3>Listen to your music</h3><p className="muted">Play audio and MIDI files saved in your library. Playback depends on the audio format supported by your browser.</p>{libraryFiles.filter(x=>isAudioLibraryFile(x)&&x.name.toLowerCase().includes(search.toLowerCase())).map(x=><div className="list-item audio-library-item" key={x.id}><span className="list-icon">♫</span><div><strong>{x.name}</strong><small>{Math.round(x.size/1024)} KB · {x.type||'Audio file'}</small></div>{isMidiLibraryFile(x)?<>{libraryPlayback.id===x.id&&libraryPlayback.kind==='tone'?<><button className="btn btn-dark" onClick={()=>libraryPlayback.paused?resumeMidiLibraryPlayback():pauseMidiLibraryPlayback()}>{libraryPlayback.paused?'▶ Resume':'Ⅱ Pause'}</button><button className="btn" onClick={()=>stopLibraryItem(x)}>■ Stop</button></>:<button className="btn btn-dark" onClick={()=>playMidiLibraryFile(x)}>▶ Play</button>}</>:<><audio controls style={{width:'100%',maxWidth:'260px',height:'32px'}} ref={el=>{if(el)audioLibraryRefs.current[x.id]=el;else delete audioLibraryRefs.current[x.id]}} src={x.data} preload="metadata" onPlay={()=>{if(midiPlaybackRef.current)stopMidiLibraryPlayback();for(const other of Object.values(audioLibraryRefs.current||{})){if(other&&other!==audioLibraryRefs.current[x.id]){try{other.pause();other.currentTime=0}catch{}}}setLibraryPlayback({id:x.id,kind:'audio',paused:false})}} onPause={()=>setLibraryPlayback(current=>current.id===x.id&&current.kind==='audio'?{id:x.id,kind:'audio',paused:true}:current)} onEnded={()=>setLibraryPlayback(current=>current.id===x.id?{id:null,kind:'',paused:true}:current)} onError={()=>setAudioError('This audio file could not be decoded by the browser. Try downloading it or converting it to MP3/WAV.')}/><button className="btn btn-dark" onClick={()=>toggleLibraryAudio(x)}>{libraryPlayback.id===x.id&&libraryPlayback.kind==='audio'&&!libraryPlayback.paused?'Ⅱ Pause':libraryPlayback.id===x.id&&libraryPlayback.kind==='audio'&&libraryPlayback.paused?'▶ Resume':'▶ Play'}</button>{libraryPlayback.id===x.id&&libraryPlayback.kind==='audio'&&<button className="btn" onClick={()=>stopLibraryItem(x)}>■ Stop</button>}</>}<button className="btn" onClick={()=>downloadLibraryFile(x)}>Download</button><button className="btn btn-quiet" onClick={()=>setLibraryFiles(v=>v.filter(f=>f.id!==x.id))}>Delete</button><button className="btn" onClick={()=>{setSongQuery(x.name.replace(/\.[^.]+$/,''));setLibraryTab('from-recordings')}}>Find score</button></div>)}{!libraryFiles.some(x=>isAudioLibraryFile(x)&&x.name.toLowerCase().includes(search.toLowerCase()))&&<div className="empty-state"><strong>No recordings yet</strong><p>Finish a practice recording or upload an audio file to listen to it here.</p></div>}</>}{libraryTab==='practice-scores'&&<><h3>Scores made from your playing</h3><p className="muted">These are note sequences transcribed from your practice recordings. Open a score to review it or download the .musiccoach file.</p>{libraryFiles.filter(x=>x.kind==='practice-score'&&x.name.toLowerCase().includes(search.toLowerCase())).map(x=><div className="list-item" key={x.id}><span className="list-icon">♫</span><div><strong>{x.name}</strong><small>{new Date(x.added||Date.now()).toLocaleDateString()} · {x.score?.notes?.length||0} notes detected</small></div>{libraryPlayback.id===x.id&&libraryPlayback.kind==='tone'?<><button className="btn btn-dark" onClick={()=>libraryPlayback.paused?resumeMidiLibraryPlayback():pauseMidiLibraryPlayback()}>{libraryPlayback.paused?'▶ Resume':'Ⅱ Pause'}</button><button className="btn" onClick={()=>stopLibraryItem(x)}>■ Stop</button></>:<button className="btn btn-dark" onClick={()=>playScoreLibraryFile(x)}>▶ Play</button>}<button className="btn btn-dark" onClick={()=>{const raw=atob(x.data.split(',')[1]);const bytes=Uint8Array.from(raw,v=>v.charCodeAt(0));const score=decodeMusicCoach(new TextDecoder().decode(bytes));setScoreNotation(score.notation||null);setScoreSourceAsset(score.sourceAsset||null);setSongTitle(score.title||x.name);setEvents(score.notes||[]);setLoadedScoreNotes(score.notes||[]);setExpected((score.notes||[]).map(n=>n.rest?'R/q':n.note+'/q').join(' '));setBpm(score.bpm||bpm);setTimeSignature(score.timeSignature||'4/4');setPage('Practice');setPracticeStarted(false);setStatus('Practice score loaded for review')}}>Review score</button><button className="btn" onClick={()=>downloadLibraryFile(x)}>Download</button><button className="btn btn-quiet" onClick={()=>setLibraryFiles(v=>v.filter(f=>f.id!==x.id))}>Delete</button></div>)}{!libraryFiles.some(x=>x.kind==='practice-score'&&x.name.toLowerCase().includes(search.toLowerCase()))&&<div className="empty-state"><strong>No practice scores yet</strong><p>Record and analyse a practice session. Its detected notes will appear here.</p><button className="btn btn-dark" onClick={()=>setPage('Practice')}>Start practising</button></div>}</>}{libraryTab==='scores'&&<><h3>Sheet music and notation</h3>{libraryFiles.filter(x=>((x.kind==='score'||/musicxml|xml|pdf|image\//i.test(x.type)||/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i.test(x.name))&&(!x.type?.startsWith('audio/')||/\.(mid|midi)$/i.test(x.name)))&&x.name.toLowerCase().includes(search.toLowerCase())).map(x=><div className="list-item" key={x.id} onDoubleClick={()=>openLibrarySheetFullscreen(x)} title="Double-click to expand sheet music"><span className="list-icon">▤</span><div><strong>{x.name}</strong><small>{Math.round(x.size/1024)} KB · {x.type}</small></div>{x.type?.startsWith('image/')&&<a href={x.data} target="_blank" rel="noreferrer">Preview image</a>}{(!x.type?.startsWith('audio/')||/\.(mid|midi)$/i.test(x.name))&&<>{(/\.(musiccoach|musicxml|xml|mid|midi)$/i.test(x.name)||x.kind==='practice-score')&&<><button className="btn btn-dark" onClick={()=>toggleScoreLibraryPlayback(x)}>{libraryPlayback.id===x.id&&libraryPlayback.kind==='tone'?(libraryPlayback.paused?'▶ Play':'Ⅱ Pause'):'▶ Play'}</button><button className="btn" onClick={()=>stopLibraryItem(x)}>■ Stop</button><button className="btn" onClick={()=>openLibrarySheetFullscreen(x)}>Expand sheet ↗</button></>}<button className="btn" onClick={()=>downloadLibraryFile(x)}>Download</button></>}<button className="btn btn-quiet" onClick={()=>setLibraryFiles(v=>v.filter(f=>f.id!==x.id))}>Delete</button></div>)}{!libraryFiles.some(x=>(x.kind==='score'||/musicxml|xml|pdf|image\//i.test(x.type)||/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i.test(x.name))&&(!x.type?.startsWith('audio/')||/\.(mid|midi)$/i.test(x.name)))&&<div className="empty-state"><strong>No sheet music saved yet</strong><p>Upload a score here or use the Sheet Music section to import notation.</p><button className="btn" onClick={()=>setPage('Sheet music')}>Open Sheet Music</button></div>}</>}{libraryTab==='from-recordings'&&<><h3>Find sheet music for a recording</h3><p className="muted">Choose a recording above or enter the song title to search for a possible reference. This search can find catalogue audio previews; it cannot guarantee a matching score.</p><form className="song-search" onSubmit={e=>{e.preventDefault();searchSongs()}}><input value={songQuery} onChange={e=>setSongQuery(e.target.value)} placeholder="Piece title, composer or recording name"/><button className="btn btn-dark" disabled={songBusy||!songQuery.trim()}>{songBusy?'Searching archives…':'Search public archives'}</button><a className="btn" href={audioComSearchUrl(songQuery)} target="_blank" rel="noopener noreferrer">Search Audio.com ↗</a></form>{sourceSearchStatus&&<p className="catalogue-search-status" role="status">{sourceSearchStatus}</p>}
{archiveResults.length>0&&<div className="catalogue-source-group"><h3>Internet Archive · audio recordings</h3><p className="muted small">Check each result’s source and reuse rights; public visibility does not mean every recording is public domain.</p>{archiveResults.map(item=><div className="list-item source-result" key={'archive-'+item.id}><span className="list-icon">◉</span><div><strong>{item.title}</strong><small>{item.creator}{item.year?' · '+item.year:''}</small></div><a className="btn" href={item.url} target="_blank" rel="noreferrer">Open archive ↗</a></div>)}</div>}
{commonsResults.length>0&&<div className="catalogue-source-group"><h3>Wikimedia Commons · shared media</h3><p className="muted small">Open a file page to confirm whether the image is a score and review licence/attribution requirements.</p>{commonsResults.map(item=><div className="list-item source-result" key={'commons-'+item.id}>{item.thumb&&<img className="song-art" src={item.thumb} alt="" loading="lazy"/>}<div><strong>{item.title}</strong><small>Wikimedia file · licence details on source page</small></div><a className="btn" href={item.url} target="_blank" rel="noreferrer">View file ↗</a></div>)}</div>}<div className="score-source-links"><strong>Search additional sheet-music providers</strong><p className="muted small">Some commercial/community sites do not offer a stable public search API. Open provider results directly and verify availability and licensing.</p>{[{name:'IMSLP · public-domain scores',url:'https://imslp.org/index.php?title=Special:Search&search='+encodeURIComponent(songQuery)},{name:'MuseScore · community scores',url:'https://www.google.com/search?q='+encodeURIComponent('site:musescore.com '+songQuery+' sheet music')},{name:'Musicnotes · licensed sheet music',url:'https://www.google.com/search?q='+encodeURIComponent('site:musicnotes.com '+songQuery+' sheet music')},{name:'Sheet Music Plus · licensed scores',url:'https://www.google.com/search?q='+encodeURIComponent('site:sheetmusicplus.com '+songQuery+' sheet music')},{name:'Audio.com · search recordings',url:audioComSearchUrl(songQuery)},{name:'Audio.com · browse music',url:'https://audio.com/browse/music'},{name:'Google · all score sources',url:'https://www.google.com/search?q='+encodeURIComponent(songQuery+' sheet music score')}].map(source=><a key={source.name} href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>)}</div>{songResults.map(song=><div className="list-item" key={song.id}><div><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></div>{song.url&&<a className="btn" href={song.url} target="_blank" rel="noreferrer">Open on Audio.com ↗</a>}{song.preview&&<audio controls preload="none" src={song.preview}/>}<button className="btn" onClick={()=>{setSongTitle(song.title);setPage('Sheet music')}}>Look for score</button></div>)}</>}{libraryTab==='music'&&<><h3>Other uploaded files</h3>{libraryFiles.filter(x=>!isAudioLibraryFile(x)&&!x.type?.startsWith('image/')&&!x.kind?.includes('score')&&!/\.(musiccoach|musicxml|xml|mid|midi|pdf|png|jpe?g|webp)$/i.test(x.name)).map(x=><div className="list-item" key={x.id}><div><strong>{x.name}</strong><small>{Math.round(x.size/1024)} KB · {x.type}</small></div><button className="btn" onClick={()=>downloadLibraryFile(x)}>Download</button><button className="btn btn-quiet" onClick={()=>setLibraryFiles(v=>v.filter(f=>f.id!==x.id))}>Delete</button></div>)}</>}</section>}
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
 {page==='Extras'&&<><section className="panel"><div className="eyebrow">EXTRAS</div><h2>Your music toolkit</h2><p className="muted">Tools you can use outside a timed practice session.</p><div className="toolbar extras-toolbar"><button className="btn btn-dark" onClick={()=>setExtraTool('keyboard')}>Open online keyboard</button><button className="btn" onClick={()=>setExtraTool('assistant')}>♫ Music assistant</button><button className="btn" onClick={()=>setExtraTool('score')}>Open Score tools</button><button className="btn" onClick={()=>setPage('Score converter')}>Sheet music converter</button></div></section>{extraTool==='score'&&<section className="panel"><div className="eyebrow">SCORE TOOLS</div><h2>Work with your score</h2><p className="muted">Upload MusicXML, XML or .musiccoach for editable notation, or enter a note sequence. PDF/image recognition is best-effort and may fail on difficult scans.</p><label className="upload-score">Import score file<input type="file" accept=".musiccoach,.musicxml,.xml,.mid,.midi,application/xml,text/xml" onChange={e=>{const f=e.target.files?.[0];if(f)handleScoreUpload(f,{target:'Practice'});e.target.value=''}}/></label><label className="sequence-label">Notes from score<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4/q D4/h R/q E4/e"/></label><div className="toolbar"><button className="btn btn-dark" onClick={()=>{setPage('Practice');setPracticeStarted(false);setPracticeMode('learn')}}>Practise this score</button><button className="btn" onClick={saveStudy}>Save notes</button><button className="btn" onClick={exportMusicXml}>Export MusicXML</button><button className="btn" onClick={playSequence}>▶ Listen</button></div><Staff notes={parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:i,note:n.token}))} expanded/></section>}{extraTool==='assistant'&&<section className="panel music-chat-panel"><div className="music-chat-heading"><div><div className="eyebrow">MUSIC ASSISTANT</div><h2>Your music, explained.</h2><p className="muted">Ask about theory, technique, notation, practice or composition.</p></div><span className="tag">Music Coach</span></div><div className="music-chat-thread">{musicChat.length===0&&<div className="music-chat-welcome"><div className="music-chat-orb">♫</div><h3>What would you like to learn?</h3><div className="music-chat-suggestions">{['Explain a diminished seventh chord','Help me practise sight-reading','How do crescendos work?','Suggest a piano warm-up'].map(q=><button className="btn" key={q} onClick={()=>setMusicChatInput(q)}>{q} ↗</button>)}</div></div>}{musicChat.map((m,i)=><div key={i} className={'music-chat-message '+m.role}><div className="music-chat-avatar">{m.role==='assistant'?'♫':'You'}</div><div className="music-chat-bubble">{m.content}</div></div>)}{musicChatBusy&&<div className="music-chat-message assistant"><div className="music-chat-avatar">♫</div><div className="music-chat-bubble">Thinking…</div></div>}</div><form className="music-chat-composer" onSubmit={e=>{e.preventDefault();sendMusicChat()}}><textarea value={musicChatInput} onChange={e=>setMusicChatInput(e.target.value)} placeholder="Ask your music assistant…" rows={2}/><button className="btn btn-dark" disabled={!musicChatInput.trim()||musicChatBusy}>{musicChatBusy?'Working…':'Send ↑'}</button></form></section>}{extraTool==='score'&&<section className="panel"><div className="toolbar"><button className="btn" onClick={()=>setExtraTool('keyboard')}>Back to keyboard</button><button className="btn" onClick={()=>setExtraTool('tracker')}>Open note tracker</button></div></section>}{extraTool==='keyboard'&&<section className="panel" id="extras-keyboard"><div className="panel-head"><div><div className="eyebrow">ONLINE KEYBOARD</div><h2>Play notes</h2><p className="muted">Hold a key to play it; release to stop. Played notes appear in the note list.</p></div><span className="tag">{keyboardOctaves} octaves</span></div><div className="keyboard-range-controls"><button className="btn" aria-label="Move keyboard down one semitone" onClick={()=>shiftKeyboardStart(-1)}>←</button><label>First key<input aria-label="First piano key" value={keyboardStart} onChange={e=>{const v=e.target.value.trim().toUpperCase().replace(/♯/g,"#").replace(/♭/g,"b");const midi=noteToMidi(v);if(midi!==null)setKeyboardStart(midiToNote(Math.max(21,Math.min(108-12*keyboardOctaves,midi))))}} onBlur={()=>{if(noteToMidi(keyboardStart)===null)setKeyboardStart("C3");else setKeyboardStart(midiToNote(keyboardStartMidi))}} placeholder="F3"/></label><button className="btn" aria-label="Move keyboard up one semitone" onClick={()=>shiftKeyboardStart(1)}>→</button><label>Visible range<select value={keyboardOctaves} onChange={e=>{const octaves=Number(e.target.value);setKeyboardStart(midiToNote(clampKeyboardStartMidi(keyboardStart,octaves)));setKeyboardOctaves(octaves)}}>{[2,3,4,5].map(n=><option key={n} value={n}>{n} octaves</option>)}</select></label><button className="btn" onClick={()=>shiftKeyboardStart(-12)}>− octave</button><button className="btn" onClick={()=>shiftKeyboardStart(12)}>+ octave</button></div><div className="piano-scroll"><div className="piano" style={{"--keyboard-white-key-width":keyboardWhiteKeyPercent+"%"}} aria-label="Piano keyboard">{allKeys.filter(k=>!k.black&&k.midi>=keyboardStartMidi&&k.midi<keyboardEndMidi).map(k=><button key={k.midi} className={"white-key "+(heldKeys[k.note]?"is-held ":"")+((k.midi>=keyboardStartMidi+computerOctaveOffset&&k.midi<keyboardStartMidi+computerOctaveOffset+12)?"central-key":"")} style={{flex:`0 0 ${keyboardWhiteKeyPercent}%`,width:`${keyboardWhiteKeyPercent}%`,minWidth:0}} aria-label={k.note} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}{allKeys.filter(k=>k.black&&k.midi>=keyboardStartMidi&&k.midi<keyboardEndMidi).map(k=><button key={k.midi} className={"black-key "+(heldKeys[k.note]?"is-held ":"")+((k.midi>=keyboardStartMidi+computerOctaveOffset&&k.midi<keyboardStartMidi+computerOctaveOffset+12)?"central-key":"")} aria-label={k.note} style={{left:(keyboardVisibleWhiteKeys.filter(w=>w.midi<k.midi).length*keyboardWhiteKeyPercent)+'%',width:(keyboardWhiteKeyPercent*.62)+'%',transform:'translateX(-50%)'}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);pressKey(k.note)}} onPointerUp={()=>releaseKey(k.note)} onPointerCancel={()=>releaseKey(k.note)} onLostPointerCapture={()=>releaseKey(k.note)}><span>{k.note}</span></button>)}</div></div><div className="key-hint">Computer keys: A W S E D F T G Y H U J K · active notes highlight while held.</div><div className="played-notes" aria-live="polite"><strong>Notes played</strong>{events.filter(e=>e.source==='keyboard').slice(-12).length?events.filter(e=>e.source==='keyboard').slice(-12).map((e,i)=><span key={e.id||i} className="played-note">{e.note}</span>):<span className="muted small">Play a key to see its note here.</span>}</div><div className="toolbar"><button className="btn" onClick={clearNotes}>Clear notes</button><button className="btn" onClick={exportMusicCoach}>Save performance as .musiccoach</button></div></section>}{false&&extraTool==='tracker'&&<section className="panel" id="extras-note-tracker"><h2>Quick note tracker</h2><p className="muted">Enter notes manually without starting a practice session.</p><label className="sequence-label">Target notes<input value={expected} onChange={e=>setExpected(e.target.value)} placeholder="C4 D4 E4 G4"/></label><div className="toolbar"><button className="btn" onClick={()=>{const manual=parseSequence(expected).filter(n=>n.midi!==null).map((n,i)=>({id:'manual-'+i,note:n.token,midi:n.midi,time:(i*.5).toFixed(2),source:'manual'}));sessionEvents.current=manual;setEvents(manual);setStatus('Manual notes added to the note tracker')}}>Track typed notes</button><button className="btn btn-dark" onClick={()=>listening?stopMic():startMic()}>{listening?'🎙 Stop microphone':'🎙 Start microphone'}</button></div><p className="muted small">Use the microphone button to hear notes played on a real piano. Allow microphone access when your browser asks.</p></section>}</>}
 {false&&<section className="panel"><div className="eyebrow">PREFERENCES & PRIVACY</div><h2>Settings</h2><div className="setting-row"><div><strong>Master volume</strong><p className="muted">Applies to piano playback and reference sounds.</p></div><input type="range" min="0" max="100" value={volume} onChange={e=>setVolume(+e.target.value)}/><strong>{volume}%</strong></div><div className="setting-row"><div><strong>Default tempo</strong><p className="muted">Current practice tempo.</p></div><input type="range" min="40" max="180" value={bpm} onChange={e=>setBpm(+e.target.value)}/><strong>{bpm} BPM</strong></div><div className="privacy-box"><strong>Privacy-first by default</strong><p>Practice sessions and saved studies are stored in this browser. Microphone audio is analysed locally and is not uploaded by this application. This basic pitch tracker is designed for one note at a time and is not a polyphonic transcription model.</p></div><div className="toolbar"><button className="btn" onClick={()=>{const blob=new Blob([JSON.stringify({sessions,studies:saved,preferences:{volume,bpm}},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='piano-coach-data.json';a.click();URL.revokeObjectURL(u)}}>Export all data</button><button className="btn btn-danger" onClick={()=>{if(confirm('Clear all saved sessions and studies on this device? This cannot be undone.')){setSessions([]);setSaved([]);localStorage.removeItem('pc_sessions');localStorage.removeItem('pc_studies');setStatus('Local data cleared')}}}>Clear local data</button></div></section>}
 {libraryFullscreenItem&&<div className="score-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Expanded Library file"><section className="score-fullscreen-panel"><header><div><strong>{libraryFullscreenItem.title}</strong><small>Expanded from your Library</small></div><button className="btn btn-dark" onClick={()=>setLibraryFullscreenItem(null)}>Close ✕</button></header><div className="score-fullscreen-content">{libraryFullscreenItem.kind==='pdf'?<iframe title={libraryFullscreenItem.title} src={libraryFullscreenItem.src} style={{width:'100%',height:'100%',minHeight:'75vh',border:0}}/>:<img src={libraryFullscreenItem.src} alt={libraryFullscreenItem.title} style={{display:'block',maxWidth:'100%',maxHeight:'80vh',margin:'auto',objectFit:'contain'}}/>}</div></section></div>}{fullscreenScore&&<div className="score-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Expanded sheet music"><section className="score-fullscreen-panel"><header><div><strong>{fullscreenScore.title}</strong><small>Use Close to return to practice</small></div><button className="btn btn-dark" onClick={()=>setFullscreenScore(null)}>Close ✕</button></header><div className="score-fullscreen-content"><MusicXMLPreview xml={fullscreenScore.xml} title={fullscreenScore.title}/></div></section></div>}<footer className="app-footer"><span>Made for curious musicians.</span><span>Audio stays on this device</span></footer>{(!cookieChoice||cookieSettingsOpen)&&<div className="cookie-backdrop" role="presentation"><section className="cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-title"><div className="eyebrow">YOUR PRIVACY</div><h2 id="cookie-title">Your cookie choices</h2><p>Piano Coach stores practice sessions, saved studies and Library files locally in this browser when you accept. Your data stays on this device unless you export a .musicdata backup. No third-party cookies or analytics are used.</p><div className="cookie-actions"><button className="btn btn-dark" onClick={()=>{const choice={choice:'accept',at:new Date().toISOString()};try{localStorage.setItem('pc_cookie_consent',JSON.stringify(choice));localStorage.setItem('pc_cookie_storage_enabled','true');localStorage.setItem('pc_sessions',JSON.stringify(sessions));localStorage.setItem('pc_studies',JSON.stringify(saved));localStorage.setItem('pc_files',JSON.stringify(libraryFiles))}catch{}setCookieChoice(choice);setCookieSettingsOpen(false)}}>Accept</button></div><p className="cookie-footnote">You can download a .musicdata backup from the bottom of the sidebar to keep your work safe.</p></section></div>}</main></div>
}