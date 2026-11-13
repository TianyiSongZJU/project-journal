import {fitTableWidth,toggleTableFold} from './table-layout.js';
import {editorViewCtx} from '@milkdown/kit/core';
import {callCommand} from '@milkdown/kit/utils';
import {Selection} from '@milkdown/kit/prose/state';
import {addColumnAfter,addColumnBefore,deleteColumn,deleteRow,deleteTable,isInTable,selectedRect} from '@milkdown/kit/prose/tables';
import {addRowAfterCommand,addRowBeforeCommand,exitTable,insertTableCommand} from '@milkdown/kit/preset/gfm';

export function insertNoteTable(ctx, rows, columns) {
 const view=ctx.get(editorViewCtx);
 if(isInTable(view.state))callCommand(exitTable.key)(ctx);
 const inserted=callCommand(insertTableCommand.key,{row:rows,col:columns})(ctx);
 if(inserted)view.focus();
 return inserted;
}

function changeFirstRow(view, insert) {
 const {table,tableStart}=selectedRect(view.state);
 const {table_header_row,table_header,table_row,table_cell}=view.state.schema.nodes;
 const first=table.child(0);
 const from=insert?first:table.child(1);
 const header=[];
 from.forEach(cell=>header.push(insert?table_header.createAndFill(cell.attrs):table_header.create(cell.attrs,cell.content)));
 const replacement=[table_header_row.create(insert?null:from.attrs,header)];
 if(insert){
  const body=[];
  first.forEach(cell=>body.push(table_cell.create(cell.attrs,cell.content)));
  replacement.push(table_row.create(first.attrs,body));
 }
 const end=tableStart+first.nodeSize+(insert?0:from.nodeSize);
 const tr=view.state.tr.replaceWith(tableStart,end,replacement);
 view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(tableStart+1))).scrollIntoView());
}

export function noteTableActions(ctx, cell) {
 const view=ctx.get(editorViewCtx);
 if(!view.dom.contains(cell))return [];
 const pos=view.posAtDOM(cell,0);
 const selection=Selection.near(view.state.doc.resolve(pos));
 view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory',false));
 if(!isInTable(view.state))return [];
 const {top,map}=selectedRect(view.state);
 const run=fn=>()=>{fn();view.focus()};
 const command=fn=>run(()=>fn(view.state,view.dispatch));
 return [
  ['上方插入行',top===0?run(()=>changeFirstRow(view,true)):run(()=>callCommand(addRowBeforeCommand.key)(ctx))],
  ['下方插入行',run(()=>callCommand(addRowAfterCommand.key)(ctx))],
  ['左侧插入列',command(addColumnBefore)],
  ['右侧插入列',command(addColumnAfter)],
  ['删除此行',map.height===1?null:top===0?run(()=>changeFirstRow(view,false)):command(deleteRow)],
  ['删除此列',map.width===1?null:command(deleteColumn)],
  ['删除表格',command(deleteTable)],
  [cell.closest('.journal-table-folded')?'展开正文':'折叠正文',map.height===1?null:()=>toggleTableFold(view),'view'],
  ['铺满宽度',run(()=>fitTableWidth(view,cell.closest('.journal-table-scroll'))),'view']
 ];
}
