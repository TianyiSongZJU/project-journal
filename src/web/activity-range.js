import {activitySlots} from './timeline-layout.js';
import {quarterSelection} from './timeline-selection.js';

export function summarizeActivitySlots(slots,start,end){
 const totals=new Map(),devices=new Set();
 for(const slot of slots){
  const overlap=Math.max(0,Math.min(end,slot.at+15)-Math.max(start,slot.at));
  if(!overlap)continue;
  for(const row of slot.apps){
   totals.set(row.app,(totals.get(row.app)||0)+row.seconds*overlap/15);
   for(const item of row.items)devices.add(item.deviceId||item.device||'local');
  }
 }
 const apps=[...totals].map(([app,seconds])=>({app,seconds})).filter(row=>row.seconds>0).sort((a,b)=>b.seconds-a.seconds||a.app.localeCompare(b.app));
 const seconds=apps.reduce((sum,row)=>sum+row.seconds,0);
 return {apps:apps.map(row=>({...row,percent:seconds?row.seconds/seconds*100:0})),seconds,devices:devices.size};
}
export const activityRangeStats=(activities,start,end)=>summarizeActivitySlots(activitySlots(activities,Math.floor(start/15)*15,Math.ceil(end/15)*15),start,end);
export function observedDuration(seconds){
 const value=Math.max(0,seconds);
 if(value>0&&value<60)return '<1分';
 const minutes=Math.round(value/60),h=Math.floor(minutes/60),m=minutes%60;
 return (h?h+'小时':'')+(m?m+'分':'')||'0分';
}
// Both activity reports answer the same questions in the same reading order.
export function activityReportHeader({start,end,seconds,meta='',close=false,esc}){
 const metric=value=>esc(observedDuration(value)).replace(/(小时|分)/g,'<em>$1</em>');
 return `<div class="dt-report-context"><div class="dt-report-period"><time>${time(start)}</time><span aria-hidden="true">—</span><time>${time(end)}</time></div>${meta?`<small>${esc(meta)}</small>`:''}${close?'<button type="button" aria-label="关闭应用时间分布"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>':''}</div><div class="dt-report-metrics"><div><span>观测时长</span><strong>${metric(seconds)}</strong></div><div><span>总时长</span><strong>${metric((end-start)*60)}</strong></div></div>`;
}
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const clientKey=item=>item.deviceId||item.device||'local';

// This brush inspects evidence only. It never creates allocations or saves data.
export function setupActivityRange({root,getActivities,getDay,esc,appColor,hideEvidence,isBusy}){
 let selection=null,gesture=null,guide=null,scroller=null,grid=null,marker=null,panel=null,frame=0;
 function area(client){
  if(client){const column=[...guide.querySelectorAll('[data-client]')].find(el=>el.dataset.client===client);if(column){const a=column.getBoundingClientRect(),g=guide.getBoundingClientRect();return {left:a.left-g.left,width:a.width}}}
  const width=parseFloat(guide.style.getPropertyValue('--dt-activity-width'))||guide.clientWidth*.55;
  return {left:5,width};
 }
 function hide(){if(panel)panel.hidden=true;if(marker)marker.hidden=true}
 function clear(){cancel();selection=null;hide()}
 function place(){
  if(!selection||!panel||panel.hidden||!marker)return;
  const viewport=scroller.getBoundingClientRect(),box=marker.getBoundingClientRect(),r=panel.getBoundingClientRect();
  const right=box.right+12,left=box.left-r.width-12;
  panel.style.left=Math.max(10,Math.min(right+r.width<=innerWidth-10?right:left,innerWidth-r.width-10))+'px';
  panel.style.top=Math.max(10,Math.min(Math.max(viewport.top+8,box.top),innerHeight-r.height-10))+'px';
 }
 function paint(){
  if(!selection||!marker)return;
  const {start,end,client}=selection,scale=Number(grid.dataset.scale),bounds=area(client),origin=Number(grid.dataset.start);
  marker.hidden=false;Object.assign(marker.style,{top:(start-origin)*scale+'px',height:(end-start)*scale+'px',left:bounds.left+'px',width:bounds.width+'px'});
  marker.innerHTML=`<span>${time(start)}–${time(end)}</span>`;
  const activities=gesture?.slots||activitySlots(getActivities().filter(item=>!client||clientKey(item)===client),origin,Number(grid.dataset.end));
  const stats=summarizeActivitySlots(activities,start,end);
  if(!panel){panel=document.createElement('section');panel.className='dt-range-inspector';panel.setAttribute('aria-label','所选时段前台应用排名');document.body.append(panel)}
  panel.hidden=false;
  hideEvidence();
  const formatDuration=seconds=>esc(observedDuration(seconds)).replace(/(小时|分)/g,'<em>$1</em>');
  const meta=[client?selection.clientName||'所选客户端':stats.devices>1?stats.devices+' 端':'',stats.apps.length+' 个应用'].filter(Boolean).join(' · ');
  panel.innerHTML=`<header class="dt-report-header">${activityReportHeader({start,end,seconds:stats.seconds,meta,close:true,esc})}</header>${stats.apps.length?`<ol>${stats.apps.map((row,index)=>`<li style="--app-color:${appColor(row.app)}"><span class="dt-range-rank">${index+1}</span><div class="dt-range-namebar"><div class="dt-range-track" aria-hidden="true"><i style="width:${row.percent}%"></i></div><span class="dt-range-name" title="${esc(row.app)}">${esc(row.app)}</span></div><b class="dt-range-duration">${formatDuration(row.seconds)}</b><small class="dt-range-percent">${row.percent<1?'&lt;1':Math.round(row.percent)}%</small></li>`).join('')}</ol>`:'<p class="dt-range-empty">这个时段暂无前台活动记录</p>'}`;
  panel.querySelector('button').onclick=clear;
  place();
 }
 function cancel(){
  if(!gesture)return;
  const old=gesture;gesture=null;cancelAnimationFrame(frame);frame=0;
  try{old.host.releasePointerCapture(old.pointer)}catch{}
  selection=old.previous;
  root.classList.remove('dt-inspecting');
  if(selection)paint();else hide();
 }
 function mount(){
  cancel();guide=root.querySelector('.dt-guides');scroller=root.querySelector('.dt-scroll');grid=root.querySelector('.dt-grid');if(!guide)return;guide.setAttribute('aria-label','前台活动与文件线索；拖拽前台活动区域查看所选时段的应用排名');
  if(selection&&(selection.day!==getDay()||selection.start<Number(grid.dataset.start)||selection.client&&![...guide.querySelectorAll('[data-client]')].some(el=>el.dataset.client===selection.client)))selection=null;
  marker=document.createElement('div');marker.className='dt-range-brush';marker.hidden=true;marker.setAttribute('aria-hidden','true');guide.append(marker);
  const minute=(y,round=Math.round)=>Math.max(Number(grid.dataset.start),Math.min(Number(grid.dataset.end),round((Number(grid.dataset.start)+(y-guide.getBoundingClientRect().top)/Number(grid.dataset.scale))/15)*15));
  function update(e){
   if(!gesture)return;gesture.last=e;
   const next=quarterSelection(gesture.anchor,minute(e.clientY)),key=next.start+'/'+next.end;
   if(gesture.key===key)return;gesture.key=key;
   selection={...next,day:getDay(),client:gesture.client,clientName:gesture.clientName};paint();
  }
  function scroll(){
   if(!gesture)return;
   const r=scroller.getBoundingClientRect(),y=gesture.last.clientY,delta=y<r.top+30?-Math.min(12,(r.top+30-y)/3):y>r.bottom-30?Math.min(12,(y-r.bottom+30)/3):0;
   if(delta){scroller.scrollTop+=delta;update(gesture.last)}
   frame=requestAnimationFrame(scroll);
  }
  guide.onpointerdown=e=>{
   if(e.button!==0||isBusy())return;
   const r=guide.getBoundingClientRect(),bounds=area(),x=e.clientX-r.left;
   if(x<bounds.left||x>bounds.left+bounds.width||e.target.closest('.dt-file-project'))return;
   e.preventDefault();hideEvidence();
   const column=e.target.closest('[data-client]'),client=column?.dataset.client||'',activities=getActivities().filter(item=>!client||clientKey(item)===client);
   gesture={host:guide,pointer:e.pointerId,anchor:Math.min(Number(grid.dataset.end)-15,minute(e.clientY,Math.floor)),client,clientName:column?.getAttribute('aria-label')?.replace(/的前台活动$/,''),previous:selection,last:e,slots:activitySlots(activities,Number(grid.dataset.start),Number(grid.dataset.end))};
   guide.setPointerCapture(e.pointerId);root.classList.add('dt-inspecting');update(e);frame=requestAnimationFrame(scroll);
  };
  guide.onpointermove=e=>{if(gesture)update(e)};
  guide.onpointerup=e=>{
   if(!gesture)return;update(e);const host=gesture.host,pointer=gesture.pointer;gesture=null;cancelAnimationFrame(frame);frame=0;root.classList.remove('dt-inspecting');try{host.releasePointerCapture(pointer)}catch{}paint();
  };
  guide.onpointercancel=cancel;guide.onlostpointercapture=()=>{if(gesture)cancel()};
  scroller.addEventListener('scroll',place,{passive:true});
  if(selection)paint();else hide();
 }
 function cancelSelection(){if(gesture){cancel();return true}if(selection){clear();return true}return false}
 document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelSelection()});
 window.addEventListener('blur',cancel);
 return {mount,cancelSelection,isOpen:()=>!!panel&&!panel.hidden,hide(){cancel();hide()},isDragging:()=>!!gesture};
}
