import {Plugin,PluginKey} from '@milkdown/kit/prose/state';
import {liftListItem,sinkListItem} from '@milkdown/kit/prose/schema-list';

const key=new PluginKey('journal-list-indent');

export function indentListItem(view,event,itemType){
 const command=event.shiftKey?liftListItem(itemType):sinkListItem(itemType);
 return command(view.state,tr=>view.dispatch(tr.setMeta(key,true)));
}

export const listIndentScroll=new Plugin({
 key,
 state:{init:()=>false,apply:tr=>tr.getMeta(key)===true||tr.getMeta('appendedTransaction')?.getMeta(key)===true},
 props:{handleScrollToSelection(view){
  if(!key.getState(view.state))return false;
  const caret=view.coordsAtPos(view.state.selection.head);
  let top=caret.top,bottom=caret.bottom;
  for(let el=view.dom.parentElement;el&&el!==view.dom.ownerDocument.body;el=el.parentElement){
   if(el.scrollHeight<=el.clientHeight||!['auto','scroll'].includes(getComputedStyle(el).overflowY))continue;
   const before=el.scrollTop;
   const edge=el.getBoundingClientRect().top+el.clientTop;
   if(top<edge)el.scrollTop+=top-edge-5;
   else if(bottom>edge+el.clientHeight)el.scrollTop+=bottom-edge-el.clientHeight+5;
   const moved=el.scrollTop-before;
   top-=moved;bottom-=moved;
  }
  return true;
 }}
});
