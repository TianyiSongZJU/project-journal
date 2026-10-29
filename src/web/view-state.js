import {sanitizeTimeReview} from './time-review-model.js';
import {dateKey} from './model.js';
import {sanitizeUIPreferences} from './ui-preferences.js';
// Local UI preferences survive changing server ports and non-persistent native web caches.
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function validViewDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01'||v>'2200-12-31')return false;const d=new Date(v+'T12:00:00');return !isNaN(d)&&d.getFullYear()===Number(v.slice(0,4))&&d.getMonth()+1===Number(v.slice(5,7))&&d.getDate()===Number(v.slice(8))}
export function sanitizeViewState(raw={},ids=[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
 const out={page:['review','projects','auto','settings'].includes(raw.page)?raw.page:'review',mode:['month','time'].includes(raw.mode)?raw.mode:'year'};
 if(finite(raw.viewYear,1900,2200)&&Number.isInteger(raw.viewYear))out.viewYear=raw.viewYear;
 if(typeof raw.viewMonth==='string'&&validViewDate(raw.viewMonth+'-01'))out.viewMonth=raw.viewMonth;
 for(const key of ['date','rangeStart','rangeEnd'])if(validViewDate(raw[key]))out[key]=raw[key];
 for(const key of ['currentProject','inspectorProject'])out[key]=ids.includes(raw[key])?raw[key]:null;
 out.inspectorTab=raw.inspectorTab==='note'?'note':'daily';out.totalUnit=raw.totalUnit==='days'?'days':'hours';out.reviewDeselected=raw.reviewDeselected===true;
 out.filterIds=Array.isArray(raw.filterIds)?[...new Set(raw.filterIds.filter(id=>ids.includes(id)))]:[];
 out.scroll={};for(const key of ['main','year','month'])if(finite(raw.scroll?.[key],0,1e7))out.scroll[key]=raw.scroll[key];
 out.timeReview=sanitizeTimeReview(raw.timeReview,dateKey(new Date()));
 out.ui=sanitizeUIPreferences(raw.ui,ids);
 out.timeline={};const t=raw.timeline||{};
 if(validViewDate(t.date))out.timeline.date=t.date;
 if(finite(t.visibleHours,1,24))out.timeline.visibleHours=Math.round(t.visibleHours);
 if(finite(t.scrollMinute,0,1440))out.timeline.scrollMinute=t.scrollMinute;
 if(typeof t.compare==='boolean')out.timeline.compare=t.compare;
 if(Array.isArray(t.hiddenClients))out.timeline.hiddenClients=[...new Set(t.hiddenClients.filter(x=>typeof x==='string'&&x.length<=200))].slice(0,100);
 for(const key of ['fullDay','showSuggestions'])if(typeof t[key]==='boolean')out.timeline[key]=t[key];
 if(ids.includes(t.defaultProject))out.timeline.defaultProject=t.defaultProject;
 return out;
}
export function createViewMemory(getSnapshot,fetcher=(...args)=>fetch(...args)){
 let enabled=false,timer=null,writing=Promise.resolve(true),lastQueued='';
 async function load(){try{const res=await fetcher('/api/view-state');return res.ok?await res.json():{}}catch{return {}}}
 function schedule(){if(!enabled)return;clearTimeout(timer);timer=setTimeout(()=>void flush(),250)}
 function flush(keepalive=false){
  clearTimeout(timer);if(!enabled)return writing;
  const body=JSON.stringify(getSnapshot());if(body===lastQueued)return writing;lastQueued=body;
  writing=writing.then(async()=>{try{const res=await fetcher('/api/view-state',{method:'PUT',headers:{'Content-Type':'application/json'},body,keepalive});if(!res.ok){if(lastQueued===body)lastQueued='';return false}return true}catch{if(lastQueued===body)lastQueued='';return false}});
  return writing;
 }
 return {load,schedule,flush,enable(){enabled=true}};
}
