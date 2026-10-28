// Geometry and timings mirror JournalLaunchSurface in macos.swift. Coordinates
// remain in the tile plane until projection into the Windows canvas.
export const clamp=x=>Math.max(0,Math.min(1,x));
export const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
function bezier(x,x1,x2){
 x=clamp(x);let lo=0,hi=1,t=x;
 for(let i=0;i<16;i++){t=(lo+hi)/2;const value=3*(1-t)*(1-t)*t*x1+3*(1-t)*t*t*x2+t*t*t;if(value<x)lo=t;else hi=t;}
 return 3*(1-t)*t*t+t*t*t;
}
const waveEase=x=>bezier(x,.37,.63),fadeEase=x=>bezier(x,.42,.58);
export function reliefScene(width,height,warm=false){
 const angle=31*Math.PI/180,tilt=Math.cos(52*Math.PI/180),scale=Math.max(width/1024,height/710)*1.05;
 const a=Math.cos(angle)*scale,b=-Math.sin(angle)*tilt*scale,c=-Math.sin(angle)*scale,d=-Math.cos(angle)*tilt*scale,det=a*d-b*c;
 const project=(x,y)=>({x:width/2+a*x+c*y,y:height/2+10+b*x+d*y});
 const inverse=(x,y)=>{x-=width/2;y-=height/2+10;return {x:(d*x-c*y)/det,y:(a*y-b*x)/det};};
 const period=warm?1000:1600,phaseGap=warm?.13:.08,initial=warm?1:.48,pieces=[];
 for(let row=0;row<5;row++)for(let col=0;col<5;col++){
  const x=(col-2)*354,y=(row-2)*354,center=project(x,y),corners=[project(x-155,y-155),project(x-155,y+155),project(x+155,y-155),project(x+155,y+155)];
  const rect={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
  const visible=rect.right>=-12&&rect.left<=width+12&&rect.bottom>=-12&&rect.top<=height+12;
  let source={x,y};
  if(center.x<0||center.x>width||center.y<0||center.y>height)source=inverse((Math.max(0,rect.left)+Math.min(width,rect.right))/2,(Math.max(0,rect.top)+Math.min(height,rect.bottom))/2);
  pieces.push({row,col,x,y,center,source,visible,start:-(initial-(row+col)*phaseGap)*period});
 }
 const sources=pieces.filter(p=>p.visible);let reach=0;
 for(let iy=0;iy<=8;iy++)for(let ix=0;ix<=8;ix++){const point=inverse(width*ix/8,height*iy/8);reach=Math.max(reach,Math.min(...sources.map(p=>Math.hypot(point.x-p.source.x,point.y-p.source.y))));}
 const margin=(Math.hypot(d/det,-b/det)*width+Math.hypot(-c/det,a/det)*height)/16;
 return {width,height,a,b,c,d,scale,project,pieces,sources,period,cycle:period*(1+8*phaseGap),fade:warm?330:440,diffusion:warm?500:620,outer:(reach+margin+16)/.45};
}
export function reliefWave(scene,piece,time,sweep){
 const elapsed=time-piece.start-(sweep??Math.floor(Math.max(0,time-piece.start)/scene.cycle))*scene.cycle,t=clamp(elapsed/scene.period);
 const lift=11*(t<.5?waveEase(t*2):1-waveEase((t-.5)*2));
 const opacity=t<.5?.28+.36*waveEase(t*2):t<=.805?.64:.64-.36*waveEase((t-.805)/.195);
 return {lift,opacity};
}
export function reliefExit(scene,time){
 const sweep=Math.floor(Math.max(0,time-scene.pieces[0].start)/scene.cycle),first=Math.min(...scene.sources.map(p=>p.row+p.col));
 const tiles=scene.sources.map(piece=>{const elapsed=time-piece.start-sweep*scene.cycle,exit=time+Math.max(0,.805*scene.period-elapsed,(piece.row+piece.col-first)*80);return {...piece,exit,opacity:elapsed>=.805*scene.period?reliefWave(scene,piece,time,sweep).opacity:.64};});
 const end=Math.max(...tiles.map(p=>p.exit+scene.fade*.5))+scene.diffusion,protection=tiles.map(p=>p.exit+scene.fade*.5);
 const plans=tiles.map(piece=>{
  const begin=piece.exit+scene.fade*.35,times=[...new Set([...Array.from({length:81},(_,i)=>begin+(end-begin)*i/80),...protection.filter(t=>t>begin&&t<end)])].sort((a,b)=>a-b);
  let radius=0,previous=begin;
  const radii=times.map(t=>{let safe=scene.outer;for(const other of tiles)if(t<=other.exit+scene.fade*.5+.000001){const dx=Math.max(other.x-167-piece.source.x,0,piece.source.x-other.x-167),dy=Math.max(other.y-167-piece.source.y,0,piece.source.y-other.y-167);safe=Math.min(safe,Math.max(dx,dy));}radius=Math.min(safe,radius+scene.outer/scene.diffusion*Math.max(0,t-previous));previous=t;return radius;});
  return {piece,begin,times,radii};
 });
 return {tiles,plans,end,sweep};
}
export function revealRadius(plan,time){
 if(time<=plan.begin)return 0;if(time>=plan.times.at(-1))return plan.radii.at(-1);
 let i=1;while(i<plan.times.length-1&&plan.times[i]<time)i++;
 return plan.radii[i-1]+(plan.radii[i]-plan.radii[i-1])*(time-plan.times[i-1])/(plan.times[i]-plan.times[i-1]);
}
export function reliefOpacity(scene,piece,time){return piece.opacity*(1-fadeEase((time-piece.exit)/scene.fade));}
