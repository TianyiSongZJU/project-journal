import test from 'node:test';
import assert from 'node:assert/strict';
import {activityClients,windowsAppName,timelineWidths} from '../web/desktop-timeline.js';

test('Windows application labels remove only a trailing executable suffix',()=>{
  assert.equal(windowsAppName('ChatGPT.exe'),'ChatGPT');
  assert.equal(windowsAppName('Everything.EXE'),'Everything');
  assert.equal(windowsAppName('example.exe helper'),'example.exe helper');
  assert.equal(windowsAppName('Safari'),'Safari');
});

test('foreground activity fills available space between readable width limits',()=>{
  const layout=width=>timelineWidths({width,fileCount:1});
  assert.equal(layout(250).activityWidth,220);
  assert.equal(layout(410).activityWidth,320);
  assert.equal(layout(900).activityWidth,320);
  assert.equal(layout(1400).activityWidth,320);
  assert.equal(layout(900).filesWidth,72);
  assert.equal(timelineWidths({width:900,fileCount:2}).filesWidth,144);
});

test('additional file tracks gain room and crowded layouts preserve readable minima',()=>{
  const activities=[{app:'Word.exe',start:540,end:555,seconds:900,deviceId:'win'}];
  const one=timelineWidths({width:420,activities,fileCount:1});
  const many=timelineWidths({width:420,activities,fileCount:6});
  assert.ok(many.filesWidth>one.filesWidth);
  assert.ok(many.activityWidth<=one.activityWidth);
  assert.ok(many.filesWidth/6>=52);
  assert.equal(many.activityWidth,220);
  assert.ok(many.minimum>=many.activityWidth+many.filesWidth+12);
  const compare=timelineWidths({width:260,activities:[...activities,{...activities[0],deviceId:'mac'}],compare:true,fileCount:1});
  assert.equal(compare.activityWidth,320);
  assert.equal(timelineWidths({width:1400,activities:[...activities,{...activities[0],deviceId:'mac'}],compare:true}).activityWidth,440);
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
