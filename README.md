<p align="center"><img src="src/web/app-icon.png" width="96" alt="项目手记图标"></p>
<h1 align="center">项目手记 · Project Journal</h1>
<p align="center">把每天的推进，连成项目的来路。</p>
<p align="center">本地优先的项目笔记、时间记录与工作回顾工具，支持 macOS 和 Windows。</p>
<p align="center"><a href="https://github.com/TianyiSongZJU/project-journal/releases/latest">下载应用</a> · <a href="#五分钟开始">快速开始</a> · <a href="docs/user-guide.md">使用指南</a> · <a href="README.en.md">English</a></p>

![年度回顾：全年投入热力图、项目时间分布与当天进展](docs/images/year-review.png)

你可能同时做研究、读文献、写报告、维护工具。忙了一天后，真正难回答的往往是：**今天推进了什么？这一段时间花在了哪个项目上？**

项目手记把项目笔记、每日记录、截止节点和工作线索放在一起。可以随手记录，也可以回看前台活动与文件变化，确认后补记时间，再从月度、年度视角看长期投入。

目前是个人维护的早期桌面项目，界面以中文为主。无需注册账号；项目本身不提供云服务。

## 能做什么

| 场景 | 功能 |
| --- | --- |
| 留下项目上下文 | 项目分组、总体笔记、每日备注、Markdown 预览、已完成项目归档 |
| 补记时间 | 在时间线上按 15 分钟选择区间、指定项目，核对后计入；也可直接填写其他已记时间 |
| 回忆工作过程 | 可选收集前台活动与绑定资料夹的文件变化，在同一时间线上对照查看 |
| 减少漏记 | 根据已有线索给出建议区间，展示依据与设备来源，由你检查和确认 |
| 看长期进展 | 年/月热力图、项目及分组时间分布、小时/天切换（年视图） |
| 记住关键日期 | 项目截止节点、当天节点提示、待完成数量与热力图标记 |
| 保留自己的数据 | 本地 JSON、按项目/月拆分、历史恢复、同步副本提示、资料夹重新定位 |
| 接着上次的位置工作 | 恢复页面、日期、分组、折叠等显示偏好；Mac 支持菜单栏与后台启动 |

**活动线索不等于工作时长。** 软件无法准确判断你是否正在思考、开会或处理某个项目。建议供回忆和补记使用，确认前不会自动成为正式工时；多设备归属冲突需要人工判断。

## 看看实际界面

以下截图均来自可复现的**虚构示例数据**，不是实际用户的笔记或活动日志。展示的是桌面应用内容区，原生窗口标题栏未包含在截图中。

### 从月度回顾进入一天

按天查看项目投入，切换右侧的当日记录与总体笔记；当天截止节点和所有项目总时间也在这里。

![月度回顾与每日记录](docs/images/month-review.png)

### 项目里保留思路、节点与记录

把目标、问题、下一步和每天的进展写在同一个项目中。资料夹可以单独绑定，移动或改名后重新定位。

![项目总体笔记、截止节点与每日记录](docs/images/project-notes.png)

### 对照线索，确认时间

左侧看应用活动，中间看项目资料的文件变化，右侧选择工作区间；项目合计和其他已记时间独立展示。

![每日时间线：前台活动、文件修改和项目时间段](docs/images/day-timeline.png)

悬浮建议可以查看它覆盖的时间、观测到的活动、文件线索和设备来源。点击“＋”后仍可调整，最后再计入项目。

![建议区间的依据详情](docs/images/clue-details.png)

## 下载与安装

从 [Releases](https://github.com/TianyiSongZJU/project-journal/releases/latest) 下载对应平台的 **ZIP 发布包**，而不是页面自动生成的 Source code。

| 系统 | 下载文件 | 要求 |
| --- | --- | --- |
| macOS | `project-journal-macos-universal.zip` | macOS 13+；Apple Silicon / Intel 通用 |
| Windows | `project-journal-windows-x64.zip` | Windows x64；需要 Microsoft WebView2 Runtime |

**macOS：** 解压后，把整个文件夹放到长期使用且可以写入的位置，再打开其中的 `项目手记.app`。应用默认使用同级 `data/`，所以移动时应一起保留数据。当前发行包使用临时签名，尚未经过 Apple 公证；如果系统拦截，请核对下载来源后，通过系统设置中的“隐私与安全性”按提示允许打开。不要直接从压缩包或只读磁盘运行。

**Windows：** 完整解压到可写文件夹，双击 `项目手记-Windows.exe`。如果提示缺少 WebView2，请从 [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/) 安装 Runtime。当前程序没有付费代码签名，系统可能显示未知发布者提示。发布包中的 `licenses/` 需要保留。

发布包不包含任何个人数据，首次运行从空白项目开始。Mac 构建已在本机完成签名验证；Windows 版本为交叉构建，仍欢迎反馈实际设备兼容问题。

## 五分钟开始

1. 打开“项目”，新建一个项目，选一个分组与颜色。可以先写下目标和下一步。
2. 点击“记一笔”，记录今天推进了什么、花了多久。只写备注也可以。
3. 想回看工作线索时，在“记录 → 记录设置”中按需开启前台活动，或为项目绑定资料夹；不开启也能正常记笔记和时长。
4. 在“记录”中对照线索拖选时间，分配项目；建议区间可以先采纳再修改。核对后点击“计入项目”。
5. 回到“回顾”，查看月度、年度投入与截止节点。

Mac 上关闭前台窗口后可以继续后台记录；完全退出会停止后台记录。显示偏好会在重新打开时恢复。希望登录后只启动后台，可在源码目录运行 `./scripts/install-macos-autostart.sh`（应用构建完成后执行）；这不是使用软件的必需步骤。

### 权限与采集范围

- **前台活动可选开启。** 获取窗口标题等信息取决于系统权限；Mac 可能需要辅助功能授权。没有足够权限时，部分详细线索不可用。
- **文件观察针对你绑定的资料夹。** 当前采集流程记录文件名、路径、时间和变化等元数据，不读取文档正文；文件日期本身不用于直接测量工时。
- **不做屏幕截图或键盘内容记录。** 闲置超过设置阈值后，会回溯扣除对应的无操作时间；电脑使用与实际工作仍可能有偏差。
- **本地数据未加密。** 活动标题、路径和笔记可能含私人信息，分享截图和日志前请先处理。详情见 [数据与隐私](docs/privacy.md)。

## 数据保存与跨设备同步

新安装通常会形成以下结构，`data/` 在第一次运行时创建：

```text
project-journal/
├── 项目手记.app 或 项目手记-Windows.exe
├── data/                    项目数据；跨设备同步这个完整文件夹
│   ├── .english-layout      目录布局标记，需要保留
│   ├── 项目手记.json         项目、设置与索引
│   ├── notes/               按项目保存笔记
│   ├── time/                按月保存每日时长和时间段
│   ├── activity/            按设备、月份保存活动与文件线索
│   ├── history-content/     历史版本内容
│   └── backups/             备份与同步副本
└── licenses/                Windows 发布包附带的许可说明
```

Mac 的许可说明位于应用包内部。旧版数据的目录和索引可能不同，软件保留兼容逻辑，不要手工批量改名。

**Mac 与 Windows 之间，同步完整 `data/` 就能共享项目记录与已保存的线索，不要只同步主 JSON。** 用自己的同步工具传输；应用没有内置网盘或同步服务器。资料文件本身不在其中，需自行保存或同步，并在每台设备上分别绑定本机资料夹。

本机界面偏好、资料夹绝对路径、采集设置等不应跨平台覆盖。Mac 通常保存在同级 `local/macos/`；其他配置位置取决于系统与启动方式，可在“记录设置”中查看本机情况。

**推荐同步顺序：** 在设备 A 保存完成 → 等同步工具上传完成 → 在设备 B 等待下载完成，再编辑。版本校验、同步副本提示与多设备线索合并提供保护，但不代表任意网盘都能实时无冲突协作。保留独立备份；看到冲突提示时先核对，不要直接用某个版本覆盖另一个。

更新应用时保留原来的 `data/` 和本机设置，只替换应用文件并保留新包中的许可说明。不要用示例数据覆盖自己的数据目录。

## 想先试试示例？

仓库包含 [虚构演示数据](examples/demo.json) 和一个**拒绝覆盖已有目录**的生成器。开发者可以在全新的目录运行隔离演示：

```sh
python3 scripts/make-demo.py --output /tmp/project-journal-demo
cd src
go run . --ui-only --no-open --data-dir /tmp/project-journal-demo/data --auto-home /tmp/project-journal-demo/local
```

从终端输出的会话地址打开界面，切换到 **2026-10-28** 查看示例时间线。采集关闭、资料夹绑定为空。生成器不会合并或修改你已有的数据。截图复现方式见 [开发说明](docs/development.md)。

## 从源码构建

需要 Go 1.24 或兼容版本。Mac 原生窗口还需要 Xcode Command Line Tools。Go 依赖随源码保存在 `src/vendor`。

```sh
git clone https://github.com/TianyiSongZJU/project-journal.git
cd project-journal
./scripts/build-macos.sh       # 在 Mac 上构建
# 或：./scripts/build-windows.sh
```

构建、测试、截图与许可打包详见 [开发说明](docs/development.md)。仓库的 `data/`、`local/` 和生成的应用被 Git 忽略，不应通过提交个人数据来同步记录。

## 反馈与参与

欢迎在 [Issues](https://github.com/TianyiSongZJU/project-journal/issues) 报告问题或分享使用场景。请附系统与版本、操作步骤、预期和实际结果；不要上传私人 `data/`。参与贡献请看 [CONTRIBUTING](CONTRIBUTING.md)，涉及隐私或安全的问题请看 [SECURITY](SECURITY.md)。

- [详细使用指南](docs/user-guide.md)
- [数据与隐私](docs/privacy.md)
- [开发与构建](docs/development.md)
- [显示偏好的保存方式](docs/ui-preferences.md)

## 开源许可

项目代码以 [MIT License](LICENSE) 开源，第三方组件保留各自许可，见 [Third-party notices](THIRD_PARTY_NOTICES.md)。应用图标由生成工具辅助制作，生成与编辑记录见 [图标设计说明](assets/icons/设计说明.md)。
