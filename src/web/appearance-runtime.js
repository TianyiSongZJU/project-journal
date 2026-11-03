// Runs before stylesheets paint. The same palette drives web UI and native accents.
(()=>{
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 function parse(hex){let v=hex.slice(1);if(v.length<5)v=[...v].map(c=>c+c).join('');const channels=[0,2,4].map(i=>parseInt(v.slice(i,i+2),16)/255),alpha=v.length===8?parseInt(v.slice(6),16)/255:1;const [r,g,b]=channels,max=Math.max(...channels),min=Math.min(...channels),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60}return {h,s,l,a:alpha}}
 const hsl=(h,s,l,a=1)=>`hsl(${Math.round(h)} ${Math.round(clamp(s)*100)}% ${Math.round(clamp(l)*100)}% / ${a.toFixed(3)})`;
 // Shift the complete green reference palette; retain each color's relative hue.
 const hueChoices={fern:['苔绿',148],slate:['雾蓝',218],iris:['烟紫',286],clay:['陶红',14],sand:['暖杏',34],rose:['灰粉',340],macaron:['马卡龙粉',334],custom:['自定义',148]};
 const rotateHue=(h,target)=>((h+target-148)%360+360)%360;
 function solidAt(target){if(target===148)return '#315c46';const reference=parse('#315c46'),h=rotateHue(reference.h,target),{s,l}=reference,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2,channels=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+channels.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')}
 const palettes=Object.fromEntries(Object.entries(hueChoices).map(([key,[name,h]])=>[key,{name,h,s:.27,solid:globalThis.JournalManualColors.theme(key)?.button||(key==='fern'?'#315c46':solidAt(h))}]));

 const normalizeHue=hue=>typeof hue==='number'&&Number.isFinite(hue)?Math.round(clamp(hue,0,359)):148;
 function resolvePalette(accent,hue){return accent==='custom'?{...palettes.custom,h:normalizeHue(hue),solid:solidAt(normalizeHue(hue))}:palettes[accent]||palettes.fern}
 function tone(role,hex,palette,dark,hue){
  const p=resolvePalette(palette,hue),c=parse(hex),green=c.h>=65&&c.h<=175&&c.s>.055;
  const semantic=!green&&c.l<.96&&(c.s>.35||c.h<=65&&c.s>.12);
  if(!dark&&(p.h===148||semantic))return hex;
  let {h,s,l,a}=c;
  // A trace of accent in paper, charcoal and edges ties the surfaces together.
  if(role==='shadow'){if(dark&&green)h=148;if(dark){l=c.l>.7?.95:.01;a=c.l>.7?a*.08:Math.min(.6,a*1.6)}}
  else if(dark){
   h=148;s=.04;
   if(role==='ink'){
    h=40;s=.025;
    l=c.l>.94?.94:clamp(.96-c.l*.42,.58,.90);
    if(green&&c.s>.18&&c.l<.58){h=148;s=p.s*.8;l=.74}
    else if(!green&&c.s>.35&&c.l<.8){h=c.h;s=Math.min(c.s,.32)}
   }else if(role==='line'){l=clamp(.24+(.88-c.l)*.12,.24,.33);s=.065}
   else if(c.l>.72){l=.13+(c.l-.72)*.25;if(a<1){l=.85;a*=.06}}
   else{l=green?.27:clamp(.14+c.l*.2,.16,.29);if(green){h=148;s=p.s*.65}}
  }
  if(!semantic){
   // Neutral control fills must stay in the preset's color family even when
   // they do not map to one of the editable roles. Reference rotation alone
   // sends yellow-green controls toward cyan in the blue palette.
   if(['slate','clay'].includes(palette)){h=(p.h+(((h-110+540)%360)-180)*.12+360)%360;if(!dark)s=Math.min(s*.75,role==='ink'?.30:.18)}
   else h=rotateHue(h,p.h);
  }
  return hsl(h,s,l,a);
 }
 function launchColor(r,g,b,a=1){
  const p=resolvePalette(current.accent,current.hue),dark=current.scheme==='dark'||current.scheme==='system'&&media?.matches;
  if(!dark&&p.h===148)return `rgb(${r} ${g} ${b} / ${a})`;
  const source=(Math.max(r,g,b)+Math.min(r,g,b))/510;
  const max=Math.max(r,g,b)/255,min=Math.min(r,g,b)/255,saturation=max===min?0:(max-min)/(1-Math.abs(2*source-1));
  let sourceHue=0;if(max!==min){const spread=max-min;sourceHue=(max===r/255?(g-b)/255/spread+(g<b?6:0):max===g/255?(b-r)/255/spread+2:(r-g)/255/spread+4)*60}
  const curated=!!globalThis.JournalManualColors.theme(current.accent,dark);return hsl(dark?p.h:curated?(p.h+((sourceHue-110+540)%360-180)*.15+360)%360:rotateHue(sourceHue,p.h),dark?.045:curated?Math.min(.14,saturation*.65):saturation,dark?(source>.65?.12+(1-source)*.5:.04):source,dark&&a<1?a*.15:a);
 }

 function colorHex(value){if(value.startsWith('#')){const v=value.slice(1);return '#'+(v.length<5?[...v.slice(0,3)].map(c=>c+c).join(''):v.slice(0,6))}const m=value.match(/^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)%/);if(!m)return '#000000';const h=Number(m[1])%360,s=Number(m[2])/100,l=Number(m[3])/100,c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),n=l-c/2,v=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+v.map(c=>Math.round((c+n)*255).toString(16).padStart(2,'0')).join('')}
 const blend=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
 function manualDefaults(choice=current,dark=choice.scheme==='dark'||choice.scheme==='system'&&media?.matches){const curated=globalThis.JournalManualColors.theme(choice.accent,dark);if(curated)return curated;const p=resolvePalette(choice.accent,choice.hue),result={};for(const field of globalThis.JournalManualColors.fields){let value=tone(['line','focus'].includes(field.key)?'line':['ink','muted','accent'].includes(field.key)?'ink':'surface',field.hex,choice.accent,dark,choice.hue);if(field.key==='button')value=p.solid;if(field.key==='glow')value='#ffffff';if(dark){const fixed={paper:hsl(p.h,.035,.11),panel:hsl(p.h,.04,.145),ink:'#e2e1de',muted:'#a3a39f',accent:hsl(p.h,p.s*.8,.74),line:hsl(p.h,.065,.225)};if(fixed[field.key])value=fixed[field.key];if(field.key.startsWith('heat')){const i=Number(field.key.slice(4));value=hsl(p.h,.035+i*p.s*.14,.18+i*.075)}}result[field.key]=colorHex(value)}return result}
 function recolor(role,hex,resolved,colors,defaults){const c=parse(hex),semantic=!(c.h>=65&&c.h<=175&&c.s>.055)&&c.l<.96&&(c.s>.35||c.h<=65&&c.s>.12);if(semantic)return resolved;let key;
  if(role==='surface'){key=['#eeede9','#eeece5'].includes(hex)?'paper':['#e5e7dd','#e8e9e1'].includes(hex)?'sidebar':c.l>=.96?'panel':c.l>=.915?'editor':c.l>=.70?'selected':'button'}
  else if(role==='ink'){if(c.l>.94)return resolved;key=c.h>=65&&c.h<=175&&c.s>.18&&c.l<.58?'accent':c.l<.38?'ink':'muted'}
  else if(role==='line')key=c.s>.10&&c.l<.78?'focus':'line';
  else if(role==='shadow'&&parse(colorHex(resolved)).l>.7)key='glow';
  if(!colors[key])return resolved;let color=colors[key];if(key==='sidebar'&&hex==='#e8e9e1')color=blend(color,colors.paper||defaults.paper,.25);if(key==='editor')color=blend(color,colors.panel||defaults.panel,clamp((c.l-.91)/.055));const a=resolved.startsWith('#')?parse(resolved).a:Number(resolved.match(/\/ ([\d.]+)\)/)?.[1]??1);return a===1?color:`${color}${Math.round(a*255).toString(16).padStart(2,'0')}`;
 }
 function readable(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4),l=c[0]*.2126+c[1]*.7152+c[2]*.0722;return 1.05/(l+.05)>=(l+.05)/.0642?'#ffffff':'#17211c'}
 function normalize(raw={}){raw=raw&&typeof raw==='object'?raw:{};const colors=globalThis.JournalManualColors?.sanitize(raw.colors)||{};return {scheme:['system','light','dark'].includes(raw.scheme)?raw.scheme:'system',accent:Object.hasOwn(palettes,raw.accent)?raw.accent:'fern',...((typeof raw.hue==='number'&&Number.isFinite(raw.hue)||raw.accent==='custom')?{hue:normalizeHue(raw.hue)}:{}),...(Object.keys(colors).length?{colors}:{})}}
 let current=normalize(),sheet,resolvedKey;
 const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
 function apply(raw,{cache=true}={}){
  current=normalize(raw);if(typeof document==='undefined')return;
  const dark=current.scheme==='dark'||current.scheme==='system'&&media?.matches,p=resolvePalette(current.accent,current.hue);
  const nextKey=JSON.stringify({...current,dark});if(nextKey===resolvedKey)return;resolvedKey=nextKey;
  document.documentElement.dataset.scheme=dark?'dark':'light';document.documentElement.dataset.accent=current.accent;document.documentElement.style.colorScheme=dark?'dark':'light';
  if(!sheet){sheet=document.createElement('style');sheet.id='journal-theme-palette';document.head.append(sheet)}
  const colors={...globalThis.JournalManualColors.theme(current.accent,dark),...current.colors?.[current.accent]?.[dark?'dark':'light']},defaults=manualDefaults(current,dark);
  const props=Object.entries(globalThis.JournalThemeColors||{}).map(([key,[role,hex]])=>key+':'+recolor(role,hex,tone(role,hex,current.accent,dark,current.hue),colors,defaults));
  props.push('--accent-solid:'+p.solid,'--accent-preview:'+p.solid,'--editor-bg:'+hsl(p.h,dark?.045:.15,dark?.18:.955),'--surface-sheen:'+(dark?'#ffffff09':'#ffffffb3'));
  if(dark)props.push('--paper:'+hsl(p.h,.035,.11),'--panel:'+hsl(p.h,.04,.145),'--ink:#e2e1de','--muted:#a3a39f','--line:'+hsl(p.h,.065,.225),'--surface-elevated:'+hsl(p.h,.045,.17),'--surface-edge:'+hsl(p.h,.065,.26),'--green:'+hsl(p.h,p.s*.8,.74));
  if(dark)for(let i=0;i<=5;i++)props.push('--l'+i+':'+hsl(p.h,.035+i*p.s*.14,.18+i*.075));
  const variables={paper:'--paper',panel:'--panel',editor:'--editor-bg',ink:'--ink',muted:'--muted',accent:'--green',button:'--accent-solid',line:'--line'};for(const [key,variable]of Object.entries(variables))if(colors[key])props.push(variable+':'+colors[key]);if(globalThis.JournalManualColors.theme(current.accent,dark)&&dark)props.push('--surface-elevated:'+blend(colors.panel,colors.editor,.5),'--surface-edge:'+colors.line);if(colors.glow)props.push('--surface-sheen:'+colors.glow+'b3');
  let rules='';if(Object.keys(colors).length)for(let i=0;i<=5;i++){props.push('--l'+i+':'+(colors['heat'+i]||(dark?hsl(p.h,.035+i*p.s*.14,.18+i*.075):tone('surface',globalThis.JournalManualColors.fields.find(field=>field.key==='heat'+i).hex,current.accent,false,current.hue))));if(colors['heat'+i])rules+=`html[data-scheme] :is(.heat-day,.month-day)[data-level="${i}"]{color:${readable(colors['heat'+i])}}`}
  if(colors.button)rules+=`html[data-scheme] button.primary{color:${readable(colors.button)}}`;
  sheet.textContent=':root[data-scheme]{'+props.join(';')+'}'+rules;
  if(cache)try{localStorage.setItem('journal-appearance-v1',JSON.stringify(current))}catch{}
  try{window.journalSetAppearance?.(dark)?.catch?.(()=>{})}catch{}
  const bg=dark?'#202620':'#fafaf7';
  try{window.webkit?.messageHandlers?.journalNative?.postMessage({action:'appearance',scheme:current.scheme,accent:current.accent,hue:current.hue,solid:colors.button||p.solid,dark,background:bg})}catch{}
  window.dispatchEvent(new CustomEvent('journal-appearance-change',{detail:{...current,dark}}));
 }
 globalThis.JournalAppearance={palettes,parse,tone,launchColor,normalize,resolvePalette,rotateHue,manualDefaults,colorHex,apply,get:()=>structuredClone(current)};
 if(typeof document!=='undefined'){
  try{current=normalize({...JSON.parse(localStorage.getItem('journal-appearance-v1')||'{}'),...globalThis.journalInitialAppearance})}catch{}
  apply(current,{cache:false});media?.addEventListener('change',()=>{if(current.scheme==='system')apply(current)});
 }
})();
