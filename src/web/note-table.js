let active;

export function cancelNoteTable() {
 if(!active)return false;
 active();
 return true;
}

function markdownTable(rows,columns) {
 const line=value=>'| '+Array(columns).fill(value).join(' | ')+' |';
 return '\n\n'+[line(''),line('---'),...Array(rows-1).fill(line(''))].join('\n')+'\n\n';
}

export function mountNoteTable(wrap, trigger, live, controller, sourceMode, insertSource) {
 const popup=document.createElement('div');
 popup.className='note-table-popup';
 popup.setAttribute('role','group');
 popup.hidden=true;
 wrap.append(popup);
 let restoreFocus;

 function close(focus=false) {
  if(popup.hidden)return;
  popup.hidden=true;
  popup.replaceChildren();
  trigger.setAttribute('aria-expanded','false');
  document.removeEventListener('pointerdown',outside,true);
  if(active===cancel)active=undefined;
  if(focus)restoreFocus?.();
 }
 function cancel(){close(true)}
 function outside(event){
  if(!popup.contains(event.target)&&!trigger.contains(event.target))close();
 }
 function open(label,x,y,restore) {
  popup.setAttribute('aria-label',label);
  popup.hidden=false;
  restoreFocus=restore;
  const {width,height}=popup.getBoundingClientRect();
  popup.style.left=Math.max(6,Math.min(x,innerWidth-width-6))+'px';
  popup.style.top=Math.max(6,Math.min(y,innerHeight-height-6))+'px';
  active=cancel;
  document.addEventListener('pointerdown',outside,true);
 }
 trigger.onclick=()=>{
  if(trigger.getAttribute('aria-expanded')==='true'){close();return}
  cancelNoteTable();
  const form=document.createElement('form');
  form.innerHTML='<span>行数（含表头）</span><input aria-label="行数（含表头）" name="rows" type="number" min="1" max="50" required value="3"><span>列数</span><input aria-label="列数" name="columns" type="number" min="1" max="20" required value="3"><button type="submit">插入</button>';
  popup.append(form);
  form.onsubmit=event=>{
   event.preventDefault();
   event.stopPropagation();
   const rows=form.elements.rows.valueAsNumber,columns=form.elements.columns.valueAsNumber;
   close();
   if(sourceMode())insertSource(markdownTable(rows,columns));
   else controller.insertTable(rows,columns);
  };
  const {right,bottom}=trigger.getBoundingClientRect();
  open('插入表格',right-186,bottom+5,()=>trigger.focus({preventScroll:true}));
  trigger.setAttribute('aria-expanded','true');
  form.elements.rows.focus({preventScroll:true});
  form.elements.rows.select();
 };

 live.addEventListener('contextmenu',event=>{
  const cell=event.target.closest('td,th');
  if(!cell?.closest('.journal-table-scroll'))return;
  cancelNoteTable();
  const actions=controller.tableActions(cell);
  if(!actions.length)return;
  event.preventDefault();
  event.stopPropagation();
  const display=document.createElement('div');
  display.className='note-table-view-actions';
  display.setAttribute('role','group');
  display.setAttribute('aria-label','显示');
  popup.append(display);
  for(const [label,apply,group] of actions){
   const button=document.createElement('button');
   button.type='button';
   button.textContent=label;
   button.disabled=!apply;
   button.onclick=()=>{close();apply()};
   (group==='view'?display:popup).append(button);
  }
  open('表格行列操作',event.clientX,event.clientY,()=>controller.view?.focus());
  popup.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 },true);

 return close;
}
