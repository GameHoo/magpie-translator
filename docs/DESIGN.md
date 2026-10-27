# 旁路转述：译文不进原模型的会话

插件包名是 magpie-translator。它是 magpie 的异步 gateway hook，不改写 agent 已经拿到的回复。工作模型和翻译模型都是配置里的模型 id，magpie 里已经配好的 provider（含 grok、DeepSeek、Gemini 这类插件 provider）把 id 贴进来就能用，加一个新模型不用改插件代码。`language` 写成任意人类读得懂的语言名，默认是 `简体中文`。默认提示词是英文指令，把这个名字嵌进去，不另写一套中文指令。提示词和展示出口也能改。

要看的两处都在 magpie 窗口里：设置槽里的设置，侧栏里的翻译记录。本机 `127.0.0.1` 页面默认不开。日志、文本文件、桌面通知和 webhook 仍是 `display` 里的出口。设置写回的仍是 `plugins.json` 里这一条 options，和 `magpie plugin options` 同一份。

核验日期：2026-10-27。状态：已定稿。对照的是本机 magpie 0.1.1731、当天的 [gateway hooks 文档](https://github.com/yetone/magpie/blob/main/docs/subsystems/gateway-request-hooks.md)、`internal/gateway/gateway_hooks.go`、`internal/provider/chatgpt_api.go`，以及当天能读到的 Codex 与 Claude Code 公开资料。

## 谁翻译谁，只写在配置里

一条规则把「哪个客户端上的哪个工作模型」指到「哪个翻译模型」。模型 id 用 `magpie models` 印出来的 `provider/model`，原样粘贴。插件里没有厂商名单，也没有模型枚举。翻译请求打回本机 magpie 的 `POST /v1/chat/completions`，`model` 字段就是这条 id。magpie 自己再把它路由到对应 provider，包括由插件登录、由插件提供的 provider。

```json
{
  "language": "简体中文",
  "prompt": "",
  "style": "用短句，像在跟同事解释。",
  "display": ["log"],
  "translateTimeoutMs": 120000,
  "rewriteSameLanguage": false,
  "historyLimit": 500,
  "localPanel": false,
  "panelPort": 44721,
  "rules": [
    { "agent": "codex", "model": "gpt-5*", "translator": "deepseek/deepseek-chat" },
    { "model": "claude-*", "translator": "gemini/gemini-2.5-flash", "language": "English" }
  ]
}
```

上面的 id 是例子。换成你机器上 `magpie models` 的任意一行即可，例如某个 grok 插件列出的那条。

下面前 5 项可以写在一条规则上，盖过全局的同名字段。`rules` 是规则列表，不能在某一条规则里再嵌一份。超时、同语言改写、历史条数和本机页面开关只在全局：规则上的 `rewriteSameLanguage` 是例外，写了就盖过全局。

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `language` | `简体中文` | 默认提示词里的目标语言，写人类读得懂的名字，如 `English`、`日本語`、`Français` |
| `prompt` | 空 | 非空时只换掉任务句，最长 4000 字。系统提示仍以内部记号开头。任务句默认是 `Rewrite the user's text into plain, easy-to-read 简体中文. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.` 这里的「简体中文」换成当时的 `language`。自定义任务句和 `style` 里可以写 `{language}`、`{style}`、`{model}`、`{translator}`，发出翻译请求前替换一次；不认识的花括号原样留下。固定留下两句：`Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is, including the brackets and the number. Do not translate, delete, or move them.` 以及 `Output only the rewritten text.` |
| `style` | 空 | 追加的一句口气要求，最长 4000 字 |
| `display` | `log` | 出口，见下一张表。可以是数组，或用逗号、空格分开的字符串。不含 `panel` 时不打开本机网页。magpie 侧栏的记录页不受这个字段影响 |
| `webhookUrl` | 空 | `display` 含 `webhook` 时，把转述 POST 到这个 http(s) 地址 |
| `rules` | 空数组 | 空则什么都不转述 |
| `translateTimeoutMs` | `120000` | 一次翻译调用的上限，夹在 10–600 秒。超时、连接中断，或 HTTP 408、429、5xx 再试一次。其他 4xx 不重试 |
| `rewriteSameLanguage` | false | 关着时，原文已经是目标语言就不送。认不出的语言名仍送。规则上的同名字段优先 |
| `historyLimit` | `500` | `history.json` 保留的条数。`0` 表示不保存，下一次翻译清空文件。其他数字夹在 20–5000 |
| `enabled` | true | 页头开关。`false` 时不再为新回复入队。改不了 magpie 自己的插件停用开关 |
| `placement` | `beside` | 只影响翻译记录页的排法：`beside` 并排，`below` 原文在译文上方，`only` 只留译文。不写回 Agent 会话 |
| `showTranslatorBadge` | true | 记录栏是否标出翻译模型和耗时 |
| `collapseOriginal` | false | `placement` 为 `below` 时，原文默认折叠 |
| `localPanel` | false | 为 true 时，即使 `display` 没有 `panel` 也监听本机页面 |

另外四个全局项不进规则、也不出现在表单上：`panelPort`（默认 44721）、`magpieBaseUrl`（默认读 `~/.config/magpie/settings.json` 的端口，否则 `http://127.0.0.1:3425`）、`gatewayKey`（工人回叫本机 magpie 用的钥匙，默认 `magpie-translator`，不是厂商密钥）、`gatewayTimeoutMs`（只限制 hook 写收件箱的时间，允许 100–10000 毫秒；`package.json` 的 `magpie.options` 里写的是 2000）。翻译发生在 hook 返回之后。

展示出口有 6 个，写进 `display` 的都会做，不认识的名字会被忽略：

| 出口 | 结果放在哪 |
| --- | --- |
| `panel` | 本机页面 `http://127.0.0.1:<panelPort>` |
| `log` | 数据目录里的 `log.jsonl` |
| `file` | 数据目录里的 `latest.txt`，可用 `tail -f` 看 |
| `stdout` | 工人进程的标准输出。hook 拉起的工人把标准输出丢掉了，这个出口要自己在终端里跑 `node src/panel.mjs` |
| `notify` | 调用 `notify-send`。机器上没有这个命令时静默跳过 |
| `webhook` | 向 `webhookUrl` POST 一条 JSON，不含网关钥匙 |

规则按书写顺序，第一条命中的生效。`agent` 省略表示不限制客户端，`model` 省略表示不限制模型。`agent` 是整词、不区分大小写，要和记录上显示的名字一致。`model` 写成 `vendor/name` 或光写 `name` 都能对上 magpie 给出的完整 id；光写 `name` 时对得上 `name`，对不上 `name-mini`。比较不区分大小写。`*` 可以出现在任意位置，按正则的 `.*` 理解；末尾的 `*` 仍是前缀。`?` 保持字面量。`vendor/*` 对得上完整 id `vendor/chat`，对不上只写最后一段的 `chat`。空的 `model` 表示全部，不要为了「全部」去存一个单独的 `*`。

magpie 交给 hook 的协议名目前是 `chat`、`responses`、`anthropic`、`gemini` 四种线格式。插件按这四种 JSON 形状取正文。一个新的 provider 只要仍从这四种入口进来，就不用改插件。magpie 若将来增加第五种 JSON 形状，抽取函数才要加一支。

## 设置写回 plugins.json

平时在 magpie 的设置槽里改。那个页面调用 `magpie.options.set`，宿主把它写进 `plugins.json` 里这个插件的 `options`，并重载一次 hook 宿主。这和 `magpie plugin options <名字> '<json>'` 改的是同一份。Bun 里的 `onRequest` / `onResponse` 不调用 `magpie.options.set`：翻译一次就写一次 options，会把宿主反复重启。

本机设置页是同一份文件的备用入口，默认不监听。它直接改 `plugins.json`。已经在跑的 magpie 不用为这次写入单独重启：下一轮请求发现这个文件变了，会重新加载。

打开 `http://127.0.0.1:<panelPort>/settings`。页面上能改全局的语言、提示词、style、展示方式，也能增删改规则的顺序、agent、model 和翻译模型。翻译模型从 magpie 列出来的 id 里选，列表里没有的可以手填。提示词是多行的。点「恢复默认」会把那一栏清空，保存后用默认任务句。`gatewayKey`、`panelPort`、`magpieBaseUrl`、`gatewayTimeoutMs` 不在表单上，保存时按原值留下。表单也改不了这些字段：请求体里夹带的同名字段会被丢掉。

三个看起来像「插件写自己的配置」的入口，只有 `plugins.json` 这一份是 hook 的 `ctx.options`：

| 入口 | 实际写到哪 | 这个面板用不用 |
| --- | --- | --- |
| `magpie plugin options` | `~/.config/magpie/plugins.json` 里该插件的 `options`。`SetOptions`（`internal/plugin/store.go`）整份替换后保存 | 用。面板写同一个字段 |
| `await magpie.options.set(o)` | 同样是这份 options。只在 magpie 窗口里的插件页里存在。页面不能 `fetch`，也不能写内联脚本 | 用。设置槽和「对照翻译」走这一条。本机面板不走 |
| `POST /api/settings/plugin-option` | `settings.json` 里的布尔开关 `pluginOptions`，给 provider 插件用 | 不用。那不是 hook 的 options |

hook 拿到的 `ctx.options` 是 Bun host 启动时抄下来的。`internal/plugin/host.js` 把每个 gateway hook 收成 `{ spec, options }`，每次请求再 `structuredClone` 一份交给 `onRequest`。hook 里改这个对象不会写回磁盘，下一轮也不记得。

命令行 `plugin options` 跑在另一个进程里。它的 `Restart()` 只重启那个进程自己的 host，不会直接碰到正在 `magpie serve` 的那一个。正在服务的进程靠文件发现变化：`GatewayBegin` 调 `checkList()`，`plugins.json` 的修改时间或大小变了就把 host 标成过期；`getLocked` 再拉起一个新 host，新 host 读到新的 options。所以下一轮请求用的是新配置。已经进了 `onResponse` 的那一轮仍用旧的。

2026-10-27 在这台机器的 magpie 0.1.1731 上核对过，配置目录是临时的 `HOME=/tmp/magpie-reload-probe`：

1. `magpie plugin options` 把 `language` 写成 `Français`。向网关发一次 Chat 请求（模型不存在，HTTP 404）。hook 仍被调用，记下的语言是 `Français`。
2. 不重启 serve，直接把 `plugins.json` 里的 `language` 改成 `English` 并加上 `gatewayKey`。下一次请求记下 `English` 和这把钥匙。
3. 再跑一次 `magpie plugin options` 把语言改成 `日本語`。再下一次请求记下 `日本語`。另一条插件、它的 `off`、以及文件顶上的 `config` 都还在。

因此面板自己写这个文件，不去调用 `magpie` 可执行文件。服务进程本来就是看文件重新加载的，而 hook 拉起的面板不一定找得到 `magpie` 这条命令。写法是先写临时文件再改名盖上 `plugins.json`，模式 `0600`。只替换这一条插件的 `options`。别的插件、`off`、`config`、`prefer` 不动。解析之后如果和磁盘上的对象相同，就不写，避免 magpie 白白重启 host。

面板只 `listen` 在 `127.0.0.1`。`POST /api/settings` 要带 `GET /api/settings` 发下来的 `x-magpie-translator-csrf`，并且 `Content-Type` 是 `application/json`。`Host` 不是 `127.0.0.1` 或 `localhost` 加本端口、`Origin` 或 `Referer` 指向别处、`Sec-Fetch-Site` 是 `cross-site` 或 `same-site`，都回 403。响应不带 `Access-Control-Allow-Origin`。令牌只出现在这个页面能读到的 JSON 里，别的网站读不到。

对上哪一条插件：spec 是路径时，realpath 要等于这个包的目录；spec 是 `github:` 或 npm 名时，用 `plugins/package.json` 的 `dependencies` 找到包名，再对 `plugins/node_modules/<包名>`。环境变量 `MAGPIE_TRANSLATOR_PLUGIN` 可以指定 `magpie plugin list` 印出来的那条 spec。对不上时页面说明要先 `magpie plugin add`，并且不会新建 `plugins.json`。

还没有在这台机器上点过 magpie 窗口里的 Options 按钮。那颗按钮走的也是 `SetOptions`。没有故意制造改名写到一半的崩溃。两个进程同时写时，后一次改名留下，这和两条 `plugin options` 同时跑是一样的。

## magpie 窗口里的记录

侧栏页是 `package.json` 里的 `magpie.page`，文件 `ui/history.html`，中文标题「翻译记录」。设置槽是 `magpie.panels`，`slot` 为 `settings`，文件 `ui/settings.html`，中文标题「翻译设置」。两页必须放在同一个目录，因为 magpie 只从该 HTML 所在目录提供文件。权限是 `providers:list` 和 `usage:summary`。

图标文件是 `ui/icon.svg`：靛蓝圆角方块（底色 `#5b5bd6`，上面一条 `#7b7bf0` → `#4646b8` 的渐变）加白色翻译标记。笔画是 `#ffffff`，不用 `currentColor`，所以浅色和深色底上都是同一张图。`magpie.icon` 是这张 SVG 的 `data:image/svg+xml` URI（1255 字符），给 Discover 卡片和已安装插件那一行用。这个字段不接受相对路径。`magpie.page.icon` 写的是 `ui/icon.svg`；`page.go` 会把它收成页面目录里的 `icon.svg`，侧栏入口用这一张。2026-10-27 对照 `internal/plugin/page.go`：`PanelSpec` 没有 icon，设置槽不能单独配图标。页头里的同一枚标记是 CSS 画的，不另占一个文件。

同一天在浏览器里把 `ui/icon.svg` 放在 `#fafafa` 和 `#0b0b0c` 上，64、20、16 像素都看得出白色标记。`package.json` 里的 data URI 用 `decodeURIComponent` 解出来与这个文件逐字相同，再作为图片加载也能画出。对照了 `market.go` 的 `ownIcon`（接受 `data:image/`，长度不超过约 1.5MB）、`favicon.go` 的 `dataURI`（非 base64 时按百分号解码）和 `icon.go` 的 `StoreIcon`（前 1024 字节里有 `<svg` 就当 SVG）。这条 URI 符合这三处。没有在 magpie 的插件列表、Discover 或侧栏里点开，因为这台机器没有 magpie 窗口。页面资源表把 `.svg` 标成 `image/svg+xml`（`internal/gui/api.go` 的 `assetTypes`），侧栏不会把这张图当成别的类型。

页面读不到网络，所以工人把数据写成同目录的脚本：

- `ui/catalog.js` 赋值 `globalThis.MAGPIE_TRANSLATOR_CATALOG`。来自本机 `/v1/models`，失败再用 `magpie models`。大约每分钟写一次。测试进程里不写仓库里的这份文件。
- `ui/feed.js` 赋值 `globalThis.MAGPIE_TRANSLATOR_FEED`。页面用带查询参数的 `<script src>` 重新加载。`<` 写成 `\u003c`。脚本里没有 `gatewayKey`、遮罩正文、占位符、提示词和 magpie 地址。磁盘上的 `history.json` 仍留着遮罩和提示词，供对照翻译使用，模式 `0600`。

对照翻译是这条通道里唯一一次由页面写入 options：`_compare` 带 nonce、记录 id 和另一个翻译模型。宿主因此重载一次。正在跑的工人大约每 2 秒看一眼 `plugins.json`；hook 的 `onRequest` 也会看。同一个 nonce 记在 `compare-seen.json` 里，只入队一次。结果写进那条记录的 `comparisons`，不新开卡片，也不再写一次 plugins.json 去清掉 `_compare`（再写会再重载一次）。普通保存会删掉 `_compare`。工人没在跑、而且之后没有新请求时，对照要等到下一次请求才会开始。

`magpie plugin list` 把每一个异步 hook 都印成固定的 `async gateway hook onRequest`（`internal/cli/plugins_cli.go`），窗口空闲文案是 Waiting for a request。这两句不检查插件是否导出了 `onResponse`。翻译在 `onResponse`。`onRequest` 不改请求，只标出自己的翻译请求并接收对比 / 重试。不调用 `ctx.report("ready")`，那会把状态说成「准备好往上下文里插内容」。

版面按 2026-10-27 批准的设计稿实现：`ui/style.css` 和 `ui/app.js`。设置页是选择器、风格卡片、规则流和提示词编辑区，没有手填模型的框。记录页是左右对照、失败卡片、窄屏标签，以及「用其他模型对比」。`options.set` 至少隔 1.1 秒一次。

设计稿里有几处页面做不到，或做成了别的样子：

- 译文位置写的是 magpie 会话视图。会话里的字节不能改，否则下一轮会带上译文。这个控件只改翻译记录页的排法。
- `providers:list` 没有模型 id。具体模型来自 `catalog.js` 和 `usage:summary`，厂商名来自 `providers:list`。接口不提供模型的副标题。
- 导出不能下载文件。复制到剪贴板。
- 记录里没有 token 数和请求 id。超时卡片用真实错误文字，不编一个 request id。
- 提示词框里没改过时显示和默认任务句同一句英文，语言名的位置是 `{language}`。保存时空字符串，翻译时再把语言名填进去。
- 「这个更好」只提示已记下，不改规则。
- 页头开关写入 `enabled`，不是 magpie 的插件停用。
- 同语言跳过的回复不进历史，和开关下的说明一致。页面仍能画出「已跳过」卡片，但钩子不会写出这种记录。

2026-10-27 用浏览器打开过 `ui/settings.html`（浅色、深色、模型选择器、未保存状态）和 `ui/history.html?demo=1`（左右对照、超时卡片、宽 720 的原文/译文标签、「用其他模型对比」弹出的模型列表）。预览地址是 `http://127.0.0.1:44731/`。控制台里只有 magpie 桥脚本和 favicon 的 404，静态服务器本来就没有这两样。没有在 magpie 窗口里打开过。

## 改写 agent 拿到的字节，译文会进下一轮

magpie 的 [hooks 文档](https://github.com/yetone/magpie/blob/main/docs/subsystems/gateway-request-hooks.md) 写明：`onResponse` 看到的是客户端已经收到的那份回复，回调改不了客户端输出。`internal/gateway/gateway_hooks.go` 的 `gatewayResponse` 把已经写给客户端的字节抄进旁路，再交给 `gatewayReply` 收成整段。host 里 `gatewayFinish` 调用 `onResponse` 后丢掉返回值。

客户端会把这份原文存进自己的会话，下一轮再发回来：

- **Codex** 在 `codex-rs/core/src/stream_events_utils.rs` 的 `record_completed_response_item` 里把完成的 `ResponseItem`（正文、推理、function call）交给 `sess.record_conversation_items`，写入 `~/.codex/sessions/.../rollout-*.jsonl`。ChatGPT 登录后的请求字段在 `internal/provider/chatgpt_api.go`：`previous_response_id` 列在 `siwcDropped` 里，注释说明上游什么都不存，于是整段对话每次都由客户端重发。流里的字被改成译文，下一轮重发的就是译文。这和下面的透传入口不是同一个文件：`codex_backend.go` 的 `/backend-api/codex` 是 Codex 走 ChatGPT 透传的网关入口，那里会跑这个 hook。
- **Claude Code** 把 assistant 的 content 块（text、thinking 加 signature、tool_use）写入 `~/.claude/projects/...jsonl`，恢复会话时按这些块重放。空的 text 块会一直被重放并触发 400（[issue 88536](https://github.com/anthropics/claude-code/issues/88536)）。thinking 的 signature 必须和当初的字节一致，改过之后会话会卡在 400（[issue 63374](https://github.com/anthropics/claude-code/issues/63374)、[issue 63147](https://github.com/anthropics/claude-code/issues/63147)）。
- **Chat Completions 客户端** 把 `delta.content` 拼成 assistant 消息，连同 `tool_calls`、`reasoning_content` 放进下一轮的 `messages`。

所以 hook 里只读这份回复，把它的正文抄进本机收件箱。返回给 agent 的流保持原样。

同步中间件（`onRequest` / `onEvent` / `onResponse`，时限大约 250ms / 50ms / 250ms）可以改 SSE。那正好是上面这条污染路径。Codex 走自己的 ChatGPT 透传（`codex_backend.go`）时会跑异步 hook，不会跑同步中间件。翻译一次模型调用也放不进 50 毫秒的 `onEvent`。因此用异步 hook，并且在整轮结束之后再翻译：agent 先看到原文，转述随后出现在旁路。半句不送去翻译，原流也不改。

## 下一轮请求里再删译文，删不干净

若改写了流、再指望下一轮把译文剥掉，会在这些地方失败：

1. 用户自己写的中文和译文没有稳定分界，剥的时候会误伤用户的话。
2. 压缩（compaction）会把历史收成摘要，译文可能留在摘要里，原文已经不在了。
3. 尊重 `previous_response_id` 的上游会把改写后的文本存在自己那边，下一次请求根本不再带历史，插件看不到可删的那一段。
4. Claude 的 thinking signature、工具调用参数要按原字节往返。为了删一句译文而去改消息，会把这些字段碰坏。
5. 客户端可能先把 delta 拼好、再包进自己的格式。插件看不到「拼之前」的流，就无法把已经落盘的译文逆回去。

单元测试里有一条对照：若流里的正文已经是译文，按客户端的记法组出的下一轮请求就会带上译文。旁路方案下，组下一轮所用的材料里没有译文。

## 旁路怎么接在一次请求上

一次命中规则的最终回复，经过下面 5 步。第 1 步失败时，请求仍按原样转发出去。从第 2 步起 agent 收到的是原文，旁边的失败不再改那份回复。

1. `onRequest` 只做一件事：请求的 system / instructions / developer 里若有内部记号 `MAGPIE_TRANSLATOR_SIDECAR_v1`，就在 `ctx.state.own` 做标记。不改请求体。这个记号和目标语言无关，用来认出工人自己发出的翻译请求，避免翻译模型的回复再被拿去翻译。
2. magpie 照常向上游要这一轮，并把流原样写给客户端。
3. `onResponse` 在 magpie 捕获到整段（不超过文档里写的 8MiB）时被调用。`success === false` 但回复对象里仍有正文时也入队；抽不出正文就返回。回调不修改回复对象。不命中规则、是自己的翻译请求、是侧请求（纯 JSON、结构化输出、标题或建议助手、没有用户轮次），或在 `rewriteSameLanguage` 关闭时原文已经是目标语言，就返回。
4. 抽出来的正文把代码换成占位符 `⟦0⟧`、`⟦1⟧`，连同语言和提示词写进数据目录的 `inbox/`。hook 顺手拉起本机工人。`panel.pid` 里是进程号加上插件版本、`src/*.mjs` 的哈希和安装目录。活着的进程对不上这份身份就先停掉再起一个，避免更新之后旧代码继续往旧目录写 `ui/feed.js`。这一步写盘失败时，收件箱里没有这条，记录和日志也不会有。
5. 工人把这条任务 POST 回 magpie 的 `/v1/chat/completions`，模型 id 用规则里的 `translator`。系统提示以记号开头，接着是默认任务句或你的 `prompt`。默认任务句把 `language` 的名字嵌进英文指令。然后固定留下占位符那一句和 `Output only the rewritten text.` 回来的文本把对得上的占位符换回原来的代码。丢掉的那几段补在末尾，已经嵌回的不重复。然后按 `display` 送出，并写入 `history.json` 和 `ui/feed.js`。单次等待 `translateTimeoutMs`，可重试的失败再试一次。翻译请求失败或没有返回文字时，记录和日志留下原文和错误原因。

工人的请求不带 `X-Magpie-Session`。magpie 的会话文档写明：没有会话 id 的请求不会被编成一条打得开的会话记录，网关也不用正文去猜测它属于哪一次对话。agent 的下一轮来自它自己的记录，不来自这个旁路请求。

数据目录是 `$MAGPIE_TRANSLATOR_HOME`，否则是 `$XDG_DATA_HOME/magpie-translator`，再否则是 `~/.local/share/magpie-translator`。里面有 `inbox/`、`log.jsonl`、`latest.txt`、`history.json`、`compare-seen.json` 和 `panel.pid`。工人启动时把 `log.jsonl` 里还没有对应历史记录的行补进 `history.json`，并写成新安装目录的 `ui/feed.js`。`plugins.json` 里这条插件的 `off` 为 true（`magpie plugin off`）时，工人等手头的任务结束就退出。

Codex 走 magpie 的 agent 路由时，`src/middleware.mjs` 的 `onEvent` 会在 `response.completed` 或 `response.incomplete` 的 `output` 没有助手正文时，补上从 delta 和 `output_item.done` 拼出的 message。这段中间件不跑在 Codex 自己的 ChatGPT 登录透传上。那条路径若完成事件里完全没有 output，插件看不到主回复。2026-10-27 没有用真实 Codex 核对此项。

## 只翻译最终正文

没有工具调用时，送去翻译的是面向用户的最终文字。有工具调用时，Anthropic、Chat、Gemini 整段不送。Responses 的规则是：有 `phase` 为 final 的正文就只用那些；否则没有工具时留下非铺垫正文；有工具时只留下最后一个工具调用之后的正文。铺垫句不送。整段是 JSON、请求要求结构化输出、标题或建议类助手、以及没有用户轮次的请求，在抽取之后丢掉。

| 协议 | 没有工具调用时送去翻译 | 不拿去翻译 |
| --- | --- | --- |
| Responses | message 的正文。有 `final_answer` 时只用那些，即使同一轮里还有工具。没有 `phase` 时也送。有工具且没有 final 时，只送最后一个工具调用之后的正文 | `reasoning`；类型以 `_call` 结尾的工具调用；`commentary`；工具调用前面的铺垫句 |
| Anthropic | `text` 块 | `thinking`、`redacted_thinking`；`tool_use`、`server_tool_use`、`mcp_tool_use`、`tool_result`。出现这些块，或 `stop_reason` 为 `tool_use` 时，旁边的文字也不送 |
| Chat | `message.content` 为字符串时的整段；`content` 为数组时，`type` 为 `text` 的块，以及 `type` 为 `refusal` 的块（读的是块里的 `refusal` 字段）。message 旁边单独的 `refusal` 字段不读 | `reasoning_content`、`tool_calls`。出现工具调用，或 `finish_reason` 为 `tool_calls` 时，旁边的文字也不送 |
| Gemini | 普通 `text` | `thought: true` 的段。出现 `functionCall` 时，旁边的文字也不送 |

代码仍留在这段正文里，翻译前再保护一次。围栏代码块（含没有合上的围栏）、行内反引号、以 `$ ` 开头的命令行换成占位符。去掉占位符之后若不再剩散文，这一轮不发送。遮罩后的文本按字符切，超过 20000 个字符时从第 20000 个字符处截断，不回头找句号或换行。页面上会标明截断。

## 验证记录

2026-10-27 在这台机器上核对过的部分：

- `npm test` 51 项通过。其中「下一轮发给原模型的请求不含译文」用 Responses、Anthropic、Chat、Gemini 四种客户端会落盘的材料组出下一轮请求，断言里面没有译文、记号和网关钥匙，原文、代码和推理还在。对照项证明：若流里的正文已被改成译文，下一轮请求就会带上它。工具轮不会产生翻译任务。另有一条把 `language` 设成 `Français`，断言默认提示词里出现这个名字，并且提示正文没有中文字。自定义提示词里的 `{language}` 会换成 `Français`，不认识的 `{tone}` 原样留下。同一天补上的测试覆盖：`*` 出现在中间且不区分大小写、Codex 式的 reasoning 加没有 phase 的 message、工具后面的正文留下而铺垫丢掉、中间件补上空的 `response.completed`、纯 JSON 和建议请求不入队、同语言默认跳过、超时重试一次而 HTTP 400 不重试、历史上限和 feed 脚本不含钥匙、`localPanel` 在只要日志时仍监听、清单里的 page 与 panels。
- 设置页测试：保存只改这一条插件的 options，`gatewayKey` 等未编辑字段还在，别的插件、`off`、`config`、`prefer` 不动；请求体里夹带的 `gatewayKey` 不会覆盖原值，响应里也没有这把钥匙。没有令牌、错误的 `Origin` / `Referer` / `Host` / `Sec-Fetch-Site` 都是 403，文件不变。监听地址是 `127.0.0.1`。空的配置目录不会被自动写成 `plugins.json`。同一天在浏览器里打开 `http://127.0.0.1:44771/settings`，改语言后点保存，`plugins.json` 里的 `language` 变成新值，页面写着「已写入，下一轮请求生效。」窄窗口（宽 390）没有横向溢出。
- 另一项测试把翻译模型写成 `community/brand-new-model`、`plugin-grok/grok-4` 这类任意字符串，断言发出去的 `model` 就是这个字符串，并且运行时代码里没有厂商模型表。
- 语言、自定义提示词、规则覆盖、以及「只开 log / file / webhook、不监听网页」有单独测试。webhook 的 JSON 里没有网关钥匙。
- 本机 magpie 0.1.1731 的端到端：自定义 OpenAI 兼容上游，规则把 `gpt-work` 指到 `mock/translator-zh`，目标语言设成记号 `LangTokenE2E`。客户端收到的 Chat 流是英文，代码命令仍在原文里。面板上是中文，命令被嵌回。翻译请求再次经过 magpie，正文里有这个语言记号和占位符，没有原始命令，且只发出一次。用客户端实际收到的英文组出的第二轮，经 magpie 转到工作模型的上游请求体里没有中文译文、没有语言记号、没有内部记号。同一轮还看了 `/v1/responses` 和 `/v1/messages`：客户端流是英文，不含译文。这两条协议的「续轮上游请求体」没有再在真实网关上跑，续轮形状由单元测试覆盖。
- 这次端到端里 magpie 报的 `ctx.agent` 是 `node`（客户端是 Node 的 fetch）。卡片上的名字就是规则该写的 `agent`。

还没有在这台机器上核对的部分：

- 没有跑真实的 Codex CLI 或 Claude Code 进程，也没有用 DeepSeek、Gemini、grok 的真实密钥。没有在 magpie 窗口里打开设置槽、「翻译记录」、插件列表、Discover 或侧栏图标。静态页面在浏览器里对过版面，图标文件和 data URI 也在浅色和深色底上打开过，见上面「magpie 窗口里的记录」。
- 没有走 Codex 的 ChatGPT 透传路径 `/backend-api/codex`。文档写明这条路径会跑异步 hook、不跑中间件。若那条路径的 `response.completed` 不带 output，主回复仍会漏掉。本仓库的端到端走的是普通网关入口。
- 没有确认桌面通知（`notify-send`）在一台有图形会话的机器上真的弹出。
- magpie 若增加第五种响应 JSON 形状，当前抽取函数不会认识它。
- 同语言判断是字形启发式。简体和繁体只数一小部分有简繁差别的字。短句和认不出的语言名不会被跳过。
