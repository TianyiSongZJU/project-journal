// Text edits are shared by source mode and the active paragraph editor.
export function markdownEdit(value,start,end,key,{shift=false,mod=false}={}){
 const before=value.slice(0,start),after=value.slice(end),lineStart=before.lastIndexOf('\n')+1,line=before.slice(lineStart),selected=value.slice(start,end);
 const replace=(text,a=start,b=end,offset=text.length)=>({value:value.slice(0,a)+text+value.slice(b),start:a+offset,end:a+offset});
 if(mod||shift&&key!=='Tab')return null;
 if(key==='Enter'){
  if(/^\s*\$\$$/.test(line)&&after.startsWith('$$'))return replace('\n\n',start,end,1);
  const match=line.match(/^(\s*)(?:(>\s*)|([-+*]|\d+[.)])\s+(\[[ xX]\]\s*)?)(.*)$/);
  if(match){if(!match[5].trim()&&!after.split('\n')[0].trim())return replace('',lineStart,end,0);const marker=match[2]||(/^\d/.test(match[3])?match[3].replace(/^\d+/,n=>String(Number(n)+1))+' ':match[3]+' ');return replace('\n'+match[1]+marker+(match[4]?'[ ] ':''))}
  const indent=line.match(/^\s*/)[0];if(indent)return replace('\n'+indent);
 }
 if(key==='Tab'){
  const last=value.indexOf('\n',end),finish=last<0?value.length:last,source=value.slice(lineStart,finish),lines=source.split('\n');
  const changed=lines.map(line=>shift?line.replace(/^(?: {1,2}|\t)/,''):'  '+line),text=changed.join('\n'),delta=text.length-source.length,first=changed[0].length-lines[0].length;
  return {value:value.slice(0,lineStart)+text+value.slice(finish),start:Math.max(lineStart,start+first),end:Math.max(lineStart,end+delta)};
 }
 const pairs={'(':')','[':']','{':'}','"':'"',"'":"'",'`':'`','*':'*','_':'_','$':'$'};
 if(key==='Backspace'&&start===end&&before&&after&&pairs[before.at(-1)]===after[0])return replace('',start-1,end+1,0);
 if(start===end&&['*','_','$'].includes(key)&&before.endsWith(key)&&!before.endsWith(key+key)&&after.startsWith(key))return replace(key+key,start,end,1);
 if(start===end&&[...Object.values(pairs)].includes(key)&&after.startsWith(key))return {value,start:start+1,end:end+1};
 if(pairs[key]){
  if(!selected&&/[\p{L}\p{N}]/u.test(before.at(-1)||'')&&['"',"'",'*','_','$'].includes(key))return null;
  if(!selected&&after&&/[\p{L}\p{N}]/u.test(after[0]))return null;
  const result=replace(key+selected+pairs[key],start,end,key.length);result.end=result.start+selected.length;return result;
 }
 return null;
}
export function applyMarkdownKey(input,event){if(event.isComposing||event.altKey)return false;const edit=markdownEdit(input.value,input.selectionStart,input.selectionEnd,event.key,{shift:event.shiftKey,mod:event.ctrlKey||event.metaKey});if(!edit)return false;event.preventDefault();if(edit.value!==input.value){input.setRangeText(edit.value,0,input.value.length,'end');input.setSelectionRange(edit.start,edit.end);input.dispatchEvent(new Event('input',{bubbles:true}))}else input.setSelectionRange(edit.start,edit.end);return true}
