const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-header-scroll-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const file=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');
  for(let i=0;!fs.existsSync(file)&&i<100;i++)await new Promise(r=>setTimeout(r,100));
  const session=JSON.parse(fs.readFileSync(file));browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1120,height:560}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.journalMacHost=true;addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('native-mac');const style=document.createElement('link');style.rel='stylesheet';style.href='macos.css';document.head.append(style)})});
  await page.goto(session.url+'/?token='+session.token);await page.waitForFunction(()=>window.journalViewReady);
  const before=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).state);
  for(const name of ['review','projects','auto','settings']){
   if(name==='settings')await page.locator('.workspace-header .sidebar-more>summary').click();
   await page.locator(`.workspace-header [data-page="${name}"]`).click();
   await page.evaluate(()=>document.querySelector('main').scrollTop=0);
   const initial=await page.locator('.workspace-header').boundingBox();
   // A temporary layout probe guarantees scrollable content even in an empty journal.
   await page.evaluate(()=>{const probe=document.createElement('div');probe.id='scroll-probe';probe.style.cssText='height:1200px;flex:none';document.querySelector('main').append(probe);document.querySelector('main').scrollTop=400});
   await page.waitForTimeout(60);const after=await page.locator('.workspace-header').boundingBox();
   assert(Math.abs(initial.y-after.y)<1,`${name} header stays at its original height`);
   const topmost=await page.locator('.workspace-nav').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+10))});assert(topmost,`${name} content cannot cover the header controls`);
   const button=page.locator('.workspace-header [data-page="review"]');assert(await button.isVisible());
   await page.screenshot({path:path.join(temp,`header-${name}.png`)});
   await page.evaluate(()=>{document.querySelector('#scroll-probe').remove();document.querySelector('main').scrollTop=0});
  }
  const after=await page.evaluate(async()=>(await(await fetch('/api/state')).json()).state);assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  console.log('PASS fixed header across review, projects, records and settings; controls remain above content; records unchanged.');console.log('Screenshots:',temp);
 }finally{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))}
})().catch(e=>{console.error(e);process.exitCode=1});
