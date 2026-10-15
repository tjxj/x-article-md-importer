# Markdown → X Articles

一个自用开源 Chrome 扩展，帮助把 Markdown 文章搬到 X Articles：转换正文排版，并通过 X 编辑器插入封面、图片、原生代码块和原生表格。

适合在 Obsidian、Typora、VS Code 等工具里写文章的人。源码采用 MIT 协议，Markdown 解析基于 [markdown-it](https://github.com/markdown-it/markdown-it)。

> **当前版本 `0.1.4`。** 插件更新后会先检查页面连接；代码、图片或表格窗口偶发未打开时会自动重试；图片后的正文位置会等待稳定；结束前会逐段核对正文。面板会显示正在运行的版本。自动导入仍可能受 X 页面结构影响；测试范围见 [TESTING.md](docs/TESTING.md)。

[下载安装包](https://github.com/tjxj/x-article-md-importer/releases) · [已发布文章示例](https://x.com/Changbeihai/status/2109304805965369575) · [反馈问题](https://github.com/tjxj/x-article-md-importer/issues)

## 能处理什么

| Markdown 内容 | 处理方式 |
| --- | --- |
| 文件开头的 frontmatter | 从正文移除；读取简单的单行 `title:` 字段 |
| 文章标题 | 优先使用有效 `title:`，然后是正文前的第一个 H1，最后使用文件名 |
| 章节标题 | 按相对层次映射为 X 支持的 Heading / Subheading 两级标题 |
| 粗体、斜体、链接、普通列表 | 转为富文本；最终样式由 X 编辑器决定 |
| 反引号包裹的完整网址 | 转为可点击链接 |
| 正文前的第一张独立图片 | 作为封面，使用 X 的默认裁剪位置 |
| 正文图片，包括与文字同段的图片 | 按原文顺序拆开，下载或读取已选择的本地文件，再上传到 X |
| 顶层代码块 | 使用 X 原生 Code 区块，尝试匹配代码语言 |
| 顶层 Markdown 表格 | 使用 X 原生 Table 区块，保留单元格内容 |

标题会移除文件名开头的 `YYYY-MM-DD-` 日期前缀。`title: .md` 这样的无效标题会被忽略。超过 100 个字符的标题会截短，请在预览时检查。

### X 的 Insert 菜单覆盖情况

| Insert 项目 | 当前自动导入 |
| --- | --- |
| Media | 支持封面和正文图片；正文 GIF 文件也从 Media 上传。视频尚未支持。 |
| GIF | X 自带的 GIF 搜索与选取尚未支持；Markdown 引用的 GIF 文件按上面的 Media 处理。 |
| Posts | 尚未生成 X 原生帖子卡片，帖子网址会保留为普通链接。 |
| Link preview | 尚未生成预览卡片，Markdown 链接会保留为可点击文字。 |
| Divider | 尚未保证生成 X 原生分隔线。 |
| Code | 支持顶层代码块。 |
| LaTeX | 尚未生成 X 原生公式。 |
| Table | 支持顶层表格。 |

这些项目并不都有明确对应的 Markdown 写法。导入器只自动处理上表注明支持的内容，不会把普通网址擅自改成预览卡片。

## 安装：无需运行代码

1. 打开 [Releases](https://github.com/tjxj/x-article-md-importer/releases)，下载附件 `x-article-md-importer-*.zip` 并解压。
2. 在 Chrome 地址栏输入 `chrome://extensions`，打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择**直接包含 `manifest.json` 的文件夹**。
4. 打开或刷新 [X Articles](https://x.com/compose/articles)。右下角应出现「导入 MD」按钮。

安装包内包含构建好的浏览器脚本，不需要 Node.js，也不需要注册额外服务。扩展仍需要你自己的 X 登录状态及 Articles 发布权限。

### 更新已安装的版本

替换原文件夹中的插件文件，在 Chrome 扩展管理页找到本插件并点击刷新图标，然后刷新 X 页面。重新选择 MD 后，面板标题下方应显示「版本 0.1.4」；未显示这个版本时，浏览器仍在运行旧插件。

## 使用

1. 进入 X Articles 列表或普通草稿编辑页。自动导入需要页面上的新建草稿按钮；请先退出 Focus mode。
2. 点击右下角「导入 MD」，选择一篇 `.md` 文章。面板会显示解析后的标题及图片、代码、表格数量。
3. 如果文章使用本地图片，点「选择本地图片」，把对应图片文件选入。
4. 点击「新建并自动导入草稿」。插件会准备图片、创建空白草稿，并按原文顺序填入内容。导入期间请等待进度完成，避免同时编辑同一草稿。
5. 点击「预览草稿」，检查标题、封面裁剪、图片位置、代码和表格，然后使用 X 自己的 **Publish** 按钮发布。

插件会创建新草稿。中途停止或失败时，已生成的草稿会保留，面板会标明失败的步骤；再次点击自动导入会再建一份草稿。插件没有自动发布或删除草稿功能。图片格式或大小不合适时，会在创建草稿前提示。

可先使用 [examples/demo.md](examples/demo.md) 测试排版。

### 手动续传

展开面板中的「分段复制与手动续传」：

- **正文富文本**：点复制，在 X 正文编辑区粘贴，macOS 用 `⌘V`，Windows 用 `Ctrl+V`。
- **代码块**：复制代码，在 X 的 `Insert → Code` 中粘贴。
- **表格**：复制 Markdown 表格，在 X 的 `Insert → Table` 中建表，再点表格编辑图标粘贴。
- **图片**：保存原图，在 X 的 `Insert → Media` 中上传。

「复制全文富文本」适合快速准备整篇正文。这个模式会用占位符标出图片、代码和表格，需要继续补入这些区块。

## 图片与权限

当前自动下载仅允许作者自己的两个图床域名：

- `https://r2blog.zhanglearning.com/*`
- `https://r2.zhanglearning.com/*`

其他域名的图片可以先下载到电脑，再通过「选择本地图片」提供。插件会按文件名匹配；请保留原文件名，并避免同名图片。每篇文章涉及的本地图片都需要手动选择，插件不会扫描整个磁盘或 Obsidian 仓库。

如果你维护自己的版本，需要同时修改 `manifest.json` 中的 `host_permissions` 和 `src/background.js` 中的 `IMAGE_HOSTS` 来允许其他 HTTPS 图床，然后重新加载扩展。

| 权限或数据 | 用途 |
| --- | --- |
| 在 `x.com` 运行内容脚本 | 显示导入面板，操作 Articles 编辑器的现有控件 |
| `clipboardWrite` / `clipboardRead` | 复制富文本；自动导入时，若页面内粘贴未生效，则写入剪贴板并执行一次真实粘贴 |
| 两个图床的访问权限 | 读取文章引用的图片；请求不携带登录凭据 |
| 用户选中的 MD 和图片 | 本地解析；点击自动导入后，内容会作为草稿上传到 X |

项目不读取 Cookie 或密码，不接入统计服务，也没有自建上传服务器。扩展申请的剪贴板权限用于复制内容及自动粘贴失败时的降级操作。正文图片支持 PNG、JPEG、WebP、GIF；封面支持 PNG、JPEG、WebP。单张图片上限为 20 MB，X 仍可能执行自己的限制。

## 已知限制与排错

- **更新扩展后请在 Chrome 扩展管理页刷新本插件，再刷新 X 页面。** 只替换安装包文件时，已打开的页面仍可能使用旧脚本。
- **自动导入尚未完成新版端到端实机验收。** 当前版本依赖 X 页面控件和 Draft.js 编辑器，X 改版或其他扩展改写页面可能导致中断。
- **找不到「导入 MD」**：确认加载的是含 `manifest.json` 的文件夹、插件已启用并获准在 `x.com` 运行；刷新扩展卡片后再刷新网页。如扩展卡片显示「错误」，反馈错误文字。
- **图片不支持自动下载**：检查图床域名，或选择下载到本地的同名图片。
- **找不到 Insert、Code、Table 等控件**：确认在普通 Articles 编辑模式；可暂时关闭作用于 X 的翻译或页面改写扩展，再重新加载页面。
- **导入中断**：保留当前草稿并检查面板错误，使用分段复制补齐。重复运行自动导入会新建草稿。
- **提示正文缺失**：不要发布该草稿。插件已发现 X 丢掉了某一段，会标出缺失步骤；可使用分段复制补回，或刷新页面后重新导入。
- 自动上传支持普通 Markdown 图片独立成段或与正文文字混排。Obsidian `![[附件]]` 尚未适配；列表或引用内的图片会在创建草稿前明确报错，请先把图片改成独立正文段落。
- 不支持完整 YAML 解析、Obsidian 双链、脚注、公式、嵌入视频或推文卡片；原始 HTML 会作为文字转义。
- 行内代码的等宽样式可能被 X 丢弃。代码语言未匹配到时会保留代码内容。
- 图片替代文字不会自动写入 X 的图片说明，发布前请按需要补充。

提交 Issue 时，请附上浏览器版本、X 界面语言、失败步骤和一个最小 Markdown 示例。不要附带账号凭据或私人草稿。

## 本地开发

需要 Node.js 20 或更新版本。

```sh
git clone https://github.com/tjxj/x-article-md-importer.git
cd x-article-md-importer
npm ci
npm test
npm run build
npm run package
```

安装包输出到 `out/`。本仓库提交了 `dist/content.js`，修改源码后请重新构建。CI 会检查测试和构建产物是否同步。

也可以只转换文件，生成包含标题、封面和正文步骤的 JSON：

```sh
npm run bundle -- ./examples/demo.md ./out/demo.json
```

### 代码结构

```text
manifest.json             Chrome 扩展配置
src/core.js               Markdown 解析、标题提取、格式适配
src/content.js            导入面板和复制功能
src/x-adapter.js          X 编辑器的自动操作流程
src/background.js         受限域名的图片下载
src/panel.css              导入面板样式
scripts/package.mjs        生成可安装 ZIP
test/                     转换与安装包检查
docs/TESTING.md            验证范围和当前状态
```

## 协议

[MIT License](LICENSE)。第三方依赖的版权声明见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。项目与 X 无隶属关系。
