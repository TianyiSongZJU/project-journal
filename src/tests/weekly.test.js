import test from 'node:test';import assert from 'node:assert/strict';
import {weekStart,weekNumber,weekRange} from '../web/weekly.js';import {sanitizeViewState} from '../web/view-state.js';
test('weekly dates use Monday, including year boundaries',()=>{
 assert.equal(weekStart('2026-11-08'),'2026-11-02');assert.equal(weekStart('2026-11-02'),'2026-11-02');assert.equal(weekStart('2027-01-01'),'2026-12-28');
 assert.deepEqual(weekNumber('2026-12-28'),{year:2026,number:53});assert.match(weekRange('2026-12-28'),/2027年/);
 assert.equal(sanitizeViewState({mode:'weekly',weeklyDate:'2026-11-02'}).weeklyDate,'2026-11-02');assert.equal(sanitizeViewState({mode:'weekly'}).mode,'month');assert.equal(sanitizeViewState({mode:'weekly'}).weeklySelected,true);assert.equal(sanitizeViewState({mode:'month',weeklySelected:true}).weeklySelected,true);
});
