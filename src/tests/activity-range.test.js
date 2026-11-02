import test from 'node:test';
import assert from 'node:assert/strict';
import {activityRangeStats,observedDuration} from '../web/activity-range.js';
import {displayActivities} from '../web/app-aliases.js';

test('ranks every application in the selected quarters, excluding outside evidence and empty time',()=>{
 const activities=[{app:'ChatGPT',start:960,end:975,seconds:600},{app:'Typora',start:960,end:975,seconds:300},{app:'ChatGPT',start:975,end:990,seconds:450},{app:'WeChat',start:990,end:1005,seconds:800},{app:'Outside',start:930,end:945,seconds:900}];
 const before=JSON.stringify(activities),stats=activityRangeStats(activities,960,990);
 assert.deepEqual(stats.apps.map(({app,seconds})=>({app,seconds})),[{app:'ChatGPT',seconds:1050},{app:'Typora',seconds:300}]);
 assert.equal(stats.seconds,1350);assert.equal(stats.apps.reduce((sum,row)=>sum+row.percent,0),100);assert.equal(JSON.stringify(activities),before);
});
test('clips exact spans at range boundaries and unions duplicate evidence on each device',()=>{
 const rows=[{app:'Word',deviceId:'a',start:950,end:980},{app:'Word',deviceId:'a',start:960,end:975},{app:'Word',deviceId:'a',start:970,end:985}];
 assert.equal(activityRangeStats(rows,960,975).seconds,900);
});
test('matches chart semantics for overlapping devices and app aliases',()=>{
 const rows=displayActivities([{app:'Weixin',deviceId:'mac',start:960,end:975,seconds:300},{app:'wechat.exe',deviceId:'win',start:960,end:975,seconds:480}],{});
 const stats=activityRangeStats(rows,960,975);assert.equal(stats.apps.length,1);assert.equal(stats.apps[0].app,'微信');assert.equal(stats.seconds,480);assert.equal(stats.devices,2);
});
test('does not invent activity in empty quarters, and rounds display durations to minutes',()=>{
 assert.deepEqual(activityRangeStats([],960,975),{apps:[],seconds:0,devices:0});
 assert.equal(observedDuration(3631),'1小时1分');assert.equal(observedDuration(750),'13分');assert.equal(observedDuration(0),'0分');assert.equal(observedDuration(59),'<1分');assert.equal(observedDuration(835),'14分');assert.equal(observedDuration(1761),'29分');
});
