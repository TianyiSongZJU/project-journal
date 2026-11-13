
// Source segmentation remains available for Markdown source helpers.
// Live editing is handled by the bundled ProseMirror editor below.
export function markdownBlocks(source){
 const lines=source.match(/[^\n]*(?:\n|$)/g)||[''];if(lines.at(-1)==='')lines.pop();const blocks=[];let start=0,offset=0,fence=null;
 for(const line of lines){const trimmed=line.trim(),marker=trimmed.match(/^(`{3,}|~{3,})/)?.[1]||(trimmed==='$$'?'$$':null);
  if(marker){if(!fence)fence=marker;else if(marker===fence||marker[0]===fence[0]&&marker.length>=fence.length)fence=null}
  offset+=line.length;
  if(!fence&&!trimmed){if(offset>start)blocks.push({start,end:offset});start=offset}
 }
 if(offset>start||!blocks.length)blocks.push({start,end:offset});if(source.endsWith('\n\n'))blocks.push({start:offset,end:offset});return blocks;
}
export function createLiveMarkdown(input,container){
 let controller=null,destroyed=false,focusRequested=false;
 const ready=import('./vendor/markdown-editor.js').then(({createRichMarkdown})=>{if(destroyed)return;controller=createRichMarkdown(input,container);return controller.ready.then(()=>{if(focusRequested&&!container.hidden)controller.focus()})});
 return {ready,insertTable(rows,columns){return controller?.insertTable(rows,columns)},tableActions(cell){return controller?.tableActions(cell)??[]},refresh(){controller?.refresh()},reset(paintNow=true){controller?.reset(paintNow)},commit(options){controller?.commit(options)},focus(){focusRequested=true;if(controller)controller.focus()},selection(){return controller?.selection()||{start:input.value.length,end:input.value.length}},insert(text,start,end){controller?.insert(text,start,end)},rewrite(marker,text){return controller?.rewrite(marker,text)||false},destroy(){destroyed=true;controller?.destroy()},get view(){return controller?.view}};
}
