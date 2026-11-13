const {chromium,webkit}=require(process.env.JOURNAL_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'journal-rich-md-')),data=path.join(temp,'data'),local=path.join(temp,'local');fs.mkdirSync(data);fs.mkdirSync(local);
 const server=spawn(process.env.JOURNAL_CORE,['--ui-only','--no-open','--data-dir',data,'--auto-home',local],{stdio:'ignore'});let browser;
 try{
  const sf=path.join(os.tmpdir(),'project-journal-'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'.json');for(let i=0;!fs.existsSync(sf)&&i<100;i++)await new Promise(r=>setTimeout(r,100));const session=JSON.parse(fs.readFileSync(sf));
  browser=await (process.env.JOURNAL_BROWSER==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'msedge',headless:true}));const page=await browser.newPage({viewport:{width:1320,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')console.log('BROWSER',m.text())});
  await page.addInitScript(platform=>{window.journalMacHost=platform==='mac';window.journalWindowsHost=platform!=='mac';addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add(platform==='mac'?'native-mac':'native-windows');const link=document.createElement('link');link.rel='stylesheet';link.href=platform==='mac'?'macos.css':'windows.css';document.head.append(link)})},process.env.JOURNAL_PLATFORM||'mac');
  await page.goto(session.url+'/?token='+session.token);await page.waitForFunction(()=>window.journalViewReady);
  const original='# 研究手记\n\n第一段 **重点**。\n\n第二段 $E=mc^2$。\n\n$$\n\\sum_{i=1}^n i=\\frac{n(n+1)}2\n$$\n\n- [ ] 整理实验\n- [x] 阅读论文';
  await page.evaluate(async original=>{const d=await(await fetch('/api/state')).json();d.state.projects=[{id:'a',name:'实时手记',color:'#7b9f9b',note:original,deadlines:[]},{id:'b',name:'另一个项目',color:'#a47f85',note:'另一个项目的笔记',deadlines:[]}];d.state.entries=[];await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:d.revision,state:d.state})})},original);
  await page.reload();await page.waitForFunction(()=>window.journalViewReady);await page.locator('[data-page="projects"]').click();await page.locator('[data-select-project="a"]').click();
  const source=page.locator('#project-note'),wrap=source.locator('..'),live=wrap.locator('.markdown-live'),editor=live.locator('.milkdown>.ProseMirror'),code=page.locator('#project-detail .markdown-source-toggle');
  async function readSource(){await page.waitForTimeout(340);return source.inputValue()}
  async function waitReady(id){await page.waitForFunction(id=>document.querySelector(id).parentElement.querySelector('.markdown-live')?.dataset.ready==='true',id)}
  await waitReady('#project-note');assert.equal(await readSource(),original,'opening must not rewrite existing Markdown');await editor.locator('.journal-task-box').first().check();assert((await readSource()).includes('[x] 整理实验'));await editor.locator('.journal-task-box').first().uncheck();await page.waitForFunction(()=>document.querySelector('#project-note').parentElement.querySelectorAll('.katex').length===2);
  async function setDoc(value){await code.click();await source.fill(value);await code.click();await editor.focus();await editor.press('ControlOrMeta+End')}
  async function selectAll(){await editor.press('ControlOrMeta+a')}
  async function assertTools(id){
   const input=page.locator(id),header=input.locator(id==='#project-note'?'xpath=ancestor::section[contains(@class,"project-detail-section")]/div[contains(@class,"editor-heading")]':'xpath=ancestor::label/span');
   assert(await header.evaluate(el=>el.classList.contains('note-header')));
   const icons=await header.locator('.markdown-mode button').evaluateAll(buttons=>buttons.map(el=>{const svg=el.querySelector('svg'),r=svg.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,stroke:svg.getAttribute('stroke-width')}}));
   assert.equal(icons.length,3);for(let i=0;i<icons.length;i++){assert.equal(icons[i].width,16);assert.equal(icons[i].stroke,'1.55');assert(Math.abs(icons[i].y-icons[0].y)<.5);if(i)assert(Math.abs(icons[i].x-icons[i-1].x-30)<.5)}assert.equal(await header.locator('button:visible').count(),3);
   const save=header.locator('.desktop-save-state');if(await save.count()){
    await page.waitForFunction(id=>document.querySelector(id).closest('label,.project-detail-section').querySelector('.desktop-save-state').style.getPropertyValue('--note-status-size'),id);
    const geometry=await header.evaluate(el=>{const label=el.querySelector('.note-header-label'),status=el.querySelector('.desktop-save-state'),svg=status.querySelector('svg'),probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;border:0;vertical-align:baseline';label.append(probe);const baseline=probe.getBoundingClientRect().top;probe.remove();const s=getComputedStyle(label),c=document.createElement('canvas').getContext('2d');c.font=`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;const m=c.measureText(label.textContent),r=status.getBoundingClientRect();return {error:Math.abs(r.y+r.height/2-baseline-(m.actualBoundingBoxDescent-m.actualBoundingBoxAscent)/2),size:r.height,ink:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,title:status.parentElement.classList.contains('note-header-title')}});
    assert(geometry.error<.6,JSON.stringify({id,geometry}));assert(Math.abs(geometry.size-geometry.ink)<.2);assert(geometry.title);
   }
   const toggle=header.locator('.markdown-source-toggle'),off=await toggle.innerHTML(),background=await toggle.evaluate(el=>getComputedStyle(el).backgroundColor);await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'true');assert.notEqual(await toggle.innerHTML(),off);assert.notEqual(await toggle.evaluate(el=>getComputedStyle(el).backgroundColor),background);await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('.markdown-preview-toggle').count(),0);
  }
  await assertTools('#project-note');
  const saveMotion=await page.evaluate(async()=>{
   const {renderDesktopSaveStatus}=await import('/desktop-icons.js');
   const status=document.body.appendChild(document.createElement('span'));
   const render=text=>renderDesktopSaveStatus(status,text);
   const frame=()=>new Promise(requestAnimationFrame);
   const read=path=>path.getAttribute('d');
   try{
    render('已保存');
    const path=status.querySelector('svg path'),check=read(path);
    render('正在保存');
    const start=performance.now();
    let leftFirst=false, sameWidth=true;
    const frames=[];
    while(performance.now()-start<540){
     await frame();
     const d=read(path),coords=d.match(/-?\d+(?:\.\d+)?/g).map(Number);
     sameWidth&&=coords[0]===4.3&&coords.at(-2)===15.7;
     leftFirst||=Math.abs(coords[1]-10.1)>.12&&coords.at(-1)===6.4;
     if(performance.now()-start>350)frames.push(d);
    }
    const wave=read(path);
    render('已保存');
    const handoff=read(path);
    const sweepStart=performance.now();
    while(performance.now()-sweepStart<60)await frame();
    const beforeResuming=read(path);
    render('正在保存');
    const resumed=read(path);
    render('已保存');
    const interrupted=read(path);
    const deadline=performance.now()+900;
    while(read(path)!==check&&performance.now()<deadline)await frame();
    return {
     samePath:status.querySelectorAll('svg *').length===1&&status.querySelector('svg path')===path,
     opacity:getComputedStyle(path).opacity,
     sameWidth,leftFirst,waveChanges:new Set(frames).size,handoff:handoff===wave,resumed:resumed===beforeResuming&&resumed===interrupted,
     settled:read(path)===check
    };
   }finally{status.remove()}
  });
  assert(saveMotion.samePath&&saveMotion.opacity==='1'&&saveMotion.handoff&&saveMotion.resumed&&saveMotion.settled);
  assert(saveMotion.sameWidth&&saveMotion.leftFirst&&saveMotion.waveChanges>2,JSON.stringify(saveMotion));
  {
   console.log('CHECK Paste formats, editor height and folded lists');
   const grip=wrap.locator('.note-height-grip'),pasteMenu=wrap.locator('.note-paste-menu');
   const height=element=>element.evaluate(el=>Math.round(el.getBoundingClientRect().height));
   const originalHeight=await height(live);
   const handle=await grip.boundingBox();
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
   await page.mouse.down();
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2+60,{steps:5});
   await page.mouse.up();
   assert.equal(await height(live),originalHeight+60);
   await code.click();assert.equal(await height(source),originalHeight+60);await code.click();
   await page.locator('[data-select-project="b"]').click();
   await page.locator('#project-note[data-note-height-key="project-note:b"]').waitFor({state:"attached"});
   await waitReady('#project-note');
   assert.equal(await height(live),originalHeight);
   await page.locator('[data-select-project="a"]').click();
   await page.locator('#project-note[data-note-height-key="project-note:a"]').waitFor({state:"attached"});
   await waitReady('#project-note');
   assert.equal(await height(live),originalHeight+60);
   await page.waitForFunction(async expected=>(await (await fetch('/api/view-state')).json()).ui?.noteHeights?.['project-note:a']===expected,originalHeight+60);
   await page.reload();await page.waitForFunction(()=>window.journalViewReady);await waitReady('#project-note');
   assert.equal(await height(live),originalHeight+60);
   const dispatchMixedPaste=field=>field.evaluate(el=>{
    const clipboardData=new DataTransfer();
    clipboardData.setData('text/plain','PPT 文本');
    clipboardData.setData('text/html','<strong>PPT 文本</strong>');
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
    const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
    clipboardData.items.add(new File([bytes],'slide.png',{type:'image/png'}));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
   });
   await setDoc('');
   await dispatchMixedPaste(editor);
   await page.keyboard.press('Escape');
   assert.equal(await pasteMenu.isVisible(),false);
   assert.equal((await editor.textContent()).trim(),'');
   await dispatchMixedPaste(editor);
   await pasteMenu.getByRole('button',{name:'纯文本'}).click();
   assert.equal((await editor.textContent()).trim(),'PPT 文本');
   assert.equal(await editor.locator('strong,img').count(),0);
   await editor.press('ControlOrMeta+z');
   assert.equal((await editor.textContent()).trim(),'');
   await dispatchMixedPaste(editor);
   await pasteMenu.getByRole('button',{name:'保留格式'}).click();
   assert.equal(await editor.locator('strong').textContent(),'PPT 文本');
   await setDoc('');
   await dispatchMixedPaste(editor);
   await pasteMenu.getByRole('button',{name:'图片'}).click();
   await editor.locator('img[src^="/api/note-images/"]').waitFor();
   await code.click();
   await source.fill('前缀 后缀');
   await source.evaluate(el=>el.setSelectionRange(3,3));
   await dispatchMixedPaste(source);
   assert.equal(await pasteMenu.getByRole('button',{name:'保留格式'}).count(),0);
   await pasteMenu.getByRole('button',{name:'纯文本'}).click();
   assert.equal(await source.inputValue(),'前缀 PPT 文本后缀');
   await code.click();

   const nested='列表前的正文\n\n- 外层\n  1. 中层\n     - 内层\n  2. 中层二\n- 同级\n\n'+Array.from({length:24},(_,i)=>'示例段落 '+i).join('\n\n');
   await setDoc(nested);
   await page.locator('.project-heading').click();
   await live.evaluate(el=>el.scrollTop=0);
   const markers=editor.locator('.journal-list-toggle');
   assert.equal(await markers.count(),2);
   const parentRow=editor.getByText('外层',{exact:true});
   const position=field=>field.evaluate(el=>el.getBoundingClientRect().x);
   const originalX=await position(parentRow),markerX=await position(markers.first());
   const surfaceGeometry=()=>live.evaluate(el=>({width:el.scrollWidth,viewport:el.clientWidth,left:el.scrollLeft}));
   const originalSurface=await surfaceGeometry();
   assert.equal(originalSurface.width,originalSurface.viewport);
   const edgeGap=await live.evaluate(el=>el.parentElement.getBoundingClientRect().right-el.getBoundingClientRect().right);
   assert(edgeGap<=5,'the scrollbar should sit next to the outside edge of the note');
   const gripInset=await grip.evaluate(el=>{
    const parent=el.parentElement.getBoundingClientRect(),box=el.getBoundingClientRect();
    return Math.abs((parent.right-box.right)-(parent.bottom-box.bottom));
   });
   assert(gripInset<=0.5,'the diagonal grip should have matching right and bottom insets');
   const markerStyle=()=>markers.first().evaluate(el=>{
    const dot=getComputedStyle(el,'::after');
    return {color:dot.backgroundColor,glow:dot.boxShadow,arrow:getComputedStyle(el,'::before').content};
   });
   const normalMarker=await markerStyle();
   await markers.first().hover();
   await editor.getByText('列表前的正文',{exact:true}).click();
   assert.equal(await position(parentRow),originalX);
   await parentRow.click();
   for(const key of ['ArrowLeft','ArrowRight','ArrowDown','ArrowUp']){
    await editor.press(key);
    assert.equal(await position(parentRow),originalX);
    assert.equal(await position(markers.first()),markerX);
    assert.deepEqual(await surfaceGeometry(),originalSurface);
   }
   assert.equal((await markerStyle()).arrow,'none');
   const beforeFold=await readSource();
   await markers.first().click();
   assert.equal(await markers.first().getAttribute('aria-expanded'),'false');
   const foldedMarker=await markerStyle();
   assert.notEqual(foldedMarker.color,normalMarker.color);
   assert.notEqual(foldedMarker.glow,'none');
   assert.equal(await position(parentRow),originalX);
   assert.equal(await position(markers.first()),markerX);
   assert.equal(await editor.getByText('中层',{exact:true}).isVisible(),false);
   assert.equal(await editor.getByText('同级',{exact:true}).isVisible(),true);
   assert.equal(await readSource(),beforeFold);
   await markers.first().focus();
   await markers.first().press('Enter');
   assert.equal(await markers.first().getAttribute('aria-expanded'),'true');
   await markers.nth(1).click();
   assert.equal(await editor.getByText('内层',{exact:true}).isVisible(),false);
   assert.equal(await editor.getByText('中层二',{exact:true}).isVisible(),true);
   assert.equal(await readSource(),beforeFold);

  }
  {
   const columns=Array.from({length:24},(_,index)=>'列 '+(index+1));
   const tableLine=cells=>'| '+cells.join(' | ')+' |';
   await setDoc([tableLine(columns),tableLine(columns.map((_,i)=>i===1?'---:':'---')),tableLine(columns.map((_,i)=>String(i+1))),'','- 表格下的列表项'].join('\n'));
   const table=editor.locator('.journal-table-scroll');
   assert.equal(await table.locator('th').count(),columns.length);
   assert.equal(await table.locator('td').nth(1).evaluate(el=>getComputedStyle(el).textAlign),'right');
   assert(await table.evaluate(el=>el.scrollWidth>el.clientWidth));
   const row=editor.getByText('表格下的列表项',{exact:true});
   const before=await row.evaluate(el=>el.getBoundingClientRect().x);
   await table.evaluate(el=>el.scrollLeft=el.scrollWidth);
   await row.click();
   assert.equal(await row.evaluate(el=>el.getBoundingClientRect().x),before);
   assert.equal(await live.evaluate(el=>el.scrollLeft),0);
   await table.locator('td').first().click();
   await page.keyboard.insertText('补充');
   assert((await readSource()).includes('补充'));
   assert.match((await source.inputValue()).split('\n')[1],/\|[^|]*-+:[ \t]*\|/);
  }
  {
   const launcher=page.locator('#project-detail .md-table-insert');
   const popup=wrap.locator('.note-table-popup');
   const table=editor.locator('.journal-table-scroll');
   async function insertTable(rows,columns){
    await launcher.click();
    await popup.getByRole('spinbutton',{name:'行数（含表头）'}).fill(String(rows));
    await popup.getByRole('spinbutton',{name:'列数'}).fill(String(columns));
    await popup.getByRole('button',{name:'插入',exact:true}).click();
   }
   async function changeTable(cell,action){
    await cell.click({button:'right'});
    const display=['折叠正文','展开正文','铺满宽度'].includes(action);
    const group=display?popup.getByRole('group',{name:'显示',exact:true}):popup;
    if(display)assert(await group.evaluate(el=>el.parentElement.firstElementChild===el&&el.children.length===2));
    await group.getByRole('button',{name:action,exact:true}).click();
   }
   await setDoc('');
   await insertTable(2,3);
   await table.waitFor();
   assert.equal(await table.locator('tr').count(),2);
   assert.equal(await table.locator('th').count(),3);
   await table.locator('th').first().click();
   await page.keyboard.insertText('旧表头');
   await changeTable(table.locator('th').first(),'上方插入行');
   assert.equal(await table.locator('tr').count(),3);
   assert.equal(await table.locator('td').first().innerText(),'旧表头');
   await changeTable(table.locator('th').first(),'删除此行');
   assert.equal(await table.locator('th').first().innerText(),'旧表头');
   await changeTable(table.locator('td').first(),'下方插入行');
   assert.equal(await table.locator('tr').count(),3);
   await changeTable(table.locator('td').first(),'左侧插入列');
   assert.equal(await table.locator('th').count(),4);
   await changeTable(table.locator('td').first(),'右侧插入列');
   assert.equal(await table.locator('th').count(),5);
   await changeTable(table.locator('td').first(),'删除此列');
   assert.equal(await table.locator('th').count(),4);
   await changeTable(table.locator('td').first(),'删除此行');
   assert.equal(await table.locator('tr').count(),2);
   await changeTable(table.locator('td').first(),'删除此行');
   assert.equal(await table.locator('tr').count(),1);
   assert.match(await readSource(),/\|.*旧表头/);
   await code.click();await code.click();
   assert.equal(await table.locator('tr').count(),1);
   await changeTable(table.locator('th').first(),'删除表格');
   assert.equal(await table.count(),0);
   await editor.press('ControlOrMeta+z');
   assert.equal(await table.count(),1);

   await setDoc('| 表头一 | 表头二 |\n| --- | --- |\n| 第一行 | 其他内容 |\n| 第二行 | 其他内容 |');
   const bodyCell=table.locator('td').first();
   await bodyCell.click();
   await page.waitForFunction(()=>{
    const selection=document.querySelector('#project-note')._markdownLive.view.state.selection;
    return selection.$from.parent.textContent==='第一行';
   });
   await page.keyboard.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');
   await page.keyboard.press('Shift+Enter');
   await page.keyboard.insertText('单元格第二行');
   assert.equal(await bodyCell.locator('br[data-journal-table-break]').count(),1);
   assert.match(await readSource(),/第一行<br>单元格第二行/);
   const row=table.locator('tr').nth(1);
   const box=await bodyCell.boundingBox();
   await page.mouse.move(box.x+box.width/2,box.y+box.height-2);
   await page.mouse.down();
   await page.mouse.move(box.x+box.width/2,box.y+box.height+24,{steps:5});
   assert((await row.boundingBox()).height>box.height+10,'row height must update before releasing the pointer');
   await page.mouse.up();
   assert((await row.boundingBox()).height>box.height+10);
   const header=table.locator('th').first(),widthBefore=(await header.boundingBox()).width;
   const headerBox=await header.boundingBox();
   await page.mouse.move(headerBox.x+headerBox.width-2,headerBox.y+headerBox.height/2);
   await page.mouse.down();
   await page.mouse.move(headerBox.x+headerBox.width+46,headerBox.y+headerBox.height/2,{steps:6});
   await page.mouse.up();
   assert((await header.boundingBox()).width>widthBefore+10);
   const sized=await readSource();
   assert.match(sized,/<!-- journal-table:[\d,]+;[\d,]+ -->/);
   await setDoc('');
   await setDoc(sized);
   assert.equal(await bodyCell.locator('br[data-journal-table-break]').count(),1);
   assert((await row.boundingBox()).height>box.height+10);
   assert((await header.boundingBox()).width>widthBefore+10);
   await changeTable(bodyCell,'折叠正文');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert(await header.isVisible());
   assert.equal(await bodyCell.isVisible(),false);
   const expand=table.getByRole('button',{name:'展开表格正文'});
   assert.match(await expand.evaluate(el=>getComputedStyle(el).backgroundImage),/linear-gradient/);
   await expand.click();
   assert(await bodyCell.isVisible());
   const widths=()=>table.locator('th').evaluateAll(cells=>cells.map(cell=>cell.getBoundingClientRect().width));
   async function resizeFirstColumn(delta){
    const before=await widths();
    const {x,y,width,height}=await header.boundingBox();
    await page.mouse.move(x+width-2,y+height/2);
    await page.mouse.down();
    await page.mouse.move(x+width-2+delta,y+height/2,{steps:7});
    const preview=await widths();
    assert(Math.abs(preview[0]-before[0]-delta)<=2,'column width must update before releasing the pointer');
    assert(Math.abs(preview[1]-before[1])<=1,'the other column stays unchanged during preview');
    await page.mouse.up();
   }
   const beforeShrink=await widths();
   await resizeFirstColumn(-150);
   const narrow=await widths();
   assert(narrow[0]<beforeShrink[0]-120);
   assert(Math.abs(narrow[1]-beforeShrink[1])<=1);
   assert(await table.evaluate(el=>el.querySelector('table').getBoundingClientRect().width<el.clientWidth-100));
   assert.equal(await table.getByRole('button',{name:'铺满宽度'}).count(),0);
   assert.equal(await table.getByRole('button',{name:'折叠正文'}).count(),0);
   await changeTable(header,'铺满宽度');
   const fit=await widths();
   assert(Math.abs(fit[0]/fit[1]-narrow[0]/narrow[1])<.02);
   assert(await table.evaluate(el=>Math.abs(el.querySelector('table').getBoundingClientRect().width-el.clientWidth)<=3));
   await resizeFirstColumn(120);
   const wide=await widths();
   assert(Math.abs(wide[1]-fit[1])<=1);
   assert(await table.evaluate(el=>el.scrollWidth>el.clientWidth+100));
   await table.evaluate(el=>el.scrollLeft=60);
   assert(await table.evaluate(el=>el.scrollLeft>0));
   await changeTable(header,'折叠正文');
   assert.equal(await bodyCell.isVisible(),false);
   assert(await expand.evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.querySelector('table').getBoundingClientRect().width)<=1));
   await expand.click();

   await setDoc('');
   await code.click();
   await insertTable(2,2);
   assert.match(await source.inputValue(),/\| --- \| --- \|/);
   await code.click();
   assert.equal(await table.locator('tr').count(),2);
   assert.equal(await table.locator('th').count(),2);
  }
  {
   await setDoc('- **加粗内容** 后面的文字\n- 前文 *斜体内容* 后面的文字\n- `代码内容` 后面的文字');
   await page.locator('.project-heading').click();
   for(const [selector,syntax] of [['strong','**'],['em','*'],['code','`']]){
    const mark=editor.locator('li '+selector);
    const layout=()=>mark.evaluate(el=>{
     const line=el.closest('p');
     const rect=node=>{const range=document.createRange();range.selectNodeContents(node);const {x,y,width}=range.getBoundingClientRect();return {x,y,width}};
     const text=[...el.childNodes].find(node=>node.nodeType===3);
     return {marked:rect(text),tail:rect(line.lastChild)};
    });
    const original=await layout();
    const hints=mark.locator('..').locator('.journal-list-format-marker');
    await mark.click();
    await hints.last().waitFor({state:'attached'});
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await hints.allTextContents(),[syntax,syntax]);
    assert.deepEqual(await layout(),original,selector+' should stay in place when the caret enters');
    await page.keyboard.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');
    await hints.first().waitFor({state:'detached'});
    assert.deepEqual(await layout(),original,selector+' should stay in place when the caret leaves');
   }
  }
  await setDoc('- 左侧对齐参照\n- '+('可缩进项目'.repeat(65))+'\n- 同级项目');
  const unaffected=editor.getByText('左侧对齐参照',{exact:true}).locator('..');
  const listAnchor=()=>unaffected.evaluate(el=>[el.getBoundingClientRect().left,el.querySelector('.journal-list-marker').getBoundingClientRect().left,el.closest('.markdown-live').scrollLeft]);
  const listBefore=await listAnchor();
  await editor.locator('li p').nth(1).click();
  await page.keyboard.press('Tab');
  assert.equal(await editor.locator('li li').count(),1);
  assert.deepEqual(await listAnchor(),listBefore);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await editor.locator('li li').count(),0);
  assert.deepEqual(await listAnchor(),listBefore);
  {
   await setDoc(Array.from({length:11},(_,i)=>i+1+'. 编号项目 '+i+(i===1?'\n   - 子项':'')).join('\n')+'\n\n结尾');
   assert(await page.evaluate(()=>window.journalFlush()));
   const numbers=editor.locator('ol>li >.journal-list-marker');
   const numerals=await numbers.evaluateAll(nodes=>nodes.map(node=>{
    const range=document.createRange();range.selectNodeContents(node);
    return {right:range.getBoundingClientRect().right,style:getComputedStyle(node).fontVariantNumeric};
   }));
   assert.equal(numerals.length,11);
   assert(numerals.every(({right,style})=>Math.abs(right-numerals[0].right)<.5&&style.includes('tabular-nums')));
   const nested=editor.locator('ol>li >.journal-list-toggle').first();
   await nested.click();
   assert.equal(await nested.getAttribute('aria-expanded'),'false');
   assert.match(await nested.evaluate(el=>getComputedStyle(el).textDecorationLine),/underline/);
   assert.equal(await nested.evaluate(el=>getComputedStyle(el).boxShadow),'none');

   await page.route('**/api/state',async route=>{
    if(route.request().method()==='PUT')await new Promise(resolve=>setTimeout(resolve,550));
    await route.continue();
   });
   await editor.locator('ol>li >p').first().click();
   await page.evaluate(()=>{
    const status=document.querySelector('#note-status'),icon=status.querySelector('svg');
    const root=document.querySelector('#project-note').parentElement,marker=root.querySelector('.journal-list-marker');
    const paragraph=marker.parentElement.querySelector('p');
    const measure=()=>[status.getBoundingClientRect().left,root.getBoundingClientRect().left,marker.getBoundingClientRect().left,paragraph.getBoundingClientRect().left];
    const initial=JSON.stringify(measure()),states=new Set();
    let moved=false,animation;
    const capture=()=>{
     states.add(status.dataset.state);
     if(initial!==JSON.stringify(measure())||status.querySelector('svg')!==icon)moved=true;
     animation=requestAnimationFrame(capture);
    };
    capture();
    window.finishJournalSaveTrace=()=>{cancelAnimationFrame(animation);return {moved,states:[...states]}};
   });
   await page.keyboard.insertText('已修改');
   await page.waitForFunction(()=>document.querySelector('#note-status').dataset.state==='saving');
   await page.waitForFunction(()=>document.querySelector('#note-status').dataset.state==='saved');
   const trace=await page.evaluate(()=>window.finishJournalSaveTrace());
   assert(trace.states.includes('saving'));
   assert.equal(trace.moved,false);
   await page.unroute('**/api/state');
  }
  console.log('CHECK Real keyboard');
  // Real keyboard input, including the formerly broken indented heading case.
  for(const prefix of ['# ','## ','### ','  # ']){console.log('heading',JSON.stringify(prefix));await setDoc('');await editor.pressSequentially(prefix+'单次回车');await editor.press('Enter');await editor.pressSequentially('下一行');assert.equal(await editor.locator('h1,h2,h3').textContent(),'单次回车');assert.equal(await editor.locator('p').filter({hasText:'下一行'}).textContent(),'下一行')}
  await setDoc('');await editor.pressSequentially('**加粗**');assert.equal(await editor.locator('strong').textContent(),'加粗');await editor.press('Enter');await editor.pressSequentially('*斜体*');assert.equal(await editor.locator('em').textContent(),'斜体');
  for(const prefix of ['- ','1. ']){await setDoc('');await editor.pressSequentially(prefix);await editor.locator(prefix==='- '?'ul':'ol').waitFor();assert.equal(await editor.locator('.journal-list-marker').first().textContent(),prefix==='- '?'•':'1.');assert(await editor.locator('.journal-list-marker').first().evaluate(el=>el.getBoundingClientRect().height>0));await editor.pressSequentially('第一项');await editor.press('Enter');await editor.pressSequentially('第二项');assert.equal(await editor.locator('li').count(),2);await editor.press('Tab');assert.equal(await editor.locator('li li').count(),1);await editor.press('Shift+Tab');await editor.press('Enter');await editor.press('Enter');await editor.pressSequentially('退出列表');assert.equal(await editor.locator(':scope>p').filter({hasText:'退出列表'}).count(),1,await editor.innerHTML())}
  await setDoc('3. 项目\n4. 另一个');assert.deepEqual(await editor.locator('.journal-list-marker').allTextContents(),['3.','4.']);
  await setDoc('');await editor.pressSequentially('$x^2$');assert.equal(await editor.locator('.journal-inline-math .katex').count(),1,'closing dollar must immediately render math');await editor.pressSequentially(' 后文');assert((await readSource()).includes('$x^2$'));
  await editor.locator('.journal-inline-math').click();const mathEdit=editor.locator('.journal-inline-math-source');await mathEdit.waitFor();assert.equal(await mathEdit.inputValue(),'$x^2$');await mathEdit.fill('$a+b$');await page.locator('.project-heading').click();assert.equal(await editor.locator('.journal-inline-math-source').count(),0);assert.equal(await editor.locator('.journal-inline-math .katex').count(),1);assert((await readSource()).includes('$a+b$'));
  await editor.locator('.journal-inline-math').click();await mathEdit.fill('$c+d$');await mathEdit.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');await mathEdit.press('ArrowLeft');await mathEdit.pressSequentially('+g');assert.equal(await mathEdit.inputValue(),'$c+d+g$');await mathEdit.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');await mathEdit.press('ArrowRight');assert.equal(await editor.locator('.journal-inline-math-source').count(),0);assert((await readSource()).includes('$c+d+g$'));await editor.press('ArrowLeft');await mathEdit.waitFor();await mathEdit.fill('$e+f$');await page.locator('.project-heading').click();assert((await readSource()).includes('$e+f$'));
  await editor.locator('.journal-inline-math').click();await mathEdit.fill('$未闭合');await page.locator('.project-heading').click();assert.equal(await editor.locator('.journal-inline-math-source').count(),0);assert.equal(await editor.locator('.journal-inline-math').count(),0);assert((await readSource()).includes('未闭合'));
  // Inline marks reveal their symbols only while the caret is inside the mark.
  await setDoc('**加粗** 和 *斜体* 还有 **另一段**');await editor.locator('strong').first().click();assert.equal(await editor.locator('.journal-format-marker').allTextContents().then(x=>x.join('')),'****');assert.equal(await editor.locator('strong').first().evaluate(el=>getComputedStyle(el).fontWeight),'750');await editor.locator('em').click();await page.waitForFunction(()=>[...document.querySelector('#project-note').parentElement.querySelectorAll('.journal-format-marker')].map(el=>el.textContent).join('')==='**',{timeout:3000});assert.equal(await editor.locator('.journal-format-marker').allTextContents().then(x=>x.join('')),'**');await page.locator('.project-heading').click();assert.equal(await editor.locator('.journal-format-marker').count(),0);assert((await readSource()).includes('**加粗**'));
  // The two sides of an emphasis boundary must be reachable independently.
  for(const [syntax,tag] of [['**8**','strong'],['*8*','em'],['***8***','strong'],['`8`','code']]){
   await setDoc(syntax);await editor.focus();await editor.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');await editor.press('ArrowRight');await editor.pressSequentially('普通');assert.equal(await editor.locator(tag).first().textContent(),'8');assert((await readSource()).includes('普通'));
   await setDoc(syntax+'后');await editor.locator(tag).first().click();await editor.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');await editor.press('ArrowLeft');await editor.press('ArrowRight');await editor.pressSequentially('外');assert(!(await editor.locator(tag).first().textContent()).includes('外'));
  }
  for(const [syntax,tag] of [['**8**','strong'],['*8*','em'],['`8`','code']]){await setDoc('');await editor.pressSequentially(syntax);await editor.press('ArrowRight');await editor.pressSequentially('普通文字');assert.equal(await editor.locator(tag).textContent(),'8')}
  await setDoc('**8**');await editor.locator('strong').click();await page.waitForFunction(()=>document.querySelector('#project-note').parentElement.querySelectorAll('.journal-format-marker').length===2);await editor.locator('.journal-format-marker').last().click();await page.keyboard.insertText('外部');assert.equal(await editor.locator('strong').textContent(),'8');
  await setDoc('# 一级\n\n## 二级\n\n### 三级');const headings=await editor.locator('h1,h2,h3').evaluateAll(els=>els.map(el=>({size:parseFloat(getComputedStyle(el).fontSize),font:getComputedStyle(el).fontFamily,color:getComputedStyle(el).color})));assert.deepEqual(headings.map(x=>x.size),[19,16.5,14.5]);assert(headings.every(x=>x.font.includes('Serif')||x.font.includes('serif')||x.font.includes('Songti')));
  console.log('CHECK Quotes, code and formula interactions');
  // Backspace at the first quoted paragraph must lift it even at document start.
  for(const quote of ['> 第一行引用','> ','> > 嵌套引用']){
   await setDoc(quote);const before=await editor.locator('blockquote').count();await editor.locator('blockquote p').first().click();await editor.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowLeft':'Home');await page.waitForFunction(depth=>{const s=document.querySelector('#project-note')._markdownLive.view.state.selection;return s.empty&&s.$from.parentOffset===0&&s.$from.depth===depth},before+1);await editor.press('Backspace');assert.equal(await editor.locator('blockquote').count(),before-1,'Backspace must remove one quote level: '+quote);if(quote.includes('引用'))assert((await editor.textContent()).includes(quote.includes('嵌套')?'嵌套引用':'第一行引用'));
  }
  await setDoc('> 第一段\n>\n> 第二段');await editor.locator('blockquote p').last().click();await editor.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowLeft':'Home');await page.waitForFunction(()=>{const s=document.querySelector('#project-note')._markdownLive.view.state.selection;return s.empty&&s.$from.parentOffset===0&&s.$from.depth===2&&s.$from.index(-1)===1});await editor.press('Backspace');assert.equal(await editor.locator('blockquote').count(),1);assert((await editor.locator('blockquote').textContent()).includes('第一段第二段'));

  await setDoc('');await editor.pressSequentially('> 引用第一行');await editor.press('Enter');await editor.pressSequentially('第二行');await editor.press('Enter');await editor.press('Enter');await editor.pressSequentially('引用外');assert.equal(await editor.locator('blockquote').count(),1);assert.equal(await editor.locator(':scope>p').filter({hasText:'引用外'}).count(),1);
  await setDoc('> 外层\n>\n> > 内层\n\n普通段落');assert.equal(await editor.locator('blockquote blockquote').count(),1);const quoteStyle=await editor.locator('blockquote').first().evaluate(el=>({before:getComputedStyle(el,'::before').content,border:getComputedStyle(el).borderLeftWidth,padding:getComputedStyle(el).paddingLeft}));assert.deepEqual(quoteStyle,{before:'none',border:'2px',padding:'12px'});
  await setDoc('行内 `abc` 后文');await editor.locator('code').click();await page.waitForFunction(()=>document.querySelector('#project-note').parentElement.querySelectorAll('.journal-format-marker').length===2);assert.equal(await editor.locator('.journal-format-marker').allTextContents().then(x=>x.join('')),'``');await page.keyboard.insertText('新');assert((await editor.locator('code').textContent()).includes('新'));await page.locator('.project-heading').click();assert.equal(await editor.locator('.journal-format-marker').count(),0);assert((await readSource()).includes('`'));await setDoc('``a`b``');await editor.locator('code').click();await page.waitForFunction(()=>document.querySelector('#project-note').parentElement.querySelectorAll('.journal-format-marker').length===2);assert.deepEqual(await editor.locator('.journal-format-marker').allTextContents(),['``','``']);
  await setDoc('公式 $x+y$ 后文');await editor.locator('.journal-inline-math').click();const gap=await mathEdit.evaluate(field=>{const c=document.createElement('canvas').getContext('2d');c.font=getComputedStyle(field).font;return field.getBoundingClientRect().width-c.measureText(field.value).width});assert(gap>=0&&gap<=6,'formula input must fit its text, got '+gap);await mathEdit.fill('$中文+x+y$');await page.waitForTimeout(1400);assert(await mathEdit.evaluate(el=>document.activeElement===el),'autosave must not interrupt inline math editing');assert(await mathEdit.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.locator('.project-heading').click();assert.equal(await editor.locator('.journal-inline-math .katex').count(),1);
  // Display formulas have their own themed view; ordinary code retains CodeMirror.
  await setDoc('之前\n\n$$\nx^2 + y^2 = z^2\n$$\n\n之后');const block=editor.locator('.journal-block-math'),blockInput=block.locator('.journal-block-math-source');assert.equal(await block.count(),1);assert.equal(await blockInput.isVisible(),false);assert.equal(await block.locator('.katex-display').count(),1);assert.equal(await block.locator('.cm-editor,.tools,.language-button').count(),0);
  await block.click();await blockInput.waitFor();assert.equal(await blockInput.inputValue(),'x^2 + y^2 = z^2');await blockInput.fill('a+b');await page.waitForTimeout(1400);assert(await blockInput.evaluate(el=>document.activeElement===el),'autosave must not interrupt display math editing');await blockInput.pressSequentially('+c');assert.equal(await blockInput.inputValue(),'a+b+c');await blockInput.press('ControlOrMeta+z');assert.equal(await blockInput.inputValue(),'a+b');await blockInput.press('ControlOrMeta+Shift+z');assert.equal(await blockInput.inputValue(),'a+b+c');await blockInput.press('Escape');assert.equal(await blockInput.isVisible(),false);assert.equal(await editor.locator(':scope>p').filter({hasText:'之后'}).count(),1);assert((await readSource()).includes('a+b+c'));
  await block.click();await blockInput.fill('\\frac{1}{2}\n+\\sqrt{x}');await code.click();assert((await source.inputValue()).includes('\\frac{1}{2}'));assert(!(await source.inputValue()).includes('```'));await code.click();assert.equal(await block.locator('.katex-display').count(),1);assert.equal(await blockInput.isVisible(),false);
  await block.click();await blockInput.fill('\\notACommand{');await page.locator('.project-heading').click();assert.equal(await block.locator('.katex-error').count(),1);await block.click();await blockInput.dispatchEvent('compositionstart',{data:''});await blockInput.fill('\\text{时间}');await blockInput.dispatchEvent('compositionend',{data:'时间'});await page.evaluate(()=>document.querySelector('#project-note')._markdownLive.commit());assert((await readSource()).includes('\\text{时间}'));await block.click();await blockInput.fill('E=mc^2');await blockInput.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');await blockInput.press('ArrowDown');assert.equal(await blockInput.isVisible(),false);await page.keyboard.insertText('继续正文');assert(!(await block.textContent()).includes('继续正文'));
  await setDoc('');await editor.pressSequentially('$$');await editor.press('Enter');await blockInput.waitFor();await blockInput.pressSequentially('x^2');await blockInput.press('Enter');await blockInput.pressSequentially('$$');await blockInput.press('Enter');assert.equal(await blockInput.isVisible(),false);await page.keyboard.insertText('公式后');assert.equal(await editor.locator(':scope>p').filter({hasText:'公式后'}).count(),1);
  await setDoc('');await editor.pressSequentially('$$');await editor.press('Enter');await blockInput.waitFor();await blockInput.press('Backspace');assert.equal(await block.count(),0);await page.keyboard.insertText('空公式已退出');assert((await editor.textContent()).includes('空公式已退出'));
  await setDoc('```js\nconst value = 1;\n```');assert.equal(await editor.locator('.milkdown-code-block .cm-editor').count(),1);assert.equal(await block.count(),0);
  // Mixed documents exercise nested structures, hard breaks, tables and roundtrips.
  const mixed='# 混合文档\n\n> 引用 **粗体** 与 `code`\n>\n> > 嵌套引用\n\n3. 第一项\n   - 子项 *斜体*\n4. 第二项\n\n- [ ] 待办\n- [x] 已完成\n\n| 项目 | 结果 |\n| --- | --- |\n| 甲 | $x+y$ |\n\n第一行  \n第二行\n\n[链接](https://example.com)\n\n```js\nconst x = 1;\n```\n\n$$\n\\sum_{i=1}^n i\n$$';
  await setDoc(mixed);assert.equal(await editor.locator('table').count(),1);assert.equal(await editor.locator('blockquote blockquote').count(),1);assert.equal(await editor.locator('li li').count(),1);assert.equal(await editor.locator('br').count()>0,true);await page.evaluate(()=>document.querySelector('#project-note')._markdownLive.commit());const beforeRoundtrip=await source.evaluate(el=>el._markdownLive.view.state.doc.toJSON());await code.click();const roundtrip=await source.inputValue();await code.click();assert.deepEqual(await source.evaluate(el=>el._markdownLive.view.state.doc.toJSON()),beforeRoundtrip);assert.equal(await block.count(),1);assert(roundtrip.includes('$$'));
  // Paste follows the rich editor's native transaction and remains undoable.
  await setDoc('');await editor.evaluate(el=>{const transfer=new DataTransfer();transfer.setData('text/plain','粘贴第一行\n粘贴第二行\n\n粘贴第三段');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))});assert((await editor.textContent()).includes('粘贴第三段'));await editor.press('ControlOrMeta+z');assert.equal((await editor.textContent()).trim(),'');await editor.press('ControlOrMeta+Shift+z');assert((await editor.textContent()).includes('粘贴第三段'));
  async function assertCaretAtLineStart(id){
   const surface=page.locator(id).locator('..');
   const paragraph=surface.locator('.milkdown>.ProseMirror > p').first();
   await paragraph.click();
   await page.keyboard.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowLeft':'Home');
   const caret=surface.locator('.journal-note-caret');
   await caret.waitFor({state:'visible'});
   const position=await caret.evaluate(el=>{
    const r=el.getBoundingClientRect(),editor=el.parentElement.querySelector('.milkdown>.ProseMirror');
    return {outsideEditor:!editor.contains(el),left:r.left-editor.getBoundingClientRect().left,height:r.height};
   });
   assert(position.outsideEditor&&position.left>=-0.5&&position.height>=12,JSON.stringify({id,position}));
  }
  console.log('CHECK The caret');
  await setDoc('');await editor.pressSequentially('$$');await editor.press('Enter');await editor.locator('.journal-block-math-source').waitFor();await editor.locator('.journal-block-math-source').pressSequentially('x^2');await page.locator('.project-heading').click();await page.waitForFunction(()=>document.querySelector('#project-note').parentElement.querySelector('.journal-block-math-preview .katex'));assert.equal(await editor.locator('.journal-block-math-source').isVisible(),false);
  // The caret uses glyph geometry and stays the same on every plain line.
  await setDoc('文字');const cursorHeights=[];for(let i=0;i<5;i++){await editor.press('Enter');await editor.pressSequentially('时间');await page.waitForTimeout(30);cursorHeights.push(await wrap.locator('.journal-note-caret').evaluate(el=>el.getBoundingClientRect().height))}assert(cursorHeights.every(h=>h>=12&&h<=18));assert(Math.max(...cursorHeights)-Math.min(...cursorHeights)<1);assert.equal(await editor.evaluate(el=>getComputedStyle(el).caretColor),'rgba(0, 0, 0, 0)');assert.equal(await editor.locator('p').first().evaluate(el=>getComputedStyle(el).paddingTop),'0px');
  await assertCaretAtLineStart('#project-note');
  console.log('CHECK Continuous deletion');
  // Continuous deletion, document selection and native editor undo/redo.
  await setDoc('文字');for(let i=0;i<10;i++)await editor.press('Enter');for(let i=0;i<10;i++)await editor.press('Backspace');assert.equal((await editor.textContent()).trim(),'文字');
  await setDoc('前段\n\n后段');await editor.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowLeft':'Home');await editor.press('Backspace');assert.equal((await editor.textContent()).trim(),'前段后段');
  await setDoc('甲\n\n乙\n\n丙');await selectAll();await editor.press('Backspace');assert.equal((await editor.textContent()).trim(),'');await editor.press('ControlOrMeta+z');assert.equal((await editor.textContent()).replace(/\s/g,''),'甲乙丙');await editor.press('ControlOrMeta+Shift+z');assert.equal((await editor.textContent()).trim(),'');
  await setDoc('');await editor.dispatchEvent('compositionstart',{data:''});await page.keyboard.insertText('中文输入');await editor.dispatchEvent('compositionend',{data:'中文输入'});assert((await readSource()).includes('中文输入'));
  console.log('CHECK Image upload');
  // Image upload, drag-resize, persistence, captions and alt-text retention.
  await setDoc('图片');const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');g.fillStyle='#b6c8bd';g.fillRect(0,0,320,180);return c.toDataURL('image/png').split(',')[1]});
  await wrap.locator('input[type=file]').setInputFiles({name:'实验图片.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await editor.locator('.milkdown-image-block img').waitFor();await page.waitForFunction(()=>document.querySelector('#project-note').value.includes('/api/note-images/'));
  const img=editor.locator('.milkdown-image-block img');await editor.locator('.milkdown-image-block .image-wrapper').hover();const handle=editor.locator('.image-resize-handle');await handle.waitFor({state:'visible'});const oldWidth=await img.evaluate(el=>el.getBoundingClientRect().width),box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-80,box.y-45,{steps:12});await page.mouse.up();await page.waitForTimeout(100);assert((await img.evaluate(el=>el.getBoundingClientRect().width))<oldWidth-20);assert((await readSource()).includes('zoom:'));assert((await readSource()).includes('实验图片'));
  await editor.focus();await editor.press('ControlOrMeta+z');assert(!(await readSource()).includes('zoom:'));await editor.press('ControlOrMeta+Shift+z');assert((await readSource()).includes('zoom:'));const saved=await readSource();assert(await page.evaluate(()=>window.journalFlush()));await page.locator('[data-select-project="b"]').click();await page.waitForFunction(()=>document.querySelector('#project-note').value==='另一个项目的笔记');await page.locator('[data-select-project="a"]').click();await waitReady('#project-note');assert.equal(await readSource(),saved);await img.waitFor({timeout:5000});assert((await img.evaluate(el=>el.getBoundingClientRect().width))<oldWidth-20);
  console.log('CHECK Switching projects');
  // Switching projects waits for images still in flight.
  await page.route('**/api/note-images',async route=>{await new Promise(r=>setTimeout(r,250));await route.continue()});await wrap.locator('input[type=file]').setInputFiles({name:'切换时图片.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.locator('[data-select-project="b"]').click();await page.waitForFunction(()=>document.querySelector('#project-note').value==='另一个项目的笔记');await page.locator('[data-select-project="a"]').click();await waitReady('#project-note');assert((await readSource()).includes('切换时图片'));assert(!(await readSource()).includes('正在保存图片'));await page.unroute('**/api/note-images');
  console.log('CHECK Batched serialization and synchronous saves');
  await setDoc('批量同步');
  const batch=await source.evaluate(input=>{let count=0;const oninput=()=>count++;input.addEventListener('input',oninput);const view=input._markdownLive.view;for(let i=0;i<60;i++)view.dispatch(view.state.tr.insertText('字'));const immediate=count;input._markdownLive.commit();input.removeEventListener('input',oninput);return {immediate,count,value:input.value}});
  assert.equal(batch.immediate,0,'typing transactions must not serialize inline');assert.equal(batch.count,1,'explicit save must synchronously produce one snapshot');assert.equal((batch.value.match(/字/g)||[]).length,60);
  await setDoc('立刻保存');await page.keyboard.insertText('未等待');assert(await page.evaluate(()=>window.journalFlush()));const persisted=await page.evaluate(async()=>{const d=await(await fetch('/api/state')).json();return d.state.projects.find(p=>p.id==='a').note});assert(persisted.includes('未等待'),'save must capture input before debounce');await page.keyboard.insertText('快捷保存');await page.evaluate(()=>window.journalSaveNote(document.querySelector('#project-note')));assert((await source.inputValue()).includes('快捷保存'));await page.keyboard.insertText('关闭前');const beforeClose=await source.evaluate(input=>{window.dispatchEvent(new Event('beforeunload',{cancelable:true}));return input.value});assert(beforeClose.includes('关闭前'));assert(await page.evaluate(()=>window.journalFlush()));
  console.log('CHECK Source mode');
  // Source mode has the same themed surface, no hidden-editor input churn.
  await code.click();assert.equal(await source.evaluate(el=>getComputedStyle(el).appearance),'none');assert.deepEqual(await source.evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.lineHeight]}),['13px','normal']);await source.fill('# 源码更新\n\n$x+y$');await code.click();assert.equal(await editor.locator('h1').textContent(),'源码更新');assert.equal(await editor.locator('.katex').count(),1);await editor.pressSequentially('续写');assert(await page.evaluate(()=>window.journalFlush()));await editor.pressSequentially('继续');assert((await readSource()).includes('续写继续'));
  async function assertEntry(id,text){await waitReady(id);const input=page.locator(id),rich=input.locator('..').locator('.milkdown>.ProseMirror').first();await rich.click();await rich.pressSequentially(text);await page.waitForFunction(({id,text})=>document.querySelector(id).value.includes(text),{id,text});await assertTools(id);
   const richBlock=rich.locator('.journal-block-math'),formulaField=rich.locator('.journal-block-math-source');
   // Insert a real display-math node into this editor without replacing its context.
   await input.evaluate(el=>{const view=el._markdownLive.view;const node=view.state.schema.nodes.code_block.create({language:'LaTeX'});view.dispatch(view.state.tr.insert(view.state.doc.content.size,node))});
   await richBlock.click();await formulaField.waitFor();await page.keyboard.press('Backspace');assert.equal(await richBlock.count(),0,'empty block must exit with Backspace');
   await input.evaluate(el=>{const view=el._markdownLive.view;view.dispatch(view.state.tr.insert(view.state.doc.content.size,view.state.schema.nodes.code_block.create({language:'LaTeX'})))});
   await richBlock.click();const empty=await formulaField.evaluate(el=>{const s=getComputedStyle(el);return {height:el.getBoundingClientRect().height,min:parseFloat(s.minHeight),padding:parseFloat(s.paddingTop),radius:parseFloat(s.borderRadius),flex:s.flexGrow}});assert(empty.height>=20&&empty.height<=30,JSON.stringify({id,empty}));assert(empty.padding>=2);assert.equal(empty.radius,0);assert.equal(empty.flex,'0');
   await formulaField.fill('x+y');await page.keyboard.press(process.env.JOURNAL_BROWSER==='webkit'?'Meta+ArrowRight':'End');const single=await formulaField.evaluate(el=>({height:el.clientHeight,scrollTop:el.scrollTop,scrollWidth:el.scrollWidth,width:el.clientWidth}));assert(single.height<=30);assert.equal(single.scrollTop,0,'single-line caret must not scroll out of view');assert(single.scrollWidth<=single.width+1);
   await formulaField.fill('a+b\nc+d\ne+f');assert(await formulaField.evaluate(el=>el.clientHeight>35&&el.clientHeight<75));await formulaField.fill('x');assert(await formulaField.evaluate(el=>el.clientHeight<=30),'formula must shrink after deletion');
   if(process.env.JOURNAL_MARKDOWN_SCREENSHOTS){fs.mkdirSync(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,{recursive:true});await richBlock.screenshot({path:path.join(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,id.slice(1)+'-formula.png'),caret:'initial'})}
   await input.evaluate(el=>el._markdownLive.commit());assert.deepEqual(await input.evaluate(el=>{const button=el.closest('.editor-label').querySelector('.markdown-source-toggle');button.click();const s=getComputedStyle(el),metrics=[s.fontSize,s.lineHeight];button.click();return metrics}),['13px','normal'])}
  await page.locator('[data-page="review"]').first().click();await page.locator('#mode-month').click();await page.locator('.month-day').first().click();await assertEntry('#inspector-note','当日备注');assert(await page.evaluate(()=>window.journalFlush()));await page.locator('#inspector-note-tab').click();await assertEntry('#inspector-project-note','总体笔记标题栏');assert(await page.evaluate(()=>window.journalFlush()));
  await assertCaretAtLineStart('#inspector-project-note');
  await page.locator('#inspector-daily-tab').click();
  await assertCaretAtLineStart('#inspector-note');
  await page.locator('#inspector-note-tab').click();
  const reviewNote=page.locator('#inspector-project-note');
  const reviewGrip=reviewNote.locator('..').locator('.note-height-grip');
  assert.equal(await reviewNote.locator('..').getByRole('separator').count(),1);
  const before=Number(await reviewGrip.getAttribute('aria-valuenow'));
  await reviewGrip.focus();await reviewGrip.press('ArrowDown');
  assert.equal(Number(await reviewGrip.getAttribute('aria-valuenow')),before+10);
  const reviewHeightKey=await reviewNote.getAttribute('data-note-height-key');
  await page.waitForFunction(async ({key,expected})=>{
   const {ui}=await (await fetch('/api/view-state')).json();
   return ui.noteHeights?.[key]===expected&&ui.noteHeights?.['project-note:a']===320;
  },{key:reviewHeightKey,expected:before+10});
  await page.locator('#inspector-daily-tab').click();
  const dailyGrip=page.locator('#inspector-note').locator('..').locator('.note-height-grip');
  await dailyGrip.waitFor();
  assert.equal(await page.locator('#inspector-note').locator('..').getByRole('separator').count(),1);
  const dailyBefore=Number(await dailyGrip.getAttribute('aria-valuenow'));
  await dailyGrip.focus();await dailyGrip.press('ArrowDown');
  assert.equal(Number(await dailyGrip.getAttribute('aria-valuenow')),dailyBefore+10);
  await page.waitForFunction(async expected=>(await (await fetch('/api/view-state')).json()).ui?.noteHeights?.['inspector-note']===expected,dailyBefore+10);
  await page.reload();await page.waitForFunction(()=>window.journalViewReady);
  await dailyGrip.waitFor();
  assert.equal(Number(await dailyGrip.getAttribute('aria-valuenow')),dailyBefore+10);
  await page.locator('#inspector-note-tab').click();
  assert.equal(Number(await reviewGrip.getAttribute('aria-valuenow')),before+10);
  await page.locator('[data-open-week]').first().evaluate(el=>el.click());await assertEntry('#weekly-note','本周记录');await assertCaretAtLineStart('#weekly-note');assert(await page.evaluate(()=>window.journalFlush()));
  await page.locator('[data-page="projects"]').first().click();await page.locator('#project-add-record').click();await assertEntry('#record-note','每日记录');await page.locator('#record-dialog .close-dialog').click();assert(await page.evaluate(()=>window.journalFlush()));
  await page.locator('#new-deadline').click();await assertEntry('#deadline-note','节点备注');await page.locator('#deadline-name').fill('测试节点');await page.locator('#deadline-form').evaluate(el=>el.requestSubmit());await page.locator('#deadline-dialog').waitFor({state:'hidden'});
  console.log('CHECK Large notes');
  // Large notes should stay interactive and never spin on incomplete syntax.
  await setDoc(Array.from({length:250},(_,i)=>'第'+i+'段 **文字**').join('\n\n'));await editor.pressSequentially('末尾');await editor.press('Enter');await editor.pressSequentially('# ');await editor.press('Enter');await page.locator('.project-heading').click();assert((await readSource()).includes('末尾'));
  assert(await page.evaluate(()=>window.journalFlush()));const final=await readSource();await page.reload();await page.waitForFunction(()=>window.journalViewReady);await waitReady('#project-note');assert.equal(await readSource(),final);assert.deepEqual(errors,[]);
  if(process.env.JOURNAL_MARKDOWN_SCREENSHOTS){fs.mkdirSync(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,{recursive:true});await setDoc('# 研究手记\n\n## 本周进展\n\n### 当前想法\n\n**直接排版**，`inline code`，行内公式 $E=mc^2$。\n\n> 时间\n>\n> 今天\n>\n> > 嵌套引用\n\n$$\n\\sum_{i=1}^n i=\\frac{n(n+1)}2\n$$\n\n- 第一项\n- 第二项\n\n'+saved.slice(saved.indexOf('<img')));await page.locator('.project-heading').click();assert.equal(await editor.locator('.katex-error').count(),0);assert.equal(await editor.locator('.katex-display').count(),1);await editor.screenshot({path:path.join(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,'rich-light.png')});await editor.locator('.journal-block-math').click();await editor.screenshot({path:path.join(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,'math-edit-light.png')});await page.locator('.project-heading').click();await page.evaluate(()=>JournalAppearance.apply({scheme:'dark',accent:'fern'}));await editor.screenshot({path:path.join(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,'rich-dark.png')});await editor.locator('.journal-block-math').click();await editor.screenshot({path:path.join(process.env.JOURNAL_MARKDOWN_SCREENSHOTS,'math-edit-dark.png')})}
  console.log('PASS immediate headings/lists/inline math, image drag-resize and persistence, equal glyph-sized carets, IME, held deletion, undo/redo, source mode, project switching and all note entry points');
 }finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('exit',resolve))}
})().catch(e=>{console.error(e);process.exit(1)});
