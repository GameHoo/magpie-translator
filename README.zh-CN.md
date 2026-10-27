# magpie-translator

这个插件用你已经在 magpie 里配好的另一个模型，翻译选定工作模型的最终回复。`language` 可以写成任意语言名。agent 拿到的仍是原文，下一轮发回工作模型的请求里没有译文。

不写 `language` 时，默认是 `简体中文`。一条规则可以改成 `English`、`日本語`、`Français`，或任何一个人读得懂的名字。默认提示词是英文指令，把这个名字嵌进去，不假设译文必须是中文。

English: [README.md](README.md). Design notes and the checks that were run: [docs/DESIGN.md](docs/DESIGN.md). Checked on 2026-10-27.

## 装上并写一条规则

需要本机已经在跑的 magpie，版本 0.1.1273 或以后，以及 Node.js 20 或以上（跑测试和手动打开页面时用）。`magpie version` 会印出版本。本文按 0.1.1731 核对。magpie 用它自带的 Bun 跑 hook。hook 是 magpie 在一轮请求之后调用的插件入口，不用你自己启动。

1. 看翻译模型的 id。下面命令印出的 `provider/model` 都能填，包括插件提供的 provider：

   ```bash
   magpie models
   ```

   想用的模型不在列表里时，先加上它的 provider，再列一次。magpie 已经认识的厂商可以这样加：`magpie provider add deepseek sk-...`。其他字段看 `magpie provider --help`。

2. 从仓库装上。下一步的 `<名字>` 用 `plugin list` 印出来的那一项：

   ```bash
   magpie plugin add github:GameHoo/magpie-translator
   magpie plugin list
   ```

   本地目录同样可以：`magpie plugin add /path/to/magpie-translator`。这时名字就是那条路径。

3. 写规则。`model` 和 `translator` 换成第 1 步的 id。`rules` 为空时什么都不翻译。下面的例子把命中的工作模型译成英文，把 Claude 译成日文：

   ```bash
   magpie plugin options <名字> '{
     "language": "English",
     "style": "Use short sentences.",
     "display": ["panel", "log"],
     "panelPort": 44721,
     "rules": [
       { "model": "gpt-5*", "translator": "deepseek/deepseek-chat" },
       { "model": "claude-*", "translator": "gemini/gemini-2.5-flash", "language": "日本語" }
     ]
   }'
   ```

   只译成法文的一条规则：

   ```json
   { "model": "gpt-5*", "translator": "deepseek/deepseek-chat", "language": "Français" }
   ```

   交给 `plugin options` 的 JSON 会整份替换插件配置，不会和上一份合并。下一轮结束的回复使用新的 `language`。改语言不用重启 magpie。每轮原文只翻译一次，译成这条规则的语言。译文不会送回工作模型，所以不会再被译成第二种语言。

4. 让工作模型经 magpie 回答一轮。把 magpie 已经在路由的客户端（Codex、Claude Code 或其他客户端）指到 magpie，再问它一句。然后打开 <http://127.0.0.1:44721>。还没有命中的回复时，页面上写着还没有译文。命中之后，卡片上的语言、工作模型和翻译模型来自这一轮的配置。页面上的按钮和说明是中文。译文用的是卡片上的 `language`，不是页面外壳的语言。

`package.json` 里的 `magpie.options` 只是示例。生效的是 `magpie plugin options` 写进去的那份。

## 规则怎么匹配

规则按书写顺序，第一条命中的生效。

| 写法 | 命中 |
| --- | --- |
| 省略 `agent` | 所有客户端 |
| 省略 `model` | 所有模型 |
| `"model": "gpt-5.4"` | `gpt-5.4` 和 `openai/gpt-5.4`。不命中 `gpt-5.4-mini` |
| `"model": "gpt-5*"` | 完整 id 或最后一段以 `gpt-5` 开头 |
| `"agent": "codex"` | 整词，不区分大小写 |

`agent` 要和页面卡片上显示的名字一致。限定某个客户端之前，可以先只写 `model`，看卡片上的名字，再补上 `agent`。

同一条规则可以盖过全局的 `language`、`prompt`、`style`、`display`、`webhookUrl`。规则上不写 `language` 就沿用全局。全局也省略时，用默认的 `简体中文`。

厂商的 API key 仍放在 `magpie provider` 里。本机 magpie 没有要求特定的本地钥匙时，不要填 `gatewayKey`，工人会发送默认的 `magpie-translator`。你若已经配了具名网关钥匙，把同一串写进 `gatewayKey`。

## 语言、提示词和出口

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `简体中文` | 嵌进默认提示词的语言名。任意名字都可以，如 `English`、`日本語`、`Français` |
| `prompt` | 空 | 只换掉任务句，最长 4000 字。三样仍在：用来避免翻译请求再被翻译的内部记号、占位符规则、`Output only the rewritten text.` |
| `style` | 空 | 追加一句口气，最长 4000 字 |
| `display` | `panel,log` | 见下表 |
| `panelPort` | `44721` | 页面端口，只监听 127.0.0.1 |
| `webhookUrl` | 空 | `display` 含 `webhook` 时使用，须是 http 或 https |

默认任务句是：

`Rewrite the user's text into plain, easy-to-read {language}. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.`

这两句始终保留：

`Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is, including the brackets and the number. Do not translate, delete, or move them.`

`Output only the rewritten text.`

| `display` 的值 | 去哪看 |
| --- | --- |
| `panel` | 浏览器打开 `http://127.0.0.1:44721`（或你的 `panelPort`） |
| `log` | `~/.local/share/magpie-translator/log.jsonl` |
| `file` | 同一目录的 `latest.txt`，`tail -f` 可当终端面板 |
| `stdout` | 前台运行 `node src/panel.mjs` 时打在终端。由 hook 拉起时标准输出是丢掉的 |
| `notify` | `notify-send`。没有这个命令就跳过 |
| `webhook` | 向 `webhookUrl` POST JSON。正文里没有网关钥匙 |

数据目录可以用 `MAGPIE_TRANSLATOR_HOME` 或 `XDG_DATA_HOME` 改。默认是 `~/.local/share/magpie-translator`。

改了 `panelPort` 之后，结束该目录 `panel.pid` 里的进程，下一轮回复会按新端口拉起。只改 `display` 时，已经在跑的工人会按新任务的出口送出；加上 `panel` 时它会补开页面。

页面打不开时，在含有 `src/panel.mjs` 的目录里、用同一个用户执行：

```bash
node src/panel.mjs
```

用路径装上时，`magpie plugin list` 印出的就是这个目录。它和 hook 共用上面的数据目录，会把收件箱里的任务译出来。

## 哪些字会送去翻译

只送面向用户的最终正文。工具调用、推理、思考块不送。magpie 给每个请求标四种 JSON 形状之一：`chat`、`responses`、`anthropic`、`gemini`。Codex 通常是 `responses`。Claude Code 是 `anthropic`。普通聊天应用是 `chat`。有工具调用时，`anthropic`、`chat`、`gemini` 整段不送。`responses` 只保留标成最终回答的正文，铺垫句和其他没标成最终回答的文字不送。

围栏代码、没合上的代码围栏、行内代码、以 `$ ` 开头的命令行会换成占位符再送。译文回来后按原样嵌回。翻译模型弄丢的那几段补在末尾，已经嵌回的不重复。整段都是代码时不发送。遮罩后超过 20000 个字符时从第 20000 个字符处截断，不找段落边界，页面会标明截断。

翻译在这一轮结束之后进行。agent 里先出现原文，译文随后出现在出口上。流式输出不会被改写。

agent 的原流程在这些情况下都照常。hook 写盘失败时，收件箱里没有这条，页面和日志也不会出现它。翻译请求失败或翻译模型没有返回文字时，页面和日志留下原文和错误原因。

## 为什么下一轮没有译文

插件不修改 magpie 写给 agent 的字节。Codex、Claude Code 和 Chat 客户端存进历史、下一轮再发出去的，是它们自己收到的原文。工人的翻译请求不带会话 id，也不会被写回工作模型的上下文。

若要核对这件事，看 [docs/DESIGN.md](docs/DESIGN.md) 的验证记录。本地可以跑：

```bash
npm test
MAGPIE_BIN=/path/to/magpie npm run e2e
```

`npm test` 里有一条「下一轮发给原模型的请求不含译文」，另有一条把 `language` 设成 `Français`。`npm run e2e` 用真实 magpie 网关再走一遍 Chat 续轮，并看 Responses、Anthropic 的客户端流仍是原文。

不接 magpie、只看页面时：

```bash
npm run demo
```

演示开在 <http://127.0.0.1:44721>，用的是假的翻译模型，不需要厂商密钥。
