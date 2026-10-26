# 开发与验证

## 2026-10：Mac 与 Windows 界面同步

`web/desktop.css`、`desktop-editor.js` 和 `desktop-timeline.js` 共用日期联动、紧凑日期详情、时长弹层、备注清除确认、节点布局及多客户端时间线。`desktop-host.js` 按原生宿主标记启用，普通浏览器会话保留原来的布局。Windows 的字体、导航和十字指针留在 `windows.css`；Mac 用 `macos.css` 引入共用布局，继续使用原有字体、标题栏、红绿灯与菜单栏行为。

Mac 在文档开始时设置宿主标记，文档结束时加载样式。客户端筛选通过已有 `journalNative` 消息通道读取及写入本机 `UserDefaults` 的 `JournalHiddenClients`，不依赖非持久 WKWebView 缓存，也不写共享业务数据。Windows 继续使用本机 `windows-view.json`。Mac 应用名保留原样，Windows 的 .exe 后缀处理不作用于 Mac 应用名。

两组界面回归脚本 `tests/windows-editor.cjs` 和 `tests/windows-clients.cjs` 支持 `JOURNAL_PLATFORM=mac` 与默认 Windows 模式。覆盖日期联动、今天选择、清除确认、编辑保存、弹层边界、内边距、多设备筛选及原生偏好消息桥。浏览器回归与 Go 跨平台构建不能代替 Mac 上的 Swift 编译和 WKWebView 原生窗口验证；发布 Mac 应用前仍需在 Mac 运行 `scripts/build-macos.sh` 并核对原生效果。

Go 标准库提供本机服务和带版本校验的 JSON 持久化；界面为原生 HTML/CSS/JavaScript，无前端构建依赖。Mac 原生壳使用 Swift / WKWebView；Windows 使用 Go / WebView2。

## 构建

Mac 安装 Go 与 Xcode Command Line Tools 后，执行 `./build-macos.sh`。会构建 Mac Universal 应用（Intel + Apple Silicon）和 Windows x64 程序。第三方 Go 依赖已存放在 vendor 中，可离线编译。已有 app 的 Info.plist 需保留。

Windows 可以执行：

```
go build -mod=vendor -trimpath -ldflags="-s -w -H windowsgui" -o ../../项目手记-Windows.exe .
```

## 测试

```
go test ./...
node --test tests/model.test.js
```

界面回归使用 Playwright，安装后设定 JOURNAL_PLAYWRIGHT（模块路径，可选）、JOURNAL_BROWSER（本机浏览器路径，可选）。先以 `--no-open --window-url --data-dir /private/tmp/journal-e2e-data --port 18783` 启动临时后端，再运行 `node tests/e2e.cjs`。JOURNAL_TEST_DATA 可以改写测试目录；该测试会清空指定测试目录中的项目手记数据，请仅使用临时测试目录。

关键验证：精确/概括记录统计、闰年热力图、批量操作不自动转化概括记录、备注保留、JSON 原子替换与备份、过期版本及外部同步变更拒绝覆盖、损坏文件保留；项目与记录持久化、节点、颜色、连续滚动和窄屏布局。

正式数据默认写入应用所在文件夹下的`data`，可通过 --data-dir 覆盖。会话文件和 WebView 缓存位于操作系统临时或缓存目录，不参与同步。无账号、远程服务或分析遥测。

## 0.2.0 界面与图标

年度视图使用连续周列，左右接近边界时扩展年份范围，并保留滚动位置。滚动停止后以视野中央的年份更新统计；在项目页、设置页隐藏日历时不处理滚动事件，防止隐藏布局改变当前年份。

回顾与项目页的辅助内容使用原生 details 折叠。日历着色共用精确小时＋已配置估算，未配置记录保留提示。

图标文件位于 ../assets/icons。Windows 的 app_windows_amd64.syso 已包含图标资源（组 ID 1），由 akavel/rsrc v0.10.2 从 ICO 生成，交叉构建不需再安装该工具。Mac 在 Info.plist 中使用 AppIcon.icns，源图与各尺寸 PNG 保留在图标目录。

可使用 tests/run-e2e.cjs 启动和清理隔离实例。JOURNAL_CORE 指定编译后的测试后端；JOURNAL_TEST_DATA 仅可指向可重置的临时目录。JOURNAL_TEST_SCRIPT=tests/preview.cjs 可用隔离示例数据生成界面预览。

## 0.4.0 布局与回归

Mac 使用左侧标题栏 accessory 显示图标和名称，通过 WKUserScript 为网页增加 native-mac 类隐藏备用品牌行。回顾和项目共用顶部导航，无独立侧栏。月度为连续 Monday-first 周行，月份标注在左侧，右侧 Inspector 编辑每日记录或项目 note，沿用现有 JSON 结构。项目排序直接保存 projects 数组顺序。

tests/inspector.cjs 验证补记、概括类型、总体笔记、未保存切换保护、项目排序与重载后的顺序；可通过 JOURNAL_TEST_SCRIPT=tests/inspector.cjs 运行。月历模型测试覆盖跨年、闰日和无重复的连续日期。

## 0.5.0 数据兼容和验证

State version 仍为 1；Entry.Kind 增加很短、很长，原有三档不迁移。Settings 增加 projectSort，Project 增加可选 createdAt / updatedAt。修改时间在 UI 保存项目内容、节点、每日记录时更新；排序设置不会触碰项目时间。旧项目缺少创建时间时保留稳定顺序。原版 0.4 无法识别新增两档，Mac/Windows 应同时更新。

五档和小时控件共用于弹窗、Inspector 和批量编辑；点击或拖动小时会激活 hours。隐藏 select 仅用于保持既有表单校验与事件逻辑，显示使用按钮和项目菜单。tests/refinement.cjs 验证五档存取、滑杆互斥、32 色、排序持久化、项目菜单标记和批量区域不改变日历位置；模型与 Go 测试覆盖新类型和元数据读写。

## 0.5.2 清除与导航修复

Entry.Kind 增加 none，表示只保留当日备注、不记录时长。Hours 必须为 0；统计不增加估算缺失数量。writeDaily 共用于弹窗和 Inspector，none 且备注空时移除空记录。批量清除保留备注；对仅备注记录增加小时从 0 开始。

月度页原来的 .month-view display:block!important 覆盖了 [hidden]，导致隐藏页面仍占布局；现在为三个页面的 [hidden] 使用 ID 选择器，保证切换可见性。tests/cleanup.cjs 验证月度到项目／设置的隐藏状态和位置、独立清除与重载、时长控件中心线、悬浮提示与节点时间轴。

## 0.6.0 选择与刷写

采用 Pointer Events 与 setPointerCapture 实现年/月日历拖动：普通拖选按时间范围选中；刷写按指针经过的格子采样，松开后复用批量预览。边缘滚动由 requestAnimationFrame 驱动，Pointer Cancel、窗口失焦和 Escape 会撤销当前手势，单击抑制避免松开后又触发编辑弹窗。

applyBatch 支持 note 追加和只追加任务模式；不重复追加相同一行，保留原备注。notes-only 新日期使用 none。tests/brush.cjs 覆盖真实鼠标拖动、反向、取消、月历边缘滚动、预览取消、小时/概括刷写、增加小时、备注去重、多项目和重载；模型测试覆盖备注追加与原时长保留。历史导入通过软件 API 及 revision 校验，导入前自动备份，原有同项目同日期记录跳过。

## V1.0.0 色阶、项目分行与操作历史

日历和五档按钮改用同一组按估算设置校准的五级色阶；原来的固定 4 小时饱和阈值仅保留为模型兼容默认。今天保留底色，以日期圆圈、今天徽标及白色外光标识；当前查看、多选分别使用陶土边框与勾，多选模式移除查看和悬停描边，避免取消选择后仍像选中。

点日期优先选择当天已记录且符合筛选的项目；当天有多个时保留当前已记录项目。月度「分项目」开关复用 showMonthProjects，展开日期内每个项目的投入条目，点击直接进入该项目当日编辑。批量预览展示档位/小时、天数、新增与更新数量，以及逐日修改前后的值，准确呈现非连续日期。

State 增加可选 history：最多 11 个无嵌套快照（起点＋10 次操作）、游标、时间与操作摘要。保存由后端追加，撤销/重做通过 /api/history 带 revision 校验、备份、原子写入。撤销后新增修改截断后续分支，重启与同步后保留历史。旧数据首次读取可从最近十份有效备份构造历史，不修改读取文件及其 revision；首次保存后随主数据持久化。输入框中的快捷键保留原生文本撤销，页面级 ⌘/Ctrl+Z、⇧⌘Z / Ctrl+Y 用于已保存操作。编辑草稿未保存时不跨版本恢复。

验证：history_test.go 覆盖持久化、十步上限、分支、过期 revision、旧备份恢复；tests/v1-polish.cjs 覆盖五档色阶、日期项目联动、多选标记出现与消失、项目分行、历史与重载、批量预览。测试数据必须使用临时目录。

## V1 交互简化与自动保存

时间刷入口和刷写逻辑已删除，统一为统计区固定「多选/退出多选」及 Pointer Events 拖选，保留 Ctrl/⌘ 与 Shift。tests/brush.cjs 和 v1-polish.cjs 记录早期界面，当前界面使用 tests/v1-flow.cjs 回归。月度分项目恢复正方形，项目条目内部显示投入，隐藏日期底部汇总；节点含完成选项收进独立菜单。所有 details 支持外部点击收起。

projectSort 的 updated 存储值保留兼容，界面名称「最近记录」，比较 entries 每个项目最大 date，未记录的项目排后，不再按 Project.UpdatedAt 排序。

flushDrafts 串行保存记录弹窗、Inspector、总体笔记，输入停顿700ms启动，离开或关闭时立即等待。每种编辑器以编辑版本号保护保存响应到达期间的新输入，循环 flush 到最新内容。record 使用已载入的项目/日期上下文，切换选择控件时先保存旧上下文。无效值或 revision 冲突返回 false 保留窗口和草稿。Mac 关闭通过 WKWebView callAsyncJavaScript 等待 flush，Windows 用原生 WM_CLOSE 钩子和绑定回调等待同一流程；不修改 vendor。Mac 原生编辑菜单根据焦点区分文字撤销与记录历史。

当前验证：tests/v1-flow.cjs 覆盖停笔/切换/关闭自动保存、保存中继续输入、独立清除和撤销、同步冲突与无效输入阻止关闭、外部折叠、节点筛选层级、最近记录排序、方格分项目、固定多选、拖选/快捷键、批量确认和历史重载。

## V1.0.2 月历几何与节点备注

普通与空日期显式方格，split 非空按单行项目行增高，各日期 align-self:start；恢复普通按钮 absolute inset:0，避免网格 stretch 影响百分比高度。月历高度按主区域与底部操作区实测空间计算。stats 弹层标签与数值不换行，菜单用小尺寸 SVG 点，项目排序菜单移入 toolbar。Deadline 增加可选 note，JSON 旧数据默认空，节点弹窗、时间轴和悬浮详情均支持备注。外部折叠在 click 阶段依照 composedPath 判断，避免 pointerdown 改布局吞掉后续点击。已验证普通/空方格、五项目无内部滚动、备注持久化和完整操作回归。

## V1.0.3

monthHTML 为每周提供 --week-projects，split 单元格以相同 min-height、aspect-ratio 和 stretch 实现七天等高；非 split 使用独立旧 DDL 颜色与无圆点样式。图标由内置 imagegen 编辑为3×3，通过尺寸/格式转换生成 iconset、ICNS 和 ICO；使用本地 akavel/rsrc v0.10.2 更新 Windows .syso。tests/v1-flow.cjs 验证周行等高与两个模式的标记区别。

## V2.0 自动记录

`automation.go` 管理机器配置、元数据索引、设备草稿、跨设备聚合和增量确认。配置位于 UserConfigDir/ProjectJournal/<dataDir hash>，测试可传 `--auto-home` 或 JOURNAL_AUTOMATION_HOME。默认 disabled、activity=false。共享目录 `data/activity/<device id>.json` 每台机器独占写入；主 State.AutoReviewed 保存证据 stamp/累计秒数和决策时间，随主历史一起回滚。草稿编辑也会在设备文件中暂存。确认需主 revision 和证据 digest，避免吞掉同时到达的新活动；已有投入默认保留。

文件监听仅元数据，排除匹配相对于绑定根目录（不能因资料位于 /tmp 而全部忽略），最长路径绑定优先，不跟随扫描中的符号链接。baseline 跳过绑定以前的旧文件；显式历史扫描才使用创建和修改日期。源文件日期不是工时测量。文件证据的 index key 包含 projectId 和路径，重绑定不会误复用旧索引。

Mac `AutoObserver.swift` 用 FSEvents 延迟15秒批量通知，溢出/根变化/唤醒触发核对。可选 NSWorkspace/AX 通知与60秒容差15秒计时器；只有用户主动申请 AX 权限。关闭主窗口清除 script handler、释放 WKWebView/NSWindow，保留 NSStatusItem。NSWindow.isReleasedWhenClosed=false，防止 Swift 清理窗口时重复释放。退出先 flush JS 编辑、FSEvents 和待发 HTTP，再 flush 草稿；Go SIGTERM 与 kqueue NOTE_EXIT 宿主监视确保服务不会遗留。

Windows ReadDirectoryChangesW 使用 overlapped 内核等待和停止事件；前台使用 SetWinEventHook 加60秒 WM_TIMER、GetLastInputInfo。托盘主进程拥有采集服务，`--ui-only` 子进程拥有 WebView2，关窗退出子进程以释放渲染器。原生资料夹选择可以重复添加路径。Windows 仅完成交叉编译，仍需真机测试。

`web/auto.js` 提供从最早日期开始的待确认页、本机配置和编辑暂存；页面不可见或离开后停止刷新。`web/app.js` 的同步心跳仅可见窗口运行。默认采集没有重复扫描或采样计时器；草稿脏数据使用45秒一次性写盘计时器，干净时不重排。

测试：`automation_test.go`、`tests/v2-flow.cjs`，以及 `tests/v1-flow.cjs`。原生纯监听器支持 `--observer-test <临时根目录> <秒数>`，不触碰正式数据、权限或内容。见上级 V2验证记录.md。


## V2.0.1

`automation_identity.go` 处理平台无关的文件版本标识（project/date/relativePath/mtime 秒精度/size）、文件后缀规范化与时段并集。AutoEvidence.Spans 以 epoch 秒保存实际活动区间，同一条活动连续采样会合并；AutoMark.SourceKey/Spans 随主数据历史保存，处理另一台电脑晚到的重叠活动与同步文件。旧版缺乏时段的累计数据跨设备取较大值，不能伪造精确的历史时段。

后缀匹配发生在 Stat 之前，不读取正文或内容哈希。缺少 extensions 的旧配置默认使用常见文档后缀；保存后规范化到本机配置。相对路径相同的同步根请绑定到相同层级。

`/api/auto/status` 返回轻量的本机配置和有效状态，避免菜单打开时聚合全部草稿。配置未变时原生菜单刷新不重启 FSEvents。状态载荷使用 activityEnabled，避免与 /events 中 activity 对象冲突。原生回传失败显示具体错误，不能把配置 enabled 当作监听成功。

UI 改为右侧待确认入口，红色角标按 distinct date 计算；深绿概览、浅色草稿和步骤设置。附加的角标刷新复用可见窗口已有心跳，关窗没有新增轮询。测试见 automation_test.go、tests/v21-ui.cjs（3 条/2 天角标、后缀筛选、状态和对齐）、tests/v2-flow.cjs；Mac 原生开启与暂停已实测。


## 避免 Spotlight 出现重复应用

除根目录最新版外，旧版和测试版一律压缩为 ZIP，放入“归档/测试版本.noindex”，不要保留解包的 .app。移除前先校验压缩内容并取消 LaunchServices 登记，正式数据目录保持不变。2026-10-23 已清理八个旧版／测试版，仅登记根目录最新版。


## V2.0.2 项目组织

Project.Group 可选字符串、Settings.ProjectGroups 可选顺序列表。没有分组的旧数据按未分组展示；不改版本号、不迁移原记录。分组操作经 commit、主版本校验、备份和历史，删除组不删除项目。history 展示分组上下文。

web/projects.js 统一项目标签、分组、搜索、已完成折叠、原生 select 的可搜索替代控件；保留原 select 和 change/input 事件供表单与自动保存使用。搜索菜单固定在视口中，限制高度，支持 Escape 与键盘定位；滚动非菜单区域或点击外部折叠。自动记录的绑定路径必须按 .auto-binding-path 读取，不能用行内首个 input（现有搜索 input）。搜索不标记设置为脏。

项目列表、日历筛选、record/inspector/batch、auto 草稿和绑定选择都使用共用控件。紧凑月历仍仅显示项目名，title/tooltip 带组名；分项目 DDL 仅去掉伪元素圆点，保留红色线条。测试 project-groups.cjs 使用近40个项目验证搜索、折叠、分组管理、撤销、重载及各选择器；v1-flow 和 v2-flow 覆盖原有表单与自动记录回归。归档只保存 ZIP 到 .noindex，不能重新引入 Spotlight 重复 app。

分组标题在所有共用项目列表中支持折叠，状态保存在各列表实例中；搜索展示匹配分组，清空后恢复折叠。项目编辑改用应用内 editable combobox（自由输入、已有分组选择、键盘与外部点击关闭），移除原生 datalist。搜索框使用统一浅绿色，dialog 与菜单滚动条使用细暖绿色。

项目菜单内分组/已完成折叠仅改变现有节点的 hidden 与 aria-expanded，不重建按钮；菜单内 mousedown 保留焦点，避免滚动聚焦。关闭依据真实外部点击或 wheel/touchmove，不因布局/焦点触发的 scroll 关闭。project-groups 测试覆盖向上定位、反复点箭头、已完成开合及异步滚动后仍保持展开。

Settings.DistributionGroupYear/Month 为可选布尔指针，缺省分别 true/false。分布按钮通过 commit 保存对应视图设置，不依赖随机 localhost 端口的 localStorage；旧单一 distribution-by-group localStorage 忽略。项目菜单搜索按钮明确 width:auto，覆盖旧菜单 button 的 width:100%。

历史 retainedHistory 保留最近五分钟与最近十次操作的并集，额外保留首个可撤销操作的前驱快照，去掉 usableHistory 的 11 版本上限。只在追加历史时整理，不轮询。history_test 覆盖短时连续操作、过期后十条下限、恢复后分支重做语义。V1 浏览器回归改用标题“显示已完成”按钮；年度 DDL 独立 year-ddl-corner，月度竖线保持原样。

窗口对齐：macOS 红绿灯以 contentView 转换到原生按钮父视图后的 20 点 x 坐标为起点，保持原生间距；main 使用纵向 flex 和统一 20 点底部内边距，页面取消固定 viewport 最小高度，避免叠加外壳边距导致底部圆角超出视口。

标题栏视觉对齐：JournalTitleText 用 CoreText 实际字形墨迹边界居中绘制，视图中心与原生关闭按钮圆心重合；红绿灯坐标相对窗口 frameView 的固定顶部/左侧基准转换，启动、窗口激活和缩放时重算，避免 NSTextField 行框引入视觉偏移。

标题栏整体留白以红灯外缘为基准：左缘距窗口 20 点、上缘距窗口 20 点；圆心纵坐标再加半个按钮高度，标题实际字形中心随同圆心整体下移。不是把圆心到顶距离设为 20 点。

原生顶部整合为一行：窗口 fullSizeContentView，Web workspace-header 延伸至标题栏，在左侧为原生红绿灯和品牌保留 172 点；标题字形中心和 Web 32 点高顶栏均位于窗口 y=27 点。导航为 12 点系统字体、品牌为 17 点宋体。原生标题容器 hitTest 透传，避免盖住页面导航点击。

Markdown 笔记：web/markdown.js 只支持本地安全子集（三级标题、强调、引用、有序/无序列表、task），原文仍保存于旧 note 字段。文本全部先转义，不执行 HTML。MutationObserver 只在新增节点时增强 textarea，不轮询；编辑器仅有预览切换，无格式工具栏。Todo 的行号用于回写原文并触发原 input 自动保存；静态卡片禁用 checkbox。loadRecordForm/renderInspector/openDeadline 主动刷新预览，避免切换时显示旧项目内容。项目页管理动作移入 sidebar，3:7 两列。标题文字使用原生 performDrag，顶栏中部 blank strip 提供原生拖动区域，避让导航和右侧按钮。

## 兼容：旧版活动分段

AutoEvidence.Touches 是可选的按日文件观察点，旧日志继续可读，不把文件保存跨度当作前台计时。recentFiles 只维护配置的批量窗口（默认 30 秒），批量识别不扫描完整历史日志，沿用原有延迟落盘。AutoDraft 新增 confidence、rangeMin/rangeMax、sessions、bulkFiles；文件推测不写入 Seconds 或 Hours。再次发生文件变化时跳过 ReviewedAt 前的观察点，沿用 Tokens 和 AutoReviewed 管理确认与撤销。

automation_sessions_test.go 覆盖文件交替保存、断段、批量排除、旧数据、已确认前缀、双端同版本、前台空闲不补算、已有时长保护及元数据重载。auto-sessions.cjs 检查依据展示、活动分段和确认后人工时长保留。

规则存在本机 AutoConfig 的 fileGapMinutes、burstWindowSeconds、burstFiles。旧配置缺失字段时兼容默认值；待确认草稿按当前设置重新分类批量事件并生成建议，规则值参与 digest，避免接受旧规则下的草稿。


## 兼容：旧版活动段勾选与累加

AutoSession.Spans 提供真实可计区间；前台合组保留内部空闲，文件段使用观察跨度。AutoEdit/AutoReviewItem.selectedSessions 使用可空索引列表（nil 表示手动输入，空列表表示仅备注），绑定证据 digest；证据更新后清空旧索引选择，避免索引错位。后端根据当前草稿重新计算，并集减去此前计入区间，不信任前端 hours。

已计入区间作为 AutoReviewed 中的 timeline/<date>/<project> 台账项保存 countedSpans/countedProject/countedDate，不依赖证据来源 ID，因此延迟到达的其他来源也不会重复加时；随完整 State 历史撤销。AddTime 默认为前端开启，后端对 selectedSessions 强制累加语义（显式 ReplaceTime 优先）。旧客户端没有这两字段，仍保留已有时长。五档累加使用配置估算，未配置报错；每日总和超过 24 小时报错，操作不写入。

web/auto-timeline.js 和 automation_sessions.go 同时执行区间去重/扣除；tests/auto-timeline.cjs 覆盖勾选暂存、跨来源重叠、前台空闲、分钟累计、后续新来源重复扣除和窄屏。automation_sessions_test.go 对确认接口验证服务端重算和累加。


## 当前交互：单日拖拽时间线

`web/day-timeline.js` 负责每日总轴、只读活动区间/文件节点、15 分钟选择、Pointer Capture、边缘自动滚动、鼠标浮层、边缘键盘调整、项目分配及自动保存。`web/auto.js` 仅承接采集状态、设置和时间线生命周期；打开时 GET /api/auto/status + /api/auto/timeline，避免重复生成旧草稿。应用/文件的区间或节点是线索，不能勾选、不直接计时。当前页面的流程测试为 tests/day-timeline.cjs；旧 auto-sessions.cjs、auto-timeline.cjs、v2-flow.cjs 等脚本中的草稿卡片 UI 断言属于旧交互，仅对应保留的旧 API。后台兼容测试仍由 automation*_test.go 覆盖。

`State.TimelineDays[date]` 保存 blocks 与 applied。blocks 为用户当前选区（包括 projectId 为空的待分配），applied 为上次明确点击“计入项目”的已分配选区。PUT /api/auto/timeline 默认仅保存 blocks；apply:true 由服务端按项目计算新旧贡献差额，基于当前 Entry 增减，保留笔记与人工基础时长。重复 apply 幂等；改归属按两个项目的差额转移。任何同日选区不允许重叠，范围 0..1440 分钟且起止必须是 15 的倍数，一天最多 96 段。删除项目时同时清理其 blocks/applied，避免留下不可结算的贡献。

所有写入带 revision；前端另核对当天 baseline，外部改动同一日期时保留本地选区并拒绝覆盖。中途新调整在正在进行的保存完成后继续保存；失败保留选区并提供重试。退出、换页、换日调用 flush。主 State 快照天然覆盖选区和工时的撤销/重做，原有采集证据不消费、不删除。旧版本客户端不认识 timelineDays，不能用旧二进制覆盖新数据；发布须更新双平台。

GET /api/auto/timeline 返回全部已采集证据而非 pending-only，并标出设备名。文件批量识别按当前规则重算；文件关联间隔只绘制节点间细线，不自动填充选区。前台色带沿用实际 spans，空闲留白；窗口标题可读时可展示文件线索，未识别文件时只显示应用。连续文件节点在 15 分钟显示桶内汇总名称，完整时间和文件名保留在 title。

`automation_timeline_test.go` 覆盖待分配落盘、apply 幂等、差额调整/删除、项目间转移、人工时长保留、估算缺失、冲突/重叠/边界校验与历史恢复。`tests/day-timeline.cjs` 用隔离数据和真实鼠标验证拖拽、浮层、吸附、多段、重开、Esc、重叠拦截、键盘调整、计入/扣回、撤销、晚间坐标、失败重试与窄屏。


密集时间线布局：web/timeline-layout.js 的 activitySlots/fileSlots 以 15 分钟为显示桶，不改变原始 spans/touches 或用户选区。应用排序对同应用区间取并集，避免跨端重复观察抬高排名；每桶只绘制一张 34px 概览和一组文件标签，槽高 42px（SCALE=2.8），真实区间另以细轨显示。完整观察保留在 title，不引入线索选择交互。默认固定 480..1440，全天为 0..1440；右侧选区编辑栏 sticky，选择轨宽 75–102px。tests/timeline-layout.test.js 验证密集聚合与保留明细，tests/dense-timeline.cjs 用 150 段应用和 80 个文件节点检查标签矩形无交叠、编辑栏位置和窄屏溢出。


## 应用占比与紧凑存储

当前记录页把入口并入 workspace-nav 的第三个“记录”标签。精简 auto-overview 为单行标题/日期/采集状态/设置，隐藏重复的日期标题与说明；日期控件和保存状态留在轴工具栏。两栏固定相同可视高度，中间内容独立滚动，右栏和选区纯色，唯一装饰渐变在日期工具栏。项目选择器 _projectCaption 同步所有 data-picker-id 的 current 与 aria-current，修复菜单勾选停留旧项目。

activitySlots 对同应用旧 spans 取并集，再与新 bucket 秒数合计（单应用单格上限 900s）；对各应用活跃线索之和归一化百分比，用最大余数法保证总和 100。主要项最多两个，第二项需 >=20%，剩余合成其他，悬停按应用汇总分钟/占比。百分比是已观测应用内分布，并非工时，也不代表整个格子持续活跃。移除了旧原始区间轨、缩进和逐切换的 title。

AutoLog.AppUsage[date/hash(project,app)] 保存一次 date/projectId/app 与 slots[quarterUnix]=seconds；ingestActivity 继续用即时窗口信息匹配项目与空闲判断，但不归档窗口标题或逐次 spans。按季度边界和跨日边界切分，单格累计最多900秒。expandAutoUsage 只在内存读取时展开成兼容 BucketStart AutoEvidence，绝不把展开对象写回本机日志。旧 Evidence 保留兼容，不自动改写或删除旧线索。测试验证14次不同标题只产生一个应用汇总记录，边界切分与旧确认/撤销兼容。

fileSlots 每格再按 project/path 分组，同文件多次修改只保留一个显示项；多文件显示文件数/记录数，title 按文件累计次数和首末时间（最多12项+余量提示），避免大批记录产生超长逐事件列表。每格标签定高且不交叠。

记录页展示更新：前台活动每 15 分钟用横向分段时长条展示，整条刻度为 15 分钟，留白表示未观测的活跃时间；主要应用名称与分钟数并排，其他应用合并，浅色悬浮卡片列出全部应用汇总。文件修改每格只绘制一个节点，按物理文件去重并保留修改次数，详情最多展示六个文件并标注剩余数量。右侧项目汇总移入固定计入底栏，与可编辑选区分离；时间轴选区支持直接取消。桌面面板根据实际顶部位置计算可用高度。密集浏览器用例覆盖四小时内 1200 条文件修改、窗口缩放、汇总悬浮和取消选区。

记录页去重：应用图例每小时仅标注一次，15 分钟时长条仍逐格保留并提供悬浮明细。相邻时间格的物理文件集合一致时合并为连续文件记录，保留全部次数与首末修改时间；不跨空档或不同路径合并。右侧选区压成两行；项目总计每项目一行，仅展示名称、当前增减与当日总计，已有时长及时间线贡献移入详情。单元测试覆盖合并边界、路径区分及次数保留，浏览器检查汇总行高、选区高度和桌面/窄窗布局。

按项目的时间带：右栏以项目卡合并选区和总计，00–24 或08–24的同一比例尺下显示该项目所有时间段。点击分段与左轴同步高亮并滚动定位，仅展开当前时间段编辑器。计入前后的“其他已记”来自当前记录减去已应用的时间线贡献，新增选区不重复计入已有记录；当日总计也包含当天无时间线的项目。应用改为固定列的连续轨道，空档断开、连续段名称仅一次；各格深浅表示观测量。文件名首次出现时标注一次，随后以编号节点追踪同一物理文件。导航箭头使用居中的 SVG 路径。

时长视图：应用用阶梯堆叠面积表示每格的实际观测秒数，15分钟对应全宽，未观测部分留空，历史重叠证据以共同分母限制总宽。应用连续段只标一次名称。文件按绑定项目分轨，项目名固定在滚动区域顶部；主节点仅显示文件数和修改次数，文件名及原始首末时间保留在悬浮详情。缩放按钮调整可见1–16小时，全天模式1–24小时；缩小视图时聚合临近文件节点并保持原始修改计数。网格、选区坐标及拖拽均使用动态比例尺。其他已记用灰色，时间线保留绿色。截止节点备注的模式切换按钮移到独立标题行。记录角标仍为包含未分配选区的日期数。

紧凑线索样式：文件项目轨道最大间隔52px，并随项目数量收紧；项目名按三层错位固定，节点与竖线共用中心坐标。主节点使用文件、修改图标和数字，窄轨道进一步压缩。应用标签直接叠在色块上，悬浮时整个应用连续形状增加白色描边和柔光。合计改为三个对齐的标签/数值列与数学符号，单位缩小、数字突出，去除重复说明。密集测试覆盖六个项目、窄窗口、节点中心、标题不重叠、透明标签背景和悬浮高亮。

窗口拖动修复：原生透明拖动层改为覆盖顶部58px并始终放在AppKit标题栏容器上方；命中测试避开原生红绿灯/标题区及页面上报的导航、操作按钮区域。HTML用ResizeObserver上报实际按钮位置，缩放与页面布局变化后同步更新，避免固定坐标失效或遮住交互控件。拖动层保留窗口边缘以支持调整尺寸。

文件轨道标题锚点：轨道从该项目的首个更新处开始，标题首先附着在首节点上，滚过后才吸附到视口；不在尚未出现更新的时间段提前显示。轨道宽度上限随项目数从180px逐步收紧，标题长度与错层行数共同适配项目数量。
