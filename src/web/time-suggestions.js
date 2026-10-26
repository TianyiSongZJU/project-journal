export function dedupeFileChanges(files){const fileChanges=new Map();for(const f of files){const identity=(f.relativePath||f.path||f.name||'').replaceAll('\\','/').normalize('NFC'),key=f.projectId+'/'+identity+'/'+(f.stamp||Math.floor(f.at*60));let prev=fileChanges.get(key);if(prev){prev.at=Math.min(prev.at,f.at);prev.devices=[...new Set([...prev.devices,...(f.devices||[f.device||'本机'])])];prev.bulk=prev.bulk&&f.bulk}else fileChanges.set(key,{...f,devices:[...(f.devices||[f.device||'本机'])]})}
return [...fileChanges.values()] }
// At most 96 local quarter-hour buckets. Raw observations are never copied to storage.
export function suggestTimeSlots({activities=[],files=[],projectIds=[],gapMinutes=15,rules={}}){
 const known=new Set(projectIds),slots=Array.from({length:96},(_,i)=>({start:i*15,end:(i+1)*15,active:0,projects:new Map(),files:[],nearFiles:[]}));
 // Accumulate within each device, then use the maximum across devices for one project.
 // This prevents two simultaneous machines from manufacturing additional elapsed time.
 const seenActivities=new Set();
 for(const a of activities){if(!Number.isFinite(a.start)||!Number.isFinite(a.end)||a.end<=a.start)continue;if(a.id){if(seenActivities.has(a.id))continue;seenActivities.add(a.id)}const seconds=Number.isFinite(a.seconds)?Math.max(0,a.seconds):(a.end-a.start)*60;
  for(let i=Math.max(0,Math.floor(a.start/15));i<Math.min(96,Math.ceil(a.end/15));i++){const s=slots[i];s.deviceStats??=new Map();const id=a.deviceId||a.device||'local';let d=s.deviceStats.get(id);if(!d){d={name:a.device||'本机',active:0,projects:new Map()};s.deviceStats.set(id,d)}const fraction=Math.max(0,Math.min(s.end,a.end)-Math.max(s.start,a.start))/(a.end-a.start),n=Math.min(900,seconds*fraction);d.active=Math.min(900,d.active+n);
   if(known.has(a.projectId)){const basis=Object.entries(a.basis||{}),allowed=basis.length?basis.filter(([key])=>rules[key]!==false):rules.filename!==false?[['matched',seconds]]:[],attributed=Math.min(n,allowed.reduce((sum,[,v])=>sum+v*fraction,0));if(attributed<=0)continue;let p=d.projects.get(a.projectId);if(!p){p={seconds:0,basis:{}};d.projects.set(a.projectId,p)}p.seconds=Math.min(900,p.seconds+attributed);for(const [key,value]of allowed)p.basis[key]=Math.min(900,(p.basis[key]||0)+value*fraction)}
  }
 }
 for(const s of slots){s.devices=[...new Set([...(s.deviceStats?.values()||[])].map(d=>d.name))];const claims=[];for(const [id,d]of s.deviceStats||[]){s.active=Math.max(s.active,d.active);for(const [pid,p]of d.projects){if(p.seconds>=120)claims.push({id,pid});let total=s.projects.get(pid);if(!total){total={seconds:0,basis:{}};s.projects.set(pid,total)}total.seconds=Math.max(total.seconds,p.seconds);for(const [basis,n]of Object.entries(p.basis))total.basis[basis]=Math.max(total.basis[basis]||0,n)}}s.crossConflict=claims.some((a,i)=>claims.slice(i+1).some(b=>a.id!==b.id&&a.pid!==b.pid))}
 const fileChanges=dedupeFileChanges(files);
 for(const f of fileChanges){if(rules.files===false||f.bulk&&rules.ignoreBulk!==false||f.legacy||!known.has(f.projectId)||!Number.isFinite(f.at)||f.at<0||f.at>=1440)continue;const i=Math.floor(f.at/15);slots[i].files.push(f);for(let j=Math.max(0,i-1);j<=Math.min(95,i+1);j++)slots[j].nearFiles.push(f)}
 const candidates=slots.map(s=>{if(s.crossConflict)return {...s,projectId:'',projectIds:[...s.projects.keys()],confidence:'conflict',reasons:['多台设备在同一时间指向不同项目，请手动判断'],observedMinutes:Math.min(15,s.active/60)};const ranked=[...s.projects].sort((a,b)=>b[1].seconds-a[1].seconds),first=ranked[0],second=ranked[1],conflict=!!second&&(second[1].seconds>=120||second[1].seconds>=s.active*.25);if(conflict)return null;
  if(first&&first[1].seconds>=300&&first[1].seconds>=s.active*.6){const [projectId,p]=first,document=(p.basis.document||0)>=p.seconds*.5,filename=(p.basis.filename||0)>=p.seconds*.5;return {...s,projectId,confidence:document?'strong':'medium',reasons:[document?'前台文档位于项目资料夹':filename?'前台标题匹配项目文件名':p.basis.folder?'前台标题匹配项目资料夹':'前台活动已匹配此项目'],observedMinutes:Math.min(15,s.active/60)}}
  // File saves support a span only if they recur; one save or a burst never buys time.
  const relevant=s.active>=120?s.nearFiles:s.files,ids=[...new Set(relevant.map(f=>f.projectId))];if(ids.length!==1||s.projects.size>1||first&&first[0]!==ids[0])return null;const fs=relevant.filter(f=>Math.abs(f.at-(s.start+7.5))<=22.5),times=[...new Set(fs.map(f=>f.at))].sort((a,b)=>a-b);if(times.length<2||times.at(-1)-times[0]<3)return null;
  if(s.active<120&&(times[0]<s.start||times.at(-1)>=s.end))return null;
  return {...s,projectId:ids[0],confidence:'low',reasons:[s.active>=120?'活跃区间附近有同项目的连续文件修改':'同项目文件多次修改，仅提示修改跨度'],observedMinutes:Math.min(15,s.active/60)};
 });
 if(rules.gap!==false&&gapMinutes>=15)for(let i=1;i<95;i++){if(candidates[i]||slots[i].active<120)continue;const a=candidates[i-1],b=candidates[i+1];if(!a||!b||!a.projectId||a.projectId!==b.projectId||a.confidence==='low'||b.confidence==='low')continue;if([...slots[i].projects.keys()].some(id=>id!==a.projectId)||slots[i].files.some(f=>f.projectId!==a.projectId))continue;candidates[i]={...slots[i],projectId:a.projectId,confidence:'low',reasons:['前后均为同一项目，中间有前台活跃；短间隔关联'],observedMinutes:Math.min(15,slots[i].active/60)}}
 return candidates.filter(Boolean).map(({start,end,projectId,projectIds,confidence,reasons,observedMinutes,devices,files:slotFiles})=>({start,end,projectId,projectIds,confidence,reasons,observedMinutes,devices:[...new Set([...(devices||[]),...(slotFiles||[]).flatMap(f=>f.devices||[])])]}));
}
export function availableSuggestions(slots,blocks,{start=0,end=1440,nowEnd=1440}={}){const out=[];for(const s of slots){if(s.start<start||s.end>end||s.end>nowEnd||blocks.some(b=>b.start<s.end&&b.end>s.start))continue;const prev=out.at(-1);if(prev&&prev.end===s.start&&prev.projectId===s.projectId&&(prev.confidence==='conflict')===(s.confidence==='conflict')){prev.end=s.end;if(prev.confidence!==s.confidence)prev.confidence='mixed';prev.observedMinutes+=s.observedMinutes;prev.reasons=[...new Set([...prev.reasons,...s.reasons])];prev.devices=[...new Set([...(prev.devices||[]),...(s.devices||[])])];prev.projectIds=[...new Set([...(prev.projectIds||[]),...(s.projectIds||[])])]}else out.push({...s,reasons:[...s.reasons]})}return out.map(s=>({...s,id:`${s.start}-${s.end}-${s.projectId}-${s.confidence}`}))}

// Join only touching selections of the same project; applied accounting stays unchanged.
export function adoptSuggestion(blocks, suggestion){
 let block={...suggestion},remaining=[...blocks],joined;
 do{joined=false;remaining=remaining.filter(other=>{
  if(other.projectId!==block.projectId||(other.end!==block.start&&other.start!==block.end))return true;
  block={...block,id:other.id,start:Math.min(block.start,other.start),end:Math.max(block.end,other.end)};joined=true;return false;
 })}while(joined);
 return {blocks:[...remaining,block].sort((a,b)=>a.start-b.start),block};
}
