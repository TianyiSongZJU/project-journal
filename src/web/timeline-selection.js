// Compare allocations by their meaning; object field order and block IDs are incidental.
export function sameAllocations(a=[],b=[]){
 const normalize=xs=>xs.filter(x=>x.projectId).map(({start,end,projectId})=>[start,end,projectId]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2].localeCompare(b[2]));
 return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}
// The initial quarter remains selected in either direction; moving to an exact
// boundary ends there when dragging down, and starts there when dragging up.
export function quarterSelection(anchor,pointer){
 const n=Math.round(pointer/15)*15;
 return {start:Math.max(0,Math.min(1425,Math.min(anchor,n))),end:Math.min(1440,Math.max(anchor+15,n))};
}
