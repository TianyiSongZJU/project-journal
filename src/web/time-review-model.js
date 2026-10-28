import {addDays,dateKey,parseDate,entryHours,otherEntry} from './model.js';

export const TIME_REVIEW_LIMIT=366;
export function validTimeDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2200-12-31')return false;
 return dateKey(parseDate(value))===value;
}
export function timeReviewDayCount(start,end){const day=value=>Date.UTC(...value.split('-').map((n,i)=>Number(n)-(i===1?1:0)));return Math.round((day(end)-day(start))/86400000)+1}
export function timeReviewRange(preset,anchor,anchorSide='end'){
 const count=preset==='7'?7:preset==='14'?14:30;
 const shift=anchorSide==='start'?0:1-count;
 const start=addDays(anchor,shift),end=addDays(start,count-1);
 return {start,end,preset:String(count),anchorSide:anchorSide==='start'?'start':'end'};
}
export function defaultTimeReview(today){return {...timeReviewRange('14',today),startHour:8,colorMode:'effort',selectedDate:'',scrollTop:0,scrollLeft:0}}
export function sanitizeTimeReview(raw={},today){
 const out=defaultTimeReview(today);
 if(raw&&typeof raw==='object'){
  const preset=['7','14','30'].includes(raw.preset)?raw.preset:raw.preset==='28'||raw.preset==='month'?'30':'14',side=raw.anchorSide==='start'?'start':'end',anchor=side==='start'?raw.start:raw.end;
  if(validTimeDate(anchor)){const range=timeReviewRange(preset,anchor,side);if(validTimeDate(range.start)&&validTimeDate(range.end))Object.assign(out,range)}
  for(const key of ['scrollTop','scrollLeft'])if(Number.isFinite(raw[key])&&raw[key]>=0&&raw[key]<=100000)out[key]=raw[key];
  out.startHour=raw.startHour===0?0:8;out.colorMode=raw.colorMode==='project'?'project':'effort';
  if(validTimeDate(raw.selectedDate)&&raw.selectedDate>=out.start&&raw.selectedDate<=out.end)out.selectedDate=raw.selectedDate;
 }
 return out;
}

// Only applied allocations have a time-of-day location. Never infer one from daily totals or evidence.
export function buildTimeReview(state,{start,end,startHour=8,projectIds=[]}){
 if(!validTimeDate(start)||!validTimeDate(end)||start>end)throw Error('请选择有效的起止日期。');
 const dates=[];for(let d=start;d<=end;d=addDays(d,1)){dates.push(d);if(dates.length>TIME_REVIEW_LIMIT)throw Error('一次最多查看 366 天，请缩小日期范围。')}
 const selected=new Set(projectIds),projects=state.projects.filter(p=>!selected.size||selected.has(p.id)),known=new Set(projects.map(p=>p.id));
 const first=startHour===0?0:32,summary=Array.from({length:96-first},(_,i)=>({start:(first+i)*15,minutes:0,days:0,parts:new Map()}));
 let totalMinutes=0,visibleMinutes=0,unlocatedHours=0,estimatedHours=0,missingEstimates=0,conflictMinutes=0;
 const usedProjects=new Set(),rows=[];
 const entriesByDate=new Map();for(const e of state.entries||[])if(e.date>=start&&e.date<=end&&known.has(e.projectId)){if(!entriesByDate.has(e.date))entriesByDate.set(e.date,[]);entriesByDate.get(e.date).push(e)}
 for(const date of dates){
  const minutes=Array(1440).fill(null);
  for(const block of state.timelineDays?.[date]?.applied||[]){
   if(!known.has(block.projectId)||!Number.isInteger(block.start)||!Number.isInteger(block.end)||block.start<0||block.end>1440||block.start>=block.end)continue;
   for(let n=block.start;n<block.end;n++){if(minutes[n]===null)minutes[n]=block.projectId;else if(minutes[n]!==block.projectId)minutes[n]='!conflict'}
  }
  let dailyTotal=0,dailyVisible=0,dailyUnlocatedHours=0,dailyMissingEstimates=0;const dailyParts=new Map();
  for(const id of minutes)if(id!==null){dailyParts.set(id,(dailyParts.get(id)||0)+1);dailyTotal++;if(id!=='!conflict')usedProjects.add(id);else conflictMinutes++}
  const cells=summary.map((_,i)=>{
   const start=(first+i)*15,parts=new Map();let total=0;
   for(let n=start;n<start+15;n++)if(minutes[n]!==null){total++;parts.set(minutes[n],(parts.get(minutes[n])||0)+1)}
   const aggregate=summary[i];if(total)aggregate.days++;aggregate.minutes+=total;for(const [id,value]of parts)aggregate.parts.set(id,(aggregate.parts.get(id)||0)+value);
   dailyVisible+=total;return {start,minutes:total,parts:[...parts].map(([projectId,minutes])=>({projectId,minutes}))};
  });
  for(const e of entriesByDate.get(date)||[]){
   const other=otherEntry(state,e.projectId,date),hours=entryHours(other,state.settings?.estimates||{});
   if(hours===null){missingEstimates++;dailyMissingEstimates++;continue}dailyUnlocatedHours+=Math.max(0,hours||0);unlocatedHours+=Math.max(0,hours||0);if(other.kind!=='hours'&&other.kind!=='none')estimatedHours+=Math.max(0,hours||0);
  }
  totalMinutes+=dailyTotal;visibleMinutes+=dailyVisible;rows.push({date,totalMinutes:dailyTotal,visibleMinutes:dailyVisible,projectMinutes:[...dailyParts].map(([projectId,minutes])=>({projectId,minutes})).sort((a,b)=>b.minutes-a.minutes||a.projectId.localeCompare(b.projectId)),unlocatedHours:dailyUnlocatedHours,missingEstimates:dailyMissingEstimates,cells});
 }
 return {start,end,startHour:first/4,projects,usedProjects:[...usedProjects],rows,summary:summary.map(s=>({...s,parts:[...s.parts].map(([projectId,minutes])=>({projectId,minutes}))})),totalMinutes,visibleMinutes,hiddenMinutes:totalMinutes-visibleMinutes,unlocatedHours,estimatedHours,missingEstimates,conflictMinutes,recordedDays:rows.filter(r=>r.totalMinutes>0).length};
}
