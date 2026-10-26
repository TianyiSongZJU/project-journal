// The same interval union/subtraction is repeated on the server before confirmation.
export function unionSpans(spans){const sorted=spans.filter(s=>s.end>s.start).map(s=>({...s})).sort((a,b)=>a.start-b.start),out=[];for(const s of sorted){const last=out.at(-1);if(last&&s.start<=last.end)last.end=Math.max(last.end,s.end);else out.push(s)}return out}
export function subtractSpans(spans,covered){let result=unionSpans(spans);for(const c of unionSpans(covered)){result=result.flatMap(s=>c.end<=s.start||c.start>=s.end?[s]:[{start:s.start,end:Math.min(c.start,s.end)},{start:Math.max(c.end,s.start),end:s.end}].filter(s=>s.end>s.start))}return result}
export const spanSeconds=spans=>unionSpans(spans).reduce((n,s)=>n+s.end-s.start,0);
export function selectedSpans(d,indices,covered=d.countedSpans||[]){return subtractSpans((indices||[]).flatMap(i=>d.sessions?.[i]?.spans||[]),covered)}
export function duration(seconds){const minutes=Math.floor(Math.max(0,seconds+1e-6)/60),hours=Math.floor(minutes/60),rest=minutes%60;return hours?(hours+' 小时'+(rest?' '+rest+' 分钟':'')):minutes?minutes+' 分钟':seconds>0?'不足 1 分钟':'0 分钟'}
export function timelineGroups(sessions,gap){const groups=[];sessions.forEach((s,index)=>{let g=groups.at(-1);if(!g||s.start-g.end>gap*60){g={start:s.start,end:s.end,items:[]};groups.push(g)}g.end=Math.max(g.end,s.end);g.items.push({...s,index})});return groups}
