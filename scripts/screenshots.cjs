// Capture actual UI using only generated demo data and a dedicated backend.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),parent=fs.mkdtempSync(path.join(os.tmpdir(),'journal-public-demo-')),demo=path.join(parent,'demo');
(async()=>{
 let server,browser;const errors=[];
 try{
  execFileSync(process.env.JOURNAL_PYTHON||'python3',[path.join(__dirname,'make-demo.py'),'--output',demo],{stdio:'inherit'});
  const data=path.join(demo,'data'),local=path.join(demo,'local');
  server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});
  const sessionFile=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');
  for(let i=0;!fs.existsSync(sessionFile)&&i<100;i++)await new Promise(r=>setTimeout(r,100));
  const session=JSON.parse(fs.readFileSync(sessionFile));
  browser=await chromium.launch({headless:true,...(process.env.JOURNAL_BROWSER?{executablePath:process.env.JOURNAL_BROWSER}:process.env.JOURNAL_BROWSER_CHANNEL?{channel:process.env.JOURNAL_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1180,height:800},deviceScaleFactor:1.5,timezoneId:'Asia/Shanghai',colorScheme:'light'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-28T16:10:00+08:00'));
  await page.addInitScript(()=>{window.journalMacHost=true;addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('native-mac');const l=document.createElement('link');l.rel='stylesheet';l.href='macos.css';document.head.append(l)});});
  const ready=()=>page.waitForFunction(()=>window.journalViewReady===true);
  await page.goto(session.url+'/?token='+session.token);await ready();
  const output=path.join(root,'docs/images');fs.mkdirSync(output,{recursive:true});
  const shot=async name=>{await page.mouse.move(0,0);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(220);await page.screenshot({path:path.join(output,name+'.png')});};
  await page.locator('#period-today').click();
  await page.locator('.heat-day[data-date="2026-10-28"]').click();
  await shot('year-review');
  await page.locator('#mode-month').click();await shot('month-review');
  await page.locator('#mode-time').click();await page.locator('[data-tr-preset="7"]').click();await page.locator('#tr-today').click();
  await page.locator('#tr-by-project').click();await page.locator('#tr-weekends').click();await shot('time-review');
  await page.locator('[data-page="projects"]').click();
  await page.locator('[data-select-project="demo-research"]').click();
  await page.locator('#project-note').waitFor({state:'attached'});
  if(!(await page.locator('#project-note').inputValue()).includes('城市微气候'))throw Error('Project note missing');
  await shot('project-notes');
  await page.locator('#auto-entry').click();await page.locator('.dt-grid').waitFor();
  await page.locator('#dt-date').fill('2026-10-28');await page.locator('#dt-date').dispatchEvent('change');
  await page.locator('#dt-visible-hours').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(150);
  await page.locator('.dt-scroll').evaluate(el=>{const g=el.querySelector('.dt-grid');el.scrollTop=Math.max(0,(735-Number(g.dataset.start))*Number(g.dataset.scale));});
  await page.locator('.dt-app-run,.dt-area').first().waitFor();
  if(await page.getByText('这一天暂无线索',{exact:true}).isVisible())throw Error('Demo activity failed to load');
  await shot('day-timeline');
  await page.locator('.dt-suggestion').last().hover();
  await page.locator('.dt-evidence-tip').waitFor();
  await page.screenshot({path:path.join(output,'clue-details.png')});
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Saved six real UI screenshots from isolated synthetic data.');
 }finally{
  await browser?.close();
  if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,3000)});}
  fs.rmSync(parent,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
