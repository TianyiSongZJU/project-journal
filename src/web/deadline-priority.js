// Low-priority nodes are dated tasks, not calendar deadline markers.
export const isCalendarDeadline=node=>node.priority!=='低';
export const priorityMatches=(node,priority='all')=>priority==='all'||node.priority===priority;
export function dayTasks(projects,date){return projects.flatMap(p=>(p.deadlines||[]).filter(d=>d.priority==='低'&&d.date===date).map(d=>({p,d}))).sort((a,b)=>Number(!!a.d.done)-Number(!!b.d.done))}
