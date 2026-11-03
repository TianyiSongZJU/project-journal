// A portal keeps the journal action outside the heatmap's measured grid and scroll clip.
export function setupYearWeekHover({calendar,getMode,isBusy,onOpen,getTitle,weekStart}){
 const button=document.createElement('button');button.type='button';button.className='year-week-hover';button.hidden=true;
 button.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.5h8l2 2V16.5H5zM8 8h4M8 11h4M8 14h2"/></svg>';document.body.append(button);
 let timer=null;
 const cancel=()=>{clearTimeout(timer);timer=null};
 const hide=()=>{cancel();button.hidden=true};
 function show(cell){
  if(getMode()!=='year'||isBusy())return hide();
  const rect=cell.getBoundingClientRect(),viewport=calendar.getBoundingClientRect();
  if(rect.right<viewport.left||rect.left>viewport.right)return hide();
  cancel();const week=weekStart(cell.dataset.date);button.dataset.week=week;button.title=getTitle(week);button.setAttribute('aria-label',getTitle(week));button.hidden=false;
  button.style.left=Math.max(6,Math.min(innerWidth-32,rect.left+rect.width/2-13))+'px';button.style.top=Math.max(6,Math.min(innerHeight-32,rect.bottom+4))+'px';
 }
 const defer=()=>{cancel();timer=setTimeout(()=>{if(!button.matches(':hover,:focus'))hide()},180)};
 calendar.addEventListener('pointerover',event=>{const cell=event.target.closest('[data-date]');if(cell)show(cell)});
 calendar.addEventListener('pointerout',event=>{if(event.relatedTarget!==button&&!button.contains(event.relatedTarget))defer()});
 calendar.addEventListener('focusin',event=>{const cell=event.target.closest('[data-date]');if(cell)show(cell)});
 calendar.addEventListener('focusout',event=>{if(!button.contains(event.relatedTarget))defer()});
 button.addEventListener('pointerenter',cancel);button.addEventListener('pointerleave',defer);button.addEventListener('focus',cancel);button.addEventListener('blur',defer);
 button.onclick=async()=>{const date=button.dataset.week;hide();await onOpen(date)};
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);document.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});
 return {hide};
}
