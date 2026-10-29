import test from 'node:test';
import assert from 'node:assert/strict';
import {sameAllocations,quarterSelection} from '../web/timeline-selection.js';
test('allocation comparison ignores JSON field order, record order and regenerated IDs but detects real edits',()=>{
 const a=[{id:'a',start:540,end:600,projectId:'one'},{id:'b',start:630,end:660,projectId:'two'}],b=[{projectId:'two',end:660,start:630,id:'new'},{projectId:'one',end:600,start:540}];
 assert(sameAllocations(a,b));assert(!sameAllocations(a,[...b,{start:700,end:715,projectId:'two'}]));assert(!sameAllocations(a,[]));assert(sameAllocations([{start:0,end:15,projectId:''}],[]));
});
test('reverse drag includes the initial quarter and exact-boundary downward selection retains its endpoint',()=>{
 assert.deepEqual(quarterSelection(1140,1110),{start:1110,end:1155});assert.deepEqual(quarterSelection(555,630),{start:555,end:630});assert.deepEqual(quarterSelection(600,615),{start:600,end:615});assert.deepEqual(quarterSelection(1425,1440),{start:1425,end:1440});assert.deepEqual(quarterSelection(0,0),{start:0,end:15});
});
