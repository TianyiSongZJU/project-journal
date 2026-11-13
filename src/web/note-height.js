import {desktopIcon} from './desktop-icons.js';
import {uiPreferences, noteHeightRange} from './ui-preferences.js';

const defaults = new Map([
 ['project-note', 260],
 ['inspector-project-note', 240],
 ['inspector-note', 220],
 ['weekly-note', 240],
 ['record-note', 180]
]);

export function mountNoteHeight(input, wrap) {
 const defaultHeight = defaults.get(input.id);
 if (!defaultHeight) return;

 const grip = document.createElement('div');
 grip.className = 'note-height-grip';
 grip.innerHTML = desktopIcon('resize');
 grip.tabIndex = 0;
 grip.setAttribute('role', 'separator');
 grip.setAttribute('aria-orientation', 'horizontal');
 grip.setAttribute('aria-label', '调整笔记编辑区高度');
 grip.title = '拖动调整高度，也可使用上下方向键';
 grip.setAttribute('aria-valuemin', noteHeightRange.min);
 grip.setAttribute('aria-valuemax', noteHeightRange.max);
 wrap.append(grip);
 wrap.classList.add('has-note-height');

 let key, height, drag;
 function display(value) {
  height = Math.max(noteHeightRange.min, Math.min(noteHeightRange.max, Math.round(value)));
  wrap.style.setProperty('--note-height', height + 'px');
  grip.setAttribute('aria-valuenow', height);
 }
 input._markdownRestoreHeight = () => {
  const next = input.dataset.noteHeightKey || input.id;
  if (key !== next) {
   if (drag && grip.hasPointerCapture(drag.pointerId)) grip.releasePointerCapture(drag.pointerId);
   drag = null;
   key = next;
  }
  const saved = uiPreferences.noteHeight(key) ?? defaultHeight;
  if (!drag && saved !== height) display(saved);
 };
 input._markdownRestoreHeight();

 grip.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  drag = {pointerId:event.pointerId, y:event.clientY, height};
  grip.setPointerCapture(event.pointerId);
 });
 grip.addEventListener('pointermove', event => {
  if (drag?.pointerId === event.pointerId) display(drag.height + event.clientY - drag.y);
 });
 grip.addEventListener('pointerup', event => {
  if (drag?.pointerId !== event.pointerId) return;
  drag = null;
  uiPreferences.setNoteHeight(key, height);
 });
 grip.addEventListener('lostpointercapture', () => {
  if (!drag) return;
  display(drag.height);
  drag = null;
 });
 grip.addEventListener('keydown', event => {
  const step = event.shiftKey ? 50 : 10;
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = {ArrowUp:height-step, ArrowDown:height+step, Home:noteHeightRange.min, End:noteHeightRange.max}[event.key];
  display(next);
  uiPreferences.setNoteHeight(key, height);
 });
}
