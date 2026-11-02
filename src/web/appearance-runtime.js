// Runs before stylesheets paint. The same palette drives web UI and native accents.
(()=>{
 const palettes={fern:{name:'苔绿',h:148,s:.27,solid:'#315c46'},slate:{name:'雾蓝',h:211,s:.14,solid:'#526777'},iris:{name:'烟紫',h:282,s:.12,solid:'#746578'},clay:{name:'陶红',h:17,s:.17,solid:'#89685d'},sand:{name:'暖杏',h:41,s:.18,solid:'#7d6f50'}};
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 function parse(hex){let v=hex.slice(1);if(v.length<5)v=[...v].map(c=>c+c).join('');const channels=[0,2,4].map(i=>parseInt(v.slice(i,i+2),16)/255),alpha=v.length===8?parseInt(v.slice(6),16)/255:1;const [r,g,b]=channels,max=Math.max(...channels),min=Math.min(...channels),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)*60}return {h,s,l,a:alpha}}
 const hsl=(h,s,l,a=1)=>`hsl(${Math.round(h)} ${Math.round(clamp(s)*100)}% ${Math.round(clamp(l)*100)}% / ${a.toFixed(3)})`;
 function tone(role,hex,palette,dark){
  if(!dark&&palette==='fern')return hex;
  const p=palettes[palette]||palettes.fern,c=parse(hex),green=c.h>=65&&c.h<=175&&c.s>.055;
  let {h,s,l,a}=c;
  // Neutral paper/charcoal carries the interface; accent is reserved for emphasis.
  if(role==='shadow'){if(dark){l=c.l>.7?.95:.01;a=c.l>.7?a*.08:Math.min(.6,a*1.6)}else if(green){h=40;s=.025}}
  else if(dark){
   h=40;s=.025;
   if(role==='ink'){
    l=c.l>.94?.94:clamp(.96-c.l*.42,.58,.90);
    if(green&&c.s>.18&&c.l<.58){h=p.h;s=p.s*.8;l=.74}
    else if(!green&&c.s>.35&&c.l<.8){h=c.h;s=Math.min(c.s,.32)}
   }else if(role==='line'){l=clamp(.24+(.88-c.l)*.12,.24,.33);s=.025}
   else if(c.l>.72){l=.13+(c.l-.72)*.25;if(a<1){l=.85;a*=.06}}
   else{l=green?.27:clamp(.14+c.l*.2,.16,.29);if(green){h=p.h;s=p.s*.65}}
  }else if(role==='surface'||role==='line'){
   // Keep neutral surfaces warm and almost achromatic even in blue/purple themes.
   if(c.l>.70||c.s<.2){h=40;s=.025;if(role==='line')s=.035}
   else if(green){h=p.h;s=Math.min(p.s,c.s*.55)}
  }else if(green){
   h=p.h;s=c.s>.18?Math.min(p.s,.18):Math.min(c.s,.06);
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
  if(dark)props.push('--paper:#1c1c1b','--panel:#252524','--ink:#e2e1de','--muted:#a3a39f','--line:#3a3a37','--green:'+hsl(p.h,p.s*.8,.74));
  if(dark||current.accent!=='fern')for(let i=0;i<=5;i++)props.push('--l'+i+':'+(dark?hsl(p.h,.035+i*p.s*.14,.18+i*.075):i===0?hsl(40,.025,.92):hsl(p.h,p.s,.91-i*.12)));
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
