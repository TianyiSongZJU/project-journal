import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../web/markdown.js';
test('headings emphasis quotes and both list types',()=>{const html=renderMarkdown('# 一级\n## 二级\n### 三级\n\n**加粗** *斜体*\n> 引用\n\n- 无序\n- 第二条\n\n1. 有序\n2. 第二条');for(const part of ['<h1>一级</h1>','<h2>二级</h2>','<h3>三级</h3>','<strong>加粗</strong>','<em>斜体</em>','<blockquote>','<ul>','<ol>'])assert.ok(html.includes(part),part)});
test('todo line indexes, completion and readonly rendering',()=>{const source='# 清单\n- [ ] 待办\n- [x] 完成';const html=renderMarkdown(source,{interactive:true});assert.match(html,/data-md-line="1"/);assert.match(html,/checked/);assert.doesNotMatch(html,/disabled/);assert.match(renderMarkdown(source),/disabled/)});
test('raw markup and attribute payloads are inert text',()=>{const html=renderMarkdown('# <script>alert(1)</script>\n- [ ] "><img src=x onerror=alert(1)>\n**<svg onload=x>**');assert.doesNotMatch(html,/<script|<img|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/aria-label="&quot;&gt;&lt;img/)});
test('plain notes and newlines survive',()=>{assert.equal(renderMarkdown('普通笔记\n第二行'),'<p>普通笔记<br>第二行</p>');assert.equal(renderMarkdown(''), '')});
