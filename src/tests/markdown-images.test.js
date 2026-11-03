import test from 'node:test';import assert from 'node:assert/strict';
import {parseImageTag,imageTag} from '../web/markdown-images.js';
import {renderMarkdown} from '../web/markdown.js';
test('resized images retain descriptions, captions and safe portable zoom',()=>{
 const image={src:'https://example.com/figure.png',alt:'实验 & 对照',caption:'结果',ratio:.75,width:null};
 assert.deepEqual(parseImageTag(imageTag(image)),image);
 const html=renderMarkdown(imageTag(image));assert(html.includes('zoom:75%'));assert(html.includes('class="md-image"'));assert(html.includes('实验 &amp; 对照'));
});
test('image HTML only admits safe sources and strictly selected size attributes',()=>{
 for(const tag of ['<img src="javascript:alert(1)">','<img src="data:image/svg+xml,x">','<img src="file:///secret">'])assert.equal(parseImageTag(tag),null);
 const html=renderMarkdown('<img src="https://example.com/a.png" onerror="alert(1)" style="position:fixed;zoom:50%;" width="123">');
 assert(!html.includes('onerror'));assert(!html.includes('position:fixed'));assert(html.includes('width="123"'));
 assert(renderMarkdown('<script>alert(1)</script>').includes('&lt;script&gt;'));
});
