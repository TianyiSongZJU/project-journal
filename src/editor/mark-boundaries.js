const names=new Set(['strong','emphasis']);
export function markArrow(state,key){
 const {$from,empty}=state.selection;
 if(!empty||!['ArrowLeft','ArrowRight'].includes(key))return null;
 const before=$from.nodeBefore?.marks||[],after=$from.nodeAfter?.marks||[],active=state.storedMarks??$from.marks();
 const left=key==='ArrowLeft',near=left?after:before,far=left?before:after;
 const edge=near.filter(mark=>names.has(mark.type.name)&&!far.some(other=>other.eq(mark)));
 if(edge.some(mark=>active.some(other=>other.eq(mark))))return active.filter(mark=>!edge.some(other=>other.eq(mark)));
 // Return through the same boundary before moving through the styled text.
 const enter=far.filter(mark=>names.has(mark.type.name)&&!near.some(other=>other.eq(mark))&&!active.some(other=>other.eq(mark)));
 if(enter.length)return [...active,...enter];
 return null;
}
export function withoutMark(state,name){return (state.storedMarks??state.selection.$from.marks()).filter(mark=>mark.type.name!==name)}
