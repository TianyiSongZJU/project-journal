import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const result=await build({metafile:true,plugins:[{name:'shared-katex',setup(build){build.onResolve({filter:/^katex$/},()=>({path:resolve(root,'katex-global.js')}))}}],entryPoints:[resolve(root,'entry.js')],outfile:resolve(root,'../web/vendor/markdown-editor.js'),bundle:true,minify:true,format:'esm',target:['safari16','chrome110'],loader:{'.woff2':'empty','.woff':'empty','.ttf':'empty'},legalComments:'eof',external:['katex/dist/katex.min.css']});

const css=resolve(root,'../web/vendor/markdown-editor.css');
await writeFile(css,(await readFile(css,'utf8')).replace('@import"katex/dist/katex.min.css";',''));

// Keep the complete license text of every package included in the bundle.
import {existsSync} from 'node:fs';
const packages=new Map();
for(const file of Object.keys(result.metafile.inputs)){
 if(!file.includes('node_modules/'))continue;
 let dir=dirname(resolve(file));while(dir!==dirname(dir)){
  const manifest=resolve(dir,'package.json');
  if(existsSync(manifest)){const info=JSON.parse(await readFile(manifest,'utf8'));if(info.name&&info.version){packages.set(info.name,{dir,...info});break}}
  dir=dirname(dir);
 }
}
let notices='Offline Markdown editor dependencies. Generated from the actual bundle inputs.\n';
for(const info of [...packages.values()].sort((a,b)=>a.name.localeCompare(b.name))){
 const license=['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','license','license.md','LICENSE-MIT.txt'].map(name=>resolve(info.dir,name)).find(existsSync)||[resolve(root,'vendor-licenses',info.name.replaceAll('/','-')+'.txt')].find(existsSync);
 notices+='\n\n## '+info.name+' '+info.version+' ('+info.license+')\n\n'+(license?await readFile(license,'utf8'):'See '+(info.repository?.url||info.homepage||info.name)+' for license text.')+'\n';
}
await writeFile(resolve(root,'../web/vendor/markdown-editor-LICENSES.txt'),notices);
