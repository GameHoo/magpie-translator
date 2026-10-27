<p align="center">
  <img src="docs/icon.svg" width="96" height="96" alt="magpie-translator">
</p>

<h1 align="center">magpie-translator</h1>

<p align="center">一个模型在干活，另一个模型把它的最终回复改写成「人话」。语言由你选，原文照常回到会话，译文一个字也不进去。</p>

<p align="center"><a href="README.en.md">English</a> · <a href="docs/DESIGN.md">设计与核验记录</a> · MIT</p>

---

## 为什么要「旁路」

如果在 Codex、Claude Code 里让模型直接用中文回复，会话历史存的就是中文，下一轮模型读到的也是中文。上下文变了，token 也更多。

magpie-translator 是 [magpie](https://github.com/yetone/magpie) 的插件，它不碰这条链路。工作模型这一轮答完后，插件把最终回复交给你在 magpie 里配好的另一个模型，改写成直白的目标语言，结果放进 magpie 里的「翻译记录」页。

- **agent 收到的仍是原文**：插件不改 magpie 写给客户端的字节，也不改写流。
- **下一轮请求里没有译文**：翻译请求单独发给本机 magpie，不带会话 id，不会写回工作模型的上下文。测试 `下一轮发给原模型的请求不含译文` 专门核对这一点。
- **代码不动**：代码块、行内代码和以 `$ ` 开头的命令先换成占位符，翻译完再原样放回。

## 截图

<!-- TODO: 在 magpie 里截「翻译设置」面板，存为 docs/settings.png（1440 宽，浅色主题） -->
![magpie 设置里的「翻译设置」面板：目标语言、风格、翻译规则和提示词](docs/settings.png)

<!-- TODO: 在 magpie 侧栏「翻译记录」页截一张有 2～3 条记录的图，其中一条展开「用其他模型对比」，存为 docs/history.png -->
![「翻译记录」页：左边是记录列表，右边原文和译文并排，还有另一个模型的对比译文](docs/history.png)

## 安装

你需要：

- 本机正在运行的 magpie，版本 0.1.1273 或更新（`magpie version` 可查；本文按 0.1.1731 核对）；
- 打算拿来翻译的模型已经能在 magpie 里用，也就是 `magpie models` 能列出来；
- Node.js 20+。只有跑测试或手动打开本机网页时才需要，hook 由 magpie 自带的 Bun 运行。

```bash
magpie plugin add github:GameHoo/magpie-translator
magpie plugin list                       # 查看插件名
```

也可以在 magpie 的 **插件 → 发现 → 非官方** 里安装。仓库打了 `magpie-plugin` topic，所以会出现在那里。

开关与更新：

```bash
magpie plugin off magpie-translator      # 关闭
magpie plugin on  magpie-translator      # 打开
magpie plugin update                     # 更新所有插件
```

> magpie 按包名 `magpie-translator` 查找插件。如果提示 `no plugin`，改用 `magpie plugin list` 印出的名字：从 GitHub 装的是 `github:GameHoo/magpie-translator`，从本地目录装的是那条路径。

## 快速配置

**刚装好时规则是空的，什么都不翻译。** 至少要加一条规则。

最省事的办法是打开 magpie 设置里的 **翻译设置**，点「添加规则」，左边选原始模型，右边选翻译模型，然后保存。

也可以用命令行配置：

```bash
magpie models                            # 每一行 provider/model 都可以当翻译模型

magpie plugin options magpie-translator '{
  "language": "简体中文",
  "rules": [
    { "model": "gpt-*", "translator": "traex/doubao-seed-2.1-pro" },
    { "model": "*",     "translator": "grok/grok-4.7-build-fast" }
  ]
}'
```

上面的翻译模型 id 只是举例，换成你自己 `magpie models` 里的任意一行。规则从上往下匹配，命中第一条就停：这个例子里 GPT 系列交给豆包，其余模型交给 Grok。

配好后，让 Codex、Claude Code 之类的客户端照常通过 magpie 答一轮，再打开 magpie 侧栏的 **翻译记录**。

> ⚠️ `magpie plugin options` 会**整体替换**插件配置，不会和上一次合并，没写的字段会回到默认值。用设置面板保存时，面板上没有的字段会原样保留。

### 规则怎么匹配

| 写法 | 匹配范围 |
| --- | --- |
| 不写 `agent` / `model` | 所有客户端 / 所有模型（面板里叫「所有模型」） |
| `"model": "gpt-5.4"` | `gpt-5.4`、`openai/gpt-5.4`，不分大小写；不匹配 `gpt-5.4-mini` |
| `"model": "gpt-*"` | 完整 id 或最后一段以 `gpt-` 开头的模型 |
| `"model": "deepseek/*"` | 这个 provider 下的所有模型（面板里叫「所有 deepseek/*」） |
| `"model": "*gpt*"` | `*` 可以放在任意位置；`?` 只当普通字符 |
| `"agent": "codex"` | 客户端名整词匹配，不分大小写，以记录卡片上显示的名字为准 |

每条规则都能单独设置 `language`、`prompt`、`style`、`display`、`webhookUrl` 和 `rewriteSameLanguage`。面板里的「高级」可以覆盖语言和提示词。

## 设置说明

面板位置：magpie 设置 → **翻译设置**（英文界面叫 Translator）。面板和命令行改的是同一份配置，也就是 `plugins.json` 里这个插件的 `options`。保存后，下一条回复就按新设置走，不用重启 magpie。

| 面板项 | 字段 | 默认 | 说明 |
| --- | --- | --- | --- |
| 右上角开关 | `enabled` | 开 | 关掉后插件不再翻译，但仍保持安装 |
| 目标语言 | `language` | `简体中文` | 写任何人看得懂的语言名都可以，比如 `English`、`日本語`、`Français` |
| 风格 | `style` | 直白人话 | 四个预设：直白人话、保留术语、简洁、详细。会填进提示词里的 `{style}` |
| 译文位置 | `placement` | 并排 | 只影响「翻译记录」页的展示方式：原文下方、并排、仅译文 |
| 显示翻译模型标签 | `showTranslatorBadge` | 开 | 在译文角落标出翻译模型和耗时 |
| 默认折叠原文 | `collapseOriginal` | 关 | 只在「原文下方」模式下生效 |
| 原文已是目标语言时跳过 | `rewriteSameLanguage`（取反） | 跳过 | 在本机检测语言，跳过的回复不调用模型。认不出的语言一律照常翻译 |
| 代码块与命令保持原样 | — | 始终开启 | 这一项不能关 |
| 超时 | `translateTimeoutMs` | 120 秒 | 面板上可选 10～120 秒，命令行最大可设 600 秒 |
| 翻译记录保留 | `historyLimit` | 500 条 | 面板可选 100、500、1000、5000 条或「不保存」(`0`)，记录存在本机 |
| 翻译规则 | `rules` | `[]` | 拖动或用箭头调整顺序。原始模型可以选具体模型、「所有模型」或「所有 provider/*」 |
| 提示词 | `prompt` | 空 | 可以插入 `{language}`、`{style}`、`{model}`、`{translator}` 这几个变量，下方有实时预览。点「恢复默认」会还原 |

关于提示词：编辑框里先显示一份中文模板。如果不改它直接保存，存进配置的是空值，插件会用代码里的英文默认任务句：

```text
Rewrite the user's text into plain, easy-to-read <language>. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.
```

不管提示词怎么改，插件都会保留三样东西：一个内部标记（用来防止翻译请求被再翻译一遍）、占位符规则，以及 `Output only the rewritten text.` 这句要求。

以下字段只能在命令行里改：`display`（另外把译文写到 `log`、`file`、`panel`、`stdout`、`notify`、`webhook`，默认 `["log"]`）、`webhookUrl`、`localPanel`、`panelPort`（默认 44721）、`gatewayKey`、`magpieBaseUrl`。

## 翻译记录页

位置：magpie 侧栏 → **翻译记录**（英文界面叫 Translations）。

- **列表**：每条记录显示 agent、状态（成功、失败、超时、已跳过）、时间和「原始模型 → 翻译模型」。顶部汇总成功率和中位延迟。支持按关键词搜索原文和译文，也能按 Agent、源模型、翻译模型、状态筛选。
- **详情**：原文和译文按段落对齐，同步滚动。可以一键复制原文或译文。代码块会标出是「原样保留」还是「译文改了代码」。原文太长被截断时也会提示。
- **用其他模型对比**：选另一个翻译模型，把同一段原文再翻译一遍，结果和原译文并排放着。觉得哪个更好，就点「这个更好」。
- **失败与超时**：翻译模型报错或超时，记录会留下原文和错误信息，可以点「重试」，或「换个模型重试」。超时、断连以及 HTTP 408 / 429 / 5xx 会先自动重试一次，第二次还失败就会标注 `（已重试一次）`。
- **导出**：把当前筛选结果复制成 JSON 或 Markdown（原文和译文对照），也可以只复制当前这一条。

## 工作原理

```
客户端 ──► magpie 网关 ──► 工作模型
              │  原文照常流回客户端（插件不改字节）
              ├─ middleware onEvent：Responses 流的 completed 事件缺正文时补上
              ├─ hook onRequest：认出插件自己发的翻译请求，并接收「对比 / 重试」任务
              └─ hook onResponse：抽出最终正文 → 屏蔽代码 → 写进本机收件箱
                                               │
                         后台 worker（node src/panel.mjs）
                           └─► POST 127.0.0.1:3425/v1/chat/completions（model = 翻译模型）
                                 └─► history.json → ui/feed.js → 「翻译记录」页
```

- **hook**：`src/hooks.mjs` 导出 `onRequest` 和 `onResponse`，由 magpie 用 Bun 运行。`src/middleware.mjs` 导出 `onEvent`，在网关进程里运行。翻译等这一轮结束后才开始，不拖慢 agent。
- **页面和面板在沙箱里**：magpie 把插件页面放进 `sandbox allow-scripts` 的 iframe，不允许 `fetch`、WebSocket 和内联脚本。所以 worker 把模型目录写成 `ui/catalog.js`，把最近的记录写成 `ui/feed.js`，页面用 `<script>` 加载。保存设置、对比和重试走的是 magpie 提供的 `magpie.options.set`。插件只申请了 `providers:list` 和 `usage:summary` 两项只读权限。
- **出错不影响原流程**：插件出了任何问题，agent 照样拿到原文。

只翻译给人看的最终正文。工具调用、推理和 thinking 都不翻译。以下几种情况会跳过：整段回复是 JSON 或请求要求结构化输出、标题或摘要之类的辅助请求、只有代码、原文已经是目标语言。屏蔽代码后如果正文超过 20000 字，超出部分会截掉，页面上会提示。

## 隐私

- 原文只会发给你在规则里选的翻译模型，经本机 magpie 网关转发。插件本身不连接任何外部服务。
- 记录保存在本机，默认在 `~/.local/share/magpie-translator/`（`history.json`、`log.jsonl` 等），可以用 `MAGPIE_TRANSLATOR_HOME` 或 `XDG_DATA_HOME` 换位置。「翻译记录保留」设为「不保存」时，不写历史记录。页面读取的 `ui/feed.js` 里没有 gateway key 和提示词。
- 本机网页（`127.0.0.1:44721`）默认关闭，打开后也只监听 `127.0.0.1`。
- `webhook` 出口默认不启用。启用后会把译文 POST 到你填的地址，内容里不含 gateway key。

## 常见问题

**装好了，但什么都没翻译？**
规则默认是空的，先加一条。再确认规则里的原始模型能匹配上工作模型的 id（写法参照 `magpie models` 的输出），还有右上角的开关是开着的。

**用 `plugin options` 改了一项，别的设置没了？**
命令行写入会整体替换。要么把完整 JSON 一起写进去，要么改用设置面板。

**记录显示「失败」或「超时」？**
先看卡片上的错误信息。确认翻译模型在 magpie 里能用，必要时把超时调大，然后点「重试」或「换个模型重试」。

**中文回复没有被翻译？**
原文已经是目标语言时默认跳过。如果想把它也改写得更直白，把「原文已是目标语言时跳过」关掉。

**点了「对比」或「重试」没反应？**
这两个任务在下一次经过 magpie 的请求时才会开始（页面会提示「已提交，钩子重载后开始」）。如果 worker 没在运行，就要等下一轮对话。

**`magpie plugin list` 显示 `async gateway hook onRequest`？**
这是 magpie 自己的标签，属于正常现象。插件同时也导出了 `onResponse`。

**Codex 用 ChatGPT 账号登录时抓不到正文？**
这条路径不经过 middleware。如果它的 `response.completed` 不带正文，插件就看不到这一轮。详见 [docs/DESIGN.md](docs/DESIGN.md)。

## 开发

```bash
npm test                               # 单元测试
MAGPIE_BIN=/path/to/magpie npm run e2e # 走一遍真实的 magpie 网关
npm run demo                           # 可选的本机网页 + 假翻译器，不需要任何 key
```

## 许可

[MIT](LICENSE)
