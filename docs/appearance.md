# 界面外观

设置 → 外观提供跟随系统、浅色、深色，以及苔绿、雾蓝、烟紫、陶红、暖杏五种主题色。选择保存在本机的视图偏好中，不写入项目、笔记或时长数据。macOS 菜单同步使用主题色；有待处理建议、自动记录运行时采用实色圆底和白色符号，空闲或暂停时为浅灰底。

共享样式使用按用途区分的颜色变量（文字、表面、边线和阴影）。浅色苔绿保留原始颜色作为回退值，其他外观由 appearance-runtime.js 提供调色值。项目和应用自身的分类颜色不随主题改变。

在共享 CSS 中增加固定颜色后，运行 `python3 scripts/theme-tokens.py`，同时提交生成的 src/web/theme-colors.js 和样式变更。该命令可重复运行；appearance.css 使用语义变量，不参与转换。新增界面优先使用 --paper、--panel、--ink、--muted、--line、--green（文字）和 --accent-solid（实色按钮底）。

验证：`node --test src/tests/*.test.js`。浏览器检查使用 src/tests/appearance.browser.cjs，传入 JOURNAL_CORE 和 JOURNAL_PLAYWRIGHT_MODULE；程序只建立临时测试数据。JOURNAL_APPEARANCE_SCREENSHOTS 可指定截图目录。
