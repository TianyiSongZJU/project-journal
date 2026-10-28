# 开发与构建

需要 Go 1.24 或兼容版本；macOS 应用还需要 macOS 13+、Xcode Command Line Tools。自动化界面测试需要 Node.js 与 Playwright 浏览器。运行时 Go 依赖已保存在 src/vendor，构建不需要联网下载它们。

```sh
./scripts/build-macos.sh       # 在 Mac 上构建 Intel + Apple Silicon 通用应用
./scripts/build-windows.sh     # 在有 POSIX shell 的环境中交叉构建 Windows x64
cd src
go test ./...
node --test tests/*.test.js
```

可用 JOURNAL_GO 指定 Go 可执行文件。Windows 资源文件已提交；只有修改图标或 manifest 时才需要在 PowerShell 中运行 scripts/build-windows-resources.ps1（需要 rsrc）。

## 隔离演示

```sh
python3 scripts/make-demo.py --output /tmp/project-journal-demo
cd src
go run . --ui-only --no-open --data-dir /tmp/project-journal-demo/data --auto-home /tmp/project-journal-demo/local
```

从终端的会话地址打开界面。演示以 2026-10-28 为参考日；需要时在界面切到该日期。生成器拒绝覆盖任何已存在的输出目录；资料夹绑定为空、采集关闭。不要将此示例合并到自己的 data 文件夹。

生成 README 截图：先编译一个独立后端，再安装测试用 Playwright：

```sh
cd src
go build -o /tmp/project-journal-demo-core .
cd ..
npm install --prefix /tmp/project-journal-browser playwright
/tmp/project-journal-browser/node_modules/.bin/playwright install chromium
JOURNAL_CORE=/tmp/project-journal-demo-core JOURNAL_PLAYWRIGHT=/tmp/project-journal-browser/node_modules/playwright node scripts/screenshots.cjs
```

截图脚本自行创建临时演示目录、启动独立后端并在结束后清理，只向 docs/images 写入图片；不会连接现有应用。

## 分发许可

构建脚本通过 scripts/copy-release-licenses.sh 收集项目、第三方与 Go 工具链许可。Mac 应用内含 Resources/licenses；Windows 的 build/windows/licenses 必须和 exe 一起打包。不要删掉这些声明。

## 代码布局

- src/*.go：数据、同步保护、活动与文件线索、HTTP 服务及 Windows 窗口。
- src/macos.swift、src/AutoObserver.swift：Mac 原生窗口、状态栏与后台观察。
- src/web/：共享页面、时间线与平台样式。
- src/tests/：界面、模型与原生交互验证。历史流程脚本中部分覆盖旧交互，运行时请参照当前功能选择。
- examples/demo.json：纯虚构演示状态，不含实际文件绑定。

发布前运行 Go/JavaScript 测试，并分别构建两平台发布包。macOS 包使用临时签名，尚未经过 Apple 公证；Windows 包尚无代码签名。Windows 运行与原生权限行为仍需实际设备验证。
