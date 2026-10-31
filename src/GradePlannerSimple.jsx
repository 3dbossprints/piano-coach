import React,{useEffect,useState} from 'react';

const LEVELS=['Beginner','Initial Grade','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8'];
const readPlan=()=>{try{return JSON.parse(localStorage.getItem('pc_grade_plan')||'{}')}catch{return {}}};
export default function GradePlannerSimple({sessions=[],onPracticePiece=()=>{}}){
 const [done,setDone]=useState(false);
 const [level,setLevel]=useState('Beginner');
 const [goal,setGoal]=useState('exam');
 const [board,setBoard]=useState('ABRSM');
 const [target,setTarget]=useState('Grade 1');
 const [days,setDays]=useState('5');
 const [minutes,setMinutes]=useState('20');
 const [plan,setPlan]=useState(readPlan);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{try{localStorage.setItem('pc_grade_plan',JSON.stringify(plan))}catch{setError('Your browser storage is full. Export a .musicdata backup and remove older files before adding more scores.')}},[plan]);
 function buildPlan(e){
  e.preventDefault();
  const current=level==='Beginner'?'Initial Grade':level;
  const next=LEVELS[Math.min(9,Math.max(1,LEVELS.indexOf(current)+1))];
  const finalTarget=goal==='exam'?target:next;
  const route=board==='ABRSM'?'Practical Grades':'Trinity Digital — Technical work';
  setPlan(p=>({...p,board,route,current,target:finalTarget,weeklyHours:Number(days)*Number(minutes)/60,pieces:Array.isArray(p.pieces)?p.pieces:[],checks:p.checks||{}}));
  setDone(true);
 }
 function upload(file){
  if(!file)return;
  setError('');
  if(!(file.type==='application/pdf'||['image/png','image/jpeg','image/webp'].includes(file.type))){setError('Upload a clear PNG, JPG, WebP photo or PDF.');return}
  if(file.size>1500000){setError('This file is larger than 1.5 MB. Compress the photo or use Sheet Music Converter for larger files.');return}
  setBusy(true);
  const reader=new FileReader();
  reader.onerror=()=>{setBusy(false);setError('Could not read this file. Try another photo.');};
  reader.onload=()=>{
   setPlan(p=>{
    const pieces=Array.isArray(p.pieces)?p.pieces:[];
    const index=pieces.length;
    const category=p.board==='ABRSM'?(index<3?['List A','List B','List C'][index]:'Own choice'):(Number(String(p.target).replace('Grade ','').replace('Initial Grade','0'))>=6?(index===0?'Group A':'Group B'):'Repertoire list');
    const title=file.name.replace(/\.(pdf|png|jpe?g|webp)$/i,'').replace(/[_-]+/g,' ').trim()||'Grade piece '+(index+1);
    return {...p,pieces:[...pieces,{id:'piece-'+Date.now(),title,composer:'',category,scoreData:String(reader.result||''),scoreName:file.name,scoreType:file.type,addedAt:new Date().toISOString()}]};
   });
   setBusy(false);
  };
  reader.readAsDataURL(file);
 }
 function remove(id){setPlan(p=>({...p,pieces:(p.pieces||[]).filter(x=>x.id!==id)}))}
 const requirements=plan.board==='ABRSM'?[
  ['pieces','Three pieces','Choose one approved piece from each of Lists A, B and C for your syllabus edition.'],
  ['scales','Scales and arpeggios','Practise the exact keys, hands and tempos listed for your grade.'],
  ['sight','Sight-reading','Practise short unfamiliar pieces and keep a steady pulse.'],
  ['aural','Aural tests','Listen for rhythm, pitch, patterns and musical features.']
 ]:[
  ['pieces','Three repertoire pieces','Choose pieces from the current Trinity list for your grade.'],
  ['technical','Technical work','Follow the exact grade-specific scales, arpeggios or technical exercises.'],
  ['support','Supporting skills','Practise the supporting tests required by your selected exam format.']
 ];
 return <div className="grade-planner grade-planner-simple">
  {!done?<section className="panel gp-questionnaire">
   <div className="eyebrow">YOUR PIANO PLAN</div><h2>Let's work out what you need</h2>
   <p className="muted">Answer these quick questions. Music Coach will turn them into a simple plan you can follow.</p>
   <form className="gp-questionnaire-form" onSubmit={buildPlan}>
    <label>What is your current level?<select value={level} onChange={e=>setLevel(e.target.value)}>{LEVELS.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>What is your main goal?<select value={goal} onChange={e=>setGoal(e.target.value)}><option value="exam">Prepare for a graded exam</option><option value="confidence">Become more confident playing pieces</option><option value="technique">Improve technique and sight-reading</option></select></label>
    {goal==='exam'&&<><label>Exam board<select value={board} onChange={e=>setBoard(e.target.value)}><option>ABRSM</option><option>Trinity</option></select></label><label>Target grade<select value={target} onChange={e=>setTarget(e.target.value)}>{LEVELS.filter(x=>x!=='Beginner'&&x!=='Initial Grade').map(x=><option key={x}>{x}</option>)}</select></label></>}
    <label>How many days can you practise?<select value={days} onChange={e=>setDays(e.target.value)}>{[2,3,4,5,6,7].map(x=><option key={x} value={x}>{x} days per week</option>)}</select></label>
    <label>How long each day?<select value={minutes} onChange={e=>setMinutes(e.target.value)}>{[10,15,20,30,45,60].map(x=><option key={x} value={x}>{x} minutes</option>)}</select></label>
    <button className="btn btn-dark" type="submit">Create my plan →</button>
   </form>
  </section>:<>
   <section className="panel gp-simple-hero"><div><div className="eyebrow">YOUR PLAN</div><h2>{plan.board||'Piano'} · {plan.target||'Next steps'}</h2><p className="muted">Your plan is ready. Add photos of your grade pieces and Music Coach will convert them into sheet music for practice.</p><strong>{Math.round((Number(plan.weeklyHours)||0)*60)} minutes planned each week</strong></div><button className="btn" onClick={()=>setDone(false)}>Edit answers</button></section>
   <section className="panel"><h3>Your practice checklist</h3><div className="gp-simple-steps">{requirements.map((r,i)=><article className="gp-simple-step" key={r[0]}><span>{i+1}</span><div><strong>{r[1]}</strong><p>{r[2]}</p></div></article>)}</div><p className="muted small">Check the official {plan.board} syllabus for exact grade-specific requirements.</p></section>
   <section className="panel"><div className="panel-head"><div><h3>Your grade pieces</h3><p className="muted">Upload a clear photo of a piece, or its PDF. Add one piece at a time.</p></div><span className="tag">{(plan.pieces||[]).length} uploaded</span></div>
    <label className="gp-photo-upload"><span className="gp-photo-icon">＋</span><strong>{busy?'Adding score…':'Upload a piece photo or PDF'}</strong><small>PNG, JPG, WebP or PDF</small><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/></label>
    {error&&<p className="gp-error" role="alert">{error}</p>}
    {!(plan.pieces||[]).length?<div className="empty-state"><strong>No pieces uploaded yet</strong><p>Photograph the full page in good light, keep it straight and upload it here.</p></div>:<div className="gp-piece-list">{plan.pieces.map(piece=><article className="gp-piece-row" key={piece.id}><div className="gp-piece-main"><span className="gp-piece-category-text">{piece.category}</span><strong>{piece.title}</strong><small>{piece.scoreName||'Score photo saved'}</small></div><div className="gp-piece-actions"><button className="btn btn-dark" onClick={()=>onPracticePiece(piece)}>Practise this piece</button><button className="btn" onClick={()=>remove(piece.id)}>Remove</button></div></article>)}</div>}
   </section>
   <section className="panel"><h3>Choose how to practise</h3><div className="gp-simple-steps"><article className="gp-simple-step"><span>1</span><div><strong>Normal practice</strong><p>Play freely, record your attempt and review measured feedback.</p></div></article><article className="gp-simple-step"><span>2</span><div><strong>Listen & Learn · beta</strong><p>Listen to short phrases, then practise them in small sections while following the score.</p></div></article><article className="gp-simple-step"><span>3</span><div><strong>Sheet music fullscreen</strong><p>Open the score and double-click the notation to expand it.</p></div></article></div></section>
   <button className="text-button" onClick={()=>setDone(false)}>Change questionnaire answers</button>
  </>}
 </div>;
}
