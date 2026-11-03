import test from 'node:test';
import assert from 'node:assert/strict';
import {createUIPreferences,sanitizeUIPreferences} from '../web/ui-preferences.js';
import {sanitizeViewState} from '../web/view-state.js';
import '../web/appearance-runtime.js';
import '../web/theme-colors.js';
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
  const surface=api.tone('surface','#fafaf7',palette,true);assert.match(surface,/ 4% /);
  const line=api.tone('line','#e2e7da',palette,true);assert.match(line,/ 7% /);
 }
 const blue=api.tone('ink','#315c46','slate',true);assert.match(blue,/ 22% /);
});
test('startup artwork follows the saved palette and dark scheme',()=>{
 api.apply({scheme:'light',accent:'fern'});assert.equal(api.launchColor(220,232,211),'rgb(220 232 211 / 1)');
 api.apply({scheme:'dark',accent:'slate'});assert.match(api.launchColor(250,252,250),/^hsl\(218 5% 13% /);
 api.apply({scheme:'light',accent:'iris'});assert.match(api.launchColor(220,232,211),/^hsl\(28[0-9] /);
 api.apply({scheme:'system',accent:'fern'});
});

test('light themes change hue while preserving the green reference saturation, lightness and alpha',()=>{
 const values=value=>value.match(/^hsl\((\d+) (\d+)% (\d+)% \/ ([\d.]+)\)$/).slice(1).map(Number);
 for(const [role,hex]of [['surface','#e5e7dd'],['surface','#dfe6d7'],['line','#99ac91'],['ink','#315c46'],['shadow','#315c4614']]){
  const source=api.parse(hex);
  for(const accent of ['iris','sand']){const [h,s,l,a]=values(api.tone(role,hex,accent,false));assert(Math.abs(((h-api.rotateHue(source.h,api.palettes[accent].h)+540)%360)-180)<.51);assert(Math.abs(s/100-source.s)<=.0051);assert(Math.abs(l/100-source.l)<=.0051);assert(Math.abs(a-source.a)<=.0006)}
 }
 assert.equal(api.resolvePalette('custom',148).solid,api.palettes.fern.solid);
});
test('dark themes share tonal levels across every hue and preserve status colors',()=>{
 const levels=value=>value.slice(value.indexOf(' '));
 for(const [role,hex]of [['surface','#fafaf7'],['line','#e2e7da'],['ink','#315c46'],['shadow','#315c4614']]){const reference=levels(api.tone(role,hex,'fern',true));for(const accent of Object.keys(api.palettes).filter(accent=>!['slate','clay'].includes(accent)))assert.equal(levels(api.tone(role,hex,accent,true)),reference)}
 for(const hex of ['#a2553e','#a77f68','#a57751'])for(const accent of ['slate','iris','clay','sand'])assert.equal(api.tone('ink',hex,accent,false),hex);
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
  const custom=api.tone('surface','#dfe6d7','custom',false,hue),reference=api.tone('surface','#dfe6d7','iris',false);
  assert.equal(custom.slice(custom.indexOf(' ')),reference.slice(reference.indexOf(' ')));
  api.apply({scheme:'light',accent:'custom',hue});assert(api.launchColor(220,232,211).startsWith('hsl('+Math.round(api.rotateHue(api.parse('#dce8d3').h,hue))+' '));
 }
 api.apply({scheme:'system',accent:'fern'});
});

test('reference hue reproduces every green token exactly in both schemes',()=>{
 for(const [role,hex]of Object.values(globalThis.JournalThemeColors))for(const dark of [false,true])assert.equal(api.tone(role,hex,'custom',dark,148),api.tone(role,hex,'fern',dark),`${role} ${hex}`);
 assert.equal(api.resolvePalette('custom',148).solid,api.palettes.fern.solid);
 api.apply({scheme:'light',accent:'custom',hue:148});assert.equal(api.launchColor(220,232,211),'rgb(220 232 211 / 1)');api.apply({scheme:'system',accent:'fern'});
});
test('base hue conversion stays consistent underneath curated preset colors',()=>{
 for(const [accent,palette]of Object.entries(api.palettes).filter(([accent])=>!['custom','slate','clay'].includes(accent)))for(const dark of [false,true])for(const [role,hex]of [['surface','#dfe6d7'],['ink','#315c46'],['line','#99ac91'],['ink','#a2553e']])assert.equal(api.tone(role,hex,accent,dark),api.tone(role,hex,'custom',dark,palette.h));
 const first=api.parse('#dfe6d7'),second=api.parse('#315c46');assert.notEqual(Math.round(api.rotateHue(first.h,211)),Math.round(api.rotateHue(second.h,211)));
});

test('manual colors validate known fields, preserve themes and isolate preference snapshots',()=>{
 const colors={fern:{light:{panel:'#F1E2D3',button:'#315c46',bad:'#ffffff',ink:'red'},dark:{panel:'#20252a'}},slate:{light:{accent:'#123456'}},bad:{light:{panel:'#ffffff'}}};
 const prefs=createUIPreferences();prefs.setAppearance({scheme:'light',accent:'fern',colors});
 assert.deepEqual(prefs.appearance().colors,{fern:{light:{panel:'#f1e2d3',button:'#315c46'},dark:{panel:'#20252a'}},slate:{light:{accent:'#123456'}}});
 const copy=prefs.appearance();copy.colors.fern.light.panel='#ffffff';assert.equal(prefs.appearance().colors.fern.light.panel,'#f1e2d3');
 assert.deepEqual(sanitizeViewState({ui:prefs.snapshot()}).ui.appearance,prefs.appearance());
 assert.deepEqual(api.normalize(prefs.appearance()),prefs.appearance());
 assert.equal(JSON.stringify(sanitizeUIPreferences({appearance:{colors:{fern:{light:{panel:'</style>'}}}}})).includes('colors'),false);
 for(const accent of Object.keys(api.palettes))for(const dark of [false,true]){const defaults=api.manualDefaults({accent,scheme:dark?'dark':'light'},dark);assert.equal(Object.keys(defaults).length,18);for(const color of Object.values(defaults))assert.match(color,/^#[0-9a-f]{6}$/)}
});

test('recommended paper and jade palette has editable independent light and dark values',()=>{
 const recommended=globalThis.JournalManualColors.preset();
 assert.deepEqual(globalThis.JournalManualColors.sanitize({custom:recommended}),{custom:recommended});
 for(const mode of ['light','dark'])assert.equal(Object.keys(recommended[mode]).length,18);
 assert.equal(recommended.light.panel,'#fafaf6');assert.equal(recommended.dark.panel,'#222924');
 recommended.light.panel='#ffffff';assert.equal(globalThis.JournalManualColors.preset().light.panel,'#fafaf6');
});


test('curated palettes use distinct muted color families and leave fern intact',()=>{
 const families={slate:[205,225],iris:[275,300],clay:[8,24],sand:[28,43],rose:[325,355],macaron:[325,350]};
 assert.equal(globalThis.JournalManualColors.theme('fern'),null);
 for(const [accent,[min,max]]of Object.entries(families))for(const dark of [false,true]){
  const palette=api.manualDefaults({accent,scheme:dark?'dark':'light'},dark);
  for(const key of ['accent',...Array.from({length:5},(_,i)=>'heat'+(i+1))]){const c=api.parse(palette[key]);assert(c.h>=min&&c.h<=max,`${accent} ${key}: ${c.h}`);assert(c.s<(accent==='macaron'?.65:.4))}
  const levels=Array.from({length:6},(_,i)=>api.parse(palette['heat'+i]).l);for(let i=1;i<levels.length;i++)assert(dark?levels[i]>levels[i-1]:levels[i]<levels[i-1]);
 }
 const prefs=createUIPreferences();prefs.setAppearance({scheme:'dark',accent:'macaron',colors:{macaron:{dark:{panel:'#302020'}},rose:{light:{button:'#987070'}}}});assert.equal(prefs.appearance().accent,'macaron');assert.equal(prefs.appearance().colors.rose.light.button,'#987070');
});


test('blue fallback control fills cannot shift into cyan and clay stays brick red',()=>{
 for(const hex of ['#e4e6da','#e6e8e2','#edeee7','#e0e7d6','#dfe6d7','#99ac91']){
  const blue=api.parse(api.colorHex(api.tone('surface',hex,'slate',false)));assert(blue.h>=205&&blue.h<=230,`${hex}: ${blue.h}`);assert(blue.s<.2);
  const red=api.parse(api.colorHex(api.tone('surface',hex,'clay',false)));assert(red.h>=0&&red.h<=24,`${hex}: ${red.h}`);
 }
});
