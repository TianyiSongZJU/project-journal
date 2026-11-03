import {applyMarkdownKey} from './markdown-input.js';
let editing=null,boundaryInstalled=false;

// Source offsets stay authoritative. Only the paragraph under the caret is a
// textarea, so rendering never rewrites the caret or composition in progress.
export function markdownBlocks(source){
 const lines=source.match(/[^\n]*(?:\n|$)/g)||[''];if(lines.at(-1)==='')lines.pop();const blocks=[];let start=0,offset=0,fence=null;
 for(const line of lines){const trimmed=line.trim(),marker=trimmed.match(/^(`{3,}|~{3,})/)?.[1]||(trimmed==='$$'?'$$':null);
  if(marker){if(!fence)fence=marker;else if(marker===fence||marker[0]===fence[0]&&marker.length>=fence.length)fence=null}
  offset+=line.length;
  if(!fence&&!trimmed){if(offset>start)blocks.push({start,end:offset});start=offset}
 }
 if(offset>start||!blocks.length)blocks.push({start,end:offset});if(source.endsWith('\n\n'))blocks.push({start:offset,end:offset});return blocks;
}
export function createLiveMarkdown(input,container,render,shortcut){
 let active=null,busy=false,known=input.value,lastCaret=known.length,history=[],future=[],lastEdit=0,lastEditKind='',pointerFocus=false,paintedSource=null;
 const notify=()=>input.dispatchEvent(new Event('input',{bubbles:true}));
 const resize=()=>{if(!active)return;const field=active.field;field.style.height='0';field.style.height=Math.max(20,field.scrollHeight)+'px'};
 // Finish only content before the caret, keeping the native textarea in place.
 // This lets Enter reveal headings/finished paragraphs without interrupting IME,
 // held Backspace, selections or the current line's undo history.
 function revealCompleted(){if(!active)return;const field=active.field;if(field.selectionStart!==field.selectionEnd)return;const caret=field.selectionStart,source=field.value;let cut=0;
  for(const block of markdownBlocks(source))if(block.end<=caret&&source.slice(block.start,block.end).endsWith('\n\n'))cut=block.end;
  const heading=source.slice(cut,caret).match(/^ {0,3}#{1,6}[ \t]+[^\n]+\n/);if(heading)cut+=heading[0].length;
  if(!cut||!source.slice(0,cut).trim())return;
  const node=field.parentElement,rendered=document.createElement('div');rendered.className='md-live-block markdown-body';rendered.dataset.start=active.start;rendered.dataset.end=active.start+cut;rendered.innerHTML=render(source.slice(0,cut),{interactive:true,lineOffset:input.value.slice(0,active.start).split('\n').length-1});node.before(rendered);
  active.start+=cut;node.dataset.start=active.start;node.dataset.end=active.end;field.value=source.slice(cut);field.setSelectionRange(caret-cut,caret-cut);paintedSource=null;
 }
 function paint(){if(paintedSource===input.value)return;paintedSource=input.value;container.replaceChildren();for(const block of markdownBlocks(input.value)){const node=document.createElement('div');node.className='md-live-block markdown-body';node.dataset.start=block.start;node.dataset.end=block.end;node.innerHTML=render(input.value.slice(block.start,block.end),{interactive:true,lineOffset:input.value.slice(0,block.start).split('\n').length-1});if(!node.innerHTML){node.classList.add('is-blank');if(!input.value.trim()&&block.start===0){const empty=document.createElement('p');empty.className='md-empty';empty.textContent=input.placeholder||'点击开始书写…';node.append(empty)}}container.append(node)}}
 function commit(){if(editing?.container===container)editing=null;if(!active)return;lastCaret=active.start+active.field.selectionStart;active=null;paint()}
 function activate(position=input.value.length){if(editing&&editing.container!==container)editing.commit();commit();const blocks=[...container.children],node=blocks.find(el=>position>=Number(el.dataset.start)&&position<Number(el.dataset.end))||blocks.at(-1);if(!node)return;const start=Number(node.dataset.start),end=Number(node.dataset.end),field=document.createElement('textarea');field._markdown=true;field.className='md-paragraph-source';field.setAttribute('aria-label','编辑当前段落');field.spellcheck=false;field.value=input.value.slice(start,end);paintedSource=null;node.replaceChildren(field);node.classList.add('is-editing');active={start,end,field};editing={input,container,commit};field.focus({preventScroll:true});field.setSelectionRange(Math.max(0,position-start),Math.max(0,position-start));resize();
  field.addEventListener('input',event=>{const next=input.value.slice(0,active.start)+field.value+input.value.slice(active.end);if(next===input.value)return;record(input.value,lastCaret,event.inputType?.startsWith('delete')?'delete':'insert');const delta=next.length-input.value.length;if(delta)for(const node of container.children)if(node!==field.parentElement&&Number(node.dataset.start)>=active.end){node.dataset.start=Number(node.dataset.start)+delta;node.dataset.end=Number(node.dataset.end)+delta}active.end=active.start+field.value.length;lastCaret=active.start+field.selectionStart;input.value=next;known=next;busy=true;notify();busy=false;if(!event.isComposing&&event.inputType==='insertLineBreak')revealCompleted();resize();});
  field.addEventListener('compositionend',()=>{resize()});
  field.addEventListener('beforeinput',event=>{if(event.isComposing||field.selectionStart!==field.selectionEnd)return;if(event.inputType==='deleteContentBackward'&&field.selectionStart===0&&active.start>0){expandDocument(-1)}else if(event.inputType==='deleteContentForward'&&field.selectionEnd===field.value.length&&active.end<input.value.length){expandDocument(1)}});
  field.addEventListener('keydown',event=>{lastCaret=active.start+field.selectionStart;if(event.isComposing)return;
   if(boundaryKey(event))return;if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo(event.shiftKey);return}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='y'){event.preventDefault();undo(true);return}shortcut(field,event);if(!event.defaultPrevented)applyMarkdownKey(field,event);
   if(!event.defaultPrevented&&event.key==='Escape'){event.preventDefault();event.stopPropagation();commit()}
  });
 }
 function record(value,caret,kind){const now=Date.now();if(now-lastEdit>600||kind!==lastEditKind||!history.length)history.push({value,caret});if(history.length>200)history.shift();lastEdit=now;lastEditKind=kind;future=[]}
 // Extend the current textarea in place only when a native edit/navigation
 // needs to cross its paragraph edge. Keep the DOM node, caret and IME intact.
 function expandDocument(direction=0,whole=false){if(!active)return;const field=active.field,node=field.parentElement,neighbor=direction<0?node.previousElementSibling:node.nextElementSibling;if(!whole&&!neighbor)return;const from=active.start+field.selectionStart,to=active.start+field.selectionEnd,selectionDirection=field.selectionDirection,start=whole?0:direction<0?Number(neighbor.dataset.start):active.start,end=whole?input.value.length:direction>0?Number(neighbor.dataset.end):active.end;
  field.value=input.value.slice(start,end);active.start=start;active.end=end;node.dataset.start=start;node.dataset.end=end;if(whole){for(const sibling of [...container.children])if(sibling!==node)sibling.remove()}else neighbor.remove();field.setSelectionRange(from-start,to-start,selectionDirection);paintedSource=null;resize()
 }
 function boundaryKey(event){const field=active.field,collapsed=field.selectionStart===field.selectionEnd,key=event.key,head=field.selectionDirection==='backward'?field.selectionStart:field.selectionEnd;
  if((event.metaKey||event.ctrlKey)&&key.toLowerCase()==='a'){event.preventDefault();expandDocument(0,true);field.setSelectionRange(0,field.value.length);return true}
  if((event.metaKey||event.ctrlKey)&&['Home','End','ArrowUp','ArrowDown'].includes(key)){expandDocument(0,true);return false}
  if((collapsed&&key==='Backspace'&&head===0)||(key==='ArrowLeft'&&head===0)||(key==='ArrowUp'&&!field.value.slice(0,head).includes('\n')))expandDocument(-1);
  else if((collapsed&&key==='Delete'&&head===field.value.length)||(key==='ArrowRight'&&head===field.value.length)||(key==='ArrowDown'&&!field.value.slice(head).includes('\n')))expandDocument(1);
  return false;
 }
 function undo(redo=false){const from=redo?future:history,to=redo?history:future;if(!from.length)return;const entry=from.pop();to.push({value:input.value,caret:active?active.start+active.field.selectionStart:lastCaret});active=null;input.value=entry.value;known=entry.value;lastEdit=0;busy=true;notify();busy=false;paint();activate(entry.caret)}
 container.tabIndex=0;container.setAttribute('aria-label','手记实时编辑区');
 container.addEventListener('pointerdown',()=>{pointerFocus=true});
 container.addEventListener('click',event=>{pointerFocus=false;if(event.target.closest('input,button,a,textarea'))return;event.preventDefault();const node=event.target.closest('.md-live-block');let position=node?Number(node.dataset.start):input.value.length;
  if(node){try{const point=document.caretPositionFromPoint?.(event.clientX,event.clientY),range=document.caretRangeFromPoint?.(event.clientX,event.clientY),caretNode=point?.offsetNode||range?.startContainer,caretOffset=point?.offset??range?.startOffset;if(caretNode&&node.contains(caretNode)){const prefix=document.createRange();prefix.selectNodeContents(node);prefix.setEnd(caretNode,caretOffset);let offset=0;const source=input.value.slice(position,Number(node.dataset.end));for(const char of prefix.toString()){const index=source.indexOf(char,offset);if(index>=0)offset=index+1}position+=offset}}catch{}}
  activate(position)});
 container.addEventListener('focus',()=>{if(!active&&!pointerFocus)activate(lastCaret)});
 if(!boundaryInstalled){document.addEventListener('pointerdown',event=>{if(!editing)return;const {input,container,commit}=editing;if(!container.contains(event.target)&&!input.closest('.markdown-editor').contains(event.target)&&!event.target.closest('.markdown-mode'))commit()},true);boundaryInstalled=true}
 return {refresh(){if(busy)return;if(active&&known!==input.value&&known.trim()===input.value.trim()){input.value=known;return}if(known!==input.value){if(active){const old=known,next=input.value;let prefix=0,suffix=0;while(prefix<old.length&&prefix<next.length&&old[prefix]===next[prefix])prefix++;while(suffix<old.length-prefix&&suffix<next.length-prefix&&old[old.length-1-suffix]===next[next.length-1-suffix])suffix++;const caret=active.start+active.field.selectionStart,position=caret<=prefix?caret:caret>=old.length-suffix?caret+next.length-old.length:next.length-suffix;active=null;known=next;paint();activate(position)}else{known=input.value;paint()}}else if(!active)paint()},reset(paintNow=true){active=null;known=input.value;lastCaret=known.length;history=[];future=[];if(paintNow)paint()},rewrite(marker,text){for(const entry of [...history,...future]){const at=entry.value.indexOf(marker);if(at>=0){entry.value=entry.value.replace(marker,text);if(entry.caret>at)entry.caret=Math.max(at,entry.caret+text.length-marker.length)}}},focus(){activate(lastCaret)},commit,selection(){return active?{start:active.start+active.field.selectionStart,end:active.start+active.field.selectionEnd}:{start:lastCaret,end:lastCaret}},insert(text,start,end){const before=input.value;history.push({value:before,caret:start});future=[];input.value=before.slice(0,start)+text+before.slice(end);known=input.value;active=null;lastCaret=start+text.length;busy=true;notify();busy=false;paint();activate(lastCaret)}};
}
