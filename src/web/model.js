export const KINDS=['很短','短','中','长','很长'];
export function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function parseDate(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)}
export function addDays(s,n){const d=parseDate(s);d.setDate(d.getDate()+n);return dateKey(d)}
export function monthKey(d){return dateKey(d).slice(0,7)}
export function fmt(n){return Number(n.toFixed(2)).toLocaleString('zh-CN',{maximumFractionDigits:2})}
export function entryHours(e,estimates){return e.kind==='none'?0:e.kind==='hours'?e.hours:(estimates[e.kind]??null)}
export function summarize(entries,estimates){let exact=0,estimated=0,missing=0;const rough=Object.fromEntries(KINDS.map(k=>[k,0]));for(const e of entries){if(e.kind==='none')continue;if(e.kind==='hours')exact+=e.hours;else{rough[e.kind]++;if(estimates[e.kind]==null)missing++;else estimated+=estimates[e.kind]}}return{exact,estimated,missing,rough,total:exact+estimated,count:entries.length,days:new Set(entries.map(e=>e.date)).size}}
export function level(hours,estimates=null){if(!estimates)return hours>=4?4:hours>=3?3:hours>=1.5?2:hours>0?1:0;if(hours<=0)return 0;const defaults=[1,2,4,7,10],stops=KINDS.map((k,i)=>Number.isFinite(estimates[k])&&estimates[k]>0?estimates[k]:defaults[i]).sort((a,b)=>a-b);return Math.max(1,stops.filter(v=>hours>=v).length)}
export function yearDays(year){const first=new Date(year,0,1,12),last=new Date(year,11,31,12);const start=new Date(first);start.setDate(start.getDate()-first.getDay());const cells=[];while(start<=last||cells.length%7!==0){cells.push({date:dateKey(start),inYear:start.getFullYear()===year});start.setDate(start.getDate()+1)}return cells}
export function dateRange(a,b){if(a>b)[a,b]=[b,a];const values=[];for(let d=a;d<=b;d=addDays(d,1)){values.push(d);if(values.length>3660)throw Error('一次最多选择 3660 天，请缩小范围。')}return values}
// Entries retain their displayed total; editable effort is kept separately when a timeline is applied.
export function appliedHours(state,projectId,date){return (state.timelineDays?.[date]?.applied||[]).filter(b=>b.projectId===projectId).reduce((n,b)=>n+(b.end-b.start)/60,0)}
export function otherEntry(state,projectId,date){const e=state.entries.find(e=>e.projectId===projectId&&e.date===date),timeline=appliedHours(state,projectId,date);if(!e)return {projectId,date,kind:'none',hours:0,note:''};if(e.otherKind)return {...e,kind:e.otherKind,hours:e.otherHours||0};if(!timeline)return {...e};const total=entryHours(e,state.settings?.estimates||{});return {...e,kind:'hours',hours:total==null?0:Math.max(0,total-timeline)}}
export function writeOtherEntry(state,projectId,date,kind,hours,note=''){
 if(!Number.isFinite(hours)||hours<0||hours>24)throw Error('小时需介于 0 至 24。');
 const timeline=appliedHours(state,projectId,date),value={projectId,date,kind,hours:kind==='hours'?hours:0,note},base=entryHours(value,state.settings?.estimates||{});
 if(timeline){if(base==null)throw Error('这一天已有时间线，请先配置该档的估算小时，或填写精确小时。');if(base+timeline>24+1e-8)throw Error('其他已记加时间线超过 24 小时，请核对。');Object.assign(value,{otherKind:kind,otherHours:value.hours,kind:'hours',hours:Math.round((base+timeline)*1e8)/1e8})}
 const index=state.entries.findIndex(e=>e.projectId===projectId&&e.date===date);if(kind==='none'&&!note.trim()&&!timeline){if(index>=0)state.entries.splice(index,1)}else if(index>=0)state.entries[index]=value;else state.entries.push(value);
}
export function refreshTimeTotals(state){for(const e of [...state.entries])if(e.otherKind)writeOtherEntry(state,e.projectId,e.date,e.otherKind,e.otherHours||0,e.note)}
export function applyBatch(state,{dates,projectId,operation,kind,hours,note=''}){if(!state.projects.some(p=>p.id===projectId))throw Error('请先选择项目');if(!dates.length)throw Error('请先选择日期');if(!['set','add','note'].includes(operation))throw Error('未知批量操作');if(operation==='note'&&!note.trim())throw Error('请填写任务备注');if(operation!=='note'&&(!Number.isFinite(hours)||hours<0||hours>24))throw Error('小时需介于 0 至 24');const next=structuredClone(state);for(const date of dates){const old=otherEntry(next,projectId,date);if(operation==='add'&&KINDS.includes(old.kind))throw Error('所选日期中包含概括记录，无法直接增加精确小时。请选择精确记录，或使用“设为”。');let text=old.note||'';if(note.trim()&&!text.split('\n').includes(note.trim()))text=text.trim()?text+'\n'+note.trim():note.trim();const nextKind=operation==='note'?old.kind:operation==='add'?'hours':kind,nextHours=operation==='note'?old.hours:operation==='add'?Number((old.hours+hours).toFixed(8)):hours;writeOtherEntry(next,projectId,date,nextKind,nextHours,text)}return next}
export function timelineDays(firstYear,lastYear){
 const first=new Date(firstYear,0,1,12),last=new Date(lastYear,11,31,12),cursor=new Date(first),cells=[];
 cursor.setDate(cursor.getDate()-(cursor.getDay()+6)%7);
 while(cursor<=last||cells.length%7!==0){const year=cursor.getFullYear();cells.push({date:dateKey(cursor),year,inRange:year>=firstYear&&year<=lastYear});cursor.setDate(cursor.getDate()+1)}
 return cells;
}
export function monthWeeks(firstMonth,lastMonth){const [fy,fm]=firstMonth.split('-').map(Number),[ly,lm]=lastMonth.split('-').map(Number);const cursor=new Date(fy,fm-1,1,12),last=new Date(ly,lm,0,12);cursor.setDate(cursor.getDate()-(cursor.getDay()+6)%7);const weeks=[];while(cursor<=last){const days=[];for(let i=0;i<7;i++){days.push(dateKey(cursor));cursor.setDate(cursor.getDate()+1)}weeks.push(days)}return weeks}
export function reorderProjects(projects,id,targetId,after=false){if(id===targetId)return [...projects];const item=projects.find(p=>p.id===id);if(!item||!projects.some(p=>p.id===targetId))throw Error('找不到要排序的项目');const result=projects.filter(p=>p.id!==id),index=result.findIndex(p=>p.id===targetId);result.splice(index+(after?1:0),0,item);return result}

export function sortProjects(projects,mode='manual',entries=[]){const result=[...projects],deadline=p=>(p.deadlines||[]).filter(d=>!d.done).map(d=>d.date).sort()[0]||'9999';if(mode==='deadline')result.sort((a,b)=>deadline(a).localeCompare(deadline(b)));if(mode==='created')result.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));if(mode==='updated'){const latest=new Map();for(const e of entries)if(e.date>(latest.get(e.projectId)||''))latest.set(e.projectId,e.date);result.sort((a,b)=>(latest.get(b.id)||'').localeCompare(latest.get(a.id)||''));}return result}
