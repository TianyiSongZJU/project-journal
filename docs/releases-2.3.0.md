# 项目手记 2.3.0 · 对比合并与手记更新

- **同步副本对比合并。** 在“设置 → 同步副本 → 对比并合并”左右查看差异，选择要应用的记录。默认不勾选；保留当前版本独有的记录和副本原文件。版本变化后需要重新对比。支持能完整读取的主数据副本，单个分文件冲突仍可导出核对。
- **手记编辑。** 周记、当日备注、总体笔记使用统一的离线 Markdown 编辑器，支持实时排版、源码切换、图片缩放和公式。长文编辑减少了重复转换，历史不再引用的图片可由应用清理。
- **截止节点。** 低优先级节点在日期详情中显示为可勾选的当日事项。项目节点可按最低优先级筛选；年、月回顾可以悬浮图例突出截止节点。macOS 菜单栏的“今日截止”可打开当天详情，窗口跨天后会自动更新倒计时。
- **回顾与时间线。** 年度、月度、时段视图都可整组选项目，进行中和已完成分组独立选择。悬浮已划取的区间可以查看时长，深色模式的拖动柄更清楚。划取仍以 15 分钟为单位。
- **主题。** 增加低饱和度预设和马卡龙粉色，支持自定义色相及逐项调整主题颜色。

## 下载与升级

| 平台 | 文件 |
| --- | --- |
| macOS 13+（Apple Silicon / Intel 通用） | `project-journal-macos-universal.zip` |
| Windows x64（需要 WebView2 Runtime） | `project-journal-windows-x64.zip` |

用 `SHA256SUMS.txt` 核对下载。升级前退出旧版，保留完整的 `data/` 和本机设置，只替换应用及随附许可文件。发布包不含个人记录、配置或演示数据。

macOS 版使用临时签名，未经过 Apple 公证；Windows 版已交叉构建，未在 Windows 实机验证。详见 [README](https://github.com/TianyiSongZJU/project-journal#readme)。

**English:** This release adds side-by-side sync-copy comparison and selective merging, live Markdown editing, daily deadline checklists and group filters across review views. See the [English README](https://github.com/TianyiSongZJU/project-journal/blob/main/README.en.md) for installation and upgrade instructions.
