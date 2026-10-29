const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-windows-launch-')),sessionPath=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(dir).digest('hex').slice(0,24)+'.json');
 const server=spawn(process.env.JOURNAL_CORE,['--no-open','--ui-only','--data-dir',dir,'--auto-home',path.join(dir,'local')],{windowsHide:true,stdio:'ignore'});let browser;
 try{
  for(let i=0;!fs.existsSync(sessionPath)&&i<100;i++)await new Promise(r=>setTimeout(r,100));const session=JSON.parse(fs.readFileSync(sessionPath));
  browser=await chromium.launch({headless:true,executablePath:process.env.JOURNAL_BROWSER});
  for(const mode of process.env.JOURNAL_FRAME_ONLY?[]:['cold','warm','reduced','hidden','error']){
   console.log('Windows launch case:',mode);
   const context=await browser.newContext({viewport:{width:1120,height:740},reducedMotion:mode==='reduced'?'reduce':'no-preference'}),errors=[];
   await context.addInitScript(mode=>{window.journalWindowsHost=true;window.journalLaunchWarm=mode==='warm';
    document.addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('native-windows');const link=document.createElement('link');link.rel='stylesheet';link.href='windows.css';document.head.append(link);});},mode);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/view-state',async route=>{if(route.request().method()==='GET')await new Promise(r=>setTimeout(r,1000));await route.continue();});
   if(mode==='error')await page.route('**/api/state',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'test read failure'})}));
   await page.goto(session.url+'/?token='+session.token,{waitUntil:'domcontentloaded'});
   if(mode!=='reduced'){
    const surface=page.locator('#windows-launch-surface');await surface.waitFor();assert.equal(await surface.evaluate(el=>getComputedStyle(el).visibility),'visible');
    const first=await surface.evaluate(el=>el.toDataURL());await page.waitForTimeout(140);assert.notEqual(await surface.evaluate(el=>el.toDataURL()),first,'relief moves while the real page loads');
    if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'windows-launch-'+mode+'.png')});
   }
   if(mode==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>window.journalViewReady===true,{},{timeout:12000}).catch(async error=>{console.error({mode,errors,state:await page.evaluate(()=>({status:document.querySelector('#save-status')?.textContent,classes:document.documentElement.className,error:document.querySelector('.error-banner')?.textContent}))});throw error;});await page.locator('#windows-launch-surface').waitFor({state:'detached'});
   if(mode==='error')assert(await page.locator('.error-banner').isVisible());else assert(await page.locator('#page-review').isVisible());
   assert.deepEqual(errors,[]);await context.close();
  }
  // Drive actual canvas frames deterministically, including the final visible tile.
  const context=await browser.newContext({viewport:{width:1120,height:740}}),page=await context.newPage();
  await context.addInitScript(warm=>{
   window.journalLaunchWarm=warm;window.journalWindowsHost=true;window.frameTime=0;let next=0;const frames=new Map();
   Object.defineProperty(performance,'now',{value:()=>window.frameTime});
   window.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};window.cancelAnimationFrame=id=>frames.delete(id);
   window.stepFrame=time=>{window.frameTime=time;const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(time));};
  },process.env.JOURNAL_COVER_WARM==='1');
  await page.route('**/relief-preview',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0;background:#fbfbf9"><script type="module">
   import {finishWindowsLaunch,tileTexture,featherTexture} from './windows-launch.js';window.tileTexture=tileTexture;window.featherTexture=featherTexture;import {reliefScene,reliefExit,reliefWave,reliefOpacity} from './launch-relief.js';
   window.scene=reliefScene(1120,740,!!window.journalLaunchWarm);window.exit=reliefExit(window.scene,350);window.wave=reliefWave;window.opacity=reliefOpacity;
   window.beginExit=()=>{void finishWindowsLaunch().then(()=>window.completed=true);};window.previewReady=true;
   </script></body></html>`}));
  await context.setExtraHTTPHeaders({'X-Journal-Token':session.token});
  await page.goto(session.url+'/relief-preview');await page.waitForFunction(()=>window.previewReady,{},{polling:20});
  if(process.env.JOURNAL_NATIVE_ARTWORK){
   const output=process.env.JOURNAL_NATIVE_ARTWORK;fs.mkdirSync(output,{recursive:true});
   for(const name of ['tileTexture','featherTexture']){const png=await page.evaluate(name=>window[name]().toDataURL().split(',')[1],name);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(png,'base64'));}
   await context.close();return;
  }
  if(process.env.JOURNAL_COVER_OUTPUT){await page.evaluate(()=>window.stepFrame(0));const png=await page.locator('#windows-launch-surface').evaluate(el=>el.toDataURL().split(',')[1]);fs.writeFileSync(process.env.JOURNAL_COVER_OUTPUT,Buffer.from(png,'base64'));}
  const timings=await page.evaluate(()=>{window.stepFrame(350);window.beginExit();return {end:window.exit.end,last:Math.max(...window.exit.tiles.map(p=>p.exit+window.scene.fade))};});
  if(process.env.JOURNAL_NATIVE_REFERENCE){
   await page.evaluate(()=>window.stepFrame(window.journalLaunchWarm?350+(900-350)/1.8:900));
   const png=await page.locator('#windows-launch-surface').evaluate(el=>el.toDataURL().split(',')[1]);
   fs.writeFileSync(process.env.JOURNAL_NATIVE_REFERENCE,Buffer.from(png,'base64'));await context.close();return;
  }
  let protectedFrames=0,tailFrames=0,overlapFrames=0;const partialBackground=[];
  for(let time=350;time<=timings.end+100;time+=17){
   const result=await page.evaluate(time=>{
    window.stepFrame(window.journalLaunchWarm?350+(time-350)/1.8:time);const canvas=document.querySelector('#windows-launch-surface');if(!canvas)return {gone:true};
    const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data,dpr=canvas.width/1120;let protectedCount=0;
    for(const piece of window.exit.tiles){if(time>=piece.exit&&time<piece.exit+window.scene.fade*.5&&piece.center.x>5&&piece.center.x<1115&&piece.center.y>20&&piece.center.y<720){
     const wave=window.wave(window.scene,piece,time,window.exit.sweep),x=Math.round(piece.center.x*dpr),y=Math.round((piece.center.y-window.scene.scale*wave.lift)*dpr);
     if(data[(y*canvas.width+x)*4+3]<250)throw Error('A still-solid tile lost its protected paper background');protectedCount++;
    }}
    let total=0,maximum=0;for(let i=3;i<data.length;i+=4){maximum=Math.max(maximum,data[i]);total+=data[i];}
    const last=window.exit.tiles.reduce((a,b)=>a.exit>b.exit?a:b),point=window.scene.project(last.source.x,last.source.y),x=Math.max(0,Math.min(canvas.width-1,Math.round(point.x*dpr))),y=Math.max(0,Math.min(canvas.height-1,Math.round(point.y*dpr)));
    return {protectedCount,mean:total/(data.length/4*255),maximum,gone:false,phase:(time-last.exit)/window.scene.fade,lastAlpha:data[(y*canvas.width+x)*4+3],opacity:window.opacity(window.scene,last,time)};
   },time);
   protectedFrames+=result.protectedCount||0;
   if(process.env.JOURNAL_SCREENSHOTS&&time>=timings.last-100&&time<timings.last)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'windows-launch-tail-check.png')});
   if(result.mean>.05&&result.mean<.95)partialBackground.push(time);
   if(result.phase>.5&&result.phase<.9&&result.opacity>.01&&result.lastAlpha<245)overlapFrames++;
   if(result.phase>.25&&result.phase<.9){assert(!result.gone);assert(result.maximum>1,'the final fade retains actual intermediate pixels');tailFrames++;}
   if(time>=timings.end&&!result.gone)assert(result.maximum<=1,'the composed surface is fully clear before removal');
   if(process.env.JOURNAL_SCREENSHOTS&&Math.abs(time-(timings.last-75))<9)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'windows-launch-fade-tail.png')});
  }
  assert(protectedFrames>10);assert(tailFrames>=4);assert(overlapFrames>=2,'local paper diffusion overlaps the final tile tail');assert(partialBackground.length>=12);assert(partialBackground.at(-1)-partialBackground[0]>=(process.env.JOURNAL_COVER_WARM==='1'?280:360),'background diffusion remains readable over time');assert(await page.evaluate(()=>window.completed===true));await context.close();
  console.log('PASS Windows cold/warm relief motion, restored-page reveal, reduced motion, hidden-window cleanup and startup errors.');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
