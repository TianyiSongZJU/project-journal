import {Plugin, TextSelection} from '@milkdown/kit/prose/state';

export function noteCaret(surface) {
 return new Plugin({
  view(view) {
   const wrapper=surface.parentElement;
   const doc=surface.ownerDocument,win=doc.defaultView;
   const caret=doc.createElement('span');
   caret.className='journal-note-caret';
   caret.setAttribute('aria-hidden','true');
   caret.hidden=true;
   wrapper.append(caret);
   let frame=0,previous='';

   function hide(){
    caret.hidden=true;
    view.dom.classList.remove('journal-painted-caret');
    previous='';
   }
   function draw(){
    frame=0;
    const selection=view.state.selection;
    if(!view.hasFocus()||view.composing||!(selection instanceof TextSelection)||!selection.empty||surface.hidden){
     hide();return;
    }
    const native=doc.getSelection();
    let rect;
    if(native?.isCollapsed&&native.rangeCount&&view.dom.contains(native.focusNode)){
     const range=native.getRangeAt(0);
     rect=range.getClientRects()[0];
    }
    if(!rect?.height)rect=view.coordsAtPos(selection.head);
    const outer=wrapper.getBoundingClientRect(),clip=surface.getBoundingClientRect();
    const minX=clip.left+surface.clientLeft;
    const maxX=minX+surface.clientWidth;
    const top=Math.max(rect.top,clip.top+surface.clientTop);
    const bottom=Math.min(rect.bottom,clip.top+surface.clientTop+surface.clientHeight);
    if(maxX<=minX||bottom<=top||rect.left<minX-1||rect.left>maxX+1){hide();return}
    const x=Math.max(minX,Math.min(maxX-1,rect.left));
    const geometry=[x-outer.left-wrapper.clientLeft,top-outer.top-wrapper.clientTop,bottom-top];
    if(geometry.join(',')!==previous){
     const [left,y,height]=geometry;
     caret.style.left=left+'px';
     caret.style.top=y+'px';
     caret.style.height=height+'px';
     caret.classList.remove('is-blinking');
     void caret.offsetWidth;
     caret.classList.add('is-blinking');
     previous=geometry.join(',');
    }
    caret.hidden=false;
    view.dom.classList.add('journal-painted-caret');
   }
   function schedule(){if(!frame&&(!caret.hidden||view.hasFocus()))frame=win.requestAnimationFrame(draw)}
   const events=['focusin','focusout','compositionstart','compositionend'];
   for(const name of events)view.dom.addEventListener(name,schedule);
   doc.addEventListener('selectionchange',schedule);
   win.addEventListener('scroll',schedule,true);
   const resize=new ResizeObserver(schedule);
   resize.observe(view.dom);
   resize.observe(surface);
   return {update:schedule,destroy(){
    win.cancelAnimationFrame(frame);
    for(const name of events)view.dom.removeEventListener(name,schedule);
    doc.removeEventListener('selectionchange',schedule);
    win.removeEventListener('scroll',schedule,true);
    resize.disconnect();
    hide();
    caret.remove();
   }};
  }
 });
}
