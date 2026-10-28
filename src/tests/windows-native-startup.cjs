// Exercise the actual embedded WebView2, with an isolated profile and records.
const {chromium}=require(process.env.JOURNAL_PLAYWRIGHT||'playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'journal-native-startup-'));
 for(const mode of ['cold','warm']){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const args=['--ui-only','--data-dir',path.join(dir,'data'),'--auto-home',path.join(dir,'local')];if(mode==='warm')args.push('--warm-open');
 const child=spawn(process.env.JOURNAL_NATIVE_CORE||process.env.JOURNAL_CORE,args,{windowsHide:false,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(dir,'webview-profile'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}});
 let browser,page;
 try{
  const endpoint='http://127.0.0.1:'+port;
  for(let i=0;i<150;i++){try{const r=await fetch(endpoint+'/json/version');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];
  for(let i=0;i<100&&!context.pages().length;i++)await new Promise(r=>setTimeout(r,100));page=context.pages()[0];assert(page,'native WebView2 page exists');const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.journalViewReady===true,{},{timeout:15000});
  await page.waitForFunction(()=>window.journalLaunchCoverReleased===true,{},{timeout:6000});
  await page.locator('#windows-launch-surface').waitFor({state:'detached'});assert(await page.locator('#page-review').isVisible());
  await page.locator('#auto-entry').click();await page.locator('#dt-date').waitFor();assert(await page.locator('#page-auto').isVisible());
  await page.locator('.workspace-nav [data-page="review"]').click();assert(await page.locator('#page-review').isVisible());assert.deepEqual(errors,[]);
  if(process.env.JOURNAL_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JOURNAL_SCREENSHOTS,'windows-native-recovered.png')});
  await page.evaluate(async()=>{await fetch('/api/quit',{method:'POST'});});
  console.log('PASS '+mode+' native Windows startup cover release, completed transition, visible review and record/review navigation.');
 }catch(error){if(page)console.error('Native startup state:',await page.evaluate(()=>({cover:window.journalLaunchCoverReleased,bridge:typeof window.journalLaunchPainted,error:window.journalLaunchCoverError,ready:!!window.journalViewReady,starting:document.documentElement.className,text:document.body?.innerText.slice(0,160)})).catch(()=>({unavailable:true})));throw error;}
 finally{await browser?.close().catch(()=>{});child.kill();await new Promise(r=>setTimeout(r,250));}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
