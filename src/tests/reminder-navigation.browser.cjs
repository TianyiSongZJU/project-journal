const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||process.env.JOURNAL_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-timeline-selection-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{windowsHide:true,stdio:'ignore'});let browser;
 try{
  const file=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');for(let n=0;!fs.existsSync(file)&&n<100;n++)await new Promise(r=>setTimeout(r,100));
  const s=JSON.parse(fs.readFileSync(file));browser=await chromium.launch({channel:'msedge',headless:true});const p=await browser.newPage({viewport:{width:1180,height:860},timezoneId:'Asia/Shanghai'});await p.clock.setFixedTime(new Date('2026-10-28T13:00:00+08:00'));const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(s.url+'/?token='+s.token);await p.waitForFunction(()=>window.journalViewReady);
  await p.evaluate(async()=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'p',name:'示例项目',color:'#83a48e',note:'',deadlines:[]}];d.state.entries=[];d.state.timelineDays={};await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})})});
  const date='2026-10-27',base=Date.parse(date+'T00:00:00+08:00')/1000,evidence={};for(const start of [120,1215]){const id='fixture/'+start;evidence[id]={id,date,projectId:'p',kind:'activity',app:'Word',bucketStart:base+start*60,seconds:900,attribution:{document:900},at:new Date((base+start*60)*1000).toISOString()}}
  fs.mkdirSync(path.join(data,'activity'),{recursive:true});fs.writeFileSync(path.join(data,'activity','fixture.json'),JSON.stringify({version:1,deviceId:'fixture',deviceName:'测试',evidence}));
  await p.reload();await p.waitForFunction(()=>window.journalViewReady);await p.locator('#auto-entry').click();await p.locator('#dt-toggle-suggestions').click();
  const before=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state);
  assert.equal(await p.evaluate(date=>window.journalOpenTimelineDate(date,{start:1215,end:1230,projectId:'p'}),date),true);
  await p.locator('.dt-suggestion.reminder-target').waitFor();await p.waitForTimeout(150);
  assert.equal(await p.locator('#dt-date').inputValue(),date);assert.equal(await p.locator('#dt-toggle-suggestions').getAttribute('aria-pressed'),'true');
  const check=async()=>{const r=await p.locator('.dt-suggestion.reminder-target').boundingBox(),v=await p.locator('.dt-scroll').boundingBox();assert(r.y>=v.y && r.y+r.height<=v.y+v.height,'selected suggestion is fully visible');};await check();
  assert.equal(await p.evaluate(date=>window.journalOpenTimelineDate(date,{start:120,end:135,projectId:'p'}),date),true);await p.waitForTimeout(150);await check();assert.equal(await p.locator('.dt-grid').getAttribute('data-start'),'0');
  assert.equal(await p.evaluate(date=>window.journalOpenTimelineDate(date,{start:1440,end:1500}),date),false);
  const after=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.timelineDays,before.timelineDays);
  assert.deepEqual(errors,[]);console.log('PASS menu range navigation to evening and before 08:00, visibility, suggestion reveal, invalid range rejection and no accounting changes');

 }finally{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
