const {chromium,webkit}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-sync-review-')),data=path.join(dir,'data'),local=path.join(dir,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const sessionFile=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');for(let i=0;i<150&&!fs.existsSync(sessionFile);i++)await new Promise(r=>setTimeout(r,100));const session=JSON.parse(fs.readFileSync(sessionFile));
  browser=await(process.env.JOURNAL_BROWSER==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));
  const page=await browser.newPage({viewport:{width:1240,height:850},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(session.url+'/?token='+session.token);await page.waitForFunction(()=>window.journalViewReady);
  const state=await page.evaluate(async()=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'p1',name:'论文',color:'#315c46',note:'共同段落\n当前版本的笔记',deadlines:[{id:'d1',name:'初稿',date:'2026-12-01',priority:'高',done:false}]}];d.state.entries=[{projectId:'p1',date:'2026-10-28',kind:'hours',hours:1.5,note:'当前的每日记录'}];d.state.weekly={'2026-10-26':{title:'仅本地的周记',goals:[],note:'应保留'}};const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})});if(!r.ok)throw Error(await r.text());return (await(await fetch('/api/state')).json()).state});
  const incoming=structuredClone(state);delete incoming.history;
  incoming.projects[0].note='共同段落\n副本里的新笔记 <script>不可执行</script>';
  incoming.projects[0].deadlines[0].date='2026-12-05';incoming.entries[0].hours=2;
  incoming.weekly={};incoming.projects.push({id:'p2',name:'新项目',color:'#778899',note:'新项目笔记',deadlines:[]});
  const name='项目手记-测试冲突.json',source=JSON.stringify(incoming),file=path.join(data,name);fs.writeFileSync(file,source);
  await page.reload();await page.waitForFunction(()=>window.journalViewReady);
  await page.locator('.workspace-header [data-page="settings"]').evaluate(el=>el.click());
  const open=async()=>{await page.locator('[data-copy-merge]').click();await page.locator('#sync-merge-dialog').waitFor({state:'visible'})};
  const dialog=page.locator('#sync-merge-dialog'),apply=dialog.locator('.merge-apply'),item=id=>dialog.locator(`input[data-merge-item="${id}"]`);
  const getState=()=>page.evaluate(async()=>(await(await fetch('/api/state')).json()).state);
  await open();assert(await apply.isDisabled());assert.match(await dialog.textContent(),/仅当前版本/);assert.equal(await dialog.locator('script').count(),0);
  await item('note/p2').check();assert(await item('project/p2').isChecked());await item('project/p2').uncheck();assert(!await item('note/p2').isChecked());assert(await apply.isDisabled());
  await dialog.locator('.merge-cancel').click();assert.deepEqual(await getState(),state);
  await open();const noteRow=item('note/p1').locator('xpath=ancestor::article');if(await noteRow.locator('details').getAttribute('open')===null)await noteRow.locator('summary').click();
  await noteRow.locator('mark').first().waitFor();assert.match(await noteRow.textContent(),/当前版本的笔记/);assert.match(await noteRow.textContent(),/副本里的新笔记/);assert.equal(await dialog.locator('script').count(),0);
  await item('note/p1').check();assert(await noteRow.locator('mark').first().isVisible());
  const screenshots=process.env.JOURNAL_MERGE_SCREENSHOTS;if(screenshots){fs.mkdirSync(screenshots,{recursive:true});for(const scheme of ['light','dark']){await page.evaluate(scheme=>JournalAppearance.apply({scheme,accent:'fern'}),scheme);await dialog.screenshot({path:path.join(screenshots,'merge-'+scheme+'.png')})}}
  await apply.click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(async()=>(await(await fetch('/api/state')).json()).state.projects[0].note.includes('副本里的新笔记'));
  const merged=await getState();assert.equal(merged.projects.length,1);assert.equal(merged.projects[0].deadlines[0].date,'2026-12-01');assert.equal(merged.entries[0].hours,1.5);assert.equal(merged.weekly['2026-10-26'].title,'仅本地的周记');assert.equal(fs.readFileSync(file,'utf8'),source);
  await open();assert.equal(await item('note/p1').count(),0);await item('entry/p1/2026-10-28').check();
  fs.writeFileSync(file,JSON.stringify({...incoming,projects:incoming.projects.map(p=>({...p,note:p.note+'（又同步了一次）'}))}));
  await apply.click();await dialog.locator('.merge-error').waitFor({state:'visible'});assert.match(await dialog.locator('.merge-error').textContent(),/重新对比/);assert.equal((await getState()).entries[0].hours,1.5);assert.deepEqual(errors,[]);
  console.log('PASS visual comparison, unchecked defaults, dependency selection, cancel, selective application, untouched local records/source copy, escaped notes and stale conflict guard');
 }finally{if(browser)await browser.close();if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r))}fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
