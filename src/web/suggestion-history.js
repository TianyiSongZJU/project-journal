import {unionSpans} from './auto-timeline.js';
import {dedupeFileChanges,suggestTimeSlots,availableSuggestions} from './time-suggestions.js';
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const localMinute=ts=>{const d=new Date(ts*1000);return d.getHours()*60+d.getMinutes()+d.getSeconds()/60};
export function evidenceGuides(evidence,day){const activities=[],files=[],seen=new Set();for(const e of evidence.filter(e=>e.date===day)){
  if(e.kind==='activity'){if(e.bucketStart){const start=localMinute(e.bucketStart);activities.push({id:e.id,deviceId:e.deviceId,start,end:start+15,seconds:e.seconds,app:e.app||'应用',name:e.app,projectId:e.projectId,basis:e.attribution||{},device:e.deviceName||''});continue}const spans=unionSpans(e.spans||[]);for(const span of spans){const start=localMinute(span.start),end=Math.min(1440,start+(span.end-span.start)/60),id=`${e.deviceId||e.deviceName}/${e.projectId}/${e.app}/${e.name}/${span.start}/${span.end}`;if(seen.has(id))continue;seen.add(id);activities.push({id:e.id+'/'+span.start,deviceId:e.deviceId,start,end,app:e.app||'应用',name:e.name||e.app,projectId:e.projectId,basis:e.attribution||{},device:e.deviceName||''})}}
  else {const touches=e.touches?.length?e.touches:[];if(touches.length){for(const t of touches){const id=`${e.projectId}/${e.relativePath||e.name}/${t.stamp}/${Math.floor(t.at/60)}`;files.push({at:localMinute(t.at),name:e.name,path:e.path||e.relativePath||e.name,relativePath:e.relativePath||e.name,stamp:t.stamp,projectId:e.projectId,deviceId:e.deviceId,device:e.deviceName||'',bulk:!!t.bulk})}}else if(e.at){const t=Date.parse(e.at);if(Number.isFinite(t)&&dateKey(new Date(t))===day)files.push({at:localMinute(t/1000),name:e.name,path:e.path||e.relativePath||e.name,projectId:e.projectId,device:e.deviceName||'',legacy:true})}}
 }files.splice(0,files.length,...dedupeFileChanges(files));return {activities,files};}
export function pendingSuggestionDays({evidence=[],timelineDays={},timelineRead={},dateStamps={},projectIds=[],rules={},gapMinutes=15,start,end}){
 rules=rules||{};gapMinutes=gapMinutes||15;
 const dates=[...new Set(evidence.map(e=>e.date))].filter(date=>date>=start&&date<end).sort();
 return dates.flatMap(date=>{
  if(dateStamps[date]&&timelineRead[date]===dateStamps[date])return [];
  const day=timelineDays[date]||{},guides=evidenceGuides(evidence,date),slots=suggestTimeSlots({...guides,projectIds,gapMinutes,rules}),suggestions=availableSuggestions(slots,[...(day.blocks||[]),...(day.applied||[])]);
  return suggestions.length?[{date,count:suggestions.length,minutes:suggestions.reduce((n,s)=>n+s.end-s.start,0)}]:[];
 });
}
