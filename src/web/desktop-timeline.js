// Shared native desktop presentation. Device filters never change suggestions or saved time.
import {activitySlots} from './timeline-layout.js';
export const clientKey = item => item.deviceId || item.device || item.deviceName || 'local';
export const windowsAppName = app => app.replace(/\.exe$/i,'');

export function activityClients(activities) {
  const clients = new Map();
  for (const item of activities) {
    const id = clientKey(item);
    if (!clients.has(id)) clients.set(id, {id, name:item.device || '本机', activities:[]});
    clients.get(id).activities.push(item);
  }
  return [...clients.values()].sort((a,b) => a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id));
}

const labelWidth = text => [...text].reduce((width,char)=>width+(/[\u2e80-\uffff]/.test(char)?10:5.5),0);
function activityDemand(activities,start,end) {
  const slots=activitySlots(activities.map(item=>({...item,app:typeof window!=='undefined'&&window.journalMacHost?item.app:windowsAppName(item.app)})),start,end);
  if(!slots.length) return 132;
  return Math.min(360,Math.max(132,...slots.map(slot=>slot.apps.filter((app,index)=>!index||app.percent>=12).slice(0,4).reduce((width,app)=>width+Math.min(124,Math.max(64,labelWidth(app.app.replace(/^Microsoft /,''))+24)),0))));
}

// Size from visible content, rather than stretching application shapes into spare space.
export function timelineWidths({width,activities=[],fileLabels=[],compare=false,start=0,end=1440}) {
  const clients=activityClients(activities), gap=12;
  const activityMin=compare?Math.max(1,clients.length)*160:120;
  const activityPreferred=compare?clients.reduce((sum,client)=>sum+Math.max(160,activityDemand(client.activities,start,end)),0)||160:activityDemand(activities,start,end);
  const filesMin=fileLabels.length?Math.max(80,fileLabels.length*52):0;
  const filesPreferred=fileLabels.reduce((sum,label)=>sum+Math.min(120,Math.max(80,labelWidth(label)+24)),0);
  const minimum=activityMin+filesMin+gap, available=Math.max(width,minimum);
  const activityWidth=Math.min(activityPreferred,Math.max(activityMin,available-filesPreferred-gap));
  const filesWidth=Math.min(filesPreferred,Math.max(filesMin,available-activityWidth-gap));
  return {activityWidth,filesWidth,minimum,gap};
}

export function setupClientTimeline({esc}) {
  const storageKey = window.journalMacHost?'journal-macos-hidden-clients':'journal-windows-hidden-clients';
  let hidden;
  try { const value=JSON.parse(localStorage.getItem(storageKey)); hidden=new Set(Array.isArray(value)?value:[]); }
  catch { hidden=new Set(); }
  let root, refresh, horizontal=0, selectionVersion=0, saveTimer, compare=false;
  const includes = item => !hidden.has(clientKey(item));
  const dayClients = guides => activityClients([...guides.activities,...guides.files]);
  const persist = () => {
    selectionVersion++;
    try { localStorage.setItem(storageKey,JSON.stringify([...hidden])); } catch {}
    if(window.journalSaveHiddenClients) {
      clearTimeout(saveTimer);
      saveTimer=setTimeout(()=>window.journalSaveHiddenClients([...hidden]).catch(()=>{
        const caption=root?.querySelector('.dt-client-count');
        if(caption) { caption.textContent='偏好未保存'; caption.title='客户端选择尚未保存到本机，请重新选择后重试'; }
      }),0);
    }
  };
  if(window.journalLoadHiddenClients) window.journalLoadHiddenClients().then(value=>{
    if(selectionVersion||!Array.isArray(value)) return;
    hidden=new Set(value);
    refresh?.();
  }).catch(()=>{});
  function update(focus) {
    persist();
    refresh();
    const menu=root.querySelector('.dt-client-picker');
    menu.open=true;
    const input=[...menu.querySelectorAll('input')].find(el=>el.value===focus);
    (input || menu.querySelector('summary')).focus();
  }
  document.addEventListener('pointerdown',event=>{
    const menu=root?.querySelector('.dt-client-picker');
    if (menu?.open && !menu.contains(event.target)) menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    const menu=root?.querySelector('.dt-client-picker');
    if (event.key==='Escape' && menu?.open) { menu.open=false; menu.querySelector('summary').focus(); }
  });
  function mount(element,guides,rerender,sources) {
    root=element; refresh=rerender;
    const clients=sources?activityClients(sources.map(item=>({...item,device:item.deviceName}))):dayClients(guides), shown=clients.filter(includesClient), all=shown.length===clients.length;
    function includesClient(client) { return !hidden.has(client.id); }
    const legend=root.querySelector('.dt-legend-activity');
    const picker=document.createElement('details');
    picker.className='dt-client-picker';
    picker.innerHTML=`<summary aria-label="选择展示的客户端"><span>客户端</span><span class="dt-client-count">${all?'全部':shown.length+' / '+clients.length}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></summary><div class="dt-client-menu"><div class="dt-client-menu-heading"><strong>展示客户端</strong><button type="button" class="quiet" data-client-all>显示全部</button></div><p>筛选活动与文件线索，项目时间保持完整</p><div class="dt-client-options">${clients.map(client=>`<label><input type="checkbox" value="${esc(client.id)}" ${includesClient(client)?'checked':''}><span title="${esc(client.name)}">${esc(client.name)}</span><small>当天有记录</small></label>`).join('') || '<div class="dt-client-menu-empty">这一天暂无客户端记录</div>'}</div></div>`;
    legend.replaceWith(picker);
    const layout=document.createElement('button');
    layout.type='button'; layout.className='quiet dt-client-layout';
    layout.textContent='分端对比'; layout.setAttribute('aria-pressed',String(compare));
    layout.title='切换合并展示与按客户端分轨';
    picker.querySelector('.dt-client-menu').append(layout);
    layout.onclick=()=>{compare=!compare;horizontal=0;refresh();root.querySelector('.dt-client-picker').open=true;root.querySelector('.dt-client-layout').focus({preventScroll:true});};
    picker.querySelector('summary>span').textContent='前台活动';
    picker.querySelector('.dt-client-count').textContent=shown.length?shown.length+' 端':'未选择';
    picker.querySelectorAll('input').forEach(input=>input.onchange=()=>{
      if(input.checked) hidden.delete(input.value); else hidden.add(input.value);
      update(input.value);
    });
    picker.querySelector('[data-client-all]').onclick=()=>{
      hidden.clear(); update();
    };
    const activity=activityClients(guides.activities).filter(includesClient), count=activity.length;
    const headings=document.createElement('div');
    headings.className='dt-client-headings';
    const titles=count?(compare?activity.map(client=>`<button type="button" data-focus-client="${esc(client.id)}" title="只看${esc(client.name)}；可在客户端菜单恢复多选"><i></i><b>${esc(client.name)}</b></button>`).join(''):`<span><i></i><b>前台活动</b><small>${count===1?esc(activity[0].name):count+' 个客户端'}</small></span>`):'<span class="dt-client-heading-empty">暂无前台活动</span>';
    headings.innerHTML=`<div class="dt-client-head-grid"><span></span><div class="dt-client-heading-guide"><div class="dt-client-heading-group" style="--client-count:${compare?Math.max(1,count):1}">${titles}</div><span class="dt-client-file-heading">文件修改</span></div><span></span></div>`;
    root.querySelector('.dt-axis-caption').after(headings);
    headings.hidden=!compare||count<2;
    const scroller=root.querySelector('.dt-scroll'), grid=root.querySelector('.dt-grid'), headGrid=headings.firstElementChild;
    // Keep the split stable while scrolling vertically; recalculate on date/filter/size changes.
    const tracks=[...root.querySelectorAll('.dt-file-project')];
    const guide=root.querySelector('.dt-guides');
    const widths=timelineWidths({width:guide.clientWidth,activities:guides.activities.filter(includes),fileLabels:tracks.map(track=>track.querySelector('.dt-file-project-name').textContent),compare,start:Number(grid.dataset.start),end:Number(grid.dataset.end)});
    if(widths.minimum>guide.clientWidth) grid.style.minWidth=(grid.clientWidth+widths.minimum-guide.clientWidth)+'px';
    const {activityWidth,filesWidth}=widths;
    const captionGuide=root.querySelector('.dt-axis-caption>div');
    const fileCaption=document.createElement('span');fileCaption.className='dt-caption-files';fileCaption.textContent='文件修改';
    captionGuide.append(fileCaption);
    for(const el of [guide,headings.querySelector('.dt-client-heading-guide'),captionGuide]) {
      el.style.setProperty('--dt-activity-width',activityWidth+'px');
    }
    tracks.forEach((track,index)=>{
      track.style.left=(activityWidth+12+index*filesWidth/tracks.length)+'px';
      track.style.width=filesWidth/tracks.length+'px';

    });
    headings.querySelector('.dt-client-file-heading').hidden=!tracks.length;
    fileCaption.hidden=!tracks.length||activityWidth+60>captionGuide.clientWidth;
    const scrollStyle=getComputedStyle(scroller);
    headings.style.paddingLeft=scrollStyle.paddingLeft;
    headings.style.paddingRight=scrollStyle.paddingRight;
    headGrid.style.width=grid.getBoundingClientRect().width+'px';
    headGrid.style.gridTemplateColumns=getComputedStyle(grid).gridTemplateColumns;
    scroller.scrollLeft=horizontal;
    const sync=()=>{
      horizontal=scroller.scrollLeft;headings.scrollLeft=horizontal;
      // Float along the original stem without leaving its actual revision extent.
      const viewport=scroller.getBoundingClientRect();
      tracks.forEach(track=>{
        const label=track.querySelector('.dt-file-project-name'),host=track.getBoundingClientRect(),height=label.getBoundingClientRect().height;
        const minimum=Math.max(0,viewport.top+6-host.top),maximum=Math.min(host.height-height,viewport.bottom-6-host.top-height);
        const blocked=[...track.querySelectorAll('.dt-node-metrics')].map(metrics=>{const r=metrics.getBoundingClientRect();return {start:r.top-host.top-height-2,end:r.bottom-host.top+2};}).sort((a,b)=>a.start-b.start);
        const gaps=[];let start=minimum;
        for(const block of blocked){if(block.end<=start)continue;if(block.start>start)gaps.push([start,Math.min(maximum,block.start)]);start=Math.max(start,block.end);if(start>maximum)break;}
        if(start<=maximum)gaps.push([start,maximum]);
        const desired=minimum+parseFloat(track.style.getPropertyValue('--file-label-offset')||0),candidates=gaps.filter(([a,b])=>a<=b).map(([a,b])=>Math.min(b,Math.max(a,desired)));
        label.style.visibility=candidates.length?'visible':'hidden';
        if(candidates.length){const top=candidates.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired))[0];label.style.top=top+'px';}
      });
    };
    scroller.addEventListener('scroll',sync,{passive:true});
    sync();
    headings.querySelectorAll('[data-focus-client]').forEach(button=>button.onclick=()=>{
      clients.forEach(client=>{if(client.id===button.dataset.focusClient)hidden.delete(client.id);else hidden.add(client.id);});
      persist();
      refresh();
      const focused=[...root.querySelectorAll('[data-focus-client]')].find(el=>el.dataset.focusClient===button.dataset.focusClient);
      focused?.focus({preventScroll:true});
    });
  }
  function renderActivities(guides,range,scale,renderRuns) {
    const clients=activityClients(guides.activities);
    if(!clients.length) return '';
    if(!compare) return `<div class="dt-client-column dt-clients-merged" style="--client-index:0;--client-count:1">${renderRuns({activities:guides.activities.map(item=>({...item,app:typeof window!=='undefined'&&window.journalMacHost?item.app:windowsAppName(item.app)})),merged:true},range,scale,'合并展示')}</div>`;
    return clients.map((client,index)=>`<div class="dt-client-column" data-client="${esc(client.id)}" aria-label="${esc(client.name)}的前台活动" style="--client-index:${index};--client-count:${clients.length}">${renderRuns({activities:client.activities},range,scale,client.name)}</div>`).join('');
  }
  function activityDetail(activities,run) {
    const names=new Set(run.apps.keys());
    const clients=activityClients(activities.filter(item=>names.has(item.app)&&item.start<run.end&&item.end>run.start));
    const minuteLabel=seconds=>seconds<60?'不足1分':Math.round(seconds/60)+'分';
    return `<div class="dt-client-evidence"><span>客户端来源</span>${clients.map(client=>{
      const seconds=activitySlots(client.activities,run.start,run.end).reduce((sum,slot)=>sum+slot.activeSeconds,0);
      return `<div><span>${esc(client.name)}</span><b>${minuteLabel(seconds)}</b></div>`;
    }).join('')}<small>各端分别观测，重叠部分不能相加为工时</small></div>`;
  }
  return {includes,mount,renderActivities,activityDetail};
}
