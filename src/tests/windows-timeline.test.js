import test from 'node:test';
import assert from 'node:assert/strict';
import {activityClients,windowsAppName,timelineWidths} from '../web/desktop-timeline.js';

test('Windows application labels remove only a trailing executable suffix',()=>{
  assert.equal(windowsAppName('ChatGPT.exe'),'ChatGPT');
  assert.equal(windowsAppName('Everything.EXE'),'Everything');
  assert.equal(windowsAppName('example.exe helper'),'example.exe helper');
  assert.equal(windowsAppName('Safari'),'Safari');
});

test('activity width follows concurrent application content instead of window width',()=>{
  const activities=[{app:'Word.exe',start:540,end:555,seconds:900,deviceId:'win'}];
  const one=timelineWidths({width:900,activities,fileLabels:['论文']});
  const wider=timelineWidths({width:1400,activities,fileLabels:['论文']});
  const multiple=timelineWidths({width:900,activities:[...activities,{app:'ChatGPT',start:540,end:555,seconds:600,deviceId:'mac'},{app:'PowerPoint',start:540,end:555,seconds:600,deviceId:'other'}],fileLabels:['论文']});
  assert.equal(one.activityWidth,wider.activityWidth);
  assert.ok(one.activityWidth<200);
  assert.ok(multiple.activityWidth>one.activityWidth);
});

test('additional file tracks gain room and crowded layouts preserve readable minima',()=>{
  const activities=[{app:'Word.exe',start:540,end:555,seconds:900,deviceId:'win'}];
  const one=timelineWidths({width:420,activities,fileLabels:['论文']});
  const many=timelineWidths({width:420,activities,fileLabels:Array(6).fill('研究资料')});
  assert.ok(many.filesWidth>one.filesWidth);
  assert.ok(many.activityWidth<=one.activityWidth);
  assert.ok(many.filesWidth/6>=52);
  assert.ok(many.activityWidth>=120);
  assert.ok(many.minimum>=many.activityWidth+many.filesWidth+12);
  const compare=timelineWidths({width:260,activities:[...activities,{...activities[0],deviceId:'mac'}],compare:true,fileLabels:['论文']});
  assert.ok(compare.activityWidth>=320);
  assert.ok(compare.minimum>260);
});

test('client grouping keeps distinct devices with the same display name',()=>{
  const activities=[{deviceId:'mac',device:'工作电脑',app:'Safari'},{deviceId:'win',device:'工作电脑',app:'Word.exe'},{deviceId:'mac',device:'工作电脑',app:'Notes'}];
  const clients=activityClients(activities);
  assert.equal(clients.length,2);
  assert.equal(clients.find(client=>client.id==='mac').activities.length,2);
  assert.equal(clients.find(client=>client.id==='win').activities.length,1);
  assert.equal(activities[1].app,'Word.exe');
});
