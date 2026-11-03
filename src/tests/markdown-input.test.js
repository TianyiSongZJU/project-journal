import test from 'node:test';import assert from 'node:assert/strict';
import {markdownEdit} from '../web/markdown-input.js';import {markdownBlocks} from '../web/markdown-live.js';
const key=(text,key,options={})=>markdownEdit(text,text.length,text.length,key,options);
test('lists continue, ordered numbers increment and empty items exit',()=>{
 for(const [text,expected]of [['- item','- item\n- '],['2. item','2. item\n3. '],['  - [x] done','  - [x] done\n  - [ ] '],['> quote','> quote\n> '],['- ',''],['  - [ ] ','']])assert.equal(key(text,'Enter').value,expected);
 assert.equal(key('- item','Enter',{shift:true}),null);
 const edit=markdownEdit('- a\n- b',0,7,'Tab');assert.equal(edit.value,'  - a\n  - b');assert.equal(markdownEdit(edit.value,edit.start,edit.end,'Tab',{shift:true}).value,'- a\n- b');
});
test('paired symbols wrap selections, skip closers and delete together',()=>{
 assert.deepEqual(markdownEdit('word',0,4,'*'),{value:'*word*',start:1,end:5});assert.equal(key('x','(').value,'x()');
 assert.deepEqual(markdownEdit('()',1,1,'Backspace'),{value:'',start:0,end:0});assert.equal(markdownEdit('()',1,1,')').value,'()');assert.equal(markdownEdit('**',1,1,'*').value,'****');
 assert.equal(markdownEdit('中文',2,2,'*'),null);assert.equal(markdownEdit('',0,0,'Backspace'),null);
});
test('paragraph offsets preserve the exact source and fenced blank lines stay in one block',()=>{
 const source='# 标题\n\n段落\n\n```\na\n\nb\n```\n\n$$\na\n\nb\n$$';const blocks=markdownBlocks(source);assert.equal(blocks.length,4);assert.equal(blocks.map(b=>source.slice(b.start,b.end)).join(''),source);assert.equal(markdownBlocks('段落\n\n').at(-1).start,4);
});
