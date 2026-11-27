import React,{useEffect,useMemo,useState} from 'react';

const LEVELS=['Beginner','Initial Grade','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8'];
const CATEGORIES=[
 {id:'pieces',title:'Pieces',detail:'Repertoire and performance pieces',empty:'Add the pieces from the exam-book copy you own.'},
 {id:'exercises',title:'Exercises',detail:'Technique, control and coordination',empty:'Add the exercises you are working on.'},
 {id:'scales',title:'Scales',detail:'Scales, arpeggios and requirements',empty:'Add the scales and arpeggios for your grade.'}
];
const WEIGHTS={pieces:.6,exercises:.25,scales:.15};
const STANDARDS={'Initial Grade':58,'Grade 1':62,'Grade 2':66,'Grade 3':70,'Grade 4':74,'Grade 5':78,'Grade 6':82,'Grade 7':86,'Grade 8':90};
const blankDraft={id:'',kind:'pieces',title:'',composer:'',notes:'',category:'Grade repertoire',sectionCount:1,scoreData:'',scoreName:'',scoreType:''};
const clean=value=>String(value||'').toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function readPlan(){
 try{
  const stored=JSON.parse(localStorage.getItem('pc_grade_plan')||'{}');
  const legacy=Array.isArray(stored.pieces)?stored.pieces:[];
  const tasks=Array.isArray(stored.tasks)?stored.tasks:legacy.map(piece=>({...piece,kind:'pieces'}));
  return {...stored,tasks,pieces:tasks.filter(task=>(task.kind||'pieces')==='pieces'),checks:stored.checks||{}};
 }catch{return {tasks:[],pieces:[],checks:{}}}
}
function readFile(file){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||''));
  reader.onerror=()=>reject(new Error('Could not read this score file. Try another photo.'));
  reader.readAsDataURL(file);
 });
}
function scoreForTask(task,sessions){
 const title=clean(task.title);
 const related=(Array.isArray(sessions)?sessions:[])
  .filter(session=>clean(session.song)===title)
  .map(session=>({session,score:Number(session.keystoneResult?.score??session.feedbackScore)}))
  .filter(item=>Number.isFinite(item.score)&&item.score>=0&&item.score<=100)
  .sort((a,b)=>new Date(b.session.lastPractisedAt||b.session.date||0)-new Date(a.session.lastPractisedAt||a.session.date||0))
  .slice(0,5);
 if(!related.length)return {progress:null,attempts:0,lastAttemptedAt:null};
 const total=related.reduce((sum,item,index)=>sum+item.score*(related.length-index),0);
 const weights=related.reduce((sum,_,index)=>sum+(related.length-index),0);
 return {progress:total/weights,attempts:related.length,lastAttemptedAt:related[0].session.lastPractisedAt||related[0].session.date||null};
}
function calculateReadiness(tasks,sessions,target){
 const items=tasks.map(task=>({task,...scoreForTask(task,sessions)}));
 const byKind={pieces:[],exercises:[],scales:[]};
 for(const item of items)if(byKind[item.task.kind])byKind[item.task.kind].push(item);
 let weighted=0,weightUsed=0;
 const breakdown=[];
 for(const [kind,weight] of Object.entries(WEIGHTS)){
  const group=byKind[kind];
  if(!group.length)continue;
  const value=group.reduce((sum,item)=>sum+(item.progress??0),0)/group.length;
  weighted+=value*weight;weightUsed+=weight;
  breakdown.push({kind,value:Math.round(value),evidenced:group.filter(item=>item.progress!==null).length,total:group.length});
 }
 const ability=weightUsed?weighted/weightUsed:0;
 const evidenced=items.filter(item=>item.progress!==null);
 const attemptCount=items.reduce((sum,item)=>sum+item.attempts,0);
 const coverage=items.length?evidenced.length/items.length:0;
 const confidence=attemptCount>=8&&evidenced.length>=3?'high':attemptCount>=3||evidenced.length>=2?'medium':attemptCount?'low':'none';
 const cap=confidence==='low'?70:confidence==='medium'?90:100;
 const raw=attemptCount?Math.round(ability/(STANDARDS[target]||62)*100*(.55+.45*coverage)):0;
 const percent=clamp(raw,0,cap);
 return {percent,ability:Math.round(ability),confidence,attemptCount,evidenced:evidenced.length,total:items.length,breakdown,items,
  weakest:items.filter(item=>item.progress!==null).sort((a,b)=>a.progress-b.progress).slice(0,3)};
}

export default function GradePlannerSimple({sessions=[],onPracticePiece=()=>{}}){
 const [plan,setPlan]=useState(readPlan);
 const [done,setDone]=useState(()=>Boolean(readPlan().target));
 const [level,setLevel]=useState('Beginner');
 const [goal,setGoal]=useState('exam');
 const [board,setBoard]=useState('ABRSM');
 const [target,setTarget]=useState('Grade 1');
 const [days,setDays]=useState('5');
 const [minutes,setMinutes]=useState('20');
 const [draft,setDraft]=useState(null);
 const [draftFile,setDraftFile]=useState(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);

 useEffect(()=>{
  try{
   const tasks=Array.isArray(plan.tasks)?plan.tasks:[];
   localStorage.setItem('pc_grade_plan',JSON.stringify({...plan,tasks,pieces:tasks.filter(task=>(task.kind||'pieces')==='pieces')}));
   window.dispatchEvent(new Event('pc-grade-plan-updated'));
  }catch{setError('Your browser storage is full. Remove older uploaded scores or use Sheet Music Converter for larger files.');}
 },[plan]);

 const tasks=Array.isArray(plan.tasks)?plan.tasks:[];
 const readiness=useMemo(()=>calculateReadiness(tasks,sessions,plan.target),[tasks,sessions,plan.target]);
 const personal=Boolean(plan.goal&&plan.goal!=='exam');
 const minutesPerWeek=Math.round((Number(plan.weeklyHours)||0)*60);

 function buildPlan(event){
  event.preventDefault();
  const current=level==='Beginner'?'Initial Grade':level;
  const next=LEVELS[Math.min(9,Math.max(1,LEVELS.indexOf(current)+1))];
  const finalTarget=goal==='exam'?target:next;
  setPlan(previous=>({...previous,goal,board:goal==='exam'?board:'Personal',route:goal==='exam'?(board==='ABRSM'?'Practical Grades':'Graded Piano'):'Personal development',current,target:finalTarget,weeklyHours:Number(days)*Number(minutes)/60,tasks:Array.isArray(previous.tasks)?previous.tasks:[],pieces:Array.isArray(previous.pieces)?previous.pieces:[]}));
  setError('');
  setNotice('Your Grade Plan has been saved in this browser.');
  setDone(true);
 }

 function beginAdd(kind){
  setError('');
  setDraft({...blankDraft,kind,category:kind==='pieces'?'Grade repertoire':kind==='scales'?'Technique reference':'Exercise'});
  setDraftFile(null);
 }
 function beginEdit(task){
  setError('');
  setDraft({...blankDraft,...task,kind:task.kind||'pieces'});
  setDraftFile(null);
 }
 function closeEditor(){setDraft(null);setDraftFile(null);setError('');}
 async function saveTask(event){
  event.preventDefault();
  if(!draft?.title?.trim()){setError('Give this task a title.');return;}
  setBusy(true);setError('');
  try{
   const fileData=draftFile?await readFile(draftFile):draft.scoreData||'';
   const task={...draft,id:draft.id||'task-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),title:draft.title.trim(),composer:draft.composer.trim(),notes:draft.notes.trim(),scoreData:fileData,scoreName:draftFile?.name||draft.scoreName||'',scoreType:draftFile?.type||draft.scoreType||'',sectionCount:clamp(Number(draft.sectionCount)||1,1,100),kind:draft.kind||'pieces',addedAt:draft.addedAt||new Date().toISOString()};
   setPlan(previous=>{
    const existing=Array.isArray(previous.tasks)?previous.tasks:[];
    const next=existing.some(item=>item.id===task.id)?existing.map(item=>item.id===task.id?task:item):[...existing,task];
    return {...previous,tasks:next,pieces:next.filter(item=>(item.kind||'pieces')==='pieces')};
   });
   setNotice(task.id&&tasks.some(item=>item.id===task.id)?'Task updated.':'Task added to your Grade Plan.');
   closeEditor();
  }catch(readError){setError(readError.message||'The task could not be saved.');}
  finally{setBusy(false);}
 }
 function removeTask(id){
  const task=tasks.find(item=>item.id===id);
  if(!task||!window.confirm('Remove '+task.title+' from your Grade Plan?'))return;
  setPlan(previous=>{const next=(previous.tasks||[]).filter(item=>item.id!==id);return {...previous,tasks:next,pieces:next.filter(item=>(item.kind||'pieces')==='pieces')}});
  setNotice('Task removed.');
 }
 async function attachScore(task,file){
  if(!file)return;
  if(!(file.type==='application/pdf'||['image/png','image/jpeg','image/webp'].includes(file.type))){setError('Choose a PDF, PNG, JPG or WebP score.');return;}
  if(file.size>1500000){setError('This file is larger than 1.5 MB. Use Sheet Music Converter for larger files.');return;}
  setBusy(true);setError('');
  try{
   const data=await readFile(file);
   setPlan(previous=>{
    const next=(previous.tasks||[]).map(item=>item.id===task.id?{...item,scoreData:data,scoreName:file.name,scoreType:file.type}:item);
    return {...previous,tasks:next,pieces:next.filter(item=>(item.kind||'pieces')==='pieces')};
   });
   setNotice('Score attached to '+task.title+'.');
  }catch(readError){setError(readError.message||'Could not attach this score.');}
  finally{setBusy(false);}
 }

 const requirements=personal?[
  ['pieces','Build a repertoire','Choose pieces that are enjoyable and slightly more challenging than your current level.'],
  ['technique','Develop technique','Practise scales, arpeggios, posture and relaxed movement in short focused sessions.'],
  ['sight','Sight-reading','Read a short unfamiliar passage regularly, keeping a steady pulse.'],
  ['listening','Musical listening','Listen back to recordings and notice timing, balance, phrasing and accuracy.']
 ]:plan.board==='ABRSM'?[
  ['pieces','Three set pieces','Choose one approved piece from each of Lists A, B and C in your chosen syllabus.'],
  ['scales','Scales and arpeggios','Use the exact keys, hands, motion, articulation and tempos for your grade.'],
  ['sight','Sight-reading','Practise unfamiliar short pieces using the current grade preparation time.'],
  ['aural','Aural tests','Practise the grade-specific listening, pulse, rhythm and musical-feature tasks.']
 ]:[
  ['pieces','Repertoire','Choose the pieces and programme required by your current Trinity or RSL syllabus.'],
  ['technique','Technical work','Follow the exact grade-specific scales, arpeggios and technical exercises.'],
  ['support','Supporting skills','Practise the supporting tests required by your selected exam format.']
 ];

 return <div className="grade-planner grade-planner-simple">
  {!done?<section className="panel gp-questionnaire">
   <div className="eyebrow">YOUR PIANO PLAN</div><h2>Let's build your Grade Plan</h2>
   <p className="muted">Choose your level and goal. You can add pieces, exercises and scales separately once your plan is ready.</p>
   <form className="gp-questionnaire-form" onSubmit={buildPlan}>
    <label>What is your current level?<select value={level} onChange={event=>setLevel(event.target.value)}>{LEVELS.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>What is your main goal?<select value={goal} onChange={event=>setGoal(event.target.value)}><option value="exam">Prepare for a graded exam</option><option value="confidence">Become more confident playing pieces</option><option value="technique">Improve technique and sight-reading</option></select></label>
    {goal==='exam'&&<><label>Exam board<select value={board} onChange={event=>setBoard(event.target.value)}><option>ABRSM</option><option>Trinity</option><option>RSL Awards</option></select></label><label>Target grade<select value={target} onChange={event=>setTarget(event.target.value)}>{LEVELS.filter(item=>item!=='Beginner').map(item=><option key={item}>{item}</option>)}</select></label></>}
    <label>How many days can you practise?<select value={days} onChange={event=>setDays(event.target.value)}>{[2,3,4,5,6,7].map(value=><option key={value} value={value}>{value} days per week</option>)}</select></label>
    <label>How long each day?<select value={minutes} onChange={event=>setMinutes(event.target.value)}>{[10,15,20,30,45,60].map(value=><option key={value} value={value}>{value} minutes</option>)}</select></label>
    <button className="btn btn-dark" type="submit">Create my plan →</button>
   </form>
  </section>:<>
   <section className="panel gp-hero gp-simple-hero">
    <div><div className="eyebrow">YOUR GRADE PLAN</div><h2>{personal?'Personal learning':(plan.board||'Piano')} · {plan.target||'Next steps'}</h2><p className="muted">{personal?'Build a balanced repertoire and strengthen your technique.':'Your pieces, exercises and scales are organised around your selected grade.'}</p><strong>{minutesPerWeek} minutes planned each week</strong><p className="muted small">Saved locally in this browser · your scores are not uploaded automatically.</p></div>
    <div className="gp-ring" style={{background:'conic-gradient(#9276c8 '+readiness.percent+'%,#eae3f4 0)'}}><strong>{readiness.attemptCount?readiness.percent+'%':'—'}</strong><span>grade readiness</span></div>
    <button className="btn" type="button" onClick={()=>setDone(false)}>Edit plan</button>
   </section>

   <section className="panel gp-readiness-panel">
    <div className="panel-head"><div><h3>Grade readiness</h3><p className="muted">{readiness.attemptCount?readiness.confidence+' confidence · '+readiness.attemptCount+' scored practice attempts':'No scored playing evidence yet'}</p></div><strong>{readiness.evidenced}/{readiness.total} targets assessed</strong></div>
    <div className="gp-track"><div style={{width:readiness.percent+'%'}}/></div>
    {readiness.breakdown.length?<div className="gp-readiness-breakdown">{readiness.breakdown.map(item=><div key={item.kind}><span>{CATEGORIES.find(category=>category.id===item.kind)?.title||item.kind}</span><strong>{item.value}%</strong><small>{item.evidenced} of {item.total} assessed</small></div>)}</div>:<p className="muted">Add a task and practise it to establish a baseline. Readiness uses saved practice scores, not checklist ticks.</p>}
    <p className="muted small">This is an estimate based on your saved practice sessions, not an official exam-board mark.</p>
   </section>

   <section className="panel gp-requirements-panel">
    <h3>What your plan should cover</h3>
    <div className="gp-requirements">{requirements.map(([id,title,detail])=><div key={id}><strong>{title}</strong><span>{detail}</span></div>)}</div>
    <p className="muted small">Check the current official syllabus for exact requirements. Piano Coach does not reproduce exam-board repertoire or marking schemes.</p>
   </section>

   <section className="gp-dashboard-columns" aria-label="Grade Plan tasks">
    {CATEGORIES.map(category=>{
     const group=tasks.filter(task=>(task.kind||'pieces')===category.id);
     return <section className="panel gp-category-panel" key={category.id}>
      <header className="gp-category-heading"><div><h3>{category.title}</h3><small>{category.detail}</small></div><span>{group.length}</span></header>
      <button className="btn gp-add-task" type="button" onClick={()=>beginAdd(category.id)}>＋ Add {category.title.toLowerCase().replace(/s$/,'')}</button>
      {group.length?<div className="gp-task-list">{group.map(task=>{
       const progress=scoreForTask(task,sessions);
       return <article className="gp-task-card" key={task.id}>
        <div className="gp-task-card-heading"><div><strong>{task.title}</strong><small>{task.composer||task.category||'Grade repertoire'}</small></div><b>{progress.progress===null?'—':Math.round(progress.progress)+'%'}</b></div>
        {task.notes&&<p className="muted small">{task.notes}</p>}
        {task.scoreName&&<small className="gp-task-file">♫ {task.scoreName}</small>}
        <div className="toolbar gp-task-actions"><button className="btn btn-dark" type="button" onClick={()=>onPracticePiece(task)}>Practise</button><button className="btn" type="button" onClick={()=>beginEdit(task)}>Edit</button><button className="btn" type="button" onClick={()=>removeTask(task.id)}>Remove</button></div>
        {category.id==='pieces'&&<label className="gp-score-upload">{task.scoreData?'Replace attached score':'Attach a score photo or PDF'}<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{attachScore(task,event.target.files?.[0]);event.target.value='';}}/></label>}
       </article>;
      })}</div>:<div className="gp-grade-task-empty"><p>{category.empty}</p></div>}
     </section>;
    })}
   </section>

   <section className="panel gp-priority-panel">
    <div className="panel-head"><div><h3>Your practice priorities</h3><p className="muted">Based on recent scored attempts, not task completion.</p></div></div>
    {readiness.weakest.length?<div className="gp-priority-list">{readiness.weakest.map(item=><div className="gp-priority-row" key={item.task.id}><div><strong>{item.task.title}</strong><small>{item.task.composer||item.task.category||'Grade Plan task'}</small></div><b>{Math.round(item.progress)}%</b><button className="btn" type="button" onClick={()=>onPracticePiece(item.task)}>Practise</button></div>)}</div>:<p className="muted">Your weakest tasks will appear after you have recorded scored practice attempts.</p>}
   </section>
   <button className="text-button" type="button" onClick={()=>setDone(false)}>Change plan answers</button>
  </>}

  {draft&&<div className="gp-editor-backdrop" role="presentation"><form className="panel gp-task-editor" onSubmit={saveTask} role="dialog" aria-modal="true" aria-labelledby="gp-task-editor-title">
   <div className="panel-head"><div><span className="eyebrow">YOUR GRADE PLAN</span><h3 id="gp-task-editor-title">{draft.id?'Edit task':'Add a task'}</h3></div><button className="btn" type="button" onClick={closeEditor}>×</button></div>
   <label>Category<select value={draft.kind} onChange={event=>setDraft(value=>({...value,kind:event.target.value,category:event.target.value==='pieces'?'Grade repertoire':event.target.value==='scales'?'Technique reference':'Exercise'}))}>{CATEGORIES.map(category=><option key={category.id} value={category.id}>{category.title}</option>)}</select></label>
   <label>Title<input value={draft.title} maxLength={180} onChange={event=>setDraft(value=>({...value,title:event.target.value}))} placeholder="e.g. Sonatina in C, first movement" required/></label>
   <label>Composer or description<input value={draft.composer||''} maxLength={160} onChange={event=>setDraft(value=>({...value,composer:event.target.value}))} placeholder="Optional"/></label>
   <label>Notes<textarea rows="3" value={draft.notes||''} onChange={event=>setDraft(value=>({...value,notes:event.target.value}))} placeholder="What would you like to focus on?"/></label>
   {draft.kind==='pieces'&&<label className="gp-score-upload">Attach sheet music (optional)<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={event=>setDraftFile(event.target.files?.[0]||null)}/><small>Files are kept in this browser. Use Sheet Music Converter for larger scans.</small></label>}
   <label>Practice sections<input type="number" min="1" max="100" value={draft.sectionCount||1} onChange={event=>setDraft(value=>({...value,sectionCount:event.target.value}))}/></label>
   {error&&<p className="gp-error" role="alert">{error}</p>}
   <div className="toolbar"><button className="btn" type="button" onClick={closeEditor}>Cancel</button><button className="btn btn-dark" disabled={busy}>{busy?'Saving…':'Save task'}</button></div>
  </form></div>}
  {error&&!draft&&<p className="gp-error" role="alert">{error}</p>}
  {notice&&<p className="gp-plan-confirmation" role="status">✓ {notice}</p>}
 </div>;
}
