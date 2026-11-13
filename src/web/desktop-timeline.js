// Shared native desktop presentation. Device filters never change suggestions or saved time.
import {observedDuration} from './activity-range.js';
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

const fileTrackMin=52;
const fileTrackPreferred=72;
const labelRow=20;

export function timelineWidths({width,activities=[],fileCount=0,compare=false}) {
  const columns=compare?Math.max(1,activityClients(activities).length):1;
  const activityMin=compare?columns*160:220;
  const activityMax=compare?columns*220:320;
  const gap=12;
  const filesMin=fileCount*fileTrackMin;
  const filesPreferred=fileCount*fileTrackPreferred;
  const minimum=activityMin+filesMin+gap;
  const available=Math.max(width,minimum);
  const filesWidth=Math.min(filesPreferred,available-activityMin-gap);
  const activityWidth=Math.min(activityMax,available-filesWidth-gap);
  return {activityWidth,filesWidth,minimum,gap};
}

export function setupClientTimeline({esc,initialView={},onViewChange}) {
  const storageKey = window.journalMacHost?'journal-macos-hidden-clients':'journal-windows-hidden-clients';
  let hidden;
  const restoredClients=Array.isArray(initialView.hiddenClients);
  try { const value=restoredClients?initialView.hiddenClients:JSON.parse(localStorage.getItem(storageKey)); hidden=new Set(Array.isArray(value)?value:[]); }
  catch { hidden=new Set(); }
  let root, refresh, horizontal=0, selectionVersion=0, saveTimer, compare=initialView.compare===true;
  const includes = item => !hidden.has(clientKey(item));
  const dayClients = guides => activityClients([...guides.activities,...guides.files]);
  const persist = () => {
    selectionVersion++;onViewChange?.();
    try { localStorage.setItem(storageKey,JSON.stringify([...hidden])); } catch {}
    if(window.journalSaveHiddenClients) {
      clearTimeout(saveTimer);
      saveTimer=setTimeout(()=>window.journalSaveHiddenClients([...hidden]).catch(()=>{
        const caption=root?.querySelector('.dt-client-count');
        if(caption) { caption.textContent='偏好未保存'; caption.title='客户端选择尚未保存到本机，请重新选择后重试'; }
      }),0);
    }
  };
  if(!restoredClients&&window.journalLoadHiddenClients) window.journalLoadHiddenClients().then(value=>{
    if(selectionVersion||!Array.isArray(value)) return;
    hidden=new Set(value);onViewChange?.();
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
    layout.onclick=()=>{compare=!compare;onViewChange?.();horizontal=0;refresh();root.querySelector('.dt-client-picker').open=true;root.querySelector('.dt-client-layout').focus({preventScroll:true});};
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
    const guideWidth=guide.clientWidth;
    const labels=tracks.map(track=>track.querySelector('.dt-file-project-name'));
    const {activityWidth,filesWidth,minimum,gap}=timelineWidths({
      width:guideWidth,activities:guides.activities.filter(includes),fileCount:tracks.length,compare
    });
    if(minimum>guideWidth) grid.style.minWidth=(grid.clientWidth+minimum-guideWidth)+'px';
    const captionGuide=root.querySelector('.dt-axis-caption>div');
    for(const el of [guide,headings.querySelector('.dt-client-heading-guide'),captionGuide]) {
      el.style.setProperty('--dt-activity-width',activityWidth+'px');
    }
    if(tracks.length){
      const trackWidth=filesWidth/tracks.length;
      const guideEnd=Math.max(guideWidth,minimum);
      tracks.forEach((track,index)=>{
        const offset=index*trackWidth;
        const left=activityWidth+gap+offset-3;
        track.style.left=left+'px';
        track.style.width=trackWidth+'px';
        labels[index].style.setProperty('--file-label-max-width',Math.min(240,guideEnd-left-8)+'px');
      });
    }
    headings.querySelector('.dt-client-file-heading').hidden=!tracks.length;
    const scrollStyle=getComputedStyle(scroller);
    headings.style.paddingLeft=scrollStyle.paddingLeft;
    headings.style.paddingRight=scrollStyle.paddingRight;
    headGrid.style.width=grid.getBoundingClientRect().width+'px';
    headGrid.style.gridTemplateColumns=getComputedStyle(grid).gridTemplateColumns;
    scroller.scrollLeft=horizontal;
    const sync=()=>{
      horizontal=scroller.scrollLeft;headings.scrollLeft=horizontal;
      const viewport=scroller.getBoundingClientRect();
      const counters=[...guide.querySelectorAll('.dt-git-node')].map(node=>node.getBoundingClientRect())
        .filter(rect=>rect.bottom>viewport.top&&rect.top<viewport.bottom);
      const placed=[];
      const geometry=tracks.map((track,index)=>({host:track.getBoundingClientRect(),label:labels[index].getBoundingClientRect()}));
      geometry.forEach(({host,label},index)=>{
        const minimum=Math.max(host.top,viewport.top+6);
        const maximum=Math.min(host.bottom,viewport.bottom-6)-label.height;
        const desired=minimum+index*labelRow;
        const blocked=[...counters,...placed]
          .filter(rect=>rect.left<label.right+2&&rect.right>label.left-2)
          .map(rect=>({start:rect.top-label.height-2,end:rect.bottom+2}))
          .sort((a,b)=>a.start-b.start);
        let start=minimum,top;
        function consider(end){
          if(start>end)return;
          const candidate=Math.min(end,Math.max(start,desired));
          if(top===undefined||Math.abs(candidate-desired)<Math.abs(top-desired))top=candidate;
        }
        for(const block of blocked){
          if(block.end<=start)continue;
          consider(Math.min(maximum,block.start));
          start=Math.max(start,block.end);
          if(start>maximum)break;
        }
        consider(maximum);
        labels[index].style.visibility=top===undefined?'hidden':'visible';
        if(top!==undefined){
          labels[index].style.top=(top-host.top)+'px';
          placed.push({left:label.left,right:label.right,top,bottom:top+label.height});
        }
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
    if(!compare) return `<div class="dt-client-column dt-clients-merged" style="--client-index:0;--client-count:1">${renderRuns({activities:guides.activities.map(item=>({...item,app:windowsAppName(item.app)})),merged:true},range,scale,'合并展示')}</div>`;
    return clients.map((client,index)=>`<div class="dt-client-column" data-client="${esc(client.id)}" aria-label="${esc(client.name)}的前台活动" style="--client-index:${index};--client-count:${clients.length}">${renderRuns({activities:client.activities},range,scale,client.name)}</div>`).join('');
  }
  function activityDetail(activities,run) {
    const names=new Set(run.apps.keys());
    const clients=activityClients(activities.filter(item=>names.has(item.app)&&item.start<run.end&&item.end>run.start));
    const minuteLabel=observedDuration;
    return `<div class="dt-client-evidence"><span>客户端来源</span>${clients.map(client=>{
      const seconds=activitySlots(client.activities,run.start,run.end).reduce((sum,slot)=>sum+slot.activeSeconds,0);
      return `<div><span>${esc(client.name)}</span><b>${esc(minuteLabel(seconds))}</b></div>`;
    }).join('')}</div>`;
  }
  return {getView:()=>({hiddenClients:[...hidden],compare}),includes,mount,renderActivities,activityDetail};
}
