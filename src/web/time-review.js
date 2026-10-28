import {buildTimeReview,timeReviewRange,validTimeDate,timeReviewDayCount,TIME_REVIEW_LIMIT} from './time-review-model.js';
import {fmt,parseDate} from './model.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=n=>n===1440?'24:00':`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const duration=n=>n>=60?fmt(n/60)+' 小时':fmt(n)+' 分钟';
const color=value=>/^#[0-9a-f]{3,8}$/i.test(value||'')?value:'#8ba682';
export function createTimeReview(root,{today,onChange,onSelect,onTimeline,onScroll}){
 let model=null,options=null,tip=null;
 const fit=()=>{const days=root.querySelector('.tr-days'),paper=root.querySelector('.tr-paper');if(!days||!root.getBoundingClientRect().width)return;const main=root.closest('main'),bottom=Math.min(innerHeight,main?.getBoundingClientRect().bottom||innerHeight),reserve=paper.getBoundingClientRect().bottom-days.getBoundingClientRect().bottom;days.style.maxHeight=Math.max(140,Math.min(610,bottom-days.getBoundingClientRect().top-reserve-16))+'px'};
 const hideTip=()=>{if(tip)tip.hidden=true};
 const request=next=>{hideTip();void onChange(next)};
 const lookup=id=>model.projects.find(p=>p.id===id);
 function paint(cell,max=15){
  if(!cell.minutes)return '';
  if(options.colorMode==='project')return cell.parts.map(p=>`<i style="width:${p.minutes/cell.minutes*100}%;background:${color(lookup(p.projectId)?.color)}" ${p.projectId==='!conflict'?'class="tr-conflict"':''}></i>`).join('');
  const level=Math.max(1,Math.ceil(cell.minutes/Math.max(1,max)*5));return `<i class="tr-ink tr-level-${level}" style="width:100%"></i>`;
 }
 function cellHTML(cell,index,date,previous,next){
  const id=cell.parts.length===1?cell.parts[0].projectId:'';
  const connected=other=>other?.minutes===15&&cell.minutes===15&&(options.colorMode==='effort'||id&&other.parts.length===1&&other.parts[0].projectId===id);
  const label=`${date} ${clock(cell.start)}–${clock(cell.start+15)}，${cell.minutes?cell.parts.map(p=>(lookup(p.projectId)?.name||'重叠待核对')+' '+duration(p.minutes)).join('，'):'无已确认时间段'}`;
  return `<button type="button" class="tr-cell ${cell.minutes?'has-time':''} ${connected(previous)?'joins-before':''} ${connected(next)?'joins-after':''}" data-tr-date="${date}" data-tr-cell="${index}" aria-label="${esc(label)}" ${index?'tabindex="-1"':''}>${paint(cell)}</button>`;
 }
 function showTip(target){
  const row=target.closest('[data-tr-row]'),index=Number(target.dataset.trCell),cell=row?model.rows.find(r=>r.date===row.dataset.trRow)?.cells[index]:model.summary[index];if(!cell)return;
  if(!tip){tip=document.createElement('div');tip.className='tr-tip';tip.id='time-review-tip';tip.setAttribute('role','tooltip');document.body.append(tip)}
  const date=row?`${row.dataset.trRow} · `:'所选日期累计 · ';
  tip.innerHTML=`<small>${esc(date)}</small><div class="tr-tip-heading"><strong>${clock(cell.start)}–${clock(cell.start+15)}</strong><span>${duration(cell.minutes)}</span></div>${cell.parts.length?`<div class="tr-tip-projects">${cell.parts.map(p=>`<div><i style="background:${color(lookup(p.projectId)?.color)}"></i><span>${esc(lookup(p.projectId)?.name||'重叠待核对')}</span><b>${duration(p.minutes)}</b></div>`).join('')}</div>`:'<p>没有已确认的时间段，不能据此判断这时没有工作。</p>'}${!row?`<p>${cell.days} / ${model.rows.length} 天有时间段；按所选日期计算。</p>`:'<p>点击查看当天记录 · 方向键切换时间格</p>'}`;
  tip.hidden=false;const rect=target.getBoundingClientRect(),box=tip.getBoundingClientRect();tip.style.left=Math.max(12,Math.min(rect.left,innerWidth-box.width-12))+'px';tip.style.top=(rect.bottom+box.height+12<innerHeight?rect.bottom+8:Math.max(8,rect.top-box.height-8))+'px';
 }
 function render(state,next,projectIds=[]){
  hideTip();options=next;model=buildTimeReview(state,{...next,projectIds});
  const oldTop=root.querySelector('.tr-days')?.scrollTop??next.scrollTop??0,oldLeft=root.querySelector('.tr-scroll')?.scrollLeft??next.scrollLeft??0;
  const first=options.startHour===0?0:8,hours=24-first,slots=hours*4,maxSummary=Math.max(1,...model.summary.map(c=>c.minutes));
  const ticks=Array.from({length:hours+1},(_,i)=>`<span style="left:${i/hours*100}%">${String(first+i).padStart(2,'0')}:00</span>`).join('');
  const rows=model.rows.map(row=>{const d=parseDate(row.date),weekend=[0,6].includes(d.getDay()),weekStart=d.getDay()===1;
   return `<div class="tr-row ${weekend?'is-weekend':''} ${weekStart?'starts-week':''} ${next.selectedDate===row.date?'is-selected':''}" data-tr-row="${row.date}"><button class="tr-day-label" data-tr-date="${row.date}" aria-label="查看 ${row.date} 当日记录"><strong>${Number(row.date.slice(5,7))}.${Number(row.date.slice(8))}</strong><small>${['日','一','二','三','四','五','六'][d.getDay()]}</small></button><div class="tr-cells">${row.cells.map((c,i)=>cellHTML(c,i,row.date,row.cells[i-1],row.cells[i+1])).join('')}</div><span class="tr-day-total" title="全天已确认时长，包括当前横轴未显示的时段">${row.totalMinutes?fmt(row.totalMinutes/60)+'h':'—'}</span></div>`;
  }).join('');
  const legend=next.colorMode==='project'?model.projects.filter(p=>model.usedProjects.includes(p.id)).map(p=>`<span><i style="background:${color(p.color)}"></i>${esc(p.name)}</span>`).join(''):`<span>每格 15 分钟</span><span><i class="tr-ink tr-level-5"></i>已确认</span>`;
  root.innerHTML=`<div class="tr-controls"><div class="tr-presets" aria-label="时段日期范围">${[['7','最近一周'],['28','最近四周'],['month','本月'],['custom','自定义']].map(([key,label])=>`<button type="button" data-tr-preset="${key}" aria-pressed="${next.preset===key}" class="quiet ${next.preset===key?'active':''}">${label}</button>`).join('')}</div><div class="tr-date-fields"><label><span class="sr-only">时段开始日期</span><input id="tr-start" type="date" min="1900-01-01" max="2200-12-31" value="${next.start}" aria-label="时段开始日期"></label><span>—</span><label><span class="sr-only">时段结束日期</span><input id="tr-end" type="date" min="1900-01-01" max="2200-12-31" value="${next.end}" aria-label="时段结束日期"></label></div><div class="tr-display-controls"><div class="tr-colors" aria-label="时段颜色"><button type="button" data-tr-color="effort" aria-pressed="${next.colorMode==='effort'}" class="quiet ${next.colorMode==='effort'?'active':''}">投入</button><button type="button" data-tr-color="project" aria-pressed="${next.colorMode==='project'}" class="quiet ${next.colorMode==='project'?'active':''}">项目</button></div><button id="tr-full-day" class="quiet ${first===0?'active':''}" aria-pressed="${first===0}">全天</button></div></div><p id="tr-range-error" class="tr-error" role="alert" hidden></p>
  <div class="tr-overview"><div><span>已定位时间</span><strong>${fmt(model.totalMinutes/60)}<small>小时</small></strong><span class="tr-days-count">${model.recordedDays} / ${model.rows.length} 天</span></div><p>另有 <b>${fmt(model.unlocatedHours)}</b> 小时未指定时段${model.estimatedHours?'（含估算）':''}${model.missingEstimates?` · ${model.missingEstimates} 条待配置估算`:''}</p></div>
  <section class="tr-paper" aria-label="日期与时间段热力图"><div class="tr-paper-heading"><div><h2>时段分布</h2><span>${next.start.replaceAll('-','/')} — ${next.end.replaceAll('-','/')}</span></div><span>${first===0?'00:00':'08:00'}—24:00</span></div>
  ${model.hiddenMinutes?`<p class="tr-outside">08:00 前还有 ${duration(model.hiddenMinutes)}，切换“全天”查看。</p>`:''}${model.conflictMinutes?'<p class="tr-outside">部分已确认区间重叠，已去重；项目归属请到记录页核对。</p>':''}
  <div class="tr-scroll" tabindex="0" aria-label="可横向滚动的时段图"><div class="tr-grid" style="--tr-slots:${slots};--tr-hours:${hours}"><div class="tr-axis-row"><span>日期</span><div class="tr-axis">${ticks}</div><span title="全天已确认时长">全天</span></div><div class="tr-days">${rows}</div>
  <div class="tr-summary"><div class="tr-summary-label"><strong>时段累计</strong><small>所选日期</small></div><div class="tr-cells tr-summary-cells">${model.summary.map((cell,i)=>`<button class="tr-summary-cell" data-tr-cell="${i}" aria-label="${clock(cell.start)}–${clock(cell.start+15)} 累计 ${duration(cell.minutes)}" ${i?'tabindex="-1"':''}><span style="height:${cell.minutes?Math.max(5,cell.minutes/maxSummary*100):3}%">${paint(cell,maxSummary)}</span></button>`).join('')}</div><span class="tr-day-total">${fmt(model.visibleMinutes/60)}h</span></div><div class="tr-axis-row tr-bottom-axis"><span></span><div class="tr-axis">${ticks}</div><span></span></div></div></div>
  ${!model.totalMinutes?'<div class="tr-empty"><strong>这段日期还没有已确认的时间段</strong><p>已有的每日总时长不会自动分配到某个时刻。在“记录”中确认时间段后，这里就会出现。</p><button id="tr-open-records" class="quiet">去记录时间段 →</button></div>':''}
  <div class="tr-legend">${legend}<span class="tr-blank-key"><i></i>无已确认时间段</span></div><p class="tr-footnote">空白不代表没有工作。底部汇总当前横轴内的已确认时间；每日右侧为全天时长。</p></section>`;
  root.querySelector('.tr-days').scrollTop=oldTop;root.querySelector('.tr-scroll').scrollLeft=oldLeft;
  root.querySelectorAll('[data-tr-preset]').forEach(b=>b.onclick=()=>request(b.dataset.trPreset==='custom'?{preset:'custom'}:{...timeReviewRange(b.dataset.trPreset,today),selectedDate:''}));
  root.querySelectorAll('[data-tr-color]').forEach(b=>b.onclick=()=>request({colorMode:b.dataset.trColor}));
  root.querySelector('#tr-full-day').onclick=()=>request({startHour:first===0?8:0});
  for(const id of ['tr-start','tr-end'])root.querySelector('#'+id).onchange=()=>{
   const start=root.querySelector('#tr-start').value,end=root.querySelector('#tr-end').value,notice=root.querySelector('#tr-range-error');
   const valid=validTimeDate(start)&&validTimeDate(end)&&start<=end&&timeReviewDayCount(start,end)<=TIME_REVIEW_LIMIT;
   notice.hidden=valid;if(!valid){notice.textContent='请选择有效的起止日期，范围最多 366 天。';return}request({start,end,preset:'custom',selectedDate:''});
  };
  root.querySelectorAll('[data-tr-date]').forEach(b=>b.onclick=()=>{hideTip();const row=model.rows.find(r=>r.date===b.dataset.trDate),cell=b.dataset.trCell!==undefined?row?.cells[Number(b.dataset.trCell)]:null,id=cell?.parts.length===1&&lookup(cell.parts[0].projectId)?cell.parts[0].projectId:null;void onSelect(b.dataset.trDate,id)});
  root.querySelectorAll('.tr-cell,.tr-summary-cell').forEach(b=>{b.onpointerenter=()=>showTip(b);b.onpointerleave=hideTip;b.onfocus=()=>showTip(b);b.onblur=hideTip;b.onkeydown=e=>{
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const row=b.closest('.tr-row'),items=[...b.parentElement.children],i=items.indexOf(b);let target;
   if(e.key==='Home')target=items[0];else if(e.key==='End')target=items.at(-1);else if(e.key==='ArrowLeft'||e.key==='ArrowRight')target=items[i+(e.key==='ArrowLeft'?-1:1)];else if(row){const sibling=e.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;target=sibling?.querySelectorAll('.tr-cell')[i]}
   if(target){b.tabIndex=-1;target.tabIndex=0;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'})}
  }});
  root.querySelector('.tr-days').onscroll=()=>{hideTip();onScroll?.({scrollTop:root.querySelector('.tr-days').scrollTop})};root.querySelector('.tr-scroll').onscroll=()=>{hideTip();onScroll?.({scrollLeft:root.querySelector('.tr-scroll').scrollLeft})};
  requestAnimationFrame(()=>{fit();root.querySelector('.tr-days').scrollTop=oldTop;root.querySelector('.tr-scroll').scrollLeft=oldLeft});
  root.querySelector('#tr-open-records')?.addEventListener('click',()=>onTimeline(next.end));
 }
 window.addEventListener('scroll',hideTip,true);window.addEventListener('resize',()=>{hideTip();fit()});
 return {render,hideTip};
}
