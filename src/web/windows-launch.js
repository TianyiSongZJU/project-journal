// Canvas counterpart of the Mac layers: grouped tiles, paper, one shared mask and light.
import {clamp,smooth,reliefScene,reliefWave,reliefExit,revealRadius,reliefOpacity} from './launch-relief.js';
let launch=null;
let nativeReveal=null;
// The host remains visible and rendering behind a separate native cover. Release
// that cover only after the canvas (or restored reduced-motion page) has painted.
export function notifyWindowsLaunchPainted(){
 if(!window.journalWindowsHost||typeof window.journalLaunchPainted!=='function')return Promise.resolve();
 nativeReveal??=new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))).then(()=>window.journalLaunchPainted()).then(removed=>{window.journalLaunchCoverReleased=removed===true||removed?.removed===true;if(removed?.error)window.journalLaunchCoverError=removed.error;}).catch(error=>{window.journalLaunchCoverError=String(error);});
 return nativeReveal;
}
const surface=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});
function tileTexture(){
 const image=surface(860,860),ctx=image.getContext('2d');ctx.scale(2,2);ctx.translate(215,215);
 ctx.shadowColor='rgba(97,117,89,.14)';ctx.shadowBlur=14;ctx.shadowOffsetX=8;ctx.shadowOffsetY=-10;
 ctx.fillStyle='#dce8d3';ctx.beginPath();ctx.roundRect(-155,-155,310,310,30);ctx.fill();ctx.shadowColor='transparent';
 const edge=ctx.createLinearGradient(-155,155,155,-155);edge.addColorStop(0,'rgb(224.4,237.15,214.2)');edge.addColorStop(1,'rgb(204,219.3,188.7)');ctx.fillStyle=edge;ctx.beginPath();ctx.roundRect(-155,-159,310,310,30);ctx.fill();
 const face=ctx.createLinearGradient(-130.2,155,139.5,-117.8);face.addColorStop(0,'rgb(239.802,245.004,233.4525)');face.addColorStop(1,'#dce8d3');ctx.fillStyle=face;ctx.beginPath();ctx.roundRect(-155,-155,310,310,30);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.42)';ctx.lineWidth=1;ctx.stroke();
 return image;
}
function featherTexture(){
 const image=surface(256,256),ctx=image.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,256,256);
 for(let step=128;step>=0;step--){const t=step/128,extent=128*(.45+.55*t),gray=smooth(t)*255;ctx.fillStyle=`rgb(${gray},${gray},${gray})`;ctx.beginPath();ctx.roundRect(128-extent,128-extent,extent*2,extent*2,extent*30/155);ctx.fill();}
 return image;
}
export function startWindowsLaunch(){
 if(!window.journalWindowsHost||launch||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const canvas=surface(1,1);canvas.id='windows-launch-surface';canvas.setAttribute('aria-hidden','true');
 Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'2147483646',pointerEvents:'auto'});canvas.style.setProperty('visibility','visible','important');document.body.append(canvas);
 const ctx=canvas.getContext('2d'),gray=surface(1,1),gc=gray.getContext('2d',{willReadFrequently:true}),mask=surface(1,1),mc=mask.getContext('2d'),light=surface(1,1),lc=light.getContext('2d'),tile=tileTexture(),feather=featherTexture();
 const warm=!!window.journalLaunchWarm,start=performance.now();let scene,exit=null,raf=0,done=false,resolve,clearSince=null,maskPixels;
 const finished=new Promise(r=>resolve=r),motion=matchMedia('(prefers-reduced-motion: reduce)');
 function stop(){if(done)return;done=true;cancelAnimationFrame(raf);canvas.remove();window.removeEventListener('resize',size);document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',onMotion);resolve();}
 function size(){
  scene=reliefScene(innerWidth,innerHeight,warm);const dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.ceil(innerWidth*dpr);canvas.height=Math.ceil(innerHeight*dpr);
  const ratio=320/Math.max(innerWidth,innerHeight);gray.width=mask.width=light.width=Math.max(1,Math.ceil(innerWidth*ratio));gray.height=mask.height=light.height=Math.max(1,Math.ceil(innerHeight*ratio));maskPixels=mc.createImageData(mask.width,mask.height);
  if(exit)exit=reliefExit(scene,performance.now()-start);clearSince=null;
 }
 function updateMask(time){
  gc.setTransform(1,0,0,1,0,0);gc.globalCompositeOperation='copy';gc.globalAlpha=1;gc.fillStyle='white';gc.fillRect(0,0,gray.width,gray.height);
  const sx=gray.width/scene.width,sy=gray.height/scene.height;gc.setTransform(scene.a*sx,scene.b*sy,scene.c*sx,scene.d*sy,scene.width/2*sx,(scene.height/2+10)*sy);gc.globalCompositeOperation='darken';
  // Overlapping regions choose their strongest field instead of multiplying alpha.
  for(const plan of exit.plans){const radius=revealRadius(plan,time);if(radius<=.5)continue;gc.globalAlpha=clamp((time-plan.begin)/120);gc.drawImage(feather,plan.piece.source.x-radius,plan.piece.source.y-radius,radius*2,radius*2);}
  gc.globalAlpha=1;gc.globalCompositeOperation='source-over';gc.setTransform(1,0,0,1,0,0);
  const source=gc.getImageData(0,0,gray.width,gray.height).data,target=maskPixels.data;let maximum=0;
  for(let i=0;i<source.length;i+=4){target[i+3]=source[i];maximum=Math.max(maximum,source[i]);}mc.putImageData(maskPixels,0,0);return maximum;
 }
 function draw(now){
  if(done||document.hidden)return;const time=now-start,{width,height}=scene,dpr=canvas.width/width;
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.globalAlpha=1;
  const background=ctx.createLinearGradient(width*.2,0,width*.85,height);background.addColorStop(0,'rgb(250.7415,251.991,250.002)');background.addColorStop(.5,'rgb(238,243,235)');background.addColorStop(1,'rgb(236.2065,241.893,232.6875)');ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  const maximum=exit?updateMask(time):255;
  if(exit){ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0,width,height);ctx.globalCompositeOperation='source-over';}
  for(const piece of scene.sources){const wave=reliefWave(scene,piece,time,exit?.sweep),fade=exit?.tiles.find(p=>p.row===piece.row&&p.col===piece.col),opacity=fade&&time>=fade.exit?reliefOpacity(scene,fade,time):wave.opacity;if(opacity<=0)continue;
   ctx.save();ctx.globalAlpha=opacity;ctx.transform(scene.a,scene.b,scene.c,scene.d,piece.center.x,piece.center.y-scene.scale*wave.lift);ctx.drawImage(tile,-215,-215,430,430);ctx.restore();
  }
  // The lighting wash sits over the artwork and shares the backdrop's mask.
  lc.setTransform(1,0,0,1,0,0);lc.clearRect(0,0,light.width,light.height);const wash=lc.createLinearGradient(light.width*.2,0,light.width*.7,light.height*.8);wash.addColorStop(0,'rgba(255,255,249.9,.28)');wash.addColorStop(1,'rgba(255,255,249.9,0)');lc.fillStyle=wash;lc.fillRect(0,0,light.width,light.height);
  if(exit){lc.globalCompositeOperation='destination-in';lc.drawImage(mask,0,0);lc.globalCompositeOperation='source-over';}ctx.drawImage(light,0,0,width,height);
  if(exit&&time>=exit.end&&maximum<=1){clearSince??=now;if(now-clearSince>=33){ctx.clearRect(0,0,width,height);stop();return;}}else clearSince=null;
  if(!motion.matches)raf=requestAnimationFrame(draw);
  void notifyWindowsLaunchPainted();
 }
 function visibility(){cancelAnimationFrame(raf);if(document.hidden){if(exit)stop();}else if(!done&&!motion.matches)raf=requestAnimationFrame(draw);}
 function onMotion(){if(motion.matches)stop();}
 window.addEventListener('resize',size);document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',onMotion);size();raf=requestAnimationFrame(draw);
 launch={finish(){if(done)return finished;if(document.hidden||motion.matches)stop();else if(!exit)exit=reliefExit(scene,performance.now()-start);return finished;},stop};window.addEventListener('pagehide',stop,{once:true});
}
export function finishWindowsLaunch(){return launch?.finish()??Promise.resolve();}
if(typeof window!=='undefined'&&window.journalWindowsHost)startWindowsLaunch();
