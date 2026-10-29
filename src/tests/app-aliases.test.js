import test from 'node:test';
import assert from 'node:assert/strict';
import {appNameResolver,displayActivities,validateAppAliases,DEFAULT_APP_ALIASES} from '../web/app-aliases.js';
import {activitySlots,applicationRuns} from '../web/timeline-layout.js';
test('default aliases join platform names exactly, preserving distinct applications and source evidence',()=>{
 const name=appNameResolver({});
 for(const app of ['Weixin','wechat.EXE','微信'])assert.equal(name(app),'微信');
 assert.equal(name('msedge.exe'),'Microsoft Edge');assert.equal(name('Microsoft Word.exe'),'Word');
 assert.equal(name('clash-verge.exe'),'Clash Verge');assert.equal(name('WeChatAppEx.exe'),'微信扩展');assert.equal(name('AppleMusic.exe'),'AppleMusic');assert.equal(name('项目手记-Windows.exe'),'项目手记');assert.equal(name('ChatGPT.exe'),'ChatGPT');assert.equal(name('WeChat Helper'),'WeChat Helper');
 assert.notEqual(name('Google Chrome'),name('Microsoft Edge'));
 const raw=[{app:'Weixin.exe',deviceId:'a',start:0,end:15,seconds:300},{app:'微信',deviceId:'b',start:0,end:15,seconds:400}],before=JSON.stringify(raw),shown=displayActivities(raw,{});
 assert.equal(activitySlots(shown,0,15)[0].apps[0].seconds,400);assert.equal(JSON.stringify(raw),before);
 assert.deepEqual(validateAppAliases(DEFAULT_APP_ALIASES),DEFAULT_APP_ALIASES);
});
test('custom aliases replace defaults; an empty setting disables merges and ambiguous names are rejected',()=>{
 const settings={appAliases:[{name:'写作',aliases:['WINWORD','Microsoft Word']}]};
 assert.equal(appNameResolver(settings)('winword.exe'),'写作');assert.equal(appNameResolver(settings)('Weixin'),'Weixin');
 assert.equal(appNameResolver({appAliases:[]})('WeChat.exe'),'WeChat');
 assert.throws(()=>validateAppAliases([{name:'A',aliases:['WeChat']},{name:'B',aliases:['wechat.exe']}]));
 assert.throws(()=>validateAppAliases([{name:'',aliases:['Word']}]));
});
test('each local block gets its application name regardless of daily rank; incidental use stays in other',()=>{
 const data=['A','B','C','D','E'].flatMap((app,i)=>[{app,start:i*15,end:i*15+15,seconds:850},{app:'tiny',start:i*15,end:i*15+15,seconds:50}]);
 const before=JSON.stringify(data),r=applicationRuns(data,0,75);
 for(const app of ['A','B','C','D','E'])assert(r.runs.some(run=>run.app===app));
 assert(!r.columns.includes('tiny'));assert(r.runs.filter(run=>run.app==='其他').every(run=>run.apps.has('tiny')));
 assert.equal(r.runs.reduce((n,r)=>n+r.seconds,0),4500);assert.equal(JSON.stringify(data),before);
});
test('local substantial shares stay named without a fixed column cap, while minor shares can rejoin other',()=>{
 const data=[['A',400],['B',250],['C',250],['D',300]].map(([app,seconds])=>({app,seconds,start:0,end:15}));
 data.push({app:'A',seconds:880,start:15,end:30},{app:'B',seconds:20,start:15,end:30});
 const r=applicationRuns(data,0,30);for(const app of ['A','B','C','D'])assert(r.columns.includes(app));
 assert.equal(r.runs.find(run=>run.app==='B').end,15);assert.equal(r.runs.find(run=>run.app==='其他').apps.get('B'),20);
 for(const at of [0,15])assert(r.runs.flatMap(run=>run.slots).filter(s=>s.at===at).reduce((n,s)=>n+s.width,0)<=100.00001);
});
test('small rank fluctuations keep observed use connected; real switches and empty quarters break it',()=>{
 const data=[{app:'A',start:0,end:15,seconds:800},{app:'A',start:15,end:30,seconds:20},{app:'B',start:15,end:30,seconds:40},{app:'A',start:30,end:45,seconds:800}];
 assert.equal(applicationRuns(data,0,45).runs.filter(r=>r.app==='A').length,1);
 data[2].seconds=800;assert.equal(applicationRuns(data,0,45).runs.filter(r=>r.app==='A').length,2);
 assert.equal(applicationRuns([data[0],data[3]],0,45).runs.filter(r=>r.app==='A').length,2);
});
