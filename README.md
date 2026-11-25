# 臻一自媒体运营工作台

在本机管理创作灵感、稿件版本、公众号与抖音交付，以及发布读数。

- **运营概览** · 查看作品读数、近期表现、灵感转化和下一篇试验。
- **灵感池** · 记录手记或用本机 Codex 生成候选，再从灵感建作品。
- **作品台** · 写初稿、按修改意见迭代、手动编辑和确认定稿，再生成平台交付。
- **发布与数据** · 预览平台素材、查看本地文件、核验发布状态并记录可见读数。作者在平台手动发布。

## 启动

使用 Node.js 25.9 或更新版本。使用创作和生图功能时，先安装并登录 Codex CLI，确保终端可以运行 `codex`。

```sh
git clone https://github.com/JokerMok/zhenyi-media-workbench.git
cd zhenyi-media-workbench
node workbench/本机服务.mjs
```

打开[本机工作台](http://127.0.0.1:5628/)。macOS 也可双击 `workbench/启动编辑台.command`。首次启动使用空白档案和示例选题。

## 平台交付

生成平台交付和打开完整公众号排版工作区需要本机的风格排版源码与依赖。已有检出可把 `ZHENYI_FORMATTER_SOURCE` 指向该目录。新的检出可在工作台仓库根目录执行以下命令，再从同一终端启动工作台。

```sh
git clone --branch codex/product-readiness https://github.com/JokerMok/wechat_article_formatter_app.git ../wechat_article_formatter_app
git -C ../wechat_article_formatter_app checkout --detach 1fee8012339ebd7bd31decadbbaef20aadc7b48a
npm --prefix ../wechat_article_formatter_app ci
export ZHENYI_FORMATTER_SOURCE="$PWD/../wechat_article_formatter_app"
node workbench/本机服务.mjs
```

定稿后点击「生成平台交付」。公众号支持编辑排版、预览，以及分开复制标题和正文图文。抖音支持预览发布文案和逐张查看图集。macOS 上，点击「发布与数据」中的「查看本地文件」，Finder 会打开当前交付版本的抖音图集或公众号文件夹。公众号封面尺寸转换与文字核对也使用 macOS 工具。

## 本地配置

- 自定义选题与档案时，将 `workbench/round-state.example.js` 和 `workbench/档案索引.example.js` 分别复制为同目录的 `round-state.js` 和 `档案索引.js`。保留变量声明，编辑 JSON 后重启。档案作品可在 `cover` 字段填写 `local/cover.webp` 等相对路径。
- macOS 上使用自动核验时，将 `account.example.json` 复制为 `account.json`，填写公众号名称 `brand` 和抖音号 `account_id`。自动核验读取当前已登录的 Chrome 普通窗口，需允许工作台使用 macOS 自动化和辅助功能。
- 本地作品、读数、交付文件、账号配置和素材目录已加入 Git 忽略规则。工作台内点击「生成 3 条灵感」可手动出题，也可用 `node workbench/灵感批次.mjs --plan` 查看当天方向。
