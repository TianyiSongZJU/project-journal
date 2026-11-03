// Runs before stylesheets paint. The same palette drives web UI and native accents.
(()=>{
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 function parse(hex){let v=hex.slice(1);if(v.length<5)v=[...v].map(c=>c+c).join('');const channels=[0,2,4].map(i=>parseInt(v.slice(i,i+2),16)/255),alpha=v.length===8?parseInt(v.slice(6),16)/255:1;const [r,g,b]=channels,max=Math.max(...channels),min=Math.min(...channels),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60}return {h,s,l,a:alpha}}
 const hsl=(h,s,l,a=1)=>`hsl(${Math.round(h)} ${Math.round(clamp(s)*100)}% ${Math.round(clamp(l)*100)}% / ${a.toFixed(3)})`;
 // All themes share the green reference's saturation/lightness; the palette supplies hue only.
 const hueChoices={fern:['苔绿',148],slate:['雾蓝',211],iris:['烟紫',282],clay:['陶红',17],sand:['暖杏',41],custom:['自定义',148]};
 function solidAt(h){const {s,l}=parse('#315c46'),c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2,channels=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return '#'+channels.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('')}
 const palettes=Object.fromEntries(Object.entries(hueChoices).map(([key,[name,h]])=>[key,{name,h,s:.27,solid:key==='fern'?'#315c46':solidAt(h)}]));
 const lightLevels=['#e7e8e0','#dce4d2','#b8c9a5','#8ea77a','#5a7651','#315c46'];
 const normalizeHue=hue=>typeof hue==='number'&&Number.isFinite(hue)?Math.round(clamp(hue,0,359)):148;
 function resolvePalette(accent,hue){return accent==='custom'?{...palettes.custom,h:normalizeHue(hue),solid:solidAt(normalizeHue(hue))}:palettes[accent]||palettes.fern}
 function tone(role,hex,palette,dark,hue){
  if(!dark&&palette==='fern')return hex;
  const p=resolvePalette(palette,hue),c=parse(hex),green=c.h>=65&&c.h<=175&&c.s>.055;
  let {h,s,l,a}=c;
  // A trace of accent in paper, charcoal and edges ties the surfaces together.
  if(role==='shadow'){if(green)h=p.h;if(dark){l=c.l>.7?.95:.01;a=c.l>.7?a*.08:Math.min(.6,a*1.6)}}
  else if(dark){
   h=p.h;s=.04;
   if(role==='ink'){
    h=40;s=.025;
    l=c.l>.94?.94:clamp(.96-c.l*.42,.58,.90);
    if(green&&c.s>.18&&c.l<.58){h=p.h;s=p.s*.8;l=.74}
    else if(!green&&c.s>.35&&c.l<.8){h=c.h;s=Math.min(c.s,.32)}
   }else if(role==='line'){l=clamp(.24+(.88-c.l)*.12,.24,.33);s=.065}
   else if(c.l>.72){l=.13+(c.l-.72)*.25;if(a<1){l=.85;a*=.06}}
   else{l=green?.27:clamp(.14+c.l*.2,.16,.29);if(green){h=p.h;s=p.s*.65}}
  }else if(green||(role==='surface'||role==='line')&&(c.l>.70||c.s<.2)){
   h=p.h;
  }

  return hsl(h,s,l,a);
 }
 function launchColor(r,g,b,a=1){
  const p=resolvePalette(current.accent,current.hue),dark=current.scheme==='dark'||current.scheme==='system'&&media?.matches;
  if(!dark&&current.accent==='fern')return `rgb(${r} ${g} ${b} / ${a})`;
  const source=(Math.max(r,g,b)+Math.min(r,g,b))/510;
  const max=Math.max(r,g,b)/255,min=Math.min(r,g,b)/255,saturation=max===min?0:(max-min)/(1-Math.abs(2*source-1));
  return hsl(p.h,dark?.045:saturation,dark?(source>.65?.12+(1-source)*.5:.04):source,dark&&a<1?a*.15:a);
 }
 function normalize(raw={}){raw=raw&&typeof raw==='object'?raw:{};return {scheme:['system','light','dark'].includes(raw.scheme)?raw.scheme:'system',accent:Object.hasOwn(palettes,raw.accent)?raw.accent:'fern',...((typeof raw.hue==='number'&&Number.isFinite(raw.hue)||raw.accent==='custom')?{hue:normalizeHue(raw.hue)}:{})}}
 let current=normalize(),sheet,resolvedKey;
 const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
 function apply(raw,{cache=true}={}){
  current=normalize(raw);if(typeof document==='undefined')return;
  const dark=current.scheme==='dark'||current.scheme==='system'&&media?.matches,p=resolvePalette(current.accent,current.hue);
  const nextKey=JSON.stringify({...current,dark});if(nextKey===resolvedKey)return;resolvedKey=nextKey;
  document.documentElement.dataset.scheme=dark?'dark':'light';document.documentElement.dataset.accent=current.accent;document.documentElement.style.colorScheme=dark?'dark':'light';
  if(!sheet){sheet=document.createElement('style');sheet.id='journal-theme-palette';document.head.append(sheet)}
  const props=Object.entries(globalThis.JournalThemeColors||{}).map(([key,[role,hex]])=>key+':'+tone(role,hex,current.accent,dark,current.hue));
  props.push('--accent-solid:'+p.solid,'--accent-preview:'+p.solid,'--editor-bg:'+hsl(p.h,dark?.045:.15,dark?.18:.955),'--surface-sheen:'+(dark?'#ffffff09':'#ffffffb3'));
  if(dark)props.push('--paper:'+hsl(p.h,.035,.11),'--panel:'+hsl(p.h,.04,.145),'--ink:#e2e1de','--muted:#a3a39f','--line:'+hsl(p.h,.065,.225),'--surface-elevated:'+hsl(p.h,.045,.17),'--surface-edge:'+hsl(p.h,.065,.26),'--green:'+hsl(p.h,p.s*.8,.74));
  if(dark||current.accent!=='fern')for(let i=0;i<=5;i++)props.push('--l'+i+':'+(dark?hsl(p.h,.035+i*p.s*.14,.18+i*.075):tone('surface',lightLevels[i],current.accent,false,current.hue)));
  sheet.textContent=':root[data-scheme]{'+props.join(';')+'}';
  if(cache)try{localStorage.setItem('journal-appearance-v1',JSON.stringify(current))}catch{}
  try{window.journalSetAppearance?.(dark)?.catch?.(()=>{})}catch{}
  const bg=dark?'#202620':'#fafaf7';
  try{window.webkit?.messageHandlers?.journalNative?.postMessage({action:'appearance',scheme:current.scheme,accent:current.accent,hue:current.hue,dark,background:bg})}catch{}
  window.dispatchEvent(new CustomEvent('journal-appearance-change',{detail:{...current,dark}}));
 }
 globalThis.JournalAppearance={palettes,parse,tone,launchColor,normalize,resolvePalette,apply,get:()=>({...current})};
 if(typeof document!=='undefined'){
  try{current=normalize(globalThis.journalInitialAppearance||JSON.parse(localStorage.getItem('journal-appearance-v1')||'{}'))}catch{}
  apply(current,{cache:false});media?.addEventListener('change',()=>{if(current.scheme==='system')apply(current)});
 }
})();
