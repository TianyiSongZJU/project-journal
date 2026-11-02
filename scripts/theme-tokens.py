#!/usr/bin/env python3
"""Introduce themed color tokens while keeping original light colors as fallbacks.
Run after adding literal colors to a shared stylesheet; existing tokens are preserved.
"""
from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]/'src/web'
index=root/'theme-colors.js'
colors=json.loads(index.read_text().split('=',1)[1].rstrip(';\n')) if index.exists() else {}
def role(prop):
 if prop.startswith('--'):
  if prop in ['--ink','--muted','--green','--clay']:return 'ink'
  if 'line' in prop:return 'line'
  if 'shadow'in prop:return 'shadow'
  return 'surface'
 if prop in ['color','fill','stroke','caret-color','accent-color','text-decoration-color']:return 'ink'
 if 'shadow'in prop or prop=='filter':return 'shadow'
 if prop.startswith(('border','outline')):return 'line'
 return 'surface'
for p in root.glob('*.css'):
 if p.name=='appearance.css':continue
 s=p.read_text()
 def decl(m):
  prefix,prop,value=m.groups()
  if prop=='content' or 'url('in value:return m.group()
  r=role(prop)
  def token(t):
   c=t[0].lower();key='--tone-'+r+'-'+c[1:];colors[key]=[r,c]
   return 'var('+key+','+c+')'
  # Ignore literals already inside a token fallback on repeat runs.
  if '--tone-'not in value:value=re.sub(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b',token,value)
  if prop in ['background','background-color'] and '--accent-solid' not in value:
   value=value.replace('var(--green)','var(--accent-solid,var(--green))')
  return prefix+prop+':'+value
 s=re.sub(r'([;{]\s*)([-\w]+)\s*:\s*([^;{}]+)',decl,s)
 p.write_text(s)
index.write_text('globalThis.JournalThemeColors='+json.dumps(colors,separators=(',',':'),sort_keys=True)+';\n')
print(len(colors),'theme color tokens')
