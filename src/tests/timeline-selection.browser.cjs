const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-timeline-selection-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const file=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');for(let n=0;!fs.existsSync(file)&&n<100;n++)await new Promise(r=>setTimeout(r,100));
  const s=JSON.parse(fs.readFileSync(file));browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage({viewport:{width:1180,height:860},timezoneId:'Asia/Shanghai'});await p.clock.setFixedTime(new Date('2026-10-28T13:00:00+08:00'));const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(s.url+'/?token='+s.token);await p.waitForFunction(()=>window.journalViewReady);
  await p.evaluate(async()=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'a',name:'示例项目',color:'#83a48e',note:'',deadlines:[]}];d.state.entries=[{projectId:'a',date:'2026-10-28',kind:'hours',hours:1,note:'原笔记'}];d.state.timelineDays={'2026-10-28':{blocks:[{id:'one',projectId:'a',start:540,end:600}],applied:[{start:540,end:600,id:'one',projectId:'a'}]}};const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})});if(!r.ok)throw Error(await r.text())});
  await p.reload();await p.waitForFunction(()=>window.journalViewReady);const open=()=>p.locator('#auto-entry').click();await open();await p.locator('#dt-apply').waitFor();assert(await p.locator('#dt-apply').isDisabled());assert.equal(await p.locator('#dt-apply').innerText(),'已计入项目');
  await p.locator('.workspace-nav [data-page="review"]').click();await open();assert(await p.locator('#dt-apply').isDisabled(),'unchanged applied time remains disabled after switching pages');
  // Begin inside 11:00–11:15, then drag up: that initial quarter remains the end.
  await p.locator('.dt-scroll').evaluate(el=>{const g=el.querySelector('.dt-grid');el.scrollTop=(600-Number(g.dataset.start))*Number(g.dataset.scale)});
  await p.waitForTimeout(180);
  const coords=await p.locator('.dt-select-lane').evaluate(el=>{const g=el.closest('.dt-grid'),r=el.getBoundingClientRect(),scale=Number(g.dataset.scale),start=Number(g.dataset.start);return {x:r.left+r.width*.6,from:r.top+(665-start)*scale,to:r.top+(630-start)*scale}});
  await p.mouse.move(coords.x,coords.from);await p.mouse.down();await p.mouse.move(coords.x,coords.to,{steps:8});await p.mouse.up();await p.evaluate(()=>window.journalFlush());
  let st=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state);assert.deepEqual(st.timelineDays['2026-10-28'].blocks.map(b=>[b.start,b.end]),[[540,600],[630,675]]);assert(await p.locator('#dt-apply').isEnabled());assert.equal(st.entries[0].hours,1);
  await p.locator('#dt-apply').click();await p.waitForFunction(()=>document.querySelector('#dt-apply').disabled);st=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state);assert.equal(st.entries[0].hours,1.75);assert.equal(st.entries[0].note,'原笔记');
  await p.locator('.workspace-nav [data-page="review"]').click();await open();assert(await p.locator('#dt-apply').isDisabled());
  // A lower-half click still selects its containing adjacent quarter.
  const click=await p.locator('.dt-select-lane').evaluate(el=>{const g=el.closest('.dt-grid'),r=el.getBoundingClientRect();return {x:r.left+r.width*.6,y:r.top+(687-Number(g.dataset.start))*Number(g.dataset.scale)}});await p.mouse.click(click.x,click.y);await p.evaluate(()=>window.journalFlush());st=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state);assert.deepEqual(st.timelineDays['2026-10-28'].blocks.at(-1).start,675);assert.equal(st.timelineDays['2026-10-28'].blocks.at(-1).end,690);
  assert.deepEqual(errors,[]);console.log('PASS unchanged apply state after navigation, reverse drag including original quarter, adjacent-quarter click, explicit differential accounting and preserved notes.');
 }finally{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
