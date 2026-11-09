const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const effects={add:'可新增',change:'内容不同',local:'仅当前版本',review:'仅供对比'};
function pairs(item){
 const current=item.current||[],incoming=item.incoming||[],groups=new Map();
 for(const [side,fields] of [['current',current],['incoming',incoming]]){
  const seen=new Map();
  for(const {label,value} of fields){const n=seen.get(label)||0;seen.set(label,n+1);const id=JSON.stringify([label,n]);if(!groups.has(id))groups.set(id,{label});groups.get(id)[side]=value}
 }
 return [...groups.values()];
}
function textDiff(old,next){
 if(old===next)return [esc(old),esc(next)];
 if(!old||!next)return [esc(old),esc(next)];
 const a=old.split('\n'),b=next.split('\n');let start=0,end=0;
 while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
 while(end<Math.min(a.length,b.length)-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 const format=lines=>lines.map((line,i)=>i>=start&&i<lines.length-end?'<mark>'+esc(line||' ')+'</mark>':esc(line)).join('\n');
 return [format(a),format(b)];
}
function compareHTML(item){
 const cell=(html,value)=>value===undefined?'<em>没有此项</em>':value===''?'<em>空白</em>':html;
 return '<div class="merge-columns"><span>当前版本</span><span>同步副本</span></div>'+pairs(item).map(({label,current,incoming})=>{
  const [a,b]=textDiff(current,incoming);return `<div class="merge-field ${current===incoming?'':'is-changed'}"><span>${esc(label)}</span><div class="merge-columns"><div class="merge-value">${cell(a,current)}</div><div class="merge-value">${cell(b,incoming)}</div></div></div>`;
 }).join('')+(item.notice?'<p class="hint merge-notice">'+esc(item.notice)+'</p>':'')+(item.requires?.length?'<p class="hint merge-notice">应用此项时会同时选中所需的新增项目。</p>':'');
}
async function request(url,options){
 const response=await fetch(url,{cache:'no-store',...options}),payload=await response.json();
 if(!response.ok)throw Error(response.status===409?'当前版本或副本已经变化。请重新对比，再选择要应用的内容。':payload.error||'读取对比失败');
 return payload;
}
export function setupSyncMerge({prepare,afterApply,toast}){
 const dialog=document.createElement('dialog');dialog.id='sync-merge-dialog';dialog.setAttribute('aria-labelledby','sync-merge-title');
 dialog.innerHTML=`<div class="dialog-heading"><div><h2 id="sync-merge-title">对比并合并</h2><p class="hint merge-source"></p></div><button type="button" class="quiet merge-close" aria-label="关闭对比">×</button></div>
 <p class="hint merge-help">勾选要从副本应用的差异。仅当前版本有的记录会保留；合并后副本仍可继续核对。设置、采集线索和操作历史不参与对比。</p>
 <div class="merge-toolbar"><label>类型<select aria-label="差异类型"></select></label><span class="merge-count" aria-live="polite"></span></div>
 <div class="merge-list"></div><p class="merge-error hint" role="status" hidden></p>
 <div class="dialog-actions"><button type="button" class="merge-cancel">取消</button><button type="button" class="primary merge-apply" disabled>应用选中项</button></div>`;
 document.body.append(dialog);
 const find=s=>dialog.querySelector(s),list=find('.merge-list'),filter=find('select'),apply=find('.merge-apply'),error=find('.merge-error'),selected=new Set();
 let preview=null,copy=null,busy=false,opening=false;
 const close=()=>{if(!busy)dialog.close()};
 find('.merge-close').onclick=close;find('.merge-cancel').onclick=close;
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 function refresh(){
  const count=selected.size;apply.disabled=busy||!count;
  apply.textContent=busy?'正在应用…':count?`应用 ${count} 项`:'应用选中项';
  find('.merge-count').textContent=preview?`${preview.items.length} 处差异 · 已选 ${count} 项`:'';
  list.querySelectorAll('[data-merge-item]').forEach(input=>{input.checked=selected.has(input.dataset.mergeItem);input.disabled=busy});
  find('.merge-cancel').disabled=busy;find('.merge-close').disabled=busy;
 }
 function choose(id,on){
  if(on){selected.add(id);for(const dep of preview.items.find(item=>item.id===id).requires||[])selected.add(dep)}
  else{selected.delete(id);for(const item of preview.items)if(item.requires?.includes(id))selected.delete(item.id)}
  refresh();
 }
 function draw(){
  const rows=preview.items.filter(item=>!filter.value||item.category===filter.value);
  list.innerHTML=rows.length?rows.map(item=>`<article class="merge-item"><div class="merge-item-heading">${item.effect==='change'||item.effect==='add'?`<input type="checkbox" data-merge-item="${esc(item.id)}" aria-label="应用：${esc(item.title)}">`:''}<strong>${esc(item.title)}</strong><small>${esc(item.category)}</small><span class="merge-effect" data-effect="${item.effect}">${effects[item.effect]}</span></div><details data-ui-panel="merge-difference"><summary>查看差异</summary><div class="merge-detail"></div></details></article>`).join(''):'<p class="empty">没有可显示的记录差异。</p>';
  list.querySelectorAll('details').forEach((details,i)=>details.ontoggle=()=>{if(details.open&&!details.dataset.ready){details.querySelector('.merge-detail').innerHTML=compareHTML(rows[i]);details.dataset.ready='true'}});
  list.querySelectorAll('[data-merge-item]').forEach(input=>input.onchange=()=>choose(input.dataset.mergeItem,input.checked));
  if(rows.length){const first=list.querySelector('details');first.open=true;first.querySelector('.merge-detail').innerHTML=compareHTML(rows[0]);first.dataset.ready='true'}
  refresh();
 }
 filter.onchange=draw;
 apply.onclick=async()=>{
  if(busy||!preview||!selected.size)return;busy=true;error.hidden=true;refresh();
  try{
   if(!await prepare())throw Error('当前编辑尚未保存，请处理保存提示后再试。');
   await request('/api/sync-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:copy.name,revision:preview.revision,sourceRevision:preview.sourceRevision,items:[...selected]})});
   dialog.close();await afterApply();toast('已应用选中的差异，副本仍保留');
  }catch(e){error.textContent=e.message;error.hidden=false;if(!dialog.open)toast(e.message,true)}
  finally{busy=false;refresh()}
 };
 return async candidate=>{
  if(opening||busy||dialog.open)return;opening=true;
  try{
   if(!await prepare())return;
   const data=await request('/api/sync-merge?name='+encodeURIComponent(candidate.name));
   preview=data;copy=candidate;selected.clear();error.hidden=true;find('.merge-source').textContent=candidate.name;
   filter.innerHTML='<option value="">全部类型</option>'+[...new Set(data.items.map(item=>item.category))].map(kind=>`<option>${esc(kind)}</option>`).join('');
   draw();dialog.showModal();
  }catch(e){toast(e.message,true)}finally{opening=false}
 };
}
