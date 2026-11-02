import test from 'node:test';
import assert from 'node:assert/strict';
import {createUIPreferences,sanitizeUIPreferences} from '../web/ui-preferences.js';
import {sanitizeViewState} from '../web/view-state.js';
import '../web/appearance-runtime.js';
const api=globalThis.JournalAppearance;
test('appearance is bounded, device-local, and survives view memory',()=>{
 const prefs=createUIPreferences();let changes=0;prefs.onChange(()=>changes++);
 assert.deepEqual(prefs.appearance(),{scheme:'system',accent:'fern'});
 prefs.setAppearance({scheme:'dark',accent:'iris',secret:'discard'});prefs.setAppearance({scheme:'dark',accent:'iris'});
 assert.equal(changes,1);assert.deepEqual(sanitizeViewState({ui:prefs.snapshot()}).ui.appearance,{scheme:'dark',accent:'iris'});
 const saved=prefs.snapshot();saved.appearance.accent='clay';assert.equal(prefs.appearance().accent,'iris');
 assert.deepEqual(sanitizeUIPreferences({appearance:{scheme:'bad',accent:'bad'}}).appearance,{scheme:'system',accent:'fern'});
});
test('light fern preserves legacy colors and alpha survives theme conversion',()=>{
 for(const color of ['#315c46','#fafaf7','#ffffff18','#abc'])assert.equal(api.tone('surface',color,'fern',false),color);
 assert.equal(api.parse('#fff8').a,136/255);
 for(const accent of Object.keys(api.palettes))for(const role of ['ink','surface','line','shadow']){
  const result=api.tone(role,'#315c4666',accent,true);assert.match(result,/^hsl\(/);assert.doesNotMatch(result,/NaN|undefined/);
 }
 assert.deepEqual(api.normalize({scheme:'dark',accent:'clay'}),{scheme:'dark',accent:'clay'});
});
test('active circle palettes keep white symbols readable',()=>{
 const luminance=hex=>{const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
 for(const p of Object.values(api.palettes))assert(1.05/(luminance(p.solid)+.05)>=4.5,p.name);
 assert.deepEqual(api.normalize({accent:'__proto__'}),{scheme:'system',accent:'fern'});
});

test('dark surfaces are neutral, and blue emphasis stays muted',()=>{
 for(const palette of Object.keys(api.palettes)){
  const surface=api.tone('surface','#fafaf7',palette,true);assert.match(surface,/ 3% /);
  const line=api.tone('line','#e2e7da',palette,true);assert.match(line,/ 3% /);
 }
 const blue=api.tone('ink','#315c46','slate',true);assert.match(blue,/ 11% /);
});
