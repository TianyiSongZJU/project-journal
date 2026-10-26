const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-clients-')),date='2026-10-23',base=Date.parse(date+'T00:00:00+08:00')/1000;
 const server=spawn(process.env.JOURNAL_CORE,['--no-open','--data-dir',dir,'--auto-home',path.join(dir,'local')],{windowsHide:true,stdio:'ignore'});
 let browser;
 try {
  const sessionPath=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(dir).digest('hex').slice(0,24)+'.json');
  for(let i=0;!fs.existsSync(sessionPath)&&i<100;i++)await new Promise(r=>setTimeout(r,100));
  const session=JSON.parse(fs.readFileSync(sessionPath));
  browser=await chromium.launch({headless:true,executablePath:process.env.JOURNAL_BROWSER||undefined});
  const context=await browser.newContext({viewport:{width:1360,height:1000},timezoneId:'Asia/Shanghai'});
  let nativeHidden=[];
  await context.exposeFunction('journalLoadHiddenClients',()=>nativeHidden);
  await context.exposeFunction('journalSaveHiddenClients',value=>{nativeHidden=value;});
  const windowsInit=()=>{window.journalWindowsHost=true;document.addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('native-windows');const link=document.createElement('link');link.rel='stylesheet';link.href='windows.css';document.head.append(link);});};
  await context.addInitScript(windowsInit);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const toggleLayout=async target=>{const picker=target.locator('.dt-client-picker');if(!await picker.evaluate(el=>el.open))await picker.locator('summary').click();await target.locator('.dt-client-layout').click();await target.keyboard.press('Escape');};
  const open=async(compare=true)=>{await page.goto(session.url+'/?token='+session.token);await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存到本地');await page.locator('#auto-entry').click();await page.locator('#dt-date').fill(date);await page.locator('#dt-date').dispatchEvent('change');await page.locator('.dt-client-picker').waitFor();if(compare)await toggleLayout(page);};
  await open();
  await page.evaluate(async()=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'a',name:'论文研究',color:'#315c46',note:'',deadlines:[]}];d.state.entries=[{projectId:'a',date:'2026-10-23',kind:'hours',hours:2,note:'已有记录'}];d.state.timelineDays={'2026-10-23':{blocks:[{id:'selected',start:540,end:585,projectId:'a'}],applied:[]}};const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})});if(!res.ok)throw Error('fixture write failed');});
  const folder=path.join(dir,'activity');fs.mkdirSync(folder,{recursive:true});
  for(const [id,name,app,seconds]of [['mac','MacBook Pro','Safari',600],['win','Windows 主机','Microsoft Word.exe',780],['office','办公室电脑','Microsoft Word.EXE',420]]){
   const evidence={};for(let i=0;i<8;i++){const key=id+'/app-'+i;evidence[key]={id:key,date,projectId:'a',kind:'activity',app,name:app,stamp:''+i,seconds,bucketStart:base+(540+i*15)*60,attribution:{filename:seconds}};}
   evidence[id+'/file']={id:id+'/file',date,projectId:'a',kind:'file',name:name+'-文稿.docx',relativePath:name+'/文稿.docx',stamp:id,touches:[{at:base+560*60,stamp:id}]};
   fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify({version:1,deviceId:id,deviceName:name,evidence}));
  }
  await open(false);
  assert.equal(await page.locator('.dt-clients-merged').count(),1,'merged view is the default');
  assert.doesNotMatch((await page.locator('.dt-area-name').allTextContents()).join(' '),/\.exe/i);
  await page.locator('.dt-area-name').filter({hasText:'Word'}).first().hover();
  assert.match(await page.locator('.dt-evidence-tip').innerText(),/Windows 主机/);
  assert.match(await page.locator('.dt-evidence-tip').innerText(),/办公室电脑/);
  assert.doesNotMatch(await page.locator('.dt-evidence-tip').innerText(),/\.exe/i);
  await page.mouse.move(1,1);
  if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'clients-merged.png')});
  await toggleLayout(page);
  assert.equal(await page.locator('.dt-client-column').count(),3);
  assert.equal(await page.locator('.dt-client-heading-group b').count(),3);
  const headingBounds=await page.locator('.dt-client-heading-group b').evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right};}));
  assert.ok(headingBounds.every((r,i)=>!i||r.left>=headingBounds[i-1].right),'client titles never overlap');
  const state=await page.evaluate(async()=>JSON.stringify((await(await fetch('/api/state')).json()).state)),suggestions=await page.locator('.dt-suggestion').count();
  const menu=page.locator('.dt-client-picker');await menu.locator('summary').click();
  if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'clients-menu.png')});
  await menu.locator('input[value="mac"]').uncheck();
  assert.equal(await page.locator('.dt-client-column').count(),2);assert.equal(await page.locator('.dt-client-picker[open]').count(),1);
  assert.equal(await page.locator('.dt-suggestion').count(),suggestions);
  assert.equal(await page.evaluate(async()=>JSON.stringify((await(await fetch('/api/state')).json()).state)),state);
  await menu.locator('input[value="office"]').uncheck();assert.equal(await page.locator('.dt-client-column').count(),1);
  assert.doesNotMatch((await page.locator('.dt-file').evaluateAll(xs=>xs.map(x=>x.dataset.evidence))).join(' '),/MacBook Pro|办公室电脑/,'file clues follow the chosen clients');
  await open();assert.equal(await page.locator('.dt-client-column').count(),1,'choice persists after reload');
  const restarted=await browser.newContext({timezoneId:'Asia/Shanghai'});
  await restarted.exposeFunction('journalLoadHiddenClients',()=>nativeHidden);
  await restarted.addInitScript(windowsInit);
  const fresh=await restarted.newPage();await fresh.goto(session.url+'/?token='+session.token);await fresh.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存到本地');await fresh.locator('#auto-entry').click();await fresh.locator('#dt-date').fill(date);await fresh.locator('#dt-date').dispatchEvent('change');await toggleLayout(fresh);await fresh.waitForFunction(()=>document.querySelectorAll('.dt-client-column').length===1);assert.equal(await fresh.locator('.dt-client-column').getAttribute('data-client'),'win','native preference survives an empty web cache');await restarted.close();
  await menu.locator('summary').click();await menu.locator('input[value="win"]').uncheck();assert.equal(await page.locator('.dt-client-column').count(),0);assert.match(await page.locator('.dt-no-evidence').innerText(),/所选客户端/);
  await menu.locator('[data-client-all]').click();assert.equal(await page.locator('.dt-client-column').count(),3);await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('open'),null);
  await page.locator('.dt-scroll').evaluate(el=>el.scrollTop=0);
  await page.locator('.dt-client-column[data-client="mac"] .dt-area-name').first().hover();assert.match(await page.locator('.dt-evidence-tip').innerText(),/MacBook Pro/);await page.mouse.move(1,1);
  if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'clients-desktop.png')});
  for(const width of [760,600]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(180);assert.ok(await page.locator('.dt-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'page must not overflow');
   await page.locator('.dt-scroll').evaluate(el=>el.scrollLeft=100);await page.waitForTimeout(30);
   const alignment=await page.evaluate(()=>Math.abs(document.querySelector('.dt-client-heading-group').getBoundingClientRect().left-document.querySelector('.dt-client-column').getBoundingClientRect().left));assert.ok(alignment<2,'headings follow horizontal scroll: '+alignment);
   const pinned=await page.evaluate(()=>{const surface=document.querySelector('.dt-surface').getBoundingClientRect(),clock=document.querySelector('.dt-clock').getBoundingClientRect(),lane=document.querySelector('.dt-select-lane').getBoundingClientRect();return clock.left>=surface.left&&lane.right<=surface.right&&lane.left>=surface.left;});assert.ok(pinned,'clock and selection stay visible when scrolling');
   const centers=await page.locator('.dt-axis-caption>span,.dt-client-picker>summary,.dt-axis-caption>div:last-child>strong').evaluateAll(xs=>xs.map(el=>{const r=el.getBoundingClientRect();return r.top+r.height/2;}));assert.ok(Math.max(...centers)-Math.min(...centers)<1,'caption contents share a vertical center: '+JSON.stringify(centers));
   if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'clients-'+width+'.png')});
  }
  await toggleLayout(page);
  for(const width of [760,600]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
   assert.equal(await page.locator('.dt-clients-merged').count(),1);
   assert.ok(await page.locator('.dt-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'merged view fits narrow windows without horizontal scrolling');
   if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'clients-merged-'+width+'.png')});
  }
  await toggleLayout(page);
  await page.setViewportSize({width:1360,height:1000});await page.waitForTimeout(150);await page.locator('[data-focus-client="win"]').click();assert.equal(await page.locator('.dt-client-column').count(),1,'device title focuses a client');assert.equal(await page.locator('.dt-client-column').getAttribute('data-client'),'win');
  const macContext=await browser.newContext(),mac=await macContext.newPage();await mac.goto(session.url+'/?token='+session.token);await mac.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存到本地');await mac.locator('#auto-entry').click();await mac.locator('#dt-date').fill(date);await mac.locator('#dt-date').dispatchEvent('change');assert.equal(await mac.locator('.dt-client-picker').count(),0);assert.equal(await mac.locator('.dt-client-column').count(),0);assert.ok(await mac.locator('.dt-app-run').count()>0,'shared presentation remains');
  assert.deepEqual(errors,[]);console.log('PASS: client lanes, filtering, persistence, empty selection, tooltips, responsive scrolling, unchanged records/suggestions and non-Windows presentation');
 } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
