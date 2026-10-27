import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeViewState,createViewMemory,validViewDate} from '../web/view-state.js';
test('view restoration discards removed projects, invalid dates and unsupported pages',()=>{
 const value=sanitizeViewState({page:'unknown',mode:'month',date:'2026-02-30',currentProject:'deleted',inspectorProject:'a',filterIds:['a','deleted','a'],timeline:{visibleHours:100,scrollMinute:-4},scroll:{main:Infinity,year:42}},['a']);
 assert.equal(value.page,'review');assert.equal(value.mode,'month');assert.equal(value.currentProject,null);assert.equal(value.inspectorProject,'a');assert.deepEqual(value.filterIds,['a']);assert.equal(value.date,undefined);assert.deepEqual(value.timeline,{});assert.deepEqual(value.scroll,{year:42});assert(validViewDate('2024-02-29'));assert(!validViewDate('2026-02-29'));
});
test('local view saves are serialized and do not save initial defaults before restoring',async()=>{
 let current={page:'auto'},calls=[];const store=createViewMemory(()=>current,async(url,opts)=>{if(!opts)return {ok:true,json:async()=>({page:'projects'})};calls.push(JSON.parse(opts.body));return {ok:true}});
 assert.equal((await store.load()).page,'projects');await store.flush();assert.deepEqual(calls,[]);store.enable();const first=store.flush();current={page:'settings'};const second=store.flush();await Promise.all([first,second]);assert.deepEqual(calls,[{page:'auto'},{page:'settings'}]);await store.flush();assert.equal(calls.length,2);
});
