import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deferredSync} from '../editor/deferred-sync.js';
test('typing coalesces snapshots, max wait checkpoints, explicit save flushes and resets cancel',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const pending=deferredSync(()=>calls++,{delay:300,maxWait:1500});
 for(let i=0;i<10;i++){pending.schedule();t.mock.timers.tick(100)}
 assert.equal(calls,0);t.mock.timers.tick(300);assert.equal(calls,1);
 for(let i=0;i<16;i++){pending.schedule();t.mock.timers.tick(100)}
 assert.equal(calls,2,'continuous input receives a bounded checkpoint');pending.flush();assert.equal(calls,3);t.mock.timers.tick(2000);assert.equal(calls,3);
 pending.schedule();pending.cancel();t.mock.timers.tick(2000);assert.equal(calls,3,'old document must never sync into a reset context');
});
