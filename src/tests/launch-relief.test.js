import test from 'node:test';
import assert from 'node:assert/strict';
import {reliefScene,reliefWave,reliefExit,revealRadius,reliefOpacity} from '../web/launch-relief.js';

test('cold and warm tile waves use unwrapped Mac diagonals and keep descending during fades',()=>{
 for(const warm of [false,true]){
  const scene=reliefScene(1120,740,warm),piece=scene.pieces[0];
  assert.ok(Math.abs(reliefWave(scene,piece,piece.start+scene.period*.5,0).lift-11)<.001);
  const exit=reliefExit(scene,100),last=exit.tiles.at(-1),t=last.exit;
  assert.equal(scene.fade,warm?330:440);
  assert.ok(reliefWave(scene,last,t,exit.sweep).lift>=reliefWave(scene,last,t+scene.fade,exit.sweep).lift);
  assert.ok(reliefOpacity(scene,last,t+scene.fade*.5)>0);
  assert.ok(reliefOpacity(scene,last,t+scene.fade)<.001);
  assert.ok(exit.end>=Math.max(...exit.tiles.map(p=>p.exit+scene.fade))+scene.diffusion-scene.fade*.5);
 }
});

test('every local diffusion stays outside faces still in the protected half of their fade',()=>{
 for(const size of [[1120,740],[720,550],[1920,1080]])for(const now of [50,750,2200,7000]){
  const scene=reliefScene(...size),exit=reliefExit(scene,now);
  for(const plan of exit.plans)for(let time=plan.begin;time<exit.end;time+=17){
   const radius=revealRadius(plan,time);
   for(const other of exit.tiles)if(time<=other.exit+scene.fade*.5){
    const dx=Math.max(other.x-167-plan.piece.source.x,0,plan.piece.source.x-other.x-167),dy=Math.max(other.y-167-plan.piece.source.y,0,plan.piece.source.y-other.y-167);
    assert.ok(radius<=Math.max(dx,dy)+.001,'a neighboring diffusion must not erase a solid face');
   }
  }
 }
});

test('diffusion expands continuously after releases and finishes with enough clear core coverage',()=>{
 const scene=reliefScene(1120,740),exit=reliefExit(scene,400);
 for(const plan of exit.plans){
  assert.equal(revealRadius(plan,plan.begin),0);
  for(let i=1;i<plan.times.length;i++){
   const change=plan.radii[i]-plan.radii[i-1];assert.ok(change>=-.001);
   assert.ok(change<=scene.outer/scene.diffusion*(plan.times[i]-plan.times[i-1])+.001,'releasing a neighboring face cannot jump the contour');
  }
  assert.ok(Math.abs(revealRadius(plan,exit.end)-scene.outer)<.001);
 }
});
