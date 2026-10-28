#!/usr/bin/env python3
"""Create an isolated, synthetic demo. Existing destinations are never overwritten."""
import argparse
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATE = '2026-10-28'

def generate(output):
    output = Path(output).expanduser().absolute()
    # exist_ok=False is intentional: even an empty existing directory is refused.
    output.mkdir(parents=True, exist_ok=False)
    data, local = output / 'data', output / 'local'
    data.mkdir(); local.mkdir()
    (data / '.english-layout').write_text('1\n')
    state = json.loads((ROOT / 'examples/demo.json').read_text())
    (data / '项目手记.json').write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
    (local / '自动记录设置.json').write_text(json.dumps({'enabled':False,'activity':False,'bindings':[],'deviceName':'演示设备'},ensure_ascii=False))
    (local / 'view-state.json').write_text(json.dumps({'page':'review','mode':'year','viewYear':2026,'viewMonth':'2026-10','date':DATE,'currentProject':'demo-research','inspectorProject':'demo-research','timeline':{'date':DATE,'visibleHours':8,'fullDay':False}},ensure_ascii=False))
    base = int(dt.datetime(2026,10,28,tzinfo=dt.timezone(dt.timedelta(hours=8))).timestamp())
    evidence, usage = {}, {}
    def activity(key,start,end,app,project):
        slots = {str(base+n*60): 780 for n in range(start,end,15)}
        usage[key] = {'date':DATE,'projectId':project,'app':app,'slots':slots,'attribution':{k:{'document':v} for k,v in slots.items()}}
    activity('writing',540,660,'Microsoft Word','demo-research')
    activity('reading',660,705,'Preview','demo-reading')
    activity('analysis',780,840,'Python','demo-research')
    activity('coding',840,900,'Visual Studio Code','demo-tools')
    activity('followup',915,960,'Visual Studio Code','demo-tools')
    def file_event(key,minute,name,project):
        stamp=dt.datetime.fromtimestamp(base+minute*60,dt.timezone.utc).isoformat().replace('+00:00','Z')
        evidence[key]={'id':key,'date':DATE,'projectId':project,'kind':'file','name':name,'relativePath':name,'stamp':key,'at':stamp,'touches':[{'at':base+(minute+x)*60,'stamp':key+str(x)} for x in [0,3,6]]}
    file_event('report',620,'阶段报告.docx','demo-research')
    file_event('figure',815,'温度对照图.svg','demo-research')
    file_event('script',870,'clean_data.py','demo-tools')
    file_event('example',940,'examples.csv','demo-tools')
    folder=data/'activity'/'demo-mac';folder.mkdir(parents=True)
    (folder/'2026-10.json').write_text(json.dumps({'version':1,'deviceId':'demo-mac','deviceName':'演示 Mac','appUsage':usage,'evidence':evidence},ensure_ascii=False,indent=2)+'\n')
    print('Synthetic demo created:',output)
    print('Reference date:',DATE,'; monitoring is disabled; no folder bindings.')
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,help='new directory; must not already exist')
    args=parser.parse_args()
    try:generate(args.output)
    except FileExistsError:parser.error('output already exists; choose a new empty path (nothing was overwritten)')
