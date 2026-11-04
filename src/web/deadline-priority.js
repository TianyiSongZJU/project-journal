// Low-priority nodes are dated tasks, not calendar deadline markers.
export const isCalendarDeadline=node=>node.priority!=='低';
const priorityRank={低:1,中:2,高:3};
export const priorityMatches=(node,priority='all')=>priority==='all'||(priorityRank[node.priority]??2)>=(priorityRank[priority]??1);
export function dayTasks(projects,date){return projects.flatMap(p=>(p.deadlines||[]).filter(d=>d.priority==='低'&&d.date===date).map(d=>({p,d}))).sort((a,b)=>Number(!!a.d.done)-Number(!!b.d.done))}
