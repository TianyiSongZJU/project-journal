// Display-only aliases: original evidence and project attribution stay intact.
export const DEFAULT_APP_ALIASES = [
 {name:'微信',aliases:['Weixin','WeChat']},
 {name:'Microsoft Edge',aliases:['msedge','MicrosoftEdge']},
 {name:'Google Chrome',aliases:['chrome','GoogleChrome']},
 {name:'Word',aliases:['Microsoft Word','WINWORD']},
 {name:'Excel',aliases:['Microsoft Excel']},
 {name:'PowerPoint',aliases:['Microsoft PowerPoint','POWERPNT']},
 {name:'Visual Studio Code',aliases:['Code','VS Code']},
 {name:'飞书',aliases:['Feishu']},
 {name:'钉钉',aliases:['DingTalk']},
 {name:'腾讯会议',aliases:['wemeetapp','Tencent Meeting','TencentMeeting']},
 {name:'Clash Verge',aliases:['clash-verge']},
 {name:'微信扩展',aliases:['WeChatAppEx']},
 {name:'AppleMusic',aliases:[]},
 {name:'项目手记',aliases:['project-journal','项目手记-Windows']}
];
export const appAliasKey = name => String(name??'').trim().replace(/\.exe$/i,'').toLowerCase();
export const appAliasGroups = settings => settings?.appAliases ?? DEFAULT_APP_ALIASES;
export function validateAppAliases(groups){
 if(groups.length>100)throw Error('最多设置 100 组应用名称');
 const used=new Set();
 return groups.map(group=>{
  const name=group.name.trim(),aliases=[...new Set((group.aliases||[]).map(x=>x.trim()).filter(Boolean))];
  if(!name||name.length>120||aliases.length>50||aliases.some(x=>x.length>120))throw Error('请填写显示名称，每个名称不超过 120 字，每组不超过 50 个别名');
  const keys=new Set([name,...aliases].map(appAliasKey));
  for(const key of keys){if(!key||used.has(key))throw Error('同一个应用名称不能出现在不同分组中（忽略大小写和 .exe 后缀）');used.add(key)}
  return {name,aliases};
 });
}
export function appNameResolver(settings){
 const names=new Map();
 for(const group of appAliasGroups(settings))for(const name of [group.name,...(group.aliases||[])])names.set(appAliasKey(name),group.name);
 return name=>names.get(appAliasKey(name))||String(name??'').trim().replace(/\.exe$/i,'');
}
export function displayActivities(activities,settings){
 const nameFor=appNameResolver(settings);
 return activities.map(item=>({...item,app:nameFor(item.app)}));
}

export function setupAppAliasSettings({getState,commit,toast,esc}){
 const form=document.querySelector('#app-alias-form'),list=form.querySelector('.app-alias-rows');
 const row=group=>`<div class="app-alias-row"><label><span class="sr-only">显示名称</span><input class="app-alias-name" value="${esc(group.name)}" maxlength="120" placeholder="显示名称" aria-label="显示名称"></label><label><span class="sr-only">原始名称或别名</span><input class="app-alias-names" value="${esc([...new Set([group.name,...(group.aliases||[])])].join('，'))}" placeholder="原始名称，用逗号分隔" aria-label="原始名称或别名"></label><button type="button" class="quiet" data-remove-alias aria-label="删除这组应用名称">×</button></div>`;
 const fill=groups=>list.innerHTML=groups.map(row).join('');
 form.addEventListener('click',e=>{const remove=e.target.closest('[data-remove-alias]');if(remove)remove.closest('.app-alias-row').remove()});
 form.querySelector('[data-add-alias]').onclick=()=>{list.insertAdjacentHTML('beforeend',row({name:'',aliases:[]}));list.lastElementChild.querySelector('input').focus()};
 form.querySelector('[data-default-aliases]').onclick=()=>{fill(DEFAULT_APP_ALIASES);toast('已填入默认分组，点击保存后生效')};
 form.onsubmit=async e=>{e.preventDefault();try{
  const groups=[...list.querySelectorAll('.app-alias-row')].map(el=>({name:el.querySelector('.app-alias-name').value.trim(),aliases:el.querySelector('.app-alias-names').value.split(/[,，;；\n]/).map(x=>x.trim()).filter(Boolean)})).filter(g=>g.name||g.aliases.length),next=structuredClone(getState());
  next.settings.appAliases=validateAppAliases(groups);
  if(await commit(next))toast('应用名称合并已保存，历史时间线也会按新名称展示');
 }catch(error){toast(error.message,true)}};
 return {render:()=>fill(appAliasGroups(getState().settings))};
}
