import {unionSpans} from './auto-timeline.js';
// Shares describe observed active evidence within the quarter, not inferred work time.
export function activitySlots(activities,start,end){
 const slots=[];
 for(let at=start;at<end;at+=15){
  const hits=activities.filter(a=>a.start<at+15&&a.end>at);if(!hits.length)continue;
  const apps=new Map();for(const a of hits){if(!apps.has(a.app))apps.set(a.app,[]);apps.get(a.app).push(a)}
  const ranked=[...apps].map(([app,items])=>{const devices=new Map();for(const a of items){const key=a.deviceId||a.device||'local';if(!devices.has(key))devices.set(key,[]);devices.get(key).push(a)}const seconds=Math.max(...[...devices.values()].map(xs=>{const raw=xs.filter(a=>a.seconds==null);return unionSpans(raw.map(a=>({start:Math.max(at,a.start),end:Math.min(at+15,a.end)}))).reduce((n,s)=>n+(s.end-s.start)*60,0)+xs.filter(a=>a.seconds!=null).reduce((n,a)=>n+a.seconds,0)}));return {app,items,seconds:Math.min(900,seconds)}}).filter(a=>a.seconds>0).sort((a,b)=>b.seconds-a.seconds||a.app.localeCompare(b.app));
  const total=ranked.reduce((n,a)=>n+a.seconds,0);if(!total)continue;
  for(const a of ranked){const exact=a.seconds/total*100;a.percent=Math.floor(exact);a.remainder=exact-a.percent}
  const remainder=100-ranked.reduce((n,a)=>n+a.percent,0);[...ranked].sort((a,b)=>b.remainder-a.remainder).slice(0,remainder).forEach(a=>a.percent++);
  const major=ranked.filter((a,i)=>i===0||(i<2&&a.percent>=20)),minor=ranked.filter(a=>!major.includes(a));
  slots.push({at,app:ranked[0].app,name:ranked[0].items.find(a=>a.name&&a.name!==a.app)?.name||'',projectId:ranked[0].items[0].projectId,apps:ranked,major,minor,otherPercent:minor.reduce((n,a)=>n+a.percent,0),others:minor.length,activeSeconds:Math.min(900,total),hits});
 }
 return slots;
}
export function fileSlots(files,start,end){
 const groups=new Map();for(const file of files){if(file.at<start||file.at>=end)continue;const at=Math.floor(file.at/15)*15;if(!groups.has(at))groups.set(at,[]);groups.get(at).push(file)}
 return [...groups].sort((a,b)=>a[0]-b[0]).map(([at,items])=>{const by=new Map();for(const f of items){const id=f.path||((f.projectId||'')+'/'+f.name);if(!by.has(id))by.set(id,{name:f.name,path:id,count:0,first:f.at,last:f.at,legacy:true});const g=by.get(id);g.count++;g.first=Math.min(g.first,f.at);g.last=Math.max(g.last,f.at);g.legacy&&=!!f.legacy}return {at,items,files:[...by.values()],names:[...new Set(items.map(f=>f.name))]}});
}
// Join adjacent quarters only when their physical file sets are identical.
export function fileRuns(files,start,end){
 const runs=[];
 for(const slot of fileSlots(files,start,end)){
  const signature=JSON.stringify([...new Set(slot.items.map(f=>f.path||((f.projectId||'')+'/'+f.name)))].sort()),last=runs.at(-1);
  if(last&&last.end===slot.at&&last.signature===signature){last.end=slot.at+15;last.items.push(...slot.items)}
  else runs.push({...slot,end:slot.at+15,signature,items:[...slot.items]});
 }
 return runs.map(run=>{const grouped=fileSlots(run.items.map(f=>({...f,at:run.at})),run.at,run.at+15)[0];const by=new Map();for(const f of run.items){const id=f.path||((f.projectId||'')+'/'+f.name);if(!by.has(id))by.set(id,{first:f.at,last:f.at});const x=by.get(id);x.first=Math.min(x.first,f.at);x.last=Math.max(x.last,f.at)};const bounds=[...by.values()];grouped.files.forEach((f,i)=>Object.assign(f,bounds[i]));return {...run,files:grouped.files}});
}
// Stable application columns; gaps always start a new visual run.
export function applicationRuns(activities,start,end){
 const slots=activitySlots(activities,start,end),usage=new Map();for(const s of slots)for(const a of s.apps)usage.set(a.app,(usage.get(a.app)||0)+a.seconds);
 const names=[...usage].sort((a,b)=>b[1]-a[1]).map(([app])=>app),major=names.slice(0,3),columns=[...major,...(names.length>3?['其他']:[])],runs=[];
 columns.forEach((app,lane)=>{let current=null;for(const slot of slots){const apps=slot.apps.filter(a=>app==='其他'?!major.includes(a.app):a.app===app);if(!apps.length){current=null;continue}if(!current||current.end!==slot.at){current={app,lane,start:slot.at,end:slot.at,seconds:0,slots:[],apps:new Map()};runs.push(current)}current.end=slot.at+15;current.seconds+=apps.reduce((n,a)=>n+a.seconds,0);const seconds=apps.reduce((n,a)=>n+a.seconds,0),total=slot.apps.reduce((n,a)=>n+a.seconds,0),denominator=Math.max(900,total),before=columns.slice(0,lane).reduce((n,name)=>n+slot.apps.filter(a=>name==='其他'?!major.includes(a.app):a.app===name).reduce((n,a)=>n+a.seconds,0),0);current.slots.push({at:slot.at,seconds,left:before/denominator*100,width:seconds/denominator*100});for(const a of apps)current.apps.set(a.app,(current.apps.get(a.app)||0)+a.seconds)}});
 return {columns,runs};
}
