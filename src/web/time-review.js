import {buildTimeReview,timeReviewRange,validTimeDate} from './time-review-model.js';
import {fmt,parseDate,addDays} from './model.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=n=>n===1440?'24:00':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const duration=n=>n>=60?fmt(n/60)+' 小时':fmt(n)+' 分钟';
const color=value=>/^#[0-9a-f]{3,8}$/i.test(value||'')?value:'#8ba682';
export function createTimeReview(root,{today,onChange,onSelect,onTimeline,onScroll}){
 let model=null,options=null,tip=null,highlighted='',wheelAmount=0,wheelTimer=0;
 const fit=()=>{const days=root.querySelector('.tr-days'),paper=root.querySelector('.tr-paper');if(!days||!root.getBoundingClientRect().width)return;const main=root.closest('main'),bottom=Math.min(innerHeight,main?.getBoundingClientRect().bottom||innerHeight),reserve=paper.getBoundingClientRect().bottom-days.getBoundingClientRect().bottom,available=Math.max(140,bottom-days.getBoundingClientRect().top-reserve-16),rowHeight=Math.max(10,Math.min(27,available/model.rows.length));days.style.height=rowHeight*model.rows.length+'px';days.classList.toggle('is-dense',rowHeight<19);days.style.setProperty('--tr-label-step',rowHeight<19?3:1)};
 const hideTip=()=>{if(tip)tip.hidden=true};
 const request=next=>{hideTip();void onChange(next)};
 const lookup=id=>model.projects.find(p=>p.id===id);
 function paint(cell){
  if(!cell.minutes)return '';
  const level=Math.max(1,Math.ceil(cell.minutes/15*5));
  return cell.parts.map(p=>`<i data-tr-project="${esc(p.projectId)}" class="${p.projectId==='!conflict'?'tr-conflict':options.colorMode==='effort'?'tr-ink tr-level-'+level:''}" style="width:${p.minutes/cell.minutes*100}%;${options.colorMode==='project'?'background:'+color(lookup(p.projectId)?.color):''}"></i>`).join('');
 }
 function summaryHTML(){return model.summary.map((cell,i)=>{
  const parts=(highlighted?cell.parts.filter(p=>p.projectId===highlighted):[...cell.parts]).sort((a,b)=>b.minutes-a.minutes||a.projectId.localeCompare(b.projectId)),minutes=parts.reduce((n,p)=>n+p.minutes,0),denominator=model.rows.length*15;
  const ink=options.colorMode==='project'||highlighted?parts.map(p=>`<i data-tr-project="${esc(p.projectId)}" class="${p.projectId==='!conflict'?'tr-conflict':''}" style="height:${p.minutes/denominator*100}%;background:${color(lookup(p.projectId)?.color)}"></i>`).join(''):`<i class="tr-level-${Math.max(1,Math.ceil(minutes/denominator*5))}" style="height:${minutes/denominator*100}%"></i>`;
  return `<button class="tr-summary-cell" data-tr-cell="${i}" aria-label="${clock(cell.start)}–${clock(cell.start+15)} 日均 ${duration(minutes/model.rows.length)}，累计 ${duration(minutes)}" ${i?'tabindex="-1"':''}><span>${ink}</span></button>`;
 }).join('')}
 function highlight(id){highlighted=id;root.classList.toggle('has-highlight',!!id);root.querySelectorAll('.tr-days [data-tr-project]').forEach(el=>{const active=el.dataset.trProject===id;el.classList.toggle('is-muted',!!id&&!active);el.classList.toggle('is-highlighted',!!id&&active)});root.querySelectorAll('[data-tr-highlight]').forEach(el=>el.classList.toggle('is-muted',!!id&&el.dataset.trHighlight!==id));root.querySelector('.tr-summary-cells').innerHTML=summaryHTML();const minutes=id?model.summary.reduce((n,c)=>n+c.parts.filter(p=>p.projectId===id).reduce((a,p)=>a+p.minutes,0),0):model.visibleMinutes;root.querySelector('.tr-summary-total').textContent=fmt(minutes/60)+'h';wireCells();hideTip()}
 function shiftWindow(days){const start=addDays(options.start,days),end=addDays(options.end,days);if(validTimeDate(start)&&validTimeDate(end))request({start,end,selectedDate:'',scrollTop:0})}
 function cellHTML(cell,index,date,previous,next){
  const id=cell.parts.length===1?cell.parts[0].projectId:'';
  const connected=other=>other?.minutes===15&&cell.minutes===15&&(options.colorMode==='effort'||id&&other.parts.length===1&&other.parts[0].projectId===id);
  const label=`${date} ${clock(cell.start)}–${clock(cell.start+15)}，${cell.minutes?cell.parts.map(p=>(lookup(p.projectId)?.name||'重叠待核对')+' '+duration(p.minutes)).join('，'):'无已确认时间段'}`;
  return `<button type="button" class="tr-cell ${cell.minutes?'has-time':''} ${connected(previous)?'joins-before':''} ${connected(next)?'joins-after':''}" data-tr-date="${date}" data-tr-cell="${index}" aria-label="${esc(label)}" ${index?'tabindex="-1"':''}>${paint(cell)}</button>`;
 }
 function showTip(target){
  const row=target.closest('[data-tr-row]'),index=Number(target.dataset.trCell),cell=row?model.rows.find(r=>r.date===row.dataset.trRow)?.cells[index]:model.summary[index];if(!cell)return;
  if(!tip){tip=document.createElement('div');tip.className='tr-tip';tip.id='time-review-tip';tip.setAttribute('role','tooltip');document.body.append(tip)}
  const date=row?`${row.dataset.trRow} · `:'时段累计 · ';const parts=!row&&highlighted?cell.parts.filter(p=>p.projectId===highlighted):cell.parts,total=parts.reduce((n,p)=>n+p.minutes,0);
  tip.innerHTML=`<small>${esc(date)}</small><div class="tr-tip-heading"><strong>${clock(cell.start)}–${clock(cell.start+15)}</strong><span>${duration(total)}</span></div>${parts.length?`<div class="tr-tip-projects">${parts.map(p=>`<div><i style="background:${color(lookup(p.projectId)?.color)}"></i><span>${esc(lookup(p.projectId)?.name||'重叠待核对')}</span><b>${duration(p.minutes)}</b></div>`).join('')}</div>`:'<p>没有已确认的时间段，不能据此判断这时没有工作。</p>'}${!row?`<p>柱高为 ${model.rows.length} 天的日均值：${duration(total/model.rows.length)}；上限 15 分钟。</p>`:'<p>点击查看当天记录 · 方向键切换时间格</p>'}`;
  tip.hidden=false;const rect=target.getBoundingClientRect(),box=tip.getBoundingClientRect();tip.style.left=Math.max(12,Math.min(rect.left,innerWidth-box.width-12))+'px';tip.style.top=(rect.bottom+box.height+12<innerHeight?rect.bottom+8:Math.max(8,rect.top-box.height-8))+'px';
 }
 function render(state,next,projectIds=[]){
  hideTip();highlighted='';root.classList.remove('has-highlight');options=next;model=buildTimeReview(state,{...next,projectIds});
  const oldTop=root.querySelector('.tr-days')?.scrollTop??next.scrollTop??0,oldLeft=root.querySelector('.tr-scroll')?.scrollLeft??next.scrollLeft??0;
  const first=options.startHour===0?0:8,hours=24-first,slots=hours*4;
  const ticks=Array.from({length:hours+1},(_,i)=>`<span style="left:${i/hours*100}%">${String(first+i).padStart(2,'0')}:00</span>`).join('');
  const rows=model.rows.map(row=>{const d=parseDate(row.date),weekend=[0,6].includes(d.getDay()),weekStart=d.getDay()===1;
   return `<div class="tr-row ${weekend?'is-weekend':''} ${weekStart?'starts-week':''} ${next.selectedDate===row.date?'is-selected':''}" data-tr-row="${row.date}"><button class="tr-day-label" data-tr-date="${row.date}" aria-label="查看 ${row.date} 当日记录"><strong>${Number(row.date.slice(5,7))}.${Number(row.date.slice(8))}</strong><small>${['日','一','二','三','四','五','六'][d.getDay()]}</small></button><div class="tr-cells">${row.cells.map((c,i)=>cellHTML(c,i,row.date,row.cells[i-1],row.cells[i+1])).join('')}</div><span class="tr-day-total" title="全天已确认时长，包括当前横轴未显示的时段">${row.totalMinutes?fmt(row.totalMinutes/60)+'h':'—'}</span></div>`;
  }).join('');
  const legend=next.colorMode==='project'?model.projects.filter(p=>model.usedProjects.includes(p.id)).map(p=>`<button type="button" data-tr-highlight="${esc(p.id)}" aria-label="突出显示 ${esc(p.name)}"><i style="background:${color(p.color)}"></i>${esc(p.name)}</button>`).join(''):`<span><i class="tr-ink tr-level-5"></i>已确认</span>`;
  const side=next.anchorSide==='start'?'start':'end';
  root.innerHTML=`<div class="tr-controls"><div class="tr-presets" aria-label="显示天数">${[['7','一周'],['14','两周'],['30','一个月']].map(([key,label])=>`<button type="button" data-tr-preset="${key}" aria-pressed="${next.preset===key}" class="quiet ${next.preset===key?'active':''}" title="固定显示 ${key} 天">${label}</button>`).join('')}</div><div class="tr-date-fields"><button id="tr-prev" aria-label="前一段日期"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button><input id="tr-start" type="date" min="1900-01-01" max="2200-12-31" value="${next.start}" aria-label="时段开始日期"><span class="tr-date-separator">—</span><input id="tr-end" type="date" min="1900-01-01" max="2200-12-31" value="${next.end}" aria-label="时段结束日期"><button id="tr-next" aria-label="后一段日期"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button></div></div><p id="tr-range-error" class="tr-error" role="alert" hidden></p>
  <div class="tr-overview"><div><span>已定位时间</span><strong>${fmt(model.totalMinutes/60)}<small>小时</small></strong><span class="tr-days-count">${model.recordedDays} / ${model.rows.length} 天</span><p>另有 <b>${fmt(model.unlocatedHours)}</b> 小时未指定时段${model.estimatedHours?'（含估算）':''}${model.missingEstimates?` · ${model.missingEstimates} 条待配置估算`:''}</p></div></div>
  <div class="tr-outside-tools"><div id="tr-project-filter-host" class="filters"></div></div><section class="tr-paper" aria-label="日期与时间段热力图"><div class="tr-chart-tools"><div class="tr-range-caption"><time datetime="${next.start}">${next.start.replaceAll('-','/')}</time><span>—</span><time datetime="${next.end}">${next.end.replaceAll('-','/')}</time></div><div class="tr-display-controls"><button type="button" id="tr-by-project" aria-pressed="${next.colorMode==='project'}" class="quiet ${next.colorMode==='project'?'active':''}">分项目</button><button id="tr-full-day" class="quiet ${first===0?'active':''}" aria-pressed="${first===0}">全天</button></div></div>
  ${model.conflictMinutes?'<p class="tr-outside">部分已确认区间重叠，已去重；项目归属请到记录页核对。</p>':''}
  <div class="tr-scroll" tabindex="0" aria-label="时段图，上下滚动平移日期，左右滚动查看时间"><div class="tr-grid" style="--tr-slots:${slots};--tr-hours:${hours}"><div class="tr-axis-row"><span>日期</span><div class="tr-axis">${ticks}</div><span title="全天已确认时长">全天</span></div><div class="tr-days">${rows}</div>
  <div class="tr-summary"><div class="tr-summary-label"><strong>时段累计</strong></div><div class="tr-cells tr-summary-cells" aria-label="日均时段分布，上限15分钟">${summaryHTML()}</div><span class="tr-day-total tr-summary-total" title="当前横轴内累计时长">${fmt(model.visibleMinutes/60)}h</span><span class="tr-summary-limit">15分</span></div><div class="tr-axis-row tr-bottom-axis"><span></span><div class="tr-axis">${ticks}</div><span></span></div></div></div>
  ${!model.totalMinutes?'<div class="tr-empty"><strong>这段日期还没有已确认的时间段</strong><button id="tr-open-records" class="quiet">去记录时间段 →</button></div>':''}
  <div class="tr-legend">${legend}<span class="tr-blank-key"><i></i>无已确认时间段</span></div></section>`;
  root.querySelector('.tr-days').scrollTop=oldTop;root.querySelector('.tr-scroll').scrollLeft=oldLeft;
  root.querySelectorAll('[data-tr-preset]').forEach(b=>b.onclick=()=>request({...timeReviewRange(b.dataset.trPreset,next[side],side),selectedDate:'',scrollTop:0}));
  root.querySelector('#tr-by-project').onclick=()=>request({colorMode:next.colorMode==='project'?'effort':'project'});
  root.querySelector('#tr-full-day').onclick=()=>request({startHour:first===0?8:0});
  root.querySelector('#tr-prev').onclick=()=>shiftWindow(-model.rows.length);root.querySelector('#tr-next').onclick=()=>shiftWindow(model.rows.length);
  for(const [id,side]of [['tr-start','start'],['tr-end','end']])root.querySelector('#'+id).onchange=e=>{const anchor=e.target.value,notice=root.querySelector('#tr-range-error'),range=validTimeDate(anchor)?timeReviewRange(next.preset,anchor,side):null,valid=range&&validTimeDate(range.start)&&validTimeDate(range.end);notice.hidden=!!valid;if(!valid){notice.textContent='请选择有效日期。';return}request({...range,selectedDate:'',scrollTop:0})};
  root.querySelector('.tr-days').addEventListener('wheel',e=>{if(Math.abs(e.deltaX)>=Math.abs(e.deltaY)||e.ctrlKey||e.metaKey)return;e.preventDefault();wheelAmount+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?200:1);clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{const steps=Math.trunc(wheelAmount/35);wheelAmount=0;if(steps)shiftWindow(Math.max(-model.rows.length,Math.min(model.rows.length,steps)))},100)},{passive:false});
  root.querySelectorAll('[data-tr-highlight]').forEach(b=>{b.onpointerenter=()=>highlight(b.dataset.trHighlight);b.onpointerleave=()=>highlight('');b.onfocus=()=>highlight(b.dataset.trHighlight);b.onblur=()=>highlight('')});
  root.querySelectorAll('[data-tr-date]').forEach(b=>b.onclick=()=>{hideTip();const row=model.rows.find(r=>r.date===b.dataset.trDate),cell=b.dataset.trCell!==undefined?row?.cells[Number(b.dataset.trCell)]:null,id=cell?.parts.length===1&&lookup(cell.parts[0].projectId)?cell.parts[0].projectId:null;void onSelect(b.dataset.trDate,id)});
  wireCells();
  root.querySelector('.tr-days').onscroll=()=>{hideTip();onScroll?.({scrollTop:root.querySelector('.tr-days').scrollTop})};root.querySelector('.tr-scroll').onscroll=()=>{hideTip();onScroll?.({scrollLeft:root.querySelector('.tr-scroll').scrollLeft})};
  requestAnimationFrame(()=>{fit();root.querySelector('.tr-days').scrollTop=oldTop;root.querySelector('.tr-scroll').scrollLeft=oldLeft});
  root.querySelector('#tr-open-records')?.addEventListener('click',()=>onTimeline(next.end));
 }
 function wireCells(){
  root.querySelectorAll('.tr-cell,.tr-summary-cell').forEach(b=>{b.onpointerenter=()=>showTip(b);b.onpointerleave=hideTip;b.onfocus=()=>showTip(b);b.onblur=hideTip;b.onkeydown=e=>{
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const row=b.closest('.tr-row'),items=[...b.parentElement.children],i=items.indexOf(b);let target;
   if(e.key==='Home')target=items[0];else if(e.key==='End')target=items.at(-1);else if(e.key==='ArrowLeft'||e.key==='ArrowRight')target=items[i+(e.key==='ArrowLeft'?-1:1)];else if(row){const sibling=e.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;target=sibling?.querySelectorAll('.tr-cell')[i]}
   if(target){b.tabIndex=-1;target.tabIndex=0;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'})}
  }});
 }
 window.addEventListener('scroll',hideTip,true);window.addEventListener('resize',()=>{hideTip();fit()});
 return {render,hideTip};
}
