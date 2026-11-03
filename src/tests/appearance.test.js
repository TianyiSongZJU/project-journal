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

test('surface tints remain restrained and blue emphasis stays muted',()=>{
 for(const palette of Object.keys(api.palettes)){
  const surface=api.tone('surface','#fafaf7',palette,true);assert.match(surface,/ 4% /);assert(surface.startsWith('hsl('+api.palettes[palette].h+' '));
  const line=api.tone('line','#e2e7da',palette,true);assert.match(line,/ 7% /);
 }
 const blue=api.tone('ink','#315c46','slate',true);assert.match(blue,/ 22% /);
});
test('startup artwork follows the saved palette and dark scheme',()=>{
 api.apply({scheme:'light',accent:'fern'});assert.equal(api.launchColor(220,232,211),'rgb(220 232 211 / 1)');
 api.apply({scheme:'dark',accent:'slate'});assert.match(api.launchColor(250,252,250),/^hsl\(211 5% 13% /);
 api.apply({scheme:'light',accent:'iris'});assert.match(api.launchColor(220,232,211),/^hsl\(282 /);
 api.apply({scheme:'system',accent:'fern'});
});

test('light themes change hue while preserving the green reference saturation, lightness and alpha',()=>{
 const values=value=>value.match(/^hsl\((\d+) (\d+)% (\d+)% \/ ([\d.]+)\)$/).slice(1).map(Number);
 for(const [role,hex]of [['surface','#e5e7dd'],['surface','#dfe6d7'],['line','#99ac91'],['ink','#315c46'],['shadow','#315c4614']]){
  const source=api.parse(hex);
  for(const accent of ['slate','iris','clay','sand']){const [h,s,l,a]=values(api.tone(role,hex,accent,false));assert.equal(h,api.palettes[accent].h);assert(Math.abs(s/100-source.s)<=.0051);assert(Math.abs(l/100-source.l)<=.0051);assert(Math.abs(a-source.a)<=.0006)}
 }
 const reference=api.parse(api.palettes.fern.solid);for(const palette of Object.values(api.palettes)){const color=api.parse(palette.solid);assert(Math.abs(color.s-reference.s)<.004);assert(Math.abs(color.l-reference.l)<.004)}
});
test('dark themes share tonal levels across every hue and preserve status colors',()=>{
 const levels=value=>value.slice(value.indexOf(' '));
 for(const [role,hex]of [['surface','#fafaf7'],['line','#e2e7da'],['ink','#315c46'],['shadow','#315c4614']]){const reference=levels(api.tone(role,hex,'fern',true));for(const accent of Object.keys(api.palettes))assert.equal(levels(api.tone(role,hex,accent,true)),reference)}
 for(const accent of ['slate','iris','clay','sand'])assert.equal(api.tone('ink','#a2553e',accent,false),api.tone('ink','#a2553e','slate',false));
});

test('custom hue is bounded, remembered with preset switches and preserved in local view state',()=>{
 const prefs=createUIPreferences();prefs.setAppearance({scheme:'light',accent:'custom',hue:203});
 assert.deepEqual(prefs.appearance(),{scheme:'light',accent:'custom',hue:203});
 assert.deepEqual(sanitizeViewState({ui:prefs.snapshot()}).ui.appearance,prefs.appearance());
 prefs.setAppearance({...prefs.appearance(),accent:'fern'});assert.equal(prefs.appearance().hue,203);
 for(const [input,expected]of [[0,0],[359,359],[-20,0],[900,359],[42.6,43],[NaN,148],[Infinity,148]]){
  assert.equal(api.normalize({accent:'custom',hue:input}).hue,expected);
  assert.equal(sanitizeUIPreferences({appearance:{accent:'custom',hue:input}}).appearance.hue,expected);
 }
 for(const hue of [0,60,120,180,240,300,359]){
  assert.equal(api.resolvePalette('custom',hue).h,hue);
  const custom=api.tone('surface','#dfe6d7','custom',false,hue),reference=api.tone('surface','#dfe6d7','slate',false);
  assert.equal(custom.slice(custom.indexOf(' ')),reference.slice(reference.indexOf(' ')));
  api.apply({scheme:'light',accent:'custom',hue});assert(api.launchColor(220,232,211).startsWith('hsl('+hue+' '));
 }
 api.apply({scheme:'system',accent:'fern'});
});
