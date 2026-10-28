import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTimeReview,sanitizeTimeReview,timeReviewRange,timeReviewDayCount} from '../web/time-review-model.js';
import {sanitizeViewState} from '../web/view-state.js';
const date='2026-10-28',block=(start,end,projectId='a')=>({id:`${start}/${projectId}`,start,end,projectId});
function fixture(){return {projects:[{id:'a',name:'论文',color:'#315c46'},{id:'b',name:'实验',color:'#aabbaa'}],settings:{estimates:{中:2}},entries:[{projectId:'a',date,kind:'hours',hours:3.5},{projectId:'b',date,kind:'中',hours:0}],timelineDays:{[date]:{applied:[block(420,480),block(540,630)],blocks:[block(420,480),block(540,630),block(900,960,'b')]}}}}
const options={start:date,end:date,startHour:8};
test('time review uses applied allocations only, keeps unlocated totals separate, and reports hidden early time',()=>{
 const state=fixture(),before=structuredClone(state),m=buildTimeReview(state,options);
 assert.equal(m.totalMinutes,150);assert.equal(m.visibleMinutes,90);assert.equal(m.hiddenMinutes,60);
 assert.equal(m.unlocatedHours,3);assert.equal(m.estimatedHours,2);assert.equal(m.recordedDays,1);assert.equal(m.summary.length,64);
 assert.equal(m.rows[0].cells[4].minutes,15);assert.equal(m.rows[0].cells[28].minutes,0,'unconfirmed selection is excluded');
 assert.deepEqual(m.rows[0].projectMinutes,[{projectId:'a',minutes:150}],'daily distribution includes early hours but excludes unconfirmed blocks');assert.equal(m.rows[0].unlocatedHours,3);
 assert.equal(m.summary.reduce((s,c)=>s+c.minutes,0),90);assert.deepEqual(state,before,'review must not modify records');
 const all=buildTimeReview(state,{...options,startHour:0});assert.equal(all.summary.length,96);assert.equal(all.visibleMinutes,150);assert.equal(all.hiddenMinutes,0);
});
test('project filters include confirmed blocks even without an entry and ignore unknown projects and malformed times',()=>{
 const state=fixture();state.timelineDays[date].applied.push(block(720,765,'b'),block(100,200,'deleted'),block(-1,600),block(900,1500));
 const m=buildTimeReview(state,{...options,projectIds:['b']});assert.equal(m.totalMinutes,45);assert.equal(m.unlocatedHours,1.25);assert.deepEqual(m.usedProjects,['b']);
 state.entries=[];assert.equal(buildTimeReview(state,{...options,projectIds:['b']}).totalMinutes,45);
});
test('duplicate and overlapping allocations count unique minutes and flag ambiguous attribution',()=>{
 const state=fixture();state.timelineDays[date].applied=[block(540,600),block(540,600),block(570,630,'b')];
 const m=buildTimeReview(state,options);assert.equal(m.totalMinutes,90);assert.equal(m.conflictMinutes,30);assert.equal(m.summary.reduce((s,c)=>s+c.minutes,0),90);
 assert.deepEqual(m.rows[0].cells[6].parts,[{projectId:'!conflict',minutes:15}]);assert.equal(m.rows[0].projectMinutes.reduce((n,p)=>n+p.minutes,0),90,'daily hover totals use unique minutes including a separate conflict bucket');
});
test('ranges retain empty dates, support leap day and have a bounded size',()=>{
 const state=fixture();const m=buildTimeReview(state,{start:'2024-02-28',end:'2024-03-01'});assert.equal(m.rows.length,3);assert.equal(m.rows[1].date,'2024-02-29');assert.equal(m.totalMinutes,0);assert(m.rows.every(r=>r.cells.every(c=>c.minutes===0)));
 assert.throws(()=>buildTimeReview(state,{start:'2026-02-30',end:'2026-03-05'}));assert.throws(()=>buildTimeReview(state,{start:'2026-10-29',end:date}));
 assert.equal(buildTimeReview(state,{start:'2024-01-01',end:'2024-12-31'}).rows.length,366);
 assert.throws(()=>buildTimeReview(state,{start:'2024-01-01',end:'2025-01-01'}),/366/);
 assert.equal(timeReviewDayCount('2025-03-08','2026-03-08'),366,'date counts do not depend on DST');
});
test('missing estimates are reported rather than invented and existing other-time fields take precedence',()=>{
 const state=fixture();state.settings.estimates={};const m=buildTimeReview(state,options);assert.equal(m.missingEstimates,1);assert.equal(m.unlocatedHours,1);
 state.entries[0]={projectId:'a',date,kind:'hours',hours:3,otherKind:'hours',otherHours:.5};assert.equal(buildTimeReview(state,options).unlocatedHours,.5);
});
test('fixed date windows migrate old preferences and support either endpoint across month and leap boundaries',()=>{
 const saved={start:'2026-10-15',end:date,startHour:0,colorMode:'project',preset:'14',anchorSide:'end',selectedDate:'2026-10-20',scrollTop:25,scrollLeft:0};
 assert.deepEqual(sanitizeTimeReview(saved,date),saved);
 assert.equal(sanitizeTimeReview({...saved,selectedDate:'2026-09-30'},date).selectedDate,'');
 const v=sanitizeViewState({mode:'time',timeReview:saved});assert.equal(v.mode,'time');assert.deepEqual(v.timeReview,saved);
 assert.deepEqual(timeReviewRange('7',date),{start:'2026-10-22',end:date,preset:'7',anchorSide:'end'});
 assert.deepEqual(timeReviewRange('30','2024-02-01','start'),{start:'2024-02-01',end:'2024-03-01',preset:'30',anchorSide:'start'});
 const legacy=sanitizeTimeReview({start:'2025-01-01',end:date,preset:'custom'},date);assert.equal(timeReviewDayCount(legacy.start,legacy.end),14);
 assert.equal(sanitizeTimeReview({end:date,preset:'28'},date).preset,'30');
});
