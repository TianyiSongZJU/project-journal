// Reorganize existing controls in the native desktop presentation.
// Keep IDs, event handlers, editor contents and persisted data intact.
import {desktopIcon,renderDesktopSaveStatus} from './desktop-icons.js';
const $ = selector => document.querySelector(selector);

export function projectNodeOverview(project) {
  const pending=(project.deadlines||[]).filter(node=>!node.done).sort((a,b)=>a.date.localeCompare(b.date));
  return {pending:pending.length,done:(project.deadlines||[]).length-pending.length,next:pending[0]||null};
}

export function refineDesktopProject(project) {
  const panel=$('#project-deadline-panel');
  if(!panel) return;
  renderDesktopSaveStatus($('#note-status'),'已保存');
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
    const heading=card.querySelector('.deadline-card-heading'),check=heading.querySelector('input');
    const priority=card.querySelector('.priority-badge');
    if(priority)heading.insertBefore(priority,check);
    if(state)heading.insertBefore(state,check);
  });
  let empty=panel.querySelector('.win-deadline-empty');
  if(!empty){empty=document.createElement('p');empty.className='win-deadline-empty';panel.querySelector('.fold-content').append(empty);}
  panel.querySelector('.fold-content>.empty')?.remove();
  empty.hidden=!!panel.querySelector('.deadline-card:not([hidden])');
  empty.textContent=project.deadlines.length?'暂无待完成节点':'还没有截止节点，为项目留一个重要日期。';
}

export function refineDesktopNodes(project) {
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

export function refineDesktopInspector(project) {
  const row=$('.inspector-project-row'),tabs=$('.inspector-tabs');
  if(tabs&&tabs.parentElement!==row)row.append(tabs);
  if((window.journalWindowsHost||window.journalMacHost)&&tabs){
    let view=tabs.querySelector('.windows-inspector-view');
    if(!view){
      view=document.createElement('div');view.className='windows-inspector-view';
      const summary=document.createElement('button');summary.type='button';summary.className='windows-inspector-view-trigger';summary.setAttribute('aria-label','切换记录视图');summary.setAttribute('aria-haspopup','true');summary.setAttribute('aria-expanded','false');
      const close=()=>{view.classList.remove('is-open');summary.setAttribute('aria-expanded','false');};
      const menu=document.createElement('div');menu.className='windows-inspector-view-menu';
      menu.append(...tabs.querySelectorAll('button'));view.append(summary,menu);tabs.append(view);
      view.addEventListener('click',event=>{if(event.target.closest('.windows-inspector-view-trigger')){const open=view.classList.toggle('is-open');summary.setAttribute('aria-expanded',String(open));}else if(event.target.closest('button'))close();});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view.classList.contains('is-open')){event.preventDefault();event.stopImmediatePropagation();const restoreFocus=view.contains(document.activeElement);close();if(restoreFocus)summary.focus();}},true);
      document.addEventListener('pointerdown',event=>{if(!view.contains(event.target))close();});
    }
    view.querySelector('.windows-inspector-view-trigger').textContent=tabs.querySelector('button.active')?.textContent||'当日记录';
  }
  const label=$('#inspector-ddl-panel .inspector-context-heading>span');
  if(label) {
    const text=[...label.childNodes].find(node=>node.nodeType===3);
    if(text)text.textContent='当天截止';
  }
  refineDesktopNodes(project);
  const field=$('#inspector-note'),heading=field.closest('.editor-label').querySelector(':scope>span');
  const clear=$('[data-clear-note="inspector-note"]');
  if(clear) {
    if(clear.parentElement!==heading)heading.insertBefore(clear,heading.querySelector('.markdown-mode'));
    clear.classList.add('win-note-clear','quiet');clear.innerHTML=desktopIcon('trash');clear.setAttribute('aria-label','清除当日备注');
    clear.title='清除当日备注，需要确认';clear.disabled=!field.value;
    if(!clear.dataset.windowsBound) {
      clear.dataset.windowsBound='true';
      field.addEventListener('input',()=>{clear.disabled=!field.value;});
    }
  }
  refineDesktopNotes();
}

let noteLayoutListening=false;
function fitNotePane(){
  const pane=$('#month-inspector');
  if(!pane||!pane.offsetParent)return;
  const top=pane.getBoundingClientRect().top+($('main')?.scrollTop||0);
  pane.style.minHeight=Math.max(320,innerHeight-top-20)+'px';
}
export function refineDesktopNotes(){
  if(!noteLayoutListening){window.addEventListener('resize',fitNotePane);noteLayoutListening=true;}
  requestAnimationFrame(fitNotePane);
  for(const id of ['inspector-note','inspector-project-note','record-note']){
    const input=$('#'+id),editor=input?.closest('.markdown-editor');
    if(!editor||editor.querySelector('.desktop-note-resize'))continue;
    const grip=document.createElement('div');grip.className='desktop-note-resize';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','horizontal');grip.setAttribute('aria-label','调整笔记高度');grip.title='拖动调整高度，双击恢复填满';grip.innerHTML=desktopIcon('resize');editor.append(grip);
    const setHeight=height=>{editor.style.flex='0 0 auto';editor.style.height=Math.max(140,Math.min(4096,height))+'px';};
    const reset=()=>{editor.style.removeProperty('height');editor.style.removeProperty('flex');fitNotePane();};
    let drag=null;
    grip.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();drag={y:event.clientY,height:editor.getBoundingClientRect().height};grip.setPointerCapture(event.pointerId);};
    grip.onpointermove=event=>{if(drag)setHeight(drag.height+event.clientY-drag.y);};
    grip.onpointerup=grip.onpointercancel=()=>{drag=null;};grip.ondblclick=reset;
    grip.onkeydown=event=>{if(['ArrowUp','ArrowDown','Home'].includes(event.key)){event.preventDefault();if(event.key==='Home')reset();else setHeight(editor.getBoundingClientRect().height+(event.key==='ArrowUp'?-24:24));}};
  }
}

export function refineDesktopTime(container,context,row=$('.inspector-project-row')) {
  const editor=container.querySelector('.inspector-time-editor');
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
    const peek=document.createElement('div');peek.id=container.id==='inspector-duration'?'windows-time-peek':'record-time-peek';peek.className='win-time-peek';peek.setAttribute('role','tooltip');
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

export function refineDesktopRecord(){
  const form=$('#record-form'),grid=form.querySelector('.form-grid');
  let row=form.querySelector('.desktop-record-row');
  if(!row){
    row=document.createElement('div');row.className='inspector-project-row desktop-record-row';grid.before(row);
    const label=$('#record-project').closest('label');label.classList.add('inspector-project-label');row.append(label);
    const date=$('#record-date'),dateLabel=date.closest('label');date.setAttribute('aria-label','记录日期');
    form.querySelector('.dialog-heading').insertBefore(date,form.querySelector('.close-dialog'));dateLabel.remove();
    const field=$('#record-note'),heading=field.closest('.editor-label').querySelector(':scope>span'),clear=form.querySelector('[data-clear-note="record-note"]');
    clear.classList.add('win-note-clear','quiet');clear.innerHTML=desktopIcon('trash');clear.setAttribute('aria-label','清除当日备注');clear.title='清除当日备注，需要确认';heading.insertBefore(clear,heading.querySelector('.markdown-mode'));
    field.addEventListener('input',()=>{clear.disabled=!field.value;});
  }
  form.querySelector('[data-clear-note="record-note"]').disabled=!$('#record-note').value;
  refineDesktopTime($('#record-duration'),$('#record-project').value+'/'+$('#record-date').value,row);
  refineDesktopNotes();
}
