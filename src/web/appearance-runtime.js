// Runs before stylesheets paint. The same palette drives web UI and native accents.
(()=>{
 const palettes={fern:{name:'苔绿',h:148,s:.27,solid:'#315c46'},slate:{name:'雾蓝',h:211,s:.26,solid:'#4c6b88'},iris:{name:'烟紫',h:271,s:.21,solid:'#746185'},clay:{name:'陶红',h:12,s:.30,solid:'#976351'},sand:{name:'暖杏',h:39,s:.31,solid:'#876f3f'}};
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 function parse(hex){let v=hex.slice(1);if(v.length<5)v=[...v].map(c=>c+c).join('');const channels=[0,2,4].map(i=>parseInt(v.slice(i,i+2),16)/255),alpha=v.length===8?parseInt(v.slice(6),16)/255:1;const [r,g,b]=channels,max=Math.max(...channels),min=Math.min(...channels),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60}return {h,s,l,a:alpha}}
 const hsl=(h,s,l,a=1)=>`hsl(${Math.round(h)} ${Math.round(clamp(s)*100)}% ${Math.round(clamp(l)*100)}% / ${a.toFixed(3)})`;
 function tone(role,hex,palette,dark){
  if(!dark&&palette==='fern')return hex;
  const p=palettes[palette]||palettes.fern,c=parse(hex),green=c.h>=65&&c.h<=175&&c.s>.055,neutral=c.s<.2||c.l>.86;
  let {h,s,l,a}=c;if(green){h=p.h;s=Math.min(.42,Math.max(.08,c.s*p.s/.27))}else if(neutral&&role!=='ink'){h=p.h;s=Math.min(.12,c.s)}
  if(dark){
   if(role==='ink')l=c.l>.94?c.l:clamp(.93-c.l*.36,.60,.9);
   else if(role==='line')l=clamp(.23+(.9-c.l)*.36,.23,.52);
   else if(role==='shadow'){if(c.l>.7){l=.92;a*=.14}else{l=.02;a=Math.min(.6,a*1.6)}}
   else if(c.l>.72){l=.10+(c.l-.72)*.20;s=Math.min(s,.14);if(a<1){l=.9;a*=.12}}
   else{l=green?clamp(.24+c.l*.16,.26,.39):clamp(.12+c.l*.25,.14,.35);s=Math.min(s,.45)}
  }
  return hsl(h,s,l,a);
 }
 function normalize(raw={}){raw=raw&&typeof raw==='object'?raw:{};return {scheme:['system','light','dark'].includes(raw.scheme)?raw.scheme:'system',accent:Object.hasOwn(palettes,raw.accent)?raw.accent:'fern'}}
 let current=normalize(),sheet,resolvedKey;
 const media=typeof matchMedia==='function'?matchMedia('(prefers-color-scheme: dark)'):null;
 function apply(raw,{cache=true}={}){
  current=normalize(raw);if(typeof document==='undefined')return;
  const dark=current.scheme==='dark'||current.scheme==='system'&&media?.matches,p=palettes[current.accent];
  const nextKey=JSON.stringify({...current,dark});if(nextKey===resolvedKey)return;resolvedKey=nextKey;
  document.documentElement.dataset.scheme=dark?'dark':'light';document.documentElement.dataset.accent=current.accent;document.documentElement.style.colorScheme=dark?'dark':'light';
  if(!sheet){sheet=document.createElement('style');sheet.id='journal-theme-palette';document.head.append(sheet)}
  const props=Object.entries(globalThis.JournalThemeColors||{}).map(([key,[role,hex]])=>key+':'+tone(role,hex,current.accent,dark));
  props.push('--accent-solid:'+p.solid,'--accent-preview:'+p.solid);
  if(dark)props.push('--paper:'+hsl(p.h,.10,.085),'--panel:'+hsl(p.h,.08,.13),'--ink:'+hsl(p.h,.08,.88),'--muted:'+hsl(p.h,.08,.67),'--line:'+hsl(p.h,.08,.25),'--green:'+hsl(p.h,p.s,.73));
  if(dark||current.accent!=='fern')for(let i=0;i<=5;i++)props.push('--l'+i+':'+(dark?hsl(p.h,.1+i*.035,.15+i*.075):i===0?hsl(p.h,.12,.92):hsl(p.h,p.s,.91-i*.12)));
  sheet.textContent=':root[data-scheme]{'+props.join(';')+'}';
  if(cache)try{localStorage.setItem('journal-appearance-v1',JSON.stringify(current))}catch{}
  try{window.journalSetAppearance?.(dark)?.catch?.(()=>{})}catch{}
  const bg=dark?'#202620':'#fafaf7';
  try{window.webkit?.messageHandlers?.journalNative?.postMessage({action:'appearance',scheme:current.scheme,accent:current.accent,dark,background:bg})}catch{}
  window.dispatchEvent(new CustomEvent('journal-appearance-change',{detail:{...current,dark}}));
 }
 globalThis.JournalAppearance={palettes,parse,tone,normalize,apply,get:()=>({...current})};
 if(typeof document!=='undefined'){
  try{current=normalize(globalThis.journalInitialAppearance||JSON.parse(localStorage.getItem('journal-appearance-v1')||'{}'))}catch{}
  apply(current,{cache:false});media?.addEventListener('change',()=>{if(current.scheme==='system')apply(current)});
 }
})();
