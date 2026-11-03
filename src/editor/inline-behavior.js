import {nodeViewCtx,prosePluginsCtx} from '@milkdown/kit/core';
import {Plugin,NodeSelection,TextSelection} from '@milkdown/kit/prose/state';
import {Decoration,DecorationSet} from '@milkdown/kit/prose/view';

function mathView(node,view,getPos){
 const dom=document.createElement('span');dom.className='journal-inline-math';dom.contentEditable='false';
 let current=node,field=null,editing=false,disposed=false;
 const render=()=>{dom.dataset.value=current.attrs.value;dom.innerHTML=globalThis.katex.renderToString(current.attrs.value,{throwOnError:false,trust:false,maxExpand:1000,maxSize:20})};
 const position=()=>{try{return getPos()}catch{return null}};
 function finish(direction=0){
  if(!editing||disposed)return;editing=false;const raw=field.value,pos=position();field.onblur=null;field=null;dom.classList.remove('is-editing');
  if(pos==null||view.isDestroyed)return;
  const closed=raw.startsWith('$')&&raw.endsWith('$')&&raw.length>2;
  let tr=view.state.tr;
  if(closed){const value=raw.slice(1,-1);if(value!==current.attrs.value)tr=tr.setNodeMarkup(pos,undefined,{...current.attrs,value})}
  else tr=tr.replaceWith(pos,pos+current.nodeSize,raw?view.state.schema.text(raw):[]);
  if(direction){const next=direction<0?pos:closed?pos+1:pos+raw.length;tr=tr.setSelection(TextSelection.near(tr.doc.resolve(next),direction))}
  if(tr.docChanged||direction)view.dispatch(tr);
  if(closed)render();if(direction)view.focus();
 }
 function begin(edge){
  if(editing||disposed)return;editing=true;dom.classList.add('is-editing');field=document.createElement('input');field.className='journal-inline-math-source';field.type='text';field.value='$'+current.attrs.value+'$';field.setAttribute('aria-label','编辑行内公式');field.spellcheck=false;dom.replaceChildren(field);
  const size=()=>field.style.width=Math.max(4,field.value.length+1)+'ch';size();
  field.oninput=()=>{size();const pos=position();if(pos==null)return;const raw=field.value,value=raw.replace(/^\$/,'').replace(/\$$/,'');if(value!==current.attrs.value){let tr=view.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,value});view.dispatch(tr.setSelection(NodeSelection.create(tr.doc,pos)))}};
  field.onblur=()=>finish();
  field.onkeydown=e=>{if(e.isComposing||e.shiftKey||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='ArrowLeft'&&field.selectionStart===0&&field.selectionEnd===0){e.preventDefault();finish(-1)}else if(e.key==='ArrowRight'&&field.selectionStart===field.value.length&&field.selectionEnd===field.value.length){e.preventDefault();finish(1)}else if(e.key==='Enter'){e.preventDefault();finish(1)}};
  queueMicrotask(()=>{if(!field||disposed)return;field.focus({preventScroll:true});const at=edge==='end'?field.value.length-1:1;field.setSelectionRange(at,at)});
 }
 dom.onmousedown=e=>{if(e.target===field)return;e.preventDefault();const pos=position();if(pos!=null)view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,pos)));begin()};
 render();return {dom,selectNode(){const edge=view.journalMathEdge;delete view.journalMathEdge;begin(edge)},deselectNode(){finish()},update(next){if(next.type!==current.type)return false;current=next;if(!editing)render();return true},stopEvent:event=>editing&&event.target===field,ignoreMutation:()=>true,destroy(){disposed=true;if(field)field.onblur=null}};
}

function decorations(state,focused){
 const result=[];
 // Explicit marker widgets also render on an otherwise empty first list item.
 state.doc.descendants((node,pos)=>{if(!['bullet_list','ordered_list'].includes(node.type.name))return;node.forEach((item,offset,index)=>{if(item.attrs.checked!=null)return;const at=pos+1+offset,marker=node.type.name==='ordered_list'?(node.attrs.order+index)+'.':'•';result.push(Decoration.widget(at+1,view=>{const el=document.createElement('span');el.className='journal-list-marker';el.textContent=marker;el.setAttribute('aria-hidden','true');el.onmousedown=event=>{event.preventDefault();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,at+2)));view.focus()};return el},{key:'list:'+at+':'+marker,side:-1}))})});
 const {$from,empty}=state.selection;
 if(focused&&empty&&$from.parent.isTextblock){
  const parent=$from.parent,base=$from.start(),caret=$from.parentOffset;
  for(const [name,symbol] of [['strong','**'],['emphasis','*']]){
   const ranges=[];let start=null,end=null;
   parent.forEach((node,offset)=>{if(node.marks.some(mark=>mark.type.name===name)){if(start===null)start=offset;end=offset+node.nodeSize}else if(start!==null){ranges.push([start,end]);start=end=null}});
   if(start!==null)ranges.push([start,end]);
   const range=ranges.find(([from,to])=>caret>=from&&caret<=to);if(!range)continue;const [from,to]=range;
   for(const [pos,side] of [[base+from,-1],[base+to,1]])result.push(Decoration.widget(pos,()=>{const el=document.createElement('span');el.className='journal-format-marker';el.textContent=symbol;el.setAttribute('aria-hidden','true');return el},{key:name+':'+pos,side}));
  }
 }
 return DecorationSet.create(state.doc,result);
}

export function configureInlineBehavior(ctx){
 let focused=false;
 // The source editor lives inside the equation itself; suppress the old popup.
 ctx.set('INLINE_LATEX_TOOLTIP_SPEC',{});
 ctx.update(nodeViewCtx,views=>views.concat([['math_inline',mathView]]));
 ctx.update(prosePluginsCtx,plugins=>[new Plugin({props:{decorations:state=>decorations(state,focused),handleDOMEvents:{focus:view=>{focused=true;queueMicrotask(()=>{if(!view.isDestroyed)view.dispatch(view.state.tr)});return false},blur:view=>{focused=false;queueMicrotask(()=>{if(!view.isDestroyed)view.dispatch(view.state.tr)});return false}},handleKeyDown:(view,event)=>{
  if(event.isComposing||event.shiftKey||event.metaKey||event.ctrlKey||event.altKey||!view.state.selection.empty||!['ArrowLeft','ArrowRight'].includes(event.key))return false;
  const {$from}=view.state.selection,node=event.key==='ArrowLeft'?$from.nodeBefore:$from.nodeAfter;
  if(node?.type.name!=='math_inline')return false;
  const pos=event.key==='ArrowLeft'?$from.pos-node.nodeSize:$from.pos;view.journalMathEdge=event.key==='ArrowLeft'?'end':'start';view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,pos)));return true;
 }}}),...plugins]);
}
