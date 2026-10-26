# 项目手记

本地优先的项目笔记与时间记录工具，支持 macOS 和 Windows。把项目笔记、截止节点、每日投入、活动线索和时间线放在一起，方便回顾工作的进展。

## 功能

- 项目与分组、Markdown 笔记、截止节点、年度和月度热力图。
- 分开记录其他已记时间与时间线时间，避免重复计入。
- 轻量收集前台活动和文件修改，按 15 分钟提供可人工确认的区间建议。
- 按项目与月份保存数据，带版本校验、历史恢复与同步冲突保护。
- 项目资料夹独立配置检测类型，支持重新定位并延续历史线索。

## 目录

```text
项目手记/
├── src/                 Go 服务、原生窗口、界面与测试
├── assets/              应用图标与打包配置
├── scripts/             构建脚本
├── docs/                使用和开发说明
├── data/                个人数据与历史备份（Git 忽略）
├── local/               本机设置（Git 忽略）
├── 项目手记.app          构建后的 macOS 应用（Git 忽略）
└── 项目手记-Windows.exe  构建后的 Windows 应用（Git 忽略）
```

## 构建与验证

需要 Go 1.24 或兼容版本。macOS 原生窗口还需要 Xcode Command Line Tools。Go 第三方依赖保存在 `src/vendor`，支持离线构建。

```sh
./scripts/build-macos.sh
./scripts/build-windows.sh
cd src
go test -race ./...
node --test tests/model.test.js tests/palette.test.js tests/timeline-layout.test.js tests/time-suggestions.test.js
```

macOS 脚本生成 Intel 与 Apple Silicon 通用应用，Windows 脚本生成 x64 程序。应用放在仓库根目录，默认使用旁边的 `data`。也可直接运行后端并通过 `--data-dir` 指定数据位置。

## 数据与同步

`data/项目手记.json` 保存项目、设置和分文件索引，`notes/` 按项目保存笔记，`time/` 按月份保存时长与时间段，`activity/` 按设备和月份保存前台活动及文件修改。`history-content/` 和 `backups/` 保留撤销及恢复所需内容。

同步时保留整个 `data` 的结构及 `.english-layout`；不要只同步主 JSON。旧历史索引中的中文逻辑路径继续兼容，不会改写原始历史内容。`local` 是本机资料夹绑定等配置，不应在不同设备间直接覆盖。自动建议汇总已有设备线索，但冲突仍需人工确认。

个人数据、本机设置和编译产物均已被 Git 忽略。发布前可用 `git status --ignored` 复核；此目录尚未上传 GitHub。

使用说明见 [docs/user-guide.md](docs/user-guide.md)。开发历史见 [docs/development-history.md](docs/development-history.md)。
