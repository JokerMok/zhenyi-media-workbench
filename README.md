# 臻一自媒体运营工作台

在本机管理创作灵感、待审提纲、作品版本和发布读数。作品台可把确认素材交给本机 Codex，创作时一并带上有作品读数依据的复盘建议。

- **运营概览** · 查看四项运营指标、分平台近期作品、灵感转化和下一篇试验。
- **灵感池** · 记下想法，筛选待建或已建的灵感，再转为作品。
- **作品台** · 打磨标题与切入角度，提交或修改待审提纲，查看稿件版本与发布详情。
- **发布监测** · 打开平台后台，逐篇记录发布证据与可见读数。发布由作者在平台操作。

## 启动

使用 Node.js 25.9 或更新版本。需在工作台中生成提纲时，先安装并登录 Codex CLI，并确保终端可以运行 `codex`。

```sh
git clone https://github.com/JokerMok/zhenyi-media-workbench.git
cd zhenyi-media-workbench
node workbench/本机服务.mjs
```

打开[本机工作台](http://127.0.0.1:5628/)。macOS 也可双击 `workbench/启动编辑台.command`。服务监听本机地址，录入的灵感、作品、读数和提纲保存在本地。

## 使用

1. 在灵感池添加一条灵感，点击「新建作品」。
2. 在作品台补充已确认的素材，再点击「交给 Codex 整理提纲」。Codex CLI 使用已登录的模型处理本次提交。
3. 发布后在「发布与数据」记录实际读数，回到首页查看作品表现。后续创作可在「随创作提交的复盘建议」核对上下文，作者指令优先。

## 本地配置

首次启动使用空白档案和一条示例选题。需要自定义时，将 `workbench/round-state.example.js` 复制为 `workbench/round-state.js`，将 `workbench/档案索引.example.js` 复制为 `workbench/档案索引.js`。保留文件的变量声明，编辑其中的 JSON 数据后重启。

档案中的每条作品包含 `id`、`title`、`originalTitle`、`group`、`versions` 数组和 `history`。在 `history` 中为 `douyin` 与 `wechat` 各保留一个数组。封面可放在 `workbench/local/`，并在对应作品的 `cover` 字段填写 `local/cover.webp` 这样的相对路径。

每日灵感可用 `node workbench/灵感批次.mjs --plan` 查看当天方向，用 `node workbench/灵感批次.mjs --save < ideas.json` 保存。JSON 包含北京时间当天的 `day`（`YYYY-MM-DD`）和三条 `ideas`，每条提供 `title` 和 `note`。本地资料目录和运行记录已加入 Git 忽略规则。
