import {configureInlineBehavior} from './inline-behavior.js';
import {CrepeBuilder} from '@milkdown/crepe/builder';
import {codeMirror} from '@milkdown/crepe/feature/code-mirror';
import {latex} from '@milkdown/crepe/feature/latex';
import {imageBlock} from '@milkdown/crepe/feature/image-block';
import {cursor} from '@milkdown/crepe/feature/cursor';
import {placeholder} from '@milkdown/crepe/feature/placeholder';
import {editorViewCtx,serializerCtx,prosePluginsCtx} from '@milkdown/kit/core';
import {imageBlockSchema} from '@milkdown/kit/component/image-block';
import {Plugin,TextSelection} from '@milkdown/kit/prose/state';
import {replaceAll,insert,$remark,$inputRule} from '@milkdown/kit/utils';
import {textblockTypeInputRule} from '@milkdown/kit/prose/inputrules';
import {sinkListItem,liftListItem} from '@milkdown/kit/prose/schema-list';
import {headingSchema,listItemSchema,codeBlockSchema} from '@milkdown/kit/preset/commonmark';
import {extendListItemSchemaForTask} from '@milkdown/kit/preset/gfm';
import {imageTag,parseImageTag} from '../web/markdown-images.js';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/placeholder.css';
// KaTeX fonts and stylesheet already ship with the application.
import '@milkdown/crepe/theme/common/latex.css';

const indentedHeading=$inputRule(ctx=>textblockTypeInputRule(/^ {1,3}(#{1,6})[ \t]$/,headingSchema.type(ctx),match=>({level:match[1].length})));

const htmlImages=$remark('journal-sized-images',()=>()=>tree=>{
 const visit=node=>{if(!node.children)return;node.children=node.children.map(child=>{
  const raw=child.type==='html'?child.value:child.type==='paragraph'&&child.children?.length===1&&child.children[0].type==='html'?child.children[0].value:null;
  const image=typeof raw==='string'&&node.type!=='paragraph'?parseImageTag(raw.trim()):null;
  if(image)return {type:'image-block',url:image.src,alt:image.alt,title:image.caption,ratio:image.ratio,width:image.width};
  visit(child);return child;
 })};visit(tree);
});

export function createRichMarkdown(input,container){
 let loaded=false,updating=false,destroyed=false,known=input.value,dirty=false,needsEnd=false,resetRequested=false;
 const crepe=new CrepeBuilder({root:container,defaultValue:known})
  .addFeature(cursor)
  .addFeature(codeMirror,{languages:[],copyText:'复制',searchPlaceholder:'代码语言',noResultText:'无匹配语言',previewToggleText:shown=>shown?'编辑':'收起',previewLabel:'公式预览'})
  .addFeature(latex,{katexOptions:{throwOnError:false,trust:false,maxExpand:1000,maxSize:20}})
  .addFeature(imageBlock,{inlineUploadButton:'插入图片',blockUploadButton:'插入图片',inlineUploadPlaceholderText:'或粘贴图片链接',blockUploadPlaceholderText:'或粘贴图片链接',blockCaptionPlaceholderText:'图片说明',blockConfirmButton:'确定',onUpload:file=>input._markdownUploadFile(file)})
  .addFeature(placeholder,{text:input.placeholder||'点击开始书写…',mode:'doc'});
 const sync=ctx=>{if(!loaded||updating||destroyed||resetRequested||!dirty)return;const doc=ctx.get(editorViewCtx).state.doc,value=ctx.get(serializerCtx)(doc);if(value===known)return;known=value;input.value=value;updating=true;input.dispatchEvent(new Event('input',{bubbles:true}));updating=false};
 crepe.editor.config(ctx=>{
  configureInlineBehavior(ctx);
  ctx.update(extendListItemSchemaForTask.key,previous=>context=>{const base=previous(context);return {...base,toDOM:node=>node.attrs.checked==null?base.toDOM(node):['li',{'data-item-type':'task','data-checked':String(node.attrs.checked)},['input',{type:'checkbox',class:'journal-task-box','aria-label':'切换完成状态',contenteditable:'false',...(node.attrs.checked?{checked:'checked'}:{})}],['div',0]]}});
  // Preserve image descriptions and serialize resized images as portable HTML.
  ctx.update(imageBlockSchema.key,previous=>context=>{const base=previous(context);return {...base,attrs:{...base.attrs,alt:{default:''},width:{default:null}},parseMarkdown:{match:node=>node.type==='image-block',runner:(state,node,type)=>state.addNode(type,{src:node.url,caption:node.title||'',alt:node.alt||'',ratio:node.ratio??1,width:node.width??null})},toMarkdown:{match:node=>node.type.name==='image-block',runner:(state,node)=>{const {src,alt,caption,ratio,width}=node.attrs;if(ratio!==1||width)state.addNode('html',undefined,imageTag({src,alt,caption,ratio,width}));else{state.openNode('paragraph');state.addNode('image',undefined,undefined,{url:src,alt,title:caption||null});state.closeNode()}}}}});
  ctx.update(prosePluginsCtx,plugins=>[new Plugin({view:()=>({update:(view,prev)=>{if(!view.state.doc.eq(prev.doc)){dirty=true;sync(ctx)}}}),props:{handleKeyDown:(view,event)=>{if(event.isComposing)return false;if(event.key==='Tab'&&!event.metaKey&&!event.ctrlKey){const command=event.shiftKey?liftListItem(listItemSchema.type(ctx)):sinkListItem(listItemSchema.type(ctx));return command(view.state,view.dispatch)}if(event.key==='Enter'&&view.state.selection.empty&&view.state.selection.$from.parent.textContent==='$$'){const {$from}=view.state.selection,start=$from.start();view.dispatch(view.state.tr.delete(start,$from.end()).setBlockType(start,start,codeBlockSchema.type(ctx),{language:'LaTeX'}));queueMicrotask(()=>container.querySelector('.milkdown-code-block .cm-content')?.focus());return true}return false},handleDOMEvents:{change:(view,event)=>{if(!event.target.matches('.journal-task-box'))return false;const li=event.target.closest('li'),pos=view.posAtDOM(li,0)-1,node=view.state.doc.nodeAt(pos);if(node?.type.name==='list_item')view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,checked:event.target.checked}));return true},click:(_,event)=>{const link=event.target.closest('a');if(link&&!/^(https?:|mailto:|#)/i.test(link.getAttribute('href')||'')){event.preventDefault();return true}return false}}}}),...plugins]);
 }).use(htmlImages).use(indentedHeading);
 const ready=crepe.create().then(()=>{loaded=true;if(destroyed){crepe.destroy();return}if(resetRequested||input.value!==known)refresh();container.dataset.ready='true'}).catch(error=>{container.dataset.error='true';container.textContent='排版编辑器加载失败，请切换源码继续编辑。';console.error(error)});
 function refresh(){if(!loaded||destroyed||updating||!resetRequested&&input.value===known)return;resetRequested=false;known=input.value;updating=true;crepe.editor.action(replaceAll(known,true));dirty=false;needsEnd=true;updating=false}
 const action=fn=>{if(loaded&&!destroyed)return crepe.editor.action(fn)};
 container.addEventListener('click',event=>{if(event.target===container)action(ctx=>ctx.get(editorViewCtx).focus())});
 return {ready,refresh,reset(paintNow=true){dirty=false;resetRequested=true;if(paintNow)refresh()},commit(){container.querySelector('.journal-inline-math-source')?.blur();action(sync)},focus(){ready.then(()=>action(ctx=>{const view=ctx.get(editorViewCtx);if(needsEnd){view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));needsEnd=false}view.focus()}))},selection(){return {start:input.value.length,end:input.value.length}},insert(text){action(insert(text));action(ctx=>ctx.get(editorViewCtx).focus())},rewrite(marker,replacement){if(!loaded||destroyed)return false;const alt=marker.match(/^!\[([^\]]*)\]/)?.[1],target=replacement.match(/^!\[([^\]]*)\]\(([^)]*)\)$/);let found=false;action(ctx=>{const view=ctx.get(editorViewCtx);let tr=view.state.tr;view.state.doc.descendants((node,pos)=>{if(!found&&['image-block','image'].includes(node.type.name)&&node.attrs.alt===alt){found=true;tr=target?tr.setNodeMarkup(pos,undefined,{...node.attrs,src:target[2],alt:target[1]}):tr.delete(pos,pos+node.nodeSize)}});if(found)view.dispatch(tr.setMeta('addToHistory',false))});return found},destroy(){destroyed=true;if(loaded)crepe.destroy()},get view(){return action(ctx=>ctx.get(editorViewCtx))}};
}
