import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingSuggestionDays} from '../web/suggestion-history.js';
const day='2026-10-29';
const activity=(date=day,at=9)=>({id:date+'/'+at,date,kind:'activity',deviceId:'demo',bucketStart:new Date(date+`T${String(at).padStart(2,'0')}:00:00`).getTime()/1000,seconds:900,projectId:'p',attribution:{document:900}});
const sample=()=>({start:'2026-10-24',end:'2026-10-31',projectIds:['p'],evidence:[activity(),activity('2026-10-31'),activity('2026-10-23')],timelineDays:{},rules:{}});
test('reminders reuse suggestions and exclude today, old dates and covered or acknowledged days',()=>{
 const s=sample(),before=JSON.stringify(s);assert.deepEqual(pendingSuggestionDays(s),[{date:day,count:1,minutes:15}]);assert.equal(JSON.stringify(s),before);
 for(const field of ['blocks','applied'])assert.deepEqual(pendingSuggestionDays({...s,timelineDays:{[day]:{[field]:[{start:540,end:555,projectId:'p'}]}}}),[]);
 assert.deepEqual(pendingSuggestionDays({...s,dateStamps:{[day]:'current'},timelineRead:{[day]:'current'}}),[]);
 assert.equal(pendingSuggestionDays({...s,dateStamps:{[day]:'new'},timelineRead:{[day]:'old'}}).length,1);
 assert.deepEqual(pendingSuggestionDays({...s,rules:{document:false}}),[]);
 assert.deepEqual(pendingSuggestionDays({...s,evidence:[{date:day,id:'file',kind:'file',projectId:'p',name:'one.txt',at:day+'T09:00:00'}]}),[]);
});
test('partial selections keep uncovered suggestions and consecutive quarters merge',()=>{
 const s={...sample(),evidence:[activity(day,9),{...activity(day,9),id:'next',bucketStart:activity().bucketStart+900}]};
 assert.deepEqual(pendingSuggestionDays(s),[{date:day,count:1,minutes:30}]);
 assert.deepEqual(pendingSuggestionDays({...s,timelineDays:{[day]:{blocks:[{start:540,end:555}]}}}),[{date:day,count:1,minutes:15}]);
});
