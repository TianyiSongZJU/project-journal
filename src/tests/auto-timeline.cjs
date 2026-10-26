const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT||'playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const dir=process.env.JOURNAL_TEST_DATA,hash=crypto.createHash('sha256').update(dir).digest('hex').slice(0,24),session=JSON.parse(fs.readFileSync(path.join(require('node:os').tmpdir(),`project-journal-${hash}.json`)));
 const browser=await chromium.launch({headless:true,executablePath:process.env.JOURNAL_BROWSER});try{
  const p=await browser.newPage({viewport:{width:1120,height:800},timezoneId:'Asia/Shanghai'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(session.url+'/?token='+session.token);const ready=()=>p.waitForFunction(()=>document.querySelector('#save-status').textContent==='已保存到本地');await ready();
  await p.evaluate(async()=>{const d=await(await fetch('/api/state')).json();d.state.projects=['a','b','c','d','e'].map((id,i)=>({id,name:['文件分段','已有人工记录','批量同步','前台活动','单次保存'][i],color:'#667d79',note:'',deadlines:[]}));d.state.entries=[{projectId:'b',date:'2026-10-23',kind:'hours',hours:2,note:'人工记录'}];d.state.settings.estimates={很短:.25,短:.5,中:1,长:2,很长:4};await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})})});
  const date='2026-10-23',base=Date.parse(date+'T10:00:00+08:00')/1000,evidence={};
  const file=(id,projectId,offsets,bulk=false)=>{const key='fixture/'+id;evidence[key]={id:key,projectId,date,kind:'file',name:id+'.docx',relativePath:id+'.docx',stamp:'latest-'+id,at:new Date(base*1000).toISOString(),source:'文件变化',touches:offsets.map((offset,i)=>({at:base+offset,stamp:'s'+i,bulk}))}};
  file('proposal','a',[0,8*60,20*60,3*3600]);file('manual','b',[0,8*60,20*60]);for(let i=0;i<12;i++)file('sync'+i,'c',[0],true);file('single','e',[0]);
  evidence['fixture/foreground']={id:'fixture/foreground',projectId:'d',date,kind:'activity',name:'研究计划 — Word',app:'Word',stamp:'2580',seconds:43*60,source:'前台活动估算',spans:[{start:base,end:base+30*60},{start:base+32*60,end:base+45*60}]};
  const folder=path.join(dir,'activity');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'session-fixture.json'),JSON.stringify({version:1,deviceId:'fixture',deviceName:'测试设备',evidence}));
  await p.reload();await ready();await p.locator('#auto-entry').click();await p.locator('.auto-card').first().waitFor();assert.equal(await p.locator('.auto-card').count(),5);
  const card=id=>p.locator(`[data-auto-id="${date}/${id}"]`),drafts=await p.evaluate(async()=>(await(await fetch('/api/auto')).json()).drafts),a=drafts.find(d=>d.projectId==='a');
  assert.equal(a.confidence,'较弱');assert.equal(a.rangeMin,10);assert.equal(a.rangeMax,30);assert.equal(a.hours,0);assert.equal(a.seconds,0);assert.equal(a.sessions.length,2);
  assert.match(await card('a').locator('.auto-card-meta').textContent(),/参考 10–30 分钟/);assert.match(await card('a').locator('.auto-timeline').textContent(),/10:00–10:20/);assert.equal(await card('a').locator('.auto-hours').inputValue(),'');
  assert.equal(drafts.find(d=>d.projectId==='b').kind,'none');assert.match(await card('b').locator('.auto-total-existing').textContent(),/2 小时/);assert.equal(await card('b').locator('.auto-replace').isChecked(),false);
  assert.equal(drafts.find(d=>d.projectId==='c').rangeMax,0);assert.match(await card('c').locator('.auto-card-meta').textContent(),/12 个文件可能为复制／同步/);assert.match(await card('e').locator('.auto-card-meta').textContent(),/仅一次保存/);
  const front=drafts.find(d=>d.projectId==='d');assert.equal(front.seconds,43*60);assert.equal(front.confidence,'较强');assert.equal(front.sessions.filter(s=>s.source==='activity').length,1);assert.equal(await card('d').locator('.auto-hours').inputValue(),'');
  await card('b').locator('.auto-select').uncheck();await card('c').locator('.auto-select').uncheck();await card('d').locator('.auto-select').uncheck();await card('e').locator('.auto-select').uncheck();await p.screenshot({path:'/private/tmp/journal-auto-sessions.png'});
  await card('a').locator('.auto-select').uncheck();await card('b').locator('.auto-select').check();await p.locator('#auto-accept').click();await p.waitForFunction(async()=>{const d=await(await fetch('/api/state')).json();return d.state.entries.find(e=>e.projectId==='b').note.includes('manual.docx')});
  const saved=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state),manual=saved.entries.find(e=>e.projectId==='b');assert.equal(manual.kind,'hours');assert.equal(manual.hours,2);assert.match(manual.note,/人工记录/);assert.equal(saved.entries.length,1);assert.equal(await card('b').count(),0);
  await card('e').locator('.auto-select').check();await p.locator('#auto-accept').click();await p.waitForFunction(async()=>{const d=await(await fetch('/api/state')).json();return d.state.entries.some(e=>e.projectId==='e')});const single=await p.evaluate(async()=>(await(await fetch('/api/state')).json()).state.entries.find(e=>e.projectId==='e'));assert.equal(single.kind,'none');assert.equal(single.hours,0);assert.match(single.note,/single.docx/);

  // Selecting foreground intervals keeps the two-minute idle gap out of the sum.
  await card('d').locator('[data-session-group]').check();
  assert.match(await card('d').locator('.auto-total-added').textContent(),/43 分钟/);
  await p.waitForTimeout(1400);await p.reload();await ready();await p.locator('#auto-entry').click();
  assert.equal(await card('d').locator('[data-session]').isChecked(),true);
  assert.match(await card('d').locator('.auto-total-added').textContent(),/43 分钟/);
  await card('d').locator('.auto-select').uncheck();
  await card('a').locator('[data-session="0"]').check();
  assert.match(await card('a').locator('.auto-total-added').textContent(),/20 分钟/);
  // Add an overlapping foreground source to the same project, then select both.
  const extra={id:'fixture/a-foreground',projectId:'a',date,kind:'activity',name:'Word',app:'Word',stamp:'1800',seconds:30*60,source:'前台活动估算',spans:[{start:base+10*60,end:base+40*60}]};
  evidence[extra.id]=structuredClone(extra);fs.writeFileSync(path.join(folder,'session-fixture.json'),JSON.stringify({version:1,deviceId:'fixture',deviceName:'测试设备',evidence}));
  await p.locator('#auto-refresh').click();await p.waitForFunction(()=>document.querySelectorAll('[data-auto-id="2026-10-23/a"] [data-session]').length===3);
  await card('a').locator('[data-session-group]').first().check();
  assert.match(await card('a').locator('.auto-total-added').textContent(),/40 分钟/);
  assert.match(await card('a').locator('.auto-timeline').textContent(),/重叠 10 分钟/);
  await card('c').locator('.auto-select').uncheck();await card('d').locator('.auto-select').uncheck();
  await card('a').scrollIntoViewIfNeeded();await p.screenshot({path:'/private/tmp/journal-timeline-desktop.png',fullPage:true});
  const reviewResponse=p.waitForResponse(r=>r.url().endsWith('/api/auto/review')&&r.request().method()==='POST');await p.locator('#auto-accept').click();const accepted=await (await reviewResponse).json();let savedA=accepted.state.entries.find(e=>e.projectId==='a');
  assert.ok(Math.abs(savedA.hours-40/60)<1e-9);
  // A later source covers the same intervals: only the previously uncounted tail adds time.
  extra.id='fixture/a-later';extra.stamp='3600';extra.seconds=60*60;extra.spans=[{start:base,end:base+60*60}];evidence[extra.id]=structuredClone(extra);
  fs.writeFileSync(path.join(folder,'session-fixture.json'),JSON.stringify({version:1,deviceId:'fixture',deviceName:'测试设备',evidence}));
  await card('a').waitFor({state:'hidden'});await p.locator('#auto-refresh').click();await card('a').waitFor();for(const input of await card('a').locator('[data-session-group]:enabled').all())await input.check();
  assert.match(await card('a').locator('.auto-total-existing').textContent(),/40 分钟/);
  assert.match(await card('a').locator('.auto-total-added').textContent(),/20 分钟/);
  assert.match(await card('a').locator('.auto-total-result').textContent(),/1 小时/);
  await card('a').locator('.auto-time-total').scrollIntoViewIfNeeded();await p.screenshot({path:'/private/tmp/journal-timeline-addition.png',fullPage:true});
  await card('a').locator('.auto-select').check();const secondResponse=p.waitForResponse(r=>r.url().endsWith('/api/auto/review')&&r.request().method()==='POST');await p.locator('#auto-accept').click();const second=await(await secondResponse).json();assert.equal(second.state.entries.find(e=>e.projectId==='a').hours,1);await card('a').waitFor({state:'hidden'});
  await p.setViewportSize({width:700,height:850});await card('d').locator('[data-session-group]').check();await card('d').scrollIntoViewIfNeeded();await p.screenshot({path:'/private/tmp/journal-timeline-compact.png'});
  assert.deepEqual(errors,[]);console.log('PASS timeline selection, saved choices, union overlap, exact minutes, idle subtraction, additive total and counted-source deduplication');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
