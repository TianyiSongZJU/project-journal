import {Plugin, PluginKey, Selection} from '@milkdown/kit/prose/state';
import {Decoration, DecorationSet} from '@milkdown/kit/prose/view';
import {TableView, TableMap, isInTable, selectedRect} from '@milkdown/kit/prose/tables';
import {$node, $remark} from '@milkdown/kit/utils';

export const tableBreak=$node('journal_table_break',()=>({
 inline:true,group:'inline',atom:true,selectable:false,
 toDOM:()=>['br',{'data-journal-table-break':''}],
 parseDOM:[{tag:'br[data-journal-table-break]'}],
 parseMarkdown:{match:node=>node.type==='journalTableBreak',runner:(state,_,type)=>state.addNode(type)},
 toMarkdown:{match:node=>node.type.name==='journal_table_break',runner:state=>state.addNode('html',undefined,'<br>')}
}));

const dimensions=/^<!-- journal-table:([\d,]*);([\d,]*) -->$/;
const values=text=>text.split(',').map(value=>Math.min(8192,Number(value)||0));
export const tableLayoutMarkdown=$remark('journal-table-layout',()=>()=>tree=>{
 function visit(node,inTable=false){
  if(!node.children)return;
  const children=[];
  for(const child of node.children){
   const previous=children.at(-1);
   const html=child.type==='html'?child:
    child.type==='paragraph'&&child.children?.length===1&&child.children[0].type==='html'?child.children[0]:null;
   const size=html&&dimensions.exec(html.value.trim());
   if(size&&previous?.type==='table'){
    const widths=values(size[1]),heights=values(size[2]);
    previous.children.forEach((row,i)=>{
     row.journalHeight=heights[i]||null;
     row.children.forEach((cell,j)=>{cell.journalWidth=widths[j]||null});
    });
    continue;
   }
   if(inTable&&child.type==='html'&&/^<br\s*\/?>$/i.test(child.value)){
    children.push({type:'journalTableBreak'});continue;
   }
   visit(child,inTable||child.type==='table');children.push(child);
  }
  node.children=children;
 }
 visit(tree);
});

export function tableSchemaWithLayout(base){
 return {...base,content:'table_header_row table_row*',toMarkdown:{
  ...base.toMarkdown,
  runner(state,node){
   base.toMarkdown.runner(state,node);
   const widths=[],heights=[];
   node.firstChild?.forEach(cell=>widths.push(cell.attrs.colwidth?.[0]||0));
   node.forEach(row=>heights.push(row.attrs.journalHeight||0));
   if(widths.some(Boolean)||heights.some(Boolean)){
    state.addNode('html',undefined,`<!-- journal-table:${widths.join(',')};${heights.join(',')} -->`);
   }
  }
 }};
}

export function rowSchemaWithLayout(base){
 return {...base,attrs:{...base.attrs,journalHeight:{default:null}},
  toDOM(node){
   const [,attrs]=base.toDOM(node);
   return ['tr',{...attrs,...(node.attrs.journalHeight?{style:'height:'+node.attrs.journalHeight+'px'}:{})},0];
  },
  parseMarkdown:{
   ...base.parseMarkdown,
   runner(state,node,type){
    const align=node.align||[];
    state.openNode(type,{journalHeight:node.journalHeight??null});
    state.next(node.children.map((cell,i)=>({...cell,align:align[i],isHeader:node.isHeader})));
    state.closeNode();
   }
  }
 };
}

export function cellSchemaWithLayout(base){
 return {...base,parseMarkdown:{
  ...base.parseMarkdown,
  runner(state,node,type){
   state.openNode(type,{alignment:node.align,colwidth:node.journalWidth?[node.journalWidth]:null});
   state.openNode(state.schema.nodes.paragraph);
   state.next(node.children);
   state.closeNode().closeNode();
  }
 }};
}

let tableId=0;

export class JournalTableView extends TableView {
 constructor(node,view){
  super(node,52);
  this.dom.classList.add('journal-table-scroll');
  this.dom.dataset.journalTableId=String(++tableId);
  const position=()=>view.posAtDOM(this.contentDOM,0)-1;
  const expand=document.createElement('button');
  expand.type='button';
  expand.className='journal-table-expand';
  expand.contentEditable='false';
  expand.setAttribute('aria-label','展开表格正文');
  expand.title='展开表格正文';
  expand.onmousedown=event=>event.preventDefault();
  expand.onclick=()=>toggleFoldAt(view,position());
  this.dom.append(expand);
  this.layoutObserver=new ResizeObserver(()=>{
   if(this.layoutFrame)return;
   this.layoutFrame=requestAnimationFrame(()=>{
    this.layoutFrame=0;
    const width=this.table.getBoundingClientRect().width+'px';
    if(this.dom.style.getPropertyValue('--journal-table-width')!==width)this.dom.style.setProperty('--journal-table-width',width);
   });
  });
  this.layoutObserver.observe(this.table);
 }
 destroy(){this.layoutObserver.disconnect();cancelAnimationFrame(this.layoutFrame)}
 ignoreMutation(record){
  return record.type==='attributes'&&record.target===this.dom||super.ignoreMutation(record);
 }
 stopEvent(event){return event.target.closest?.('.journal-table-expand')!=null}
}

function columnWidths(wrapper){
 // WebKit reports no layout box for <col>; header cells expose the rendered widths.
 const header=wrapper.querySelector('table').rows[0];
 return [...header.cells].flatMap(cell=>Array(cell.colSpan).fill(cell.getBoundingClientRect().width/cell.colSpan));
}

export function fitTableWidth(view,wrapper){
 const widths=columnWidths(wrapper);
 const total=widths.reduce((a,b)=>a+b,0);
 const available=wrapper.clientWidth-2;
 if(!total||available<widths.length)return;
 let source=0,target=0;
 const scaled=widths.map(width=>{
  source+=width;
  const boundary=Math.round(source/total*available);
  const size=Math.max(1,boundary-target);
  target+=size;
  return size;
 });
 setColumnWidths(view,selectedRect(view.state).tableStart-1,scaled);
}

function setColumnWidths(view,pos,widths){
 const table=view.state.doc.nodeAt(pos);
 if(table?.type.name!=='table')return;
 const map=TableMap.get(table),tr=view.state.tr,start=pos+1;
 for(const cell of new Set(map.map)){
  const node=table.nodeAt(cell),{left,right}=map.findCell(cell);
  const colwidth=widths.slice(left,right).map(width=>Math.max(1,Math.round(width)));
  if(colwidth.some((width,i)=>node.attrs.colwidth?.[i]!==width)){
   tr.setNodeMarkup(start+cell,undefined,{...node.attrs,colwidth});
  }
 }
 if(tr.docChanged)view.dispatch(tr);
}

const tableFolds=new PluginKey('journal-table-folds');

function toggleFoldAt(view,pos){
 view.focus();
 const state=view.state,tr=state.tr;
 if(!tableFolds.getState(state).has(pos)){
  tr.setSelection(Selection.near(tr.doc.resolve(pos+2)));
 }
 view.dispatch(tr.setMeta(tableFolds,pos).setMeta('addToHistory',false));
}

export function toggleTableFold(view){
 toggleFoldAt(view,selectedRect(view.state).tableStart-1);
}

function bodyTable(selection){
 const {$head}=selection;
 let body=false;
 for(let depth=$head.depth;depth>0;depth--){
  const type=$head.node(depth).type.name;
  if(type==='table_row')body=true;
  if(type==='table')return body?$head.before(depth):null;
 }
 return null;
}

function resizeEdge(event){
 const cell=event.target.closest?.('td,th');
 const wrapper=cell?.closest('.journal-table-scroll');
 if(!wrapper)return null;
 const rect=cell.getBoundingClientRect();
 if(event.clientX>=rect.right-6)return {cell,wrapper,axis:'column'};
 if(event.clientY>=rect.bottom-5)return {cell,wrapper,axis:'row'};
 return null;
}

export function tableLayoutInteraction(){
 return new Plugin({
  key:tableFolds,
  state:{
   init:()=>new Set(),
   apply(tr,previous){
    const toggle=tr.getMeta(tableFolds);
    if(toggle===undefined&&!previous.size)return previous;
    const body=bodyTable(tr.selection);
    const folded=new Set();
    for(const pos of previous){
     const next=tr.mapping.mapResult(pos,1);
     if(!next.deletedAcross&&next.pos!==body&&tr.doc.nodeAt(next.pos)?.type.name==='table')folded.add(next.pos);
    }
    if(toggle!==undefined){
     if(folded.has(toggle))folded.delete(toggle);
     else folded.add(toggle);
    }
    return folded;
   }
  },
  view(view){
   let drag;
   const preview=document.createElement('style');
   view.dom.closest('.markdown-editor').append(preview);
   function clearPreview(){
    preview.textContent='';
    drag?.restore?.();
   }
   function down(event){
    const edge=resizeEdge(event);
    if(event.button!==0||!edge)return;
    const {cell,wrapper,axis}=edge;
    const $cell=view.state.doc.resolve(view.posAtDOM(cell,0));
    event.preventDefault();event.stopPropagation();
    if(axis==='row'){
     const row=cell.parentElement,pos=$cell.before($cell.depth-1);
     const selector=`[data-journal-table-id="${wrapper.dataset.journalTableId}"]>table>tbody>tr:nth-child(${row.rowIndex+1})`;
     drag={axis,id:event.pointerId,pos,anchor:row,point:event.clientY,start:row.getBoundingClientRect().height,selector};
    }else{
     const pos=$cell.before($cell.depth-2),node=view.state.doc.nodeAt(pos);
     const column=TableMap.get(node).findCell($cell.before($cell.depth)-pos-1).right-1;
     const widths=columnWidths(wrapper).map(Math.round);
     const table=wrapper.querySelector('table'),cols=[...table.querySelectorAll('colgroup>col')];
     const oldWidths=cols.map(col=>col.style.width),oldStyle=table.style.cssText;
     const restore=()=>{
      cols.forEach((col,i)=>{col.style.width=oldWidths[i]});
      table.style.cssText=oldStyle;
     };
     drag={axis,id:event.pointerId,pos,anchor:wrapper,point:event.clientX,start:widths[column],
      column,widths,total:widths.reduce((a,b)=>a+b,0),table,cols,restore};
    }
    view.dom.setPointerCapture(event.pointerId);
   }
   function move(event){
    const axis=drag?.axis??resizeEdge(event)?.axis;
    view.dom.classList.toggle('journal-table-row-resize',axis==='row');
    view.dom.classList.toggle('journal-table-col-resize',axis==='column');
    if(drag?.id!==event.pointerId)return;
    const pointer=axis==='row'?event.clientY:event.clientX;
    const min=axis==='row'?24:32,max=axis==='row'?600:8192;
    const size=Math.max(min,Math.min(max,Math.round(drag.start+pointer-drag.point)));
    if(axis==='row'){
     // A stylesheet previews row height without changing ProseMirror's editable DOM.
     preview.textContent=drag.selector+'{height:'+size+'px!important}';
    }else{
     if(drag.size===undefined){
      drag.cols.forEach((col,i)=>{col.style.width=drag.widths[i]+'px'});
      drag.table.style.minWidth='';
     }
     drag.cols[drag.column].style.width=size+'px';
     drag.table.style.width=(drag.total-drag.start+size)+'px';
    }
    drag.size=size;
   }
   function end(event){
    if(drag?.id!==event.pointerId)return;
    const {axis,pos,anchor,size,column,widths}=drag;
    clearPreview();
    drag=undefined;
    view.dom.classList.remove('journal-table-row-resize','journal-table-col-resize');
    const node=view.state.doc.nodeAt(pos);
    if(event.type!=='pointerup'||!size||!node||anchor!==view.nodeDOM(pos))return;
    if(axis==='row')view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,journalHeight:size}));
    else{
     widths[column]=size;
     setColumnWidths(view,pos,widths);
    }
   }
   const events={pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,lostpointercapture:end};
   for(const [name,handler] of Object.entries(events))view.dom.addEventListener(name,handler,true);
   return {destroy(){
    clearPreview();
    preview.remove();
    for(const [name,handler] of Object.entries(events))view.dom.removeEventListener(name,handler,true);
   }};
  },
  props:{
   decorations(state){
    const folded=tableFolds.getState(state);
    if(!folded.size)return DecorationSet.empty;
    return DecorationSet.create(state.doc,[...folded].map(pos=>Decoration.node(pos,pos+state.doc.nodeAt(pos).nodeSize,{class:'journal-table-folded'})));
   },
   handleKeyDown(view,event){
   if(event.isComposing||event.key!=='Enter'||!event.shiftKey||event.ctrlKey||event.metaKey||!isInTable(view.state))return false;
   view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.journal_table_break.create(),false).scrollIntoView());
   return true;
  }}
 });
}
