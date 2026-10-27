# magpie 旁路转述

这个插件把你选定的工作模型的最终回复，用另一个已在 magpie 里配好的模型，转述成你指定的语言。默认是通俗中文。转述出现在本机页面或其他出口上。agent 拿到的仍是原文，下一轮发回工作模型的内容里没有译文。

设计取舍和核验记录在 [docs/DESIGN.md](docs/DESIGN.md)。核验日期 2026-10-27。

## 装上并写一条规则

需要本机已经在跑的 magpie（异步 gateway hook，0.1.1273 及以后；本文按 0.1.1731 核对），以及 Node.js 20 或以上（跑测试和手动打开页面时用）。magpie 用它自带的 Bun 跑 hook。

1. 看翻译模型的 id。下面命令印出的 `provider/model` 都能填，包括插件提供的 provider：

   ```bash
   magpie models
   ```

2. 装上这个目录（名字就是你写的路径）：

   ```bash
   magpie plugin add /path/to/magpie-plain-zh
   magpie plugin list
   ```

3. 把规则写进去。`<名字>` 用上一步列表里的那一项。`translator` 和 `model` 换成你的 id。规则为空时什么都不转述。

   ```bash
   magpie plugin options <名字> '{
     "language": "简体中文",
     "style": "用短句，像在跟同事解释。",
     "display": ["panel", "log"],
     "panelPort": 44721,
     "rules": [
       { "model": "gpt-5*", "translator": "deepseek/deepseek-chat" }
     ]
   }'
   ```

4. 让工作模型经 magpie 回答一轮。然后打开 <http://127.0.0.1:44721> 。卡片上的语言、工作模型和翻译模型来自这一轮的配置。

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

同一条规则里可以盖过全局的 `language`、`prompt`、`style`、`display`、`webhookUrl`。例如工作模型走中文、另一个模型走英文：

```json
{
  "language": "简体中文",
  "rules": [
    { "model": "gpt-5*", "translator": "deepseek/deepseek-chat" },
    { "model": "claude-*", "translator": "gemini/gemini-2.5-flash", "language": "English" }
  ]
}
```

厂商的 API key 仍放在 `magpie provider` 里。插件配置里的 `gatewayKey` 只用于工人回叫本机 magpie，默认 `magpie-plain-zh`。你若给 magpie 配了具名网关钥匙，把同一把写进 `gatewayKey`。

## 语言、提示词和出口

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `简体中文` | 默认提示词中的目标语言，如 `日本語`、`English` |
| `prompt` | 空 | 写了就只换掉「改写成某种语言」那一句，最长 4000 字。内部记号、占位符必须原样保留、只输出正文，这三样仍在 |
| `style` | 空 | 追加一句口气，最长 4000 字 |
| `display` | `panel,log` | 见下表 |
| `panelPort` | `44721` | 页面端口，只监听 127.0.0.1 |
| `webhookUrl` | 空 | `display` 含 `webhook` 时使用，须是 http 或 https |

| `display` 的值 | 去哪看 |
| --- | --- |
| `panel` | 浏览器打开 `http://127.0.0.1:44721`（或你的 `panelPort`） |
| `log` | `~/.local/share/magpie-plain-zh/log.jsonl` |
| `file` | 同一目录的 `latest.txt`，`tail -f` 可当终端面板 |
| `stdout` | 前台运行 `node src/panel.mjs` 时打在终端。由 hook 拉起时标准输出是丢掉的 |
| `notify` | `notify-send`。没有这个命令就跳过 |
| `webhook` | 向 `webhookUrl` POST JSON。正文里没有网关钥匙 |

数据目录可以用 `MAGPIE_PLAIN_ZH_HOME` 或 `XDG_DATA_HOME` 改。默认是 `~/.local/share/magpie-plain-zh`。

改了 `panelPort` 之后，结束该目录 `panel.pid` 里的进程，下一轮回复会按新端口拉起。只改 `display` 时，已经在跑的工人会按新任务的出口送出；加上 `panel` 时它会补开页面。

页面打不开时，在同一个用户下执行：

```bash
node src/panel.mjs
```

它和 hook 共用上面的数据目录，会把收件箱里的任务译出来。

## 哪些字会送去转述

只送面向用户的最终正文。工具调用、推理、思考块不送。有工具调用时，Anthropic、Chat、Gemini 整段不送；Responses 只保留标成最终回答的正文，铺垫句不送。

围栏代码、没合上的代码围栏、行内代码、以 `$ ` 开头的命令行会换成占位符再送。译文回来后按原样嵌回。翻译模型弄丢的那几段补在末尾，已经嵌回的不重复。整段都是代码时不发送。遮罩后超过 20000 个字符时从第 20000 个字符处截断，不找段落边界，页面会标明截断。

翻译在这一轮结束之后进行。agent 里先出现原文，转述随后出现在出口上。流式输出不会被改写。

agent 的原流程在这些情况下都照常。hook 写盘失败时，收件箱里没有这条，页面和日志也不会出现它。翻译请求失败或翻译模型没有返回文字时，页面和日志留下原文和错误原因。

## 为什么下一轮没有译文

插件不修改 magpie 写给 agent 的字节。Codex、Claude Code 和 Chat 客户端存进历史、下一轮再发出去的，是它们自己收到的原文。工人的翻译请求不带会话 id，也不会被写回工作模型的上下文。

若要核对这件事，看 [docs/DESIGN.md](docs/DESIGN.md) 的验证记录。本地可以跑：

```bash
npm test
MAGPIE_BIN=/path/to/magpie npm run e2e
```

`npm test` 里有一条「下一轮发给原模型的请求不含译文」。`npm run e2e` 用真实 magpie 网关再走一遍 Chat 续轮，并看 Responses、Anthropic 的客户端流仍是原文。

不接 magpie、只看页面时：

```bash
npm run demo
```

演示开在 <http://127.0.0.1:44721> ，用的是假的翻译模型，不需要厂商密钥。
