import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNodeOverview} from '../web/desktop-editor.js';

test('project-node overview separates completed work and keeps the earliest pending date',()=>{
  const project={deadlines:[{id:'later',date:'2026-11-02',done:false},{id:'done',date:'2026-10-01',done:true},{id:'next',date:'2026-10-30',done:false}]};
  const before=JSON.stringify(project),overview=projectNodeOverview(project);
  assert.equal(overview.pending,2);assert.equal(overview.done,1);assert.equal(overview.next.id,'next');assert.equal(JSON.stringify(project),before);
  assert.deepEqual(projectNodeOverview({deadlines:[]}),{pending:0,done:0,next:null});
  assert.deepEqual(projectNodeOverview({deadlines:[{date:'2026-10-01',done:true}]}),{pending:0,done:1,next:null});
});
