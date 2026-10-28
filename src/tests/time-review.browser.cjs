const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-time-review-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const sessionFile=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');
  for(let n=0;!fs.existsSync(sessionFile)&&n<100;n++)await new Promise(r=>setTimeout(r,100));
  const s=JSON.parse(fs.readFileSync(sessionFile));const url=s.url+'/?token='+s.token;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[];
  async function open(width=1180,platform='mac'){
   const context=await browser.newContext({viewport:{width,height:860},timezoneId:'Asia/Shanghai'});
   await context.addInitScript(platform=>{window[platform==='mac'?'journalMacHost':'journalWindowsHost']=true;addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add(platform==='mac'?'native-mac':'native-windows');const l=document.createElement('link');l.rel='stylesheet';l.href=platform==='mac'?'macos.css':'windows.css';document.head.append(l)})},platform);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-28T17:00:00+08:00'));await page.goto(url);await page.waitForFunction(()=>window.journalViewReady);return {context,page};
  }
  let {context,page}=await open();
  await page.evaluate(async()=>{
   const d=await(await fetch('/api/state')).json(),st=d.state;
   st.projects=[{id:'paper',name:'城市微气候研究',group:'研究',color:'#83a48e',note:'## 当前阶段\n复核实验结果，整理方法和图示。',deadlines:[]},{id:'reading',name:'文献与方法笔记',group:'研究',color:'#ad92ad',note:'阅读与思考',deadlines:[]},{id:'tools',name:'开放数据工具箱',group:'工具',color:'#ab8b81',note:'工具和文档',deadlines:[]}];
   st.entries=[];st.timelineDays={};st.settings.projectGroups=['研究','工具'];st.settings.projectPaletteVersion=1;
   for(let n=0;n<28;n++){
    const date=new Date(2026,9,1+n,12),day=`2026-10-${String(n+1).padStart(2,'0')}`,blocks=[];
    const add=(id,start,end)=>blocks.push({id:day+'/'+id+'/'+start,projectId:id,start,end});
    if(date.getDay()!==0){add('paper',540+n%3*15,660+n%3*15);add('reading',780+n%2*30,825+n%2*30);if(n%3!==0)add('tools',900,960+n%3*15);if(n%7===0)add('reading',420,450)}
    st.timelineDays[day]={blocks:[...blocks,{id:'pending-'+day,projectId:'tools',start:1200,end:1245}],applied:blocks};
    for(const p of st.projects){const h=blocks.filter(b=>b.projectId===p.id).reduce((s,b)=>s+(b.end-b.start)/60,0);if(h||p.id==='paper')st.entries.push({projectId:p.id,date:day,kind:'hours',hours:h+(p.id==='paper'?.5:0),otherKind:'hours',otherHours:p.id==='paper'?.5:0,note:p.id==='paper'?'复核对照结果，整理研究进展。':''})}
   }
   const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:st})});if(!r.ok)throw Error(await r.text());
  });
  await page.reload();await page.waitForFunction(()=>window.journalViewReady);
  const state=()=>page.evaluate(async()=>(await(await fetch('/api/state')).json()).state);
  const before=await state();
  await page.locator('#mode-time').click();await page.locator('.tr-row').first().waitFor();
  assert.equal(await page.locator('.tr-row').count(),28);assert.equal(await page.locator('.tr-row').first().locator('.tr-cell').count(),64);
  assert.equal(await page.locator('#time-workspace').isVisible(),true);assert.equal(await page.locator('#year-calendar').isVisible(),false);
  assert.equal(await page.locator('.tr-inspector-host').isVisible(),false);
  assert.match(await page.locator('.tr-overview p').innerText(),/14/);
  assert.equal(await page.locator('.tr-row .tr-cell[data-tr-cell="48"]').count(),28);
  assert.equal((await page.locator('.tr-row .tr-cell[data-tr-cell="48"]').first().getAttribute('class')).includes('has-time'),false,'unconfirmed blocks never fill the review');
  await page.locator('[data-tr-color="project"]').click();
  assert.equal(await page.locator('[data-tr-color="project"]').getAttribute('aria-pressed'),'true');
  await page.locator('#tr-full-day').click();assert.equal(await page.locator('.tr-row').first().locator('.tr-cell').count(),96);
  assert.equal(await page.locator('.tr-outside').count(),0);
  const align=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const a=rect('.tr-axis'),b=rect('.tr-row .tr-cells'),c=rect('.tr-summary-cells');return [a.left-b.left,a.right-b.right,c.left-b.left,c.right-b.right]});assert(align.every(n=>Math.abs(n)<1),JSON.stringify(align));
  await page.locator('#tr-full-day').click();
  await page.locator('[data-tr-preset="month"]').click();assert.equal(await page.locator('#tr-start').inputValue(),'2026-10-01');
  const shotDir=process.env.JOURNAL_SCREENSHOTS||'/private/tmp/journal-time-review-shots';fs.mkdirSync(shotDir,{recursive:true});
  await page.mouse.move(0,0);await page.screenshot({path:path.join(shotDir,'time-review-projects.png')});
  const activeCell=page.locator('.tr-row .tr-cell.has-time').first();await activeCell.focus();await page.keyboard.press('ArrowRight');assert(await page.locator('.tr-tip').isVisible());
  await page.locator('.tr-row [data-tr-date="2026-10-01"]').first().click();assert(await page.locator('.tr-inspector-host').isVisible());
  assert.equal(await page.locator('.tr-inspector-host #month-inspector').count(),1);
  await page.locator('#tr-close-inspector').click();await page.locator('[data-tr-row="2026-10-01"] .tr-cell[data-tr-cell="20"]').click();assert.equal(await page.locator('#inspector-project').inputValue(),'reading');await page.locator('#tr-close-inspector').click();assert.equal(await page.locator('.tr-inspector-host').isVisible(),false);
  await page.locator('#project-filter>summary').click();await page.locator('#filter-options input[value="paper"]').check();
  await page.locator('#project-filter>summary').click();assert.equal(await page.locator('.tr-legend').getByText('文献与方法笔记',{exact:true}).count(),0);
  await page.locator('#project-filter>summary').click();await page.locator('#all-projects-filter').click();await page.locator('#project-filter>summary').click();
  await page.locator('#tr-start').fill('2027-01-01');await page.locator('#tr-start').dispatchEvent('change');assert(await page.locator('#tr-range-error').isVisible());
  await page.locator('[data-tr-preset="7"]').click();assert.equal(await page.locator('.tr-row').count(),7);
  await page.locator('[data-tr-color="effort"]').click();
  await page.locator('.tr-scroll').evaluate(el=>el.scrollLeft=40);
  await page.evaluate(()=>window.journalFlush());
  assert.deepEqual(await state(),before,'all review interactions preserve business records');
  await context.close();
  ({context,page}=await open(1180,'windows'));assert.equal(await page.locator('#mode-time').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.tr-row').count(),7);assert.equal(await page.locator('[data-tr-color="effort"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-tr-preset="28"]').click();await page.screenshot({path:path.join(shotDir,'time-review-effort.png')});
  for(const width of [760,390]){await page.setViewportSize({width,height:850});await page.waitForTimeout(50);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(overflow<=1,'page overflow at '+width+': '+overflow);const g=await page.locator('.tr-scroll').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert(g.scroll>=g.client);}
  await page.setViewportSize({width:1180,height:860});
  await page.locator('#mode-month').click();assert(await page.locator('#month-workspace').isVisible());assert.equal(await page.locator('#review-bottom>#month-inspector').count(),1);
  await page.locator('#mode-year').click();assert(await page.locator('#year-calendar').isVisible());
  await page.locator('#mode-time').click();await page.locator('[data-tr-preset="custom"]').click();await page.locator('#tr-start').fill('2025-10-01');await page.locator('#tr-end').fill('2025-10-07');await page.locator('#tr-end').dispatchEvent('change');await page.locator('#tr-open-records').waitFor();await page.locator('#tr-open-records').click();assert(await page.locator('#page-auto').isVisible());
  assert.deepEqual(await state(),before);assert.deepEqual(errors,[]);
  console.log('PASS time review: confirmed-only data, filters, range validation, aligned axes, keyboard, shared inspector, native Mac/Windows restore, responsive scrolling and unchanged business data.');
  console.log('Screenshots:',shotDir);
 }finally{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
