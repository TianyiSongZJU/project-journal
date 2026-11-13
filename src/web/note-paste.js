let cancelActivePaste;

export function cancelNotePaste() {
 if (!cancelActivePaste) return false;
 cancelActivePaste();
 return true;
}

function textFromHTML(html) {
 if (!html) return '';

 // Some apps supply rich text and an image without a plain-text flavor.
 const fragment = document.createElement('template');
 fragment.innerHTML = html;
 fragment.content.querySelectorAll('style,script,head,title').forEach(node => node.remove());
 for (const node of fragment.content.querySelectorAll('br,p,div,li,tr,h1,h2,h3,h4,h5,h6')) {
  node.after(document.createTextNode('\n'));
 }
 return fragment.content.textContent.trim();
}

export function mountNotePaste(wrap, {isEditorTarget, sourceMode, focusEditor, pasteText, pasteHTML, upload}) {
 const menu = document.createElement('div');
 menu.className = 'note-paste-menu';
 menu.setAttribute('role', 'group');
 menu.setAttribute('aria-label', '选择粘贴格式');
 menu.hidden = true;
 wrap.append(menu);

 function dismiss() {
  menu.hidden = true;
  menu.replaceChildren();
  document.removeEventListener('pointerdown', outside, true);
  if (cancelActivePaste === cancel) cancelActivePaste = undefined;
 }

 function outside(event) {
  if (!menu.contains(event.target)) dismiss();
 }

 function cancel() {
  focusEditor();
  dismiss();
 }

 wrap.addEventListener('paste', event => {
  const clipboard = event.clipboardData;
  if (!clipboard || !isEditorTarget(event.target)) return;

  const files = Array.from(clipboard.files || []).filter(file => file.type.startsWith('image/'));
  if (!files.length) {
   for (const item of clipboard.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
     const file = item.getAsFile();
     if (file) files.push(file);
    }
   }
  }
  const html = clipboard.getData('text/html');
  const plain = clipboard.getData('text/plain');
  const text = plain || textFromHTML(html);
  const choices = [];
  if (text) choices.push(['纯文本', () => pasteText(text)]);
  if (html && text && !sourceMode()) choices.push(['保留格式', () => pasteHTML(html)]);
  if (files.length) choices.push(['图片', () => upload(files)]);
  if (!choices.length || choices.length === 1 && !files.length && plain) return;

  event.preventDefault();
  event.stopPropagation();
  if (choices.length === 1) {
   choices[0][1]();
   return;
  }
  cancelNotePaste();
  for (const [label, apply] of choices) {
   const button = document.createElement('button');
   button.type = 'button';
   button.textContent = label;
   button.onclick = () => { apply(); dismiss(); };
   menu.append(button);
  }
  const viewportTop = wrap.closest('dialog,main')?.getBoundingClientRect().top ?? 0;
  menu.style.top = Math.max(6, viewportTop + 6 - wrap.getBoundingClientRect().top) + 'px';
  menu.hidden = false;
  document.addEventListener('pointerdown', outside, true);
  cancelActivePaste = cancel;
  menu.firstElementChild.focus({preventScroll:true});
 }, true);

 return dismiss;
}
