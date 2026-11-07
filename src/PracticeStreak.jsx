import React,{useMemo,useState} from 'react';

function dayKey(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
function mondayOf(date){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()-(d.getDay()+6)%7);return d}
export default function PracticeStreak({streak=0,days=[],onPractice=()=>{}}){
 const [weekOffset,setWeekOffset]=useState(0);
 const completed=useMemo(()=>new Set(days),[days]);
 const weekStart=useMemo(()=>{const d=mondayOf(new Date());d.setDate(d.getDate()+weekOffset*7);return d},[weekOffset]);
 const week=useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return {date:d,key:dayKey(d),done:completed.has(dayKey(d))}}),[weekStart,completed]);
 const label=weekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' – '+week[6].date.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
 return <div className="practice-streak-corner" tabIndex={0} aria-label={streak+' day practice streak. Hover to view your practice weeks.'}>
  <button type="button" className="practice-streak-trigger" onClick={onPractice} aria-label={streak+' day streak. Start practice'}>
   <span className="practice-streak-flame" aria-hidden="true">✦</span><span><strong>{streak} day streak</strong><small>Practice consistency</small></span>
  </button>
  <div className="practice-streak-expanded" role="region" aria-label="Weekly practice history">
   <div className="practice-streak-week-heading"><button type="button" onClick={()=>setWeekOffset(v=>v-1)} aria-label="Previous week">‹</button><strong>{label}</strong><button type="button" onClick={()=>setWeekOffset(v=>Math.min(0,v+1))} disabled={weekOffset===0} aria-label="Next week">›</button></div>
   <div className="practice-streak-days">{week.map(({date,key,done})=><div className={'practice-streak-day '+(done?'is-complete':'')} key={key}><small>{date.toLocaleDateString('en-GB',{weekday:'short'}).slice(0,2)}</small><b>{done?'✓':date.getDate()}</b></div>)}</div>
   <small className="practice-streak-note">A day counts when you finish the full selected session.</small>
  </div>
 </div>;
}
