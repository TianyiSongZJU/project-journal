// Run with JOURNAL_CORE=<test binary>; Playwright/Edge are test-only dependencies.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-ui-persistence-'));
 const data=path.join(root,'data'),local=path.join(root,'local');await fs.mkdir(data);await fs.mkdir(local);
 let server,browser;
 async function start(){
  server=spawn(process.env.JOURNAL_CORE,['-data-dir',data,'-auto-home',local,'-no-open','-window-url'],{stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('test backend startup timed out')),20000);server.once('error',reject);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-z0-9]+/);if(match){clearTimeout(timer);resolve(match[0])}});server.once('exit',code=>{if(code)reject(Error('test backend exited '+code))})});
 }
 async function stop(){if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited}}
 const call=async(url,route,body)=>{const u=new URL(url);const res=await fetch(u.origin+route,{method:body?'PUT':'GET',headers:{'X-Journal-Token':u.searchParams.get('token'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(res.ok,route+' '+res.status);return res.json()};
 async function open(url,platform){const context=await browser.newContext();await context.addInitScript(platform=>{window[platform==='mac'?'journalMacHost':'journalWindowsHost']=true},platform);const page=await context.newPage();page.on('pageerror',error=>{console.error('page error:',error.message)});await page.goto(url);await page.waitForFunction(()=>window.journalViewReady===true);assert.equal(await page.locator('.error-banner').count(),0);return {context,page}}
 const click=(page,selector)=>page.locator(selector).first().evaluate(el=>el.click());
 const pressed=(page,selector)=>page.locator(selector).getAttribute('aria-pressed');
 const flush=async page=>assert.equal(await page.evaluate(()=>window.journalFlush()),true);
 try{
  let url=await start();const envelope=await call(url,'/api/state');
  envelope.state.projects=[{id:'p-a',name:'论文',group:'科研',color:'#315c46',note:'fixture note',completed:false,deadlines:[{id:'d-a',name:'初稿',date:'2026-12-01',priority:'高',done:false},{id:'d-b',name:'提纲',date:'2026-10-01',priority:'低',done:true}]},{id:'p-b',name:'实验',group:'科研',color:'#849b77',note:'',completed:true,deadlines:[]},{id:'p-c',name:'申请书',group:'申报',color:'#a991a4',note:'',completed:false,deadlines:[]}];
  envelope.state.settings.projectGroups=['科研','申报'];envelope.state.entries=[{projectId:'p-a',date:'2026-10-22',kind:'hours',hours:1,note:'fixture daily'}];await call(url,'/api/state',envelope);
  browser=await chromium.launch({channel:process.env.JOURNAL_BROWSER_CHANNEL||'msedge',headless:true});
  let {context,page}=await open(url,'mac');const baseline=(await call(url,'/api/state')).state;
  await click(page,'.workspace-nav [data-page="projects"]');await page.waitForSelector('#project-list .project-group-heading');
  await click(page,'#project-list [data-fold-group="科研"]');await click(page,'#project-list .project-completed-toggle');await click(page,'#project-list .project-list-group-toggle');
  assert.equal(await pressed(page,'#project-list .project-list-group-toggle'),'false');
  await click(page,'#quick-record');await click(page,'#record-picker .project-list-group-toggle');await page.evaluate(()=>document.querySelector('#record-dialog').close());
  await click(page,'#project-show-done-deadlines');await click(page,'#project-record-panel>summary');await page.locator('#project-list .project-search').fill('论文');
  await flush(page);await context.close();
  ({context,page}=await open(url,'mac'));
  assert.equal(await pressed(page,'#project-list .project-list-group-toggle'),'false');assert.equal(await page.locator('#project-list .project-search').inputValue(),'');assert.equal(await pressed(page,'#project-show-done-deadlines'),'true');assert.equal(await page.locator('#project-record-panel').evaluate(el=>el.open),false);
  await click(page,'#quick-record');assert.equal(await pressed(page,'#record-picker .project-list-group-toggle'),'false');await page.evaluate(()=>document.querySelector('#record-dialog').close());
  await click(page,'#project-list .project-list-group-toggle');assert.equal(await page.locator('#project-list [data-fold-group="科研"]').first().getAttribute('aria-expanded'),'false');
  await click(page,'.workspace-nav [data-page="review"]');await click(page,'#project-filter>summary');assert.equal(await pressed(page,'#filter-project-list .project-list-group-toggle'),'true');await click(page,'#filter-project-list .project-list-group-toggle');
  await click(page,'#inspector-picker .project-list-group-toggle');
  await click(page,'#deadline-by-group');await click(page,'#show-done-deadlines');await click(page,'#inspector-show-done-deadlines');await click(page,'#distribution-panel>summary');
  await click(page,'#mode-month');await click(page,'#mode-year');assert.equal(await page.locator('#distribution-panel').evaluate(el=>el.open),false);
  await click(page,'.workspace-nav [data-page="auto"]');await page.waitForSelector('#dt-client-picker,.dt-client-picker');
  await click(page,'#dt-default-picker .project-list-group-toggle');
  await click(page,'.dt-client-layout');await click(page,'#dt-toggle-suggestions');await click(page,'#dt-full-day');
  await click(page,'#auto-open-settings');await page.waitForFunction(()=>document.querySelector('#auto-settings-dialog').open);
  await click(page,'#auto-folder-grouped');await page.locator('#auto-folder-completed').check();await click(page,'.auto-more-settings>summary');
  await page.evaluate(()=>document.querySelector('#auto-settings-dialog').close());await flush(page);await context.close();
  await stop();url=await start();
  ({context,page}=await open(url,'windows'));
  assert.equal(await pressed(page,'#dt-default-picker .project-list-group-toggle'),'false');
  assert.equal(await pressed(page,'#dt-toggle-suggestions'),'false');assert.equal(await pressed(page,'#dt-full-day'),'true');assert.equal(await pressed(page,'.dt-client-layout'),'true');
  await click(page,'#auto-open-settings');await page.waitForFunction(()=>document.querySelector('#auto-settings-dialog').open);
  assert.equal(await pressed(page,'#auto-folder-grouped'),'false');assert.equal(await page.locator('#auto-folder-completed').isChecked(),true);assert.equal(await page.locator('.auto-more-settings').evaluate(el=>el.open),true);
  await page.evaluate(()=>document.querySelector('#auto-settings-dialog').close());await click(page,'.workspace-nav [data-page="review"]');
  assert.equal(await pressed(page,'#inspector-picker .project-list-group-toggle'),'false');
  assert.equal(await pressed(page,'#deadline-by-group'),'true');assert.equal(await pressed(page,'#show-done-deadlines'),'true');assert.equal(await pressed(page,'#inspector-show-done-deadlines'),'true');assert.equal(await page.locator('#distribution-panel').evaluate(el=>el.open),false);
  await click(page,'#project-filter>summary');assert.equal(await pressed(page,'#filter-project-list .project-list-group-toggle'),'false');
  await click(page,'.workspace-nav [data-page="projects"]');assert.equal(await pressed(page,'#project-list .project-list-group-toggle'),'true');assert.equal(await page.locator('#project-list [data-fold-group="科研"]').first().getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#project-record-panel').evaluate(el=>el.open),false);
  await flush(page);assert.deepEqual((await call(url,'/api/state')).state,baseline,'UI preferences must not modify project data');
  const saved=JSON.parse(await fs.readFile(path.join(local,'view-state.json'),'utf8'));assert.equal(saved.ui.flags.foldersGrouped,false);assert.equal(saved.timeline.compare,true);assert.equal(saved.ui.lists['project-list'].completed,true);
  await context.close();console.log('PASS foreground recreation, fresh browser storage, backend restart/new port, Mac/Windows hosts, scoped grouping/folds/flags/panels/timeline; business data unchanged');
 }finally{await browser?.close();await stop();await fs.rm(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
