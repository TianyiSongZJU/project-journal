import {TextSelection,NodeSelection} from '@milkdown/kit/prose/state';
import {undo,redo,closeHistory} from '@milkdown/kit/prose/history';

const isMath=node=>node.type.name==='code_block'&&String(node.attrs.language).toLowerCase()==='latex';

// Keep the portable $$ schema, but use a compact equation view instead of the
// programming-code interface. Other languages keep the existing code editor.
export function installBlockMath(view){
 const original=view.props.nodeViews||{},fallback=original.code_block;
 view.setProps({nodeViews:{...original,code_block:(node,...args)=>{
  if(isMath(node))return blockMathView(node,...args);
  const result=fallback(node,...args),update=result.update?.bind(result);
  if(update)result.update=(next,...rest)=>!isMath(next)&&update(next,...rest);
  return result;
 }}});
}

function blockMathView(node,view,getPos){
 const dom=document.createElement('div');dom.className='journal-block-math';dom.contentEditable='false';dom.tabIndex=0;dom.setAttribute('aria-label','整行公式，点击编辑');
 const source=document.createElement('div');source.className='journal-block-math-editor';source.hidden=true;
 const opening=document.createElement('span'),closing=document.createElement('span');opening.textContent=closing.textContent='$$';opening.className=closing.className='journal-math-fence';
 const field=document.createElement('textarea');field._markdown=true;field.className='journal-block-math-source';field.setAttribute('aria-label','编辑整行公式');field.spellcheck=false;field.rows=1;field.placeholder='输入公式…';
 const preview=document.createElement('div');preview.className='journal-block-math-preview';
 source.append(opening,field,closing);dom.append(source,preview);
 let current=node,editing=false,disposed=false,composing=false,startHistory=false;
 const position=()=>{try{return getPos()}catch{return null}};
 const render=()=>{preview.hidden=editing&&!current.textContent;preview.innerHTML=current.textContent?globalThis.katex.renderToString(current.textContent,{displayMode:true,throwOnError:false,trust:false,maxExpand:1000,maxSize:20}):'<span class="journal-math-empty">输入公式…</span>'};
 const resize=()=>{field.style.height='0px';field.style.height=Math.max(20,field.scrollHeight)+'px'};
 function begin(from=field.value.length,to=from){
  if(disposed)return;
  if(!editing){editing=true;dom.classList.add('is-editing');source.hidden=false;field.value=current.textContent;startHistory=true;render()}
  field.focus({preventScroll:true});field.setSelectionRange(Math.min(from,field.value.length),Math.min(to,field.value.length));resize();
 }
 function sync(){
  if(disposed||view.isDestroyed)return;const pos=position();if(pos==null||field.value===current.textContent)return;
  let tr=startHistory?closeHistory(view.state.tr):view.state.tr;startHistory=false;const value=field.value;
  // A minimal text replacement preserves useful undo steps while keeping the
  // textarea DOM and IME selection stable throughout a composition.
  const old=current.textContent;let start=0,end=old.length,nextEnd=value.length;
  while(start<end&&start<nextEnd&&old[start]===value[start])start++;
  while(end>start&&nextEnd>start&&old[end-1]===value[nextEnd-1]){end--;nextEnd--}
  tr=tr.insertText(value.slice(start,nextEnd),pos+1+start,pos+1+end);
  view.dispatch(tr.setSelection(NodeSelection.create(tr.doc,pos)));
 }
 function finish(direction=0){
  if(!editing||disposed)return;sync();editing=false;dom.classList.remove('is-editing');source.hidden=true;render();
  if(!view.isDestroyed){let tr=closeHistory(view.state.tr);const pos=position();
   if(direction&&pos!=null){const target=direction<0?pos:pos+current.nodeSize;let selection=TextSelection.findFrom(tr.doc.resolve(target),direction,true);
    if(!selection){const paragraph=view.state.schema.nodes.paragraph.create();tr=tr.insert(target,paragraph);selection=TextSelection.create(tr.doc,target+1)}
    tr=tr.setSelection(selection)}
   view.dispatch(tr);if(direction)view.focus();
  }
 }
 field.oncompositionstart=()=>{composing=true};field.oncompositionend=()=>{composing=false;sync();resize()};
 field.oninput=()=>{if(!composing)sync();resize()};field.onblur=()=>finish();
 field.onkeydown=event=>{
  if(event.isComposing||composing)return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){
   event.preventDefault();(event.shiftKey?redo:undo)(view.state,view.dispatch);resize();return;
  }
  if(((event.metaKey||event.ctrlKey)&&event.key==='Enter')||event.key==='Escape'){event.preventDefault();finish(1);return}
  if(event.shiftKey||event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.key==='Enter'&&field.selectionStart===field.value.length&&field.selectionEnd===field.value.length&&field.value.split('\n').at(-1)==='$$'){
   event.preventDefault();field.value=field.value.replace(/(?:^|\n)\$\$$/,'');sync();finish(1);return;
  }
  if(event.key==='ArrowUp'&&field.selectionStart===0&&field.selectionEnd===0){event.preventDefault();finish(-1)}
  else if(event.key==='ArrowDown'&&field.selectionStart===field.value.length&&field.selectionEnd===field.value.length){event.preventDefault();finish(1)}
  else if(event.key==='Backspace'&&!field.value){event.preventDefault();const pos=position();if(pos!=null){const tr=view.state.tr.replaceWith(pos,pos+current.nodeSize,view.state.schema.nodes.paragraph.create());view.dispatch(tr.setSelection(TextSelection.create(tr.doc,pos+1)));view.focus()}}
 };
 dom.onmousedown=event=>{if(source.contains(event.target))return;event.preventDefault();begin(current.textContent.length)};
 dom.onkeydown=event=>{if(event.target===dom&&event.key==='Enter'){event.preventDefault();begin(current.textContent.length)}};
 field.value=node.textContent;render();
 return {dom,selectNode(){dom.classList.add('is-selected')},deselectNode(){dom.classList.remove('is-selected')},setSelection(anchor,head){begin(anchor,head)},update(next){if(!isMath(next))return false;current=next;if(field.value!==next.textContent){const from=field.selectionStart,to=field.selectionEnd;field.value=next.textContent;if(editing){field.setSelectionRange(Math.min(from,field.value.length),Math.min(to,field.value.length));resize()}}render();return true},stopEvent:event=>source.contains(event.target)||event.target===dom&&event.type==='keydown',ignoreMutation:()=>true,destroy(){disposed=true;field.onblur=null}};
}
