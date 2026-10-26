// Reorganize existing controls only in the native Windows presentation.
// Keep IDs, event handlers, editor contents and persisted data intact.
const $ = selector => document.querySelector(selector);

export function projectNodeOverview(project) {
  const pending=(project.deadlines||[]).filter(node=>!node.done).sort((a,b)=>a.date.localeCompare(b.date));
  return {pending:pending.length,done:(project.deadlines||[]).length-pending.length,next:pending[0]||null};
}

export function refineWindowsProject(project) {
  const panel=$('#project-deadline-panel');
  if(!panel) return;
  const summary=panel.querySelector(':scope>summary'), add=$('#new-deadline'), toggle=$('#project-show-done-deadlines');
  if(!add.dataset.windowsPlaced) {
    add.dataset.windowsPlaced='true'; add.classList.add('quiet','win-node-add');
    add.textContent='＋ 添加节点';
    add.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
    summary.append(add);
    panel.querySelector('.section-heading')?.remove();
  }
  const info=projectNodeOverview(project);
  toggle.hidden=!info.done;
  toggle.textContent=(toggle.getAttribute('aria-pressed')==='true'?'收起已完成':'已完成')+' '+info.done;
  const meta=summary.querySelector('.fold-meta');
  meta.textContent=info.pending?info.pending+' 个待完成':'';
  panel.querySelectorAll('.deadline-card').forEach(card=>{
    const state=card.querySelector(':scope>.deadline-state');
    if(state)card.querySelector('.deadline-meta').prepend(state);
  });
  let empty=panel.querySelector('.win-deadline-empty');
  if(!empty){empty=document.createElement('p');empty.className='win-deadline-empty';panel.querySelector('.fold-content').append(empty);}
  panel.querySelector('.fold-content>.empty')?.remove();
  empty.hidden=!!panel.querySelector('.deadline-card:not([hidden])');
  empty.textContent=project.deadlines.length?'暂无待完成节点':'还没有截止节点，为项目留一个重要日期。';
}

export function refineWindowsNodes(project) {
  const panel=$('#inspector-project-ddl-panel');
  if(!panel) return;
  let section=$('#windows-project-nodes');
  if(!section) {
    section=document.createElement('section');section.id='windows-project-nodes';
    const heading=document.createElement('div');heading.className='win-node-heading';
    const title=document.createElement('span');title.className='win-node-title';title.textContent='\u9879\u76ee\u8282\u70b9';
    const count=document.createElement('small');count.className='win-node-count';
    heading.append(title,count,$('#inspector-show-done-deadlines'),$('#inspector-add-deadline'));
    heading.querySelector('#inspector-add-deadline').classList.add('quiet','win-node-add');
    section.append(heading,panel);
    const fields=$('#inspector-daily-fields');fields.insertBefore(section,fields.querySelector('.editor-label'));
  }
  section.dataset.projectId=project.id;
  const info=projectNodeOverview(project);
  section.querySelector('.win-node-count').textContent=info.pending?info.pending+' \u4e2a\u5f85\u5b8c\u6210':info.done?'\u5168\u90e8\u5b8c\u6210':'\u672a\u8bbe\u7f6e';
  panel.hidden=!panel.querySelector('.inspector-project-node');
  const toggle=$('#inspector-show-done-deadlines');
  toggle.textContent=(toggle.getAttribute('aria-pressed')==='true'?'\u6536\u8d77\u5df2\u5b8c\u6210':'\u5df2\u5b8c\u6210')+(info.done?' '+info.done:'');
}

export function refineWindowsInspector(project) {
  const row=$('.inspector-project-row'),tabs=$('.inspector-tabs');
  if(tabs&&tabs.parentElement!==row)row.append(tabs);
  const label=$('#inspector-ddl-panel .inspector-context-heading>span');
  if(label) {
    const text=[...label.childNodes].find(node=>node.nodeType===3);
    if(text)text.textContent='当天截止';
  }
  refineWindowsNodes(project);
  const field=$('#inspector-note'),heading=field.closest('.editor-label').querySelector(':scope>span');
  const clear=$('[data-clear-note="inspector-note"]');
  if(clear) {
    if(clear.parentElement!==heading)heading.insertBefore(clear,heading.querySelector('.markdown-mode'));
    clear.classList.add('win-note-clear','quiet');clear.textContent='清除备注';
    clear.title='清除当日备注，需要确认';clear.disabled=!field.value;
    if(!clear.dataset.windowsBound) {
      clear.dataset.windowsBound='true';
      field.addEventListener('input',()=>{clear.disabled=!field.value;});
    }
  }
}

export function refineWindowsTime(container,context) {
  const row=$('.inspector-project-row'),editor=container.querySelector('.inspector-time-editor');
  const summary=editor.querySelector('summary'),value=summary.querySelector('strong');
  const other=value.innerHTML,total=container.querySelector('.time-source-summary strong').innerHTML;
  if(container.dataset.context!==context)editor.open=false;
  container.dataset.context=context;
  if(container.parentElement!==row)row.insertBefore(container,row.querySelector('.inspector-tabs'));
  let breakdown=container.querySelector('.win-time-breakdown');
  if(!breakdown) {
    const panel=editor.querySelector('.inspector-time-popover');
    breakdown=document.createElement('div');breakdown.className='win-time-breakdown';
    const otherRow=document.createElement('div');otherRow.className='win-time-other';otherRow.innerHTML='<span>其他已记</span><strong></strong>';
    breakdown.append(container.querySelector('.duration-timeline'),otherRow);panel.prepend(breakdown);
    const heading=panel.querySelector('.duration-heading>span');heading.textContent='修改其他已记';
    const peek=document.createElement('div');peek.id='windows-time-peek';peek.className='win-time-peek';peek.setAttribute('role','tooltip');
    peek.innerHTML='<div><span>时间线已记</span><strong></strong></div><div><span>其他已记</span><strong></strong></div><small>当前项目当天投入 · 点击修改</small>';
    container.append(peek);
    summary.setAttribute('aria-describedby',peek.id);
  }
  value.innerHTML=total;
  summary.removeAttribute('title');summary.setAttribute('aria-label','当前项目当天投入 '+value.textContent+'，点击修改其他已记');
  breakdown.querySelector('.win-time-other strong').innerHTML=other;
  const peekValues=container.querySelectorAll('.win-time-peek strong');
  peekValues[0].innerHTML=breakdown.querySelector('.duration-timeline strong').innerHTML;
  peekValues[1].innerHTML=other;
}
