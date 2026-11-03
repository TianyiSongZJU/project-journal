import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
// Isolate rendering so a parser regression fails with a timeout instead of
// hanging the whole test suite (or the application's UI thread).
test('incomplete Markdown headings and prefixes always finish rendering',()=>{
 const module=new URL('../web/markdown.js',import.meta.url).href;
 const sources=['# ','## ','###\t','#### ','##### ','###### ','# \n\n正文','## \n- [ ] next','> ','- ','1. ','$$','```','###','**','[', '![',...Array.from({length:6},(_,i)=>'#'.repeat(i+1)+'    ')];
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {renderMarkdown} from ${JSON.stringify(module)};for(const source of ${JSON.stringify(sources)})renderMarkdown(source);console.log('finished');`],{timeout:2000,encoding:'utf8'});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'finished');
});
