// Keep both activity detail layers inside the visible chart, below native chrome.
export function timelinePopoverPosition({anchor,popup,viewport,width,height,beside=false}){
 const top=Math.max(10,Math.min(viewport.top+6,height-70));
 const bottom=Math.min(height-10,Math.max(top+50,viewport.bottom-6));
 const right=anchor.right+12,left=anchor.left-popup.width-12;
 let x=anchor.left,y;
 if(beside){x=right+popup.width<=width-10?right:left>=10?left:Math.max(10,width-popup.width-10);y=anchor.top}
 else if(anchor.bottom+7+popup.height<=bottom)y=anchor.bottom+7;
 else if(anchor.top-popup.height-7>=top)y=anchor.top-popup.height-7;
 else{x=right+popup.width<=width-10?right:left>=10?left:anchor.left;y=anchor.top}
 return {left:Math.max(10,Math.min(x,width-popup.width-10)),top:Math.max(top,Math.min(y,bottom-popup.height)),maxHeight:Math.max(40,bottom-top)};
}
export function placeTimelinePopover(popover,{anchor,scroller,beside=false}){
 const chart=scroller.getBoundingClientRect(),chrome=document.querySelector('.workspace-header')?.getBoundingClientRect().bottom||0,viewport={top:Math.max(chart.top,chrome+2),bottom:chart.bottom},bounds=timelinePopoverPosition({anchor,popup:{width:0,height:0},viewport,width:innerWidth,height:innerHeight,beside});
 popover.style.maxHeight=bounds.maxHeight+'px';
 const position=timelinePopoverPosition({anchor,popup:popover.getBoundingClientRect(),viewport,width:innerWidth,height:innerHeight,beside});
 popover.style.left=position.left+'px';popover.style.top=position.top+'px';
}
