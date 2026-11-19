const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const effects={add:'副本新增',change:'两边不同',local:'仅当前有',review:'仅供查看'};
const applicable=item=>item.effect==='change'||item.effect==='add';
function pairs(item){
 const groups=new Map();
 for(const side of ['current','incoming']){
  const seen=new Map();
  for(const {label,value,key,period} of item[side]||[]){
   const n=seen.get(label)||0;seen.set(label,n+1);
   const id=key||JSON.stringify([label,n]);
   if(!groups.has(id))groups.set(id,{label});
   groups.get(id)[side]=value;
   if(period)groups.get(id)[side+'Period']=period;
  }
 }
 const fields=[...groups.values()];
 return item.category==='操作历史'?fields.sort((a,b)=>b.label.localeCompare(a.label)):fields;
}
function inlineDiff(a,b){
 const left=Array.from(a),right=Array.from(b),limit=Math.min(left.length,right.length);
 let start=0,end=0;
 while(start<limit&&left[start]===right[start])start++;
 while(end<limit-start&&left[left.length-1-end]===right[right.length-1-end])end++;
 return [left,right].map(chars=>{
  const last=chars.length-end,change=chars.slice(start,last).join('');
  return esc(chars.slice(0,start).join(''))+(change?'<mark>'+esc(change)+'</mark>':'')+esc(chars.slice(last).join(''));
 });
}
function textDiff(old,next){
 if(old===next)return [esc(old),esc(next)];
 if(!old||!next)return [old?'<mark>'+esc(old)+'</mark>':'',next?'<mark>'+esc(next)+'</mark>':''];
 const a=old.split('\n'),b=next.split('\n');
 let start=0,end=0;
 while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
 while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 const l=a.slice(start,a.length-end),r=b.slice(start,b.length-end),left=[],right=[];
 const pair=(from,to)=>{
  for(let row=0;row<Math.max(from.length,to.length);row++){
   const [x,y]=inlineDiff(from[row]??'',to[row]??'');
   if(row<from.length)left.push(x);
   if(row<to.length)right.push(y);
  }
 };
 const columns=r.length+1;
 // Match unchanged lines between separate edits, with a bound for large notes.
 if(l.length*r.length>120000||!l.length||!r.length)pair(l,r);
 else{
  const lengths=new Uint32Array((l.length+1)*columns);
  for(let i=l.length-1;i>=0;i--)for(let j=r.length-1;j>=0;j--){
   lengths[i*columns+j]=l[i]===r[j]?1+lengths[(i+1)*columns+j+1]:Math.max(lengths[(i+1)*columns+j],lengths[i*columns+j+1]);
  }
  let i=0,j=0,from=0,to=0;
  while(i<l.length&&j<r.length){
   if(l[i]===r[j]){
    pair(l.slice(from,i),r.slice(to,j));left.push(esc(l[i]));right.push(esc(r[j]));from=++i;to=++j;
   }else if(lengths[(i+1)*columns+j]>=lengths[i*columns+j+1])i++;
   else j++;
  }
  pair(l.slice(from),r.slice(to));
 }
 const context=(lines,leading)=>{
  const trimmed=leading?lines.slice(-2):lines.slice(0,2);
  if(trimmed.length<lines.length){if(leading)trimmed.unshift('…');else trimmed.push('…')}
  return trimmed.map(esc);
 };
 return [left,right].map((lines,index)=>[...context((index?b:a).slice(0,start),true),...lines,...context(end?(index?b:a).slice(-end):[],false)].join('\n'));
}
function valueHTML(html,value){
 return value===undefined?'<em>无此项</em>':value===''?'<em>空白</em>':html;
}
function clock(minutes){
 return [Math.floor(minutes/60),minutes%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function periodColor(period){
 return /^#[a-f\d]{6}$/i.test(period.color||'')?period.color:'var(--green)';
}
function periodLabel(period){
 if(!period)return '无此时段';
 const length=period.end-period.start;
 const duration=[Math.floor(length/60)?Math.floor(length/60)+' 小时':'',length%60?length%60+' 分钟':''].filter(Boolean).join(' ');
 return `${clock(period.start)}–${clock(period.end)} · ${period.project} · ${duration}`;
}
function sourceHeading(side,sources){
 const label=side==='current'?'本地':'同步副本';
 return `<strong>${label}</strong><small>${esc(sources[side])}</small>`;
}
function isChanged(field){
 return field.current!==field.incoming||field.currentPeriod?.projectId!==field.incomingPeriod?.projectId||field.currentPeriod?.color!==field.incomingPeriod?.color;
}
function timelineComparison(fields,sources,final=false){
 const groups=new Map();
 for(const field of fields){
  if(!field.currentPeriod&&!field.incomingPeriod)continue;
  if(!groups.has(field.label))groups.set(field.label,[]);
  groups.get(field.label).push(field);
 }
 if(!groups.size)return '';
 const sides=final?['incoming']:['current','incoming'];
 const periods=fields.flatMap(field=>sides.map(side=>field[side+'Period']).filter(Boolean));
 if(!periods.length)return '';
 const first=Math.min(...periods.map(p=>p.start)),last=Math.max(...periods.map(p=>p.end));
 const interval=[15,30,60,120,180,240].find(n=>n*5>=last-first+15)||360;
 const start=Math.floor(first/interval)*interval,end=Math.min(1440,Math.max(start+interval,Math.ceil(last/interval)*interval));
 const offset=minutes=>100*(minutes-start)/(end-start);
 const lanes=(rows,side)=>`<div class="merge-timeline-lane" data-side="${side}"><div class="merge-lane-source">${sourceHeading(side,sources)}</div><div class="merge-lane-track">${ticks.slice(1,-1).map(t=>`<b aria-hidden="true" style="--tick-left:${offset(t)}%"></b>`).join('')}${rows.map(row=>{
  const p=row[side+'Period'];
  return p?`<i class="${isChanged(row)?'is-changed':''}" style="--period-left:${offset(p.start)}%;--period-width:${offset(p.end)-offset(p.start)}%;--period-color:${periodColor(p)}" title="${esc(periodLabel(p))}"></i>`:'';
 }).join('')}${rows.some(row=>row[side+'Period'])?'':'<em>无时段</em>'}</div></div>`;
 const ticks=[];
 for(let t=start;t<=end;t+=interval)ticks.push(t);
 if(ticks.at(-1)!==end)ticks.push(end);
 const scale=`<div class="merge-timeline-axis"><div class="merge-timeline-ticks">${ticks.map(t=>`<span style="--tick-left:${offset(t)}%">${clock(t)}</span>`).join('')}</div></div>`;
 return `<div class="merge-timeline">${[...groups].map(([label,rows])=>{
  const visible=final?rows.filter(row=>row.incomingPeriod):rows;
  if(!visible.length)return '';
  return `<section class="merge-period"><h3>${esc(label)}</h3>${scale}${sides.map(side=>lanes(visible,side)).join('')}<ul class="merge-period-changes">${visible.filter(row=>final||isChanged(row)).map(({currentPeriod:a,incomingPeriod:b})=>{
   if(final)return `<li>${esc(periodLabel(b))}</li>`;
   const id=p=>a?.project===b?.project&&a?.projectId!==b?.projectId&&p?.projectId?' · '+p.projectId:'';
   return `<li><strong>${esc(periodChanges(a,b))}</strong><span>本地 ${esc(periodLabel(a)+id(a))}</span><span>副本 ${esc(periodLabel(b)+id(b))}</span></li>`;
  }).join('')}</ul></section>`;
 }).join('')}</div>`;
}
function periodChanges(left,right){
 if(!left||!right)return left?'仅当前有':'仅副本有';
 return [
  left.start!==right.start?'开始时间':'',
  left.end!==right.end?'结束时间':'',
  left.projectId!==right.projectId?'所属项目':left.project!==right.project?'项目名称':left.color!==right.color?'项目颜色':''
 ].filter(Boolean).join('、');
}
function comparisonFields(fields,sources,full=false){
 if(!fields.length)return '';
 const columns=`<div class="merge-columns merge-column-labels" aria-label="版本来源"><div data-side="current">${sourceHeading('current',sources)}</div><div data-side="incoming">${sourceHeading('incoming',sources)}</div></div>`;
 const rows=fields.map(({label,current,incoming})=>{
  const [a,b]=full?[esc(current),esc(incoming)]:textDiff(current,incoming);
  const swatch=value=>label==='颜色'&&/^#[a-f\d]{6}$/i.test(value||'')?`<i class="merge-swatch" style="--merge-swatch:${value}" aria-hidden="true"></i>`:'';
  return `<div class="merge-field"><span>${esc(label)}</span><div class="merge-columns"><div class="merge-value" aria-label="本地">${swatch(current)}${valueHTML(a,current)}</div><div class="merge-value" aria-label="同步副本 ${esc(sources.incoming)}">${swatch(incoming)}${valueHTML(b,incoming)}</div></div></div>`;
 }).join('');
 return `<div class="merge-side-by-side">${columns}${rows}</div>`;
}
function plainFields(fields){
 return fields.filter(field=>!field.currentPeriod&&!field.incomingPeriod);
}
function compareHTML(item,sources){
 const fields=pairs(item),plain=plainFields(fields),changed=plain.filter(isChanged);
 return timelineComparison(fields,sources)+(changed.length?comparisonFields(changed,sources):fields.some(isChanged)?'':'<p class="hint">两边可比较的字段一致。</p>')+
  (plain.length?'<details class="merge-context" data-ui-panel="merge-context"><summary>查看两边完整字段</summary></details>':'')+
  (item.notice?'<p class="hint merge-notice">'+esc(item.notice)+'</p>':'')+
  (item.requires?.length?'<p class="hint merge-notice">采用副本时会同时选中所属项目。</p>':'');
}
function resultHTML(item,sources){
 const fields=(item.incoming||[]).filter(field=>!field.period);
 const values=fields.map(({label,value})=>`<div class="merge-field"><span>${esc(label)}</span><div class="merge-value">${valueHTML(esc(value),value)}</div></div>`).join('');
 return timelineComparison(pairs(item),sources,true)+values+(item.notice?'<p class="hint merge-notice">'+esc(item.notice)+'</p>':'');
}
async function request(url,options){
 const response=await fetch(url,{cache:'no-store',...options}),payload=await response.json();
 if(!response.ok)throw Error(response.status===409?'当前数据或同步副本已变化。请重新对比，再作选择。':payload.error||'读取对比失败');
 return payload;
}
export function setupSyncMerge({prepare,afterApply,toast}){
 const dialog=document.createElement('dialog');dialog.id='sync-merge-dialog';dialog.setAttribute('aria-labelledby','sync-merge-title');
 dialog.innerHTML=`<div class="dialog-heading"><h2 id="sync-merge-title">核对同步差异</h2><button type="button" class="quiet merge-close" aria-label="关闭对比">×</button></div>
 <div class="merge-columns merge-sources"></div>
 <p class="hint merge-help">逐项选择要保留哪一边。默认保留当前数据，采用副本会替换该项的内容。</p>
 <div class="merge-toolbar"><label>类型<select aria-label="差异类型"></select></label><span class="merge-count" aria-live="polite"></span></div>
 <div class="merge-list"></div><p class="merge-error hint" role="status" hidden></p>
 <div class="dialog-actions"><button type="button" class="merge-cancel">取消</button><button type="button" class="primary merge-apply" disabled>核对合并结果</button></div>`;
 document.body.append(dialog);
 const find=s=>dialog.querySelector(s),list=find('.merge-list'),filter=find('select'),apply=find('.merge-apply'),error=find('.merge-error'),selected=new Set();
 let preview=null,copy=null,busy=false,opening=false,confirming=false,savedScroll=0;
 const close=()=>{if(!busy)dialog.close()};
 find('.merge-close').onclick=close;
 find('.merge-cancel').onclick=()=>{if(confirming){confirming=false;draw();list.scrollTop=savedScroll;apply.focus()}else close()};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 function refresh(){
  const count=selected.size;
  apply.disabled=busy||!count;
  apply.textContent=busy?'正在写入…':confirming?`确认写入 ${count} 项`:`核对合并结果${count?' · '+count+' 项':''}`;
  find('.merge-count').textContent=preview?`${preview.items.length} 项差异${apply.hidden?"":" · 采用副本 "+count+" 项"}`:'';
  for(const button of list.querySelectorAll('[data-merge-choice]')){
   button.setAttribute('aria-pressed',String(selected.has(button.dataset.mergeItem)===(button.dataset.mergeChoice==='incoming')));
   button.disabled=busy;
  }
  find('.merge-cancel').disabled=busy;find('.merge-close').disabled=busy;
 }
 function choose(id,on){
  if(on){selected.add(id);for(const dep of preview.items.find(item=>item.id===id).requires||[])selected.add(dep)}
  else{selected.delete(id);for(const item of preview.items)if(item.requires?.includes(id))selected.delete(item.id)}
  refresh();
 }
 function draw(){
  const rows=preview.items.filter(item=>confirming?selected.has(item.id):!filter.value||item.category===filter.value);
  find('#sync-merge-title').textContent=confirming?'确认要写入的内容':'核对同步差异';
  find('.merge-help').textContent=confirming?'下面是将采用的副本内容。其余内容会保留当前数据，同步副本会保留。':'逐项选择要保留哪一边。默认保留当前数据，采用副本会替换该项的内容。';
  const canApply=preview.items.some(applicable);
  apply.hidden=!canApply;
  filter.parentElement.hidden=confirming||filter.options.length<3;
  find('.merge-help').hidden=!confirming&&!canApply;
  find('.merge-cancel').textContent=confirming?"返回修改":canApply?"取消":"关闭";
  list.innerHTML=rows.length?rows.map(item=>`<article class="merge-item"><div class="merge-item-heading"><div class="merge-item-title"><strong>${esc(item.title)}</strong>${item.context?`<small>${esc(item.context)}</small>`:""}</div><small>${esc(item.category)}</small><span class="merge-effect" data-effect="${item.effect}">${confirming?(item.effect==='add'?'将新增':'将替换'):effects[item.effect]}</span></div><details class="merge-difference" data-ui-panel="merge-difference"><summary>${confirming?'写入后的内容':'查看内容差异'}</summary><div class="merge-detail"></div></details>${!confirming&&applicable(item)?`<div class="merge-choices" role="group" aria-label="${esc(item.title)}"><button type="button" data-merge-item="${esc(item.id)}" data-merge-choice="current">${item.effect==='add'?'跳过新增':'保留本地'}</button><button type="button" data-merge-item="${esc(item.id)}" data-merge-choice="incoming" title="${esc(copy.name)}">${item.effect==='add'?'从副本新增':'采用副本'}</button></div>`:''}</article>`).join(''):'<p class="empty">可比较的内容一致。</p>';
  const sources={current:preview.currentFile||'当前应用中的记录',incoming:copy.name};
  function show(details,item){
   if(details.dataset.ready)return;
   details.querySelector('.merge-detail').innerHTML=confirming?resultHTML(item,sources):compareHTML(item,sources);
   const context=details.querySelector('.merge-context');
   if(context)context.ontoggle=()=>{if(context.open&&!context.dataset.ready){context.insertAdjacentHTML('beforeend',comparisonFields(plainFields(pairs(item)),sources,true));context.dataset.ready='true'}};
   details.dataset.ready='true';
  }
  list.querySelectorAll('.merge-difference').forEach((details,i)=>{
   details.ontoggle=()=>{if(details.open)show(details,rows[i])};
   if(i===0){details.open=true;show(details,rows[i])}
  });
  refresh();
 }
 list.onclick=event=>{const button=event.target.closest('[data-merge-choice]');if(button)choose(button.dataset.mergeItem,button.dataset.mergeChoice==='incoming')};
 filter.onchange=draw;
 apply.onclick=async()=>{
  if(busy||!preview||!selected.size)return;
  error.hidden=true;
  if(!confirming){savedScroll=list.scrollTop;confirming=true;draw();list.scrollTop=0;apply.focus();return}
  busy=true;refresh();
  try{
   if(!await prepare())throw Error('当前编辑尚未保存，请先处理保存提示。');
   await request('/api/sync-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:copy.name,revision:preview.revision,sourceRevision:preview.sourceRevision,items:[...selected]})});
   dialog.close();await afterApply();toast('已写入确认的合并内容');
  }catch(e){error.textContent=e.message;error.hidden=false;if(!dialog.open)toast(e.message,true)}
  finally{busy=false;refresh()}
 };
 return async candidate=>{
  if(opening||busy||dialog.open)return;opening=true;
  try{
   if(!await prepare())return;
   const data=await request('/api/sync-merge?name='+encodeURIComponent(candidate.name));
   preview=data;copy=candidate;selected.clear();error.hidden=true;confirming=false;
   find('.merge-sources').innerHTML=`<div><strong>本地</strong><small>${esc(data.currentFile||'当前应用中的记录')}</small></div><div><strong>同步副本</strong><small>${esc(candidate.name)}</small></div>`;
   filter.innerHTML='<option value="">全部类型</option>'+[...new Set(data.items.map(item=>item.category))].map(kind=>`<option>${esc(kind)}</option>`).join('');
   draw();list.scrollTop=0;dialog.showModal();
  }catch(e){toast(e.message,true)}finally{opening=false}
 };
}
