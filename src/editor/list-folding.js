import {Plugin, PluginKey, TextSelection} from '@milkdown/kit/prose/state';
import {Decoration} from '@milkdown/kit/prose/view';

const key = new PluginKey('journal-list-folding');
const isList = node => node && ['bullet_list', 'ordered_list'].includes(node.type.name);

function nestedLists(item, pos) {
 const lists = [];
 if (item?.type.name === 'list_item') {
  item.forEach((node, offset) => {
   if (isList(node)) lists.push({from:pos+1+offset, to:pos+1+offset+node.nodeSize});
  });
 }
 return lists;
}

function selectionInside(selection, lists) {
 return lists.some(({from, to}) => [selection.anchor, selection.head].some(pos => pos > from && pos < to));
}

export const listFolding = new Plugin({
 key,
 state: {
  init: () => new Set(),
  apply(tr, previous) {
   const toggle = tr.getMeta(key);
   if (!previous.size && toggle === undefined) return previous;
   if (!tr.docChanged && !tr.selectionSet && toggle === undefined) return previous;

   const folded = new Set();
   for (const pos of previous) {
    const mapped = tr.mapping.mapResult(pos, 1);
    if (mapped.deletedAcross || mapped.pos === toggle) continue;
    const lists = nestedLists(tr.doc.nodeAt(mapped.pos), mapped.pos);
    if (lists.length && !selectionInside(tr.selection, lists)) folded.add(mapped.pos);
   }
   if (toggle !== undefined && !previous.has(toggle)) folded.add(toggle);
   return folded;
  }
 }
});

function activate(view, pos, keyboard) {
 const state = view.state;
 const lists = nestedLists(state.doc.nodeAt(pos), pos);
 if (!lists.length) return;
 const tr = state.tr.setMeta(key, pos).setMeta('addToHistory', false);
 if (!key.getState(state).has(pos) && selectionInside(state.selection, lists)) {
  tr.setSelection(TextSelection.near(state.doc.resolve(pos+2)));
 }
 view.dispatch(tr);
 if (keyboard) view.nodeDOM(pos)?.querySelector('.journal-list-toggle')?.focus({preventScroll:true});
}

export function addListDecorations(state, result) {
 const folded = key.getState(state);
 state.doc.descendants((node, pos) => {
  if (!isList(node)) return;
  node.forEach((item, offset, index) => {
   const at = pos+1+offset;
   const task = item.attrs.checked != null;
   const children = nestedLists(item, at);
   const collapsed = folded?.has(at);
   if (collapsed) {
    for (const {from, to} of children) result.push(Decoration.node(from, to, {class:'journal-list-folded'}));
   }
   if (task && !children.length) return;

   const marker = !task && node.type.name === 'ordered_list' ? (node.attrs.order+index)+'.' : '•';
   const toggle = !!children.length;
   result.push(Decoration.widget(at+1, view => {
    const element = document.createElement(toggle ? 'button' : 'span');
    element.className = marker === '•' ? 'journal-list-marker journal-list-bullet' : 'journal-list-marker';
    element.textContent = marker;
    element.onmousedown = event => event.preventDefault();
    if (toggle) {
     element.type = 'button';
     element.classList.add('journal-list-toggle');
     element.setAttribute('aria-expanded', String(!collapsed));
     element.setAttribute('aria-label', collapsed ? '展开子列表' : '折叠子列表');
     element.title = element.getAttribute('aria-label');
     element.onclick = event => activate(view, at, event.detail === 0);
    } else {
     element.setAttribute('aria-hidden', 'true');
     element.onclick = () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,at+2)));
      view.focus();
     };
    }
    return element;
   }, {key:`list:${at}:${marker}:${toggle}:${collapsed}`, side:-1, stopEvent:() => toggle}));
  });
 });
}
