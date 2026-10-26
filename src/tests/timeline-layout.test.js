import test from 'node:test';import assert from 'node:assert/strict';
import {activitySlots,fileSlots,fileRuns,applicationRuns,applicationLinks} from '../web/timeline-layout.js';
test('dense foreground switches produce at most one label per quarter hour',()=>{
 const activities=Array.from({length:180},(_,i)=>({start:1260+i/3,end:1260+(i+1)/3,app:['Word','ChatGPT','PowerPoint'][i%3],name:'长文件名-'+i,projectId:'a'}));
 const slots=activitySlots(activities,480,1440);assert.equal(slots.length,4);assert.equal(slots.reduce((n,s)=>n+s.hits.length,0),180);assert.ok(slots.every(s=>s.apps.length===3&&s.apps.reduce((n,a)=>n+a.percent,0)===100));
});
test('overlapping copies do not inflate dominant-app ranking',()=>{
 const activities=[...Array.from({length:8},()=>({start:600,end:603,app:'ChatGPT',name:'ChatGPT'})),{start:600,end:610,app:'Word',name:'计划书.docx'}];
 const slots=activitySlots(activities,600,615);assert.equal(slots[0].app,'Word');assert.equal(slots[0].name,'计划书.docx');assert.equal(slots[0].hits.length,9);
});
test('file labels are bucketed and preserve complete observations',()=>{
 const files=Array.from({length:100},(_,i)=>({at:1260+i/10,name:'报告-'+(i%5)+'.pptx'}));
 files.push({at:30,name:'凌晨旧文件'});const slots=fileSlots(files,480,1440);assert.equal(slots.length,1);assert.equal(slots[0].items.length,100);assert.equal(slots[0].names.length,5);assert.equal(slots[0].at,1260);
});

test('summary counters and raw history share the same percentage presentation',()=>{const slots=activitySlots([{start:600,end:615,app:'Word',seconds:540},{start:600,end:615,app:'ChatGPT',seconds:270},{start:600,end:615,app:'微信',seconds:90}],600,615);assert.deepEqual(slots[0].apps.map(a=>a.percent),[60,30,10]);assert.equal(slots[0].major.length,2);assert.equal(slots[0].otherPercent,10);assert.equal(slots[0].minor[0].app,'微信')});
test('repeated modifications retain one file row per path within each quarter',()=>{const slots=fileSlots(Array.from({length:300},(_,i)=>({at:600+i/100,name:'重复文件.docx',path:'draft/重复文件.docx',projectId:'a'})),600,615);assert.equal(slots.length,1);assert.equal(slots[0].files.length,1);assert.equal(slots[0].files[0].count,300)});

test('same physical file across project bindings is still one file; distinct paths stay separate',()=>{const s=fileSlots([{at:600,name:'同名.docx',path:'/one/同名.docx',projectId:'a'},{at:601,name:'同名.docx',path:'/one/同名.docx',projectId:'b'},{at:602,name:'同名.docx',path:'/two/同名.docx',projectId:'a'}],600,615);assert.equal(s[0].files.length,2);assert.equal(s[0].files[0].count,2)});

test('adjacent identical physical file sets merge without losing counts or time bounds',()=>{
 const files=[{at:600,name:'报告',path:'/a'},{at:610,name:'报告',path:'/a'},{at:620,name:'报告',path:'/a'},{at:637,name:'报告',path:'/b'},{at:680,name:'报告',path:'/b'}];
 const runs=fileRuns(files,480,1440);assert.equal(runs.length,3);assert.equal(runs[0].at,600);assert.equal(runs[0].end,630);assert.equal(runs[0].files[0].count,3);assert.equal(runs[0].files[0].first,600);assert.equal(runs[0].files[0].last,620);assert.equal(runs.reduce((n,r)=>n+r.items.length,0),5);
});

test('application runs keep stable columns, label continuous use once and split gaps',()=>{const data=applicationRuns([{app:'A',start:600,end:645},{app:'B',start:615,end:630},{app:'A',start:660,end:675}],480,1440);assert.equal(data.runs.filter(r=>r.app==='A').length,2);assert.equal(data.runs[0].start,600);assert.equal(data.runs[0].end,645);assert.equal(data.runs[0].seconds,2700);assert.equal(data.runs[0].lane,data.runs.at(-1).app==='A'?data.runs.at(-1).lane:0)});

test('area width uses absolute observed minutes and leaves unobserved time blank',()=>{const d=applicationRuns([{app:'A',start:600,end:615,seconds:450},{app:'B',start:600,end:615,seconds:150}],480,1440);const a=d.runs.find(r=>r.app==='A').slots[0],b=d.runs.find(r=>r.app==='其他').slots[0];assert.equal(a.width,50);assert.equal(a.left,0);assert.ok(Math.abs(b.width-100/6)<.001);assert.equal(b.left,50);assert.ok(a.width+b.width<100)});

test('same application evidence uses the maximum across simultaneous devices',()=>{const slots=activitySlots([{start:540,end:555,app:'Word',seconds:360,deviceId:'mac'},{start:540,end:555,app:'Word',seconds:360,deviceId:'windows'}],540,555);assert.equal(slots[0].activeSeconds,360);assert.equal(slots[0].apps[0].seconds,360)});

test('thin connectors join only adjacent displaced blocks and never cover empty quarters',()=>{
 const slots=[{at:540,left:0,width:25},{at:555,left:70,width:25},{at:570,left:60,width:30},{at:600,left:0,width:20}],before=JSON.stringify(slots),links=applicationLinks(slots,540,1);
 assert.equal(links.length,1);assert.equal(links[0].at,555);assert.match(links[0].path,/^M/);assert.equal(JSON.stringify(slots),before);
 assert.equal(applicationLinks(slots,540,.15).length,1);
});
