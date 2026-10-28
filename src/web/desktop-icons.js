const paths={
  saved:'<circle cx="10" cy="10" r="7"/><path d="m6.5 10 2.3 2.3 4.7-4.8"/>',
  saving:'<path d="M17 10a7 7 0 1 1-4.2-6.4"/>',
  error:'<path d="m10 3 8 14H2zM10 7v4m0 3v.3"/>',
  trash:'<path d="M4 6h12M8 3h4l1 3M6 6l.8 11h6.4L14 6M9 9v5m3-5v5"/>',
  eye:'<path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10Z"/><circle cx="10" cy="10" r="2.5"/>',
  edit:'<path d="m4 13 9-9 3 3-9 9-4 1zM11 6l3 3"/>',
  resize:'<path d="m6 16 10-10m-5 10 5-5"/>'
};
export const desktopIcon=name=>`<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.saved}</svg>`;
export const saveState=text=>/失败|错误|冲突|未保存/.test(text)?'error':/保存中|正在/.test(text)?'saving':'saved';
export function renderDesktopSaveStatus(element,text){
  if(!element)return;
  element.dataset.state=saveState(text);element.classList.add('desktop-save-state');
  element.setAttribute('role','status');element.setAttribute('aria-label',text);element.title=text;
  element.innerHTML=desktopIcon(element.dataset.state);
}
