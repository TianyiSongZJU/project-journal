import test from 'node:test';
import assert from 'node:assert/strict';
import {timelinePopoverPosition} from '../web/timeline-popover.js';
const base={viewport:{top:180,bottom:740},width:900,height:760};
test('a tall hovered report stays below the chart toolbar instead of covering window chrome',()=>{
 const p=timelinePopoverPosition({...base,anchor:{left:100,right:250,top:300,bottom:370},popup:{width:300,height:520}});
 assert(p.top>=186);assert(p.top+520<=734);assert.equal(p.maxHeight,548);
});
test('beside placement chooses the available side and respects the chart bounds',()=>{
 const p=timelinePopoverPosition({...base,beside:true,anchor:{left:650,right:800,top:680,bottom:720},popup:{width:300,height:350}});
 assert.equal(p.left,338);assert(p.top>=186);assert(p.top+350<=734);
});
test('short windows cap report height and keep both edges inside the usable region',()=>{
 const p=timelinePopoverPosition({...base,height:430,viewport:{top:170,bottom:420},anchor:{left:100,right:200,top:190,bottom:220},popup:{width:300,height:238}});
 assert.equal(p.maxHeight,238);assert.equal(p.top,176);
});
