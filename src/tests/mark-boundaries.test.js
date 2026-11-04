import test from 'node:test';import assert from 'node:assert/strict';
import {markArrow} from '../editor/mark-boundaries.js';
const mark=name=>({type:{name},eq(other){return other.type.name===name}}),bold=mark('strong'),italic=mark('emphasis'),link=mark('link'),code=mark('inlineCode');
const state=(before,after,active=null,collapsed=true)=>({storedMarks:active,selection:{empty:collapsed,$from:{nodeBefore:{marks:before},nodeAfter:{marks:after},marks:()=>before.length?before:after}}});
test('arrows reach both sides of the end of bold and italic without adding text',()=>{
 for(const m of [bold,italic,code]){assert.deepEqual(markArrow(state([m],[]),'ArrowRight'),[]);assert.deepEqual(markArrow(state([m],[],[]),'ArrowLeft'),[m]);assert.equal(markArrow(state([m],[],[]),'ArrowRight'),null)}
});
test('the opening boundary can also be left and re-entered',()=>{
 assert.deepEqual(markArrow(state([],[bold]),'ArrowLeft'),[]);assert.deepEqual(markArrow(state([],[bold],[]),'ArrowRight'),[bold]);assert.equal(markArrow(state([],[bold],[]),'ArrowLeft'),null);
});
test('nested emphasis clears only ending styles and preserves unrelated marks',()=>{
 assert.deepEqual(markArrow(state([bold,italic,link],[]),'ArrowRight'),[link]);assert.deepEqual(markArrow(state([bold,italic],[bold]),'ArrowRight'),[bold]);assert.equal(markArrow(state([bold],[bold]),'ArrowRight'),null);assert.equal(markArrow(state([bold],[],null,false),'ArrowRight'),null);
});
