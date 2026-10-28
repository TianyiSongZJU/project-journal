// Device-local presentation preferences. Never store editor contents or open menus here.
const listKeys=new Set(['project-list','filter-project-list','record-project','inspector-project','dt-default-project','timeline-project','project-picker']);
const flagKeys=new Set(['deadlineGrouped','reviewDone','projectDone','inspectorDone','foldersGrouped','foldersCompleted']);
const panelKeys=new Set(['year.distribution','year.deadlines','project.deadlines','project.records','auto.advanced','auto.history']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export function sanitizeUIPreferences(raw={},ids){
 raw=object(raw);const out={lists:{},flags:{},panels:{}};
 for(const [key,value] of Object.entries(object(raw.lists))){
  if(!listKeys.has(key))continue;const v=object(value),item={};
  for(const field of ['grouped','completed'])if(typeof v[field]==='boolean')item[field]=v[field];
  if(Array.isArray(v.folded))item.folded=[...new Set(v.folded.filter(x=>typeof x==='string'&&x.length<=160))].slice(0,32);
  out.lists[key]=item;
 }
 for(const [key,value] of Object.entries(object(raw.flags)))if(flagKeys.has(key)&&typeof value==='boolean')out.flags[key]=value;
 for(const [key,value] of Object.entries(object(raw.panels)))if(typeof value==='boolean'&&(panelKeys.has(key)||key.startsWith('folder.')&&key.length<=180&&(!ids||ids.includes(key.slice(7)))))out.panels[key]=value;
 return out;
}
export function createUIPreferences(){
 let value=sanitizeUIPreferences(),changed=()=>{};
 function write(section,key,next){if(JSON.stringify(value[section][key])===JSON.stringify(next))return;value[section][key]=next;changed()}
 return {
  restore(raw,ids){value=sanitizeUIPreferences(raw,ids)},onChange(callback){changed=callback},snapshot(){return structuredClone(value)},
  flag(key,fallback=false){return value.flags[key]??fallback},setFlag(key,next){if(flagKeys.has(key))write('flags',key,!!next)},
  panel(key,fallback=false){return value.panels[key]??fallback},setPanel(key,next){if(panelKeys.has(key)||key.startsWith('folder.'))write('panels',key,!!next)},
  list(key){const v=value.lists[key]||{};return {grouped:v.grouped??true,completed:v.completed??false,folded:new Set(v.folded||[])}},
  saveList(key,ui){if(!listKeys.has(key))return;const item=sanitizeUIPreferences({lists:{[key]:{grouped:ui.grouped,completed:ui.completed,folded:[...ui.folded]}}}).lists[key];write('lists',key,item)}
 };
}
export const uiPreferences=createUIPreferences();
export function bindPreferencePanel(element,key,fallback=false){
 if(!element)return;element.dataset.uiPanel=key;element.ontoggle=null;element.open=uiPreferences.panel(key,fallback);
 element.ontoggle=()=>uiPreferences.setPanel(key,element.open);
}
