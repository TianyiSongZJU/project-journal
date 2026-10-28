import test from 'node:test';
import assert from 'node:assert/strict';
import {createUIPreferences,sanitizeUIPreferences} from '../web/ui-preferences.js';
import {createViewMemory,sanitizeViewState} from '../web/view-state.js';

test('false preferences, independent list scopes and folded groups survive a new UI instance',()=>{
 const first=createUIPreferences();let changes=0;first.onChange(()=>changes++);
 first.saveList('project-list',{grouped:false,completed:true,folded:new Set(['科研',''])});
 first.saveList('record-project',{grouped:true,completed:false,folded:new Set(['报告'])});
 first.setFlag('deadlineGrouped',false);first.setPanel('year.distribution',false);
 const saved=first.snapshot();saved.flags.reviewDone=true;
 assert.equal(first.flag('reviewDone'),false,'snapshots must not mutate live preferences');
 const second=createUIPreferences();second.restore(JSON.parse(JSON.stringify(first.snapshot())));
 assert.equal(second.list('project-list').grouped,false);assert.equal(second.list('project-list').completed,true);
 assert.deepEqual([...second.list('project-list').folded],['科研','']);
 assert.equal(second.list('record-project').grouped,true);assert.equal(second.list('filter-project-list').grouped,true);
 assert.equal(second.panel('year.distribution',true),false);assert.equal(second.flag('deadlineGrouped',true),false);
 assert.equal(changes,4);
});
test('sanitization excludes transient fields, invalid types and deleted project panel keys',()=>{
 const ui=sanitizeUIPreferences({lists:{'project-list':{grouped:false,completed:'true',folded:['a','a',4],query:'private search'},unknown:{grouped:true}},flags:{foldersGrouped:false,reviewDone:'false',unknown:true},panels:{'year.distribution':false,'folder.a':true,'folder.deleted':true,unknown:true}},['a']);
 assert.deepEqual(ui,{lists:{'project-list':{grouped:false,folded:['a']}},flags:{foldersGrouped:false},panels:{'year.distribution':false,'folder.a':true}});
 assert.deepEqual(sanitizeUIPreferences(null),{lists:{},flags:{},panels:{}});
 const view=sanitizeViewState({ui,timeline:{hiddenClients:['mac','mac',8],compare:true}},['a']);
 assert.deepEqual(view.ui,ui);assert.deepEqual(view.timeline,{hiddenClients:['mac'],compare:true});
});
test('failed preference writes can be retried before close, while queued snapshots remain ordered',async()=>{
 let fail=true,current={ui:{flags:{foldersGrouped:false}}},saved=[];
 const memory=createViewMemory(()=>current,async(_url,options)=>{if(fail)return {ok:false};saved.push(JSON.parse(options.body));return {ok:true}});
 memory.enable();assert.equal(await memory.flush(),false);fail=false;assert.equal(await memory.flush(),true);
 current={ui:{flags:{foldersGrouped:true}}};const first=memory.flush();current={ui:{flags:{foldersGrouped:false}}};const second=memory.flush();
 assert.equal(await first,true);assert.equal(await second,true);assert.deepEqual(saved.map(x=>x.ui.flags.foldersGrouped),[false,true,false]);
});
