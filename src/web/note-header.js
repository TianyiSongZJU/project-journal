// One layout and one optical alignment rule for every Markdown note surface.
// SVG paint bounds and text ink bounds matter here, rather than line-box size.
let measure;
export function mountNoteHeader(heading,actions,input){
 if(!heading)return null;
 heading.classList.add('markdown-heading','note-header');
 const status=heading.querySelector('.desktop-save-state,[role=status],#note-status,#record-info,#inspector-save-status,#inspector-project-save-status');
 const title=document.createElement('span');title.className='note-header-title';
 const label=heading.querySelector(':scope>strong,:scope>h2')||document.createElement('span');
 if(!label.parentNode){const nodes=[...heading.childNodes].filter(node=>node.nodeType===3);label.textContent=nodes.map(node=>node.textContent).join('').trim();nodes.forEach(node=>node.remove())}
 label.classList.add('note-header-label');heading.prepend(title);title.append(label);
 if(status){status.classList.remove('hint');title.append(status)}
 heading.append(actions);
 // Legacy controls retain their IDs/handlers for existing form integrations,
 // but all note surfaces expose the same image/source actions to the user.
 for(const button of heading.querySelectorAll('button:not(.markdown-mode button)'))button.classList.add('note-obsolete-action');
 for(const button of document.querySelectorAll(`[data-clear-note="${CSS.escape(input.id)}"]`))button.classList.add('note-obsolete-action');
 let frame=null,disposed=false;
 const align=()=>{frame=null;if(disposed||!heading.isConnected||!status)return;
  const style=getComputedStyle(label);measure??=document.createElement('canvas').getContext('2d');
  measure.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ink=measure.measureText(label.textContent.trim()),ascent=ink.actualBoundingBoxAscent,descent=ink.actualBoundingBoxDescent;
  // The SVG contributes its bottom edge as a flex baseline. Drop that edge to
  // the text's ink bottom, and size the viewport to the actual painted glyphs.
  status.style.setProperty('--note-status-size',Math.max(1,ascent+descent)+'px');
  status.style.setProperty('--note-status-drop',descent+'px');
 };
 const schedule=()=>{if(!disposed&&frame===null)frame=requestAnimationFrame(align)};
 if(status)status._alignNoteHeader=schedule;
 document.fonts?.ready.then(schedule);schedule();
 input._noteHeaderDestroy=()=>{disposed=true;if(frame!==null)cancelAnimationFrame(frame);if(status)delete status._alignNoteHeader};
 return status;
}
