const {chromium,webkit}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-rich-md-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const sf=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');for(let i=0;!fs.existsSync(sf)&&i<100;i++)await new Promise(r=>setTimeout(r,100));const session=JSON.parse(fs.readFileSync(sf));
  browser=await (process.env.JOURNAL_BROWSER==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));const page=await browser.newPage({viewport:{width:1320,height:960},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')console.log('BROWSER',m.text())});
  await page.addInitScript(platform=>{window.journalMacHost=platform==='mac';window.journalWindowsHost=platform!=='mac';addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add(platform==='mac'?'native-mac':'native-windows');const link=document.createElement('link');link.rel='stylesheet';link.href=platform==='mac'?'macos.css':'windows.css';document.head.append(link)})},process.env.JOURNAL_PLATFORM||'mac');
  await page.goto(session.url+'/?token='+session.token);await page.waitForFunction(()=>window.journalViewReady);

  const dates=await page.evaluate(()=>{const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');return [4,5,6].map(d=>`${y}-${m}-${String(d).padStart(2,'0')}`)});
  await page.evaluate(async dates=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'a',name:'研究',color:'#7b9f9b',note:'',deadlines:[{id:'pending',name:'待完成',date:dates[0],priority:'高',done:false},{id:'done',name:'已完成',date:dates[1],priority:'中',done:true}]}];d.state.entries=[{projectId:'a',date:dates[0],kind:'hours',hours:2,note:''}];await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})})},dates);
  await page.reload();await page.waitForFunction(()=>window.journalViewReady);
  const legend=page.locator('.ddl-legend-trigger');
  async function snapshot(mode){return page.evaluate(({mode,dates})=>{const prefix=mode==='year'?'#year-calendar .heat-day':'#month-calendar .month-day';return dates.map(date=>{const el=document.querySelector(`${prefix}[data-date="${date}"]`),s=getComputedStyle(el),pin=el.parentElement.querySelector('.ddl-pin');return {outline:s.outlineStyle,color:s.outlineColor,pin:pin?getComputedStyle(pin).transform:'',opacity:pin?getComputedStyle(pin).opacity:'',pressed:el.getAttribute('aria-pressed')}})}, {mode,dates})}
  for(const scheme of ['light','dark']){
   await page.evaluate(scheme=>JournalAppearance.apply({scheme,accent:'fern'}),scheme);
   for(const mode of ['year','month']){
    await page.locator('#mode-'+mode).click();await page.mouse.move(0,0);await legend.evaluate(el=>el.blur());
    for(const split of mode==='month'?[false,true]:[false]){
     if(split){await page.locator('#month-project-names').click();await page.waitForFunction(()=>document.querySelector('#month-calendar .split-day'));}
     await page.evaluate(scheme=>JournalAppearance.apply({scheme,accent:'fern'}),scheme);assert.equal(await page.locator('html').getAttribute('data-scheme'),scheme);const before=await snapshot(mode);await legend.hover();await page.waitForTimeout(100);const hover=await snapshot(mode);
     assert.equal(hover[0].outline,'solid');assert.equal(hover[1].outline,'solid');assert.notEqual(hover[0].color,hover[1].color);assert.equal(hover[2].outline,before[2].outline);assert.deepEqual(hover.map(x=>x.pressed),before.map(x=>x.pressed));
     if(mode==='month'){assert.notEqual(hover[0].pin,before[0].pin);assert.equal(hover[1].opacity,'1')}
     const shots=process.env.JOURNAL_DDL_SCREENSHOTS;if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,`${mode}-${scheme}-${split?'split':'total'}.png`)})}
     await page.mouse.move(0,0);assert.deepEqual(await snapshot(mode),before);
     await page.keyboard.press('Tab');await legend.focus();assert.equal(await legend.evaluate(el=>el.matches(':focus-visible')),true);assert.deepEqual(await snapshot(mode),hover);await legend.evaluate(el=>el.blur());assert.deepEqual(await snapshot(mode),before);
     if(split){await page.locator('#month-project-names').click();await page.waitForFunction(()=>!document.querySelector('#month-calendar .split-day'));}
    }
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS year/month DDL hover and keyboard focus, completed/pending markers, split view, light/dark, selection preservation and restoration');
 }finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('exit',resolve))}
})().catch(e=>{console.error(e);process.exit(1)});
