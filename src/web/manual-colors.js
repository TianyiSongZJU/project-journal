// Shared definitions keep local preference validation and the color editor in sync.
(()=>{
 const fields=[['paper','页面背景','背景','#eeede9'],['panel','卡片背景','背景','#fbfbf9'],['sidebar','侧栏底色','背景','#e5e7dd'],['editor','输入与备注底色','背景','#e8eee3'],['selected','选中底色','背景','#dfe6d7'],['ink','主要文字','文字与强调','#39413e'],['muted','次要文字','文字与强调','#96988f'],['accent','强调文字','文字与强调','#315c46'],['button','主要按钮','文字与强调','#315c46'],['line','普通边线','边线与高光','#e0e1da'],['focus','选中与聚焦边线','边线与高光','#99ac91'],['glow','高光颜色','边线与高光','#ffffff'],...['#e8e9e1','#e0e7d6','#c4d3b1','#a1b68a','#738f61','#405f3d'].map((hex,i)=>['heat'+i,i===0?'无投入':`第 ${i} 档`,'热力图',hex])].map(([key,label,group,hex])=>({key,label,group,hex}));
 const keys=new Set(fields.map(field=>field.key)),accents=new Set(['fern','slate','iris','clay','sand','custom']);
 function sanitize(raw){const result={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;for(const [accent,modes]of Object.entries(raw)){if(!accents.has(accent)||!modes||typeof modes!=='object')continue;for(const mode of ['light','dark']){const colors=modes[mode];if(!colors||typeof colors!=='object'||Array.isArray(colors))continue;const clean={};for(const [key,value]of Object.entries(colors))if(keys.has(key)&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))clean[key]=value.toLowerCase();if(Object.keys(clean).length)(result[accent]??={})[mode]=clean}}return result}
 const recommended={
  light:['#eeede8','#fafaf6','#e3e7dc','#f0f2e9','#dce7d9','#34413b','#7b8579','#315c46','#315c46','#dce1d3','#8da78b','#ffffff','#e9ebe2','#dde7d5','#bfd1b1','#9bb78b','#729665','#456d43'],
  dark:['#191e1b','#222924','#1d2520','#283129','#35483a','#e3e8df','#a0ad9c','#a6c5a4','#466d50','#3a473d','#7b9e7d','#dfead8','#28312a','#344838','#45604a','#5b7a5e','#789b78','#a3c49c']
 };
 const preset=()=>Object.fromEntries(Object.entries(recommended).map(([mode,values])=>[mode,Object.fromEntries(fields.map((field,i)=>[field.key,values[i]]))]));
 globalThis.JournalManualColors={fields,sanitize,preset};
})();
