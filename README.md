# magpie-translator

This plugin translates the final reply of a work model with another model you already configured in magpie. Set `language` to any language name. The agent still receives the original reply, and the next request sent back to the work model does not contain the translation.

The default language is `简体中文`. A rule can override it with `English`, `日本語`, `Français`, or any other name a person would recognize. The default instruction is English and inserts that name. It does not assume the translation is Chinese.

Settings and the translation history live in magpie: a settings panel, and a sidebar page for comparing the original with the translation. The old page at `127.0.0.1:44721` stays off unless `display` includes `panel` or `localPanel` is true. `npm test` is 48 tests, last run on 2026-10-27. No Codex app and no magpie window were opened in that run.

中文说明：[README.zh-CN.md](README.zh-CN.md)。设计取舍和核验记录：[docs/DESIGN.md](docs/DESIGN.md)。核验日期 2026-10-27。

## Install and write one rule

You need a local magpie that is already running, at version 0.1.1273 or later, and Node.js 20 or later (for tests and for opening the page yourself). `magpie version` prints the version. This text was checked against 0.1.1731. Magpie runs the hook with the Bun it ships. The hook is the plugin entry magpie calls after a request; you do not start it yourself.

1. List translator ids. Every `provider/model` line is valid, including providers added by plugins:

   ```bash
   magpie models
   ```

   If the model you want is not listed, add its provider first, then list again. For a vendor magpie already knows: `magpie provider add deepseek sk-...`. `magpie provider --help` shows the other fields.

2. Install this repo. `<name>` in the next step is whatever `plugin list` prints:

   ```bash
   magpie plugin add github:GameHoo/magpie-translator
   magpie plugin list
   ```

   A local checkout works the same way: `magpie plugin add /path/to/magpie-translator`. The name is then that path.

3. Write the rules. `translator` is an id from step 1. `model` can be one of those ids, or a glob: `*` matches any stretch, anywhere in the id, and the match ignores case. The next section has examples. An empty `rules` array translates nothing. This example translates matching work models into English, and Claude models into Japanese. `gpt-5*` and `claude-*` are globs, not lines copied from `magpie models`. `display` here is only the log. The history you read is the magpie sidebar page, which is written even when `panel` is off:

   ```bash
   magpie plugin options <name> '{
     "language": "English",
     "style": "Use short sentences.",
     "display": ["log"],
     "translateTimeoutMs": 120000,
     "rewriteSameLanguage": false,
     "historyLimit": 500,
     "rules": [
       { "model": "gpt-5*", "translator": "deepseek/deepseek-chat" },
       { "model": "claude-*", "translator": "gemini/gemini-2.5-flash", "language": "日本語" }
     ]
   }'
   ```

   A single rule into French:

   ```json
   { "model": "gpt-5*", "translator": "deepseek/deepseek-chat", "language": "Français" }
   ```

   The JSON you pass to `plugin options` replaces the plugin's options. It does not merge with the previous JSON. The next finished reply uses the new `language`. You do not restart magpie for that change. Each reply is translated once, from the original into that rule's language. The translation is not sent back to the work model, so it is not translated again into a second language.

4. Let the work model answer one turn through magpie. Point the client magpie already routes (Codex, Claude Code, or another client) at magpie, then ask it something. Open magpie's sidebar page titled Translations (中文标题是「转述记录」). Before any matching reply, the page says there is no translation yet. After one, the row shows the agent, work model, translator, language, latency, and time. The page chrome is Chinese. The language of the translation is the `language` on the row, not the language of the chrome.

`magpie plugin list` still prints `async gateway hook onRequest`, and the hook row in the window says it is waiting for a request. Those two lines are magpie's own labels. This plugin does export `onResponse`. It does not call `ctx.report`, because that status is for plugins that inject context.

The two pictures below are the optional localhost page, not the magpie sidebar. They were taken on 2026-10-27 from `npm run demo`, in a 1440-pixel-wide window. Headings and buttons stay Chinese. The language line on each card is that turn's `language`. In these pictures it is `简体中文`. The footer shows port 44751 because that run set `MAGPIE_TRANSLATOR_PORT`. With no port set, `npm run demo` uses 44721. `npm run demo` turns the localhost page on for that run. A normal install leaves it off.

A finished card keeps fenced commands in their original form. File: `docs/panel_success.png`.

![Finished card. The status is 已转述. The translation is two Chinese sentences, and the command stat -c %Y file stays in a code block.](docs/panel_success.png)

A card whose translator cannot be reached keeps the original sentence and shows the error. File: `docs/panel_failure.png`.

![Failed card. The status is 转述失败. The error is fetch failed. The original English sentence is still on the card.](docs/panel_failure.png)

`npm run demo` uses a fake translator on this machine, so this failure is a connection error. A live translator that returns an error shows that error text in the same place.

`magpie.options` inside `package.json` is only an example. The live config is what `magpie plugin options` writes.

## Settings and history inside magpie

The settings panel is the plugin's settings slot. The history page is the plugin's own sidebar tab. Both files are under `ui/`. Magpie does not allow a page to call `fetch`, open a WebSocket, or use an inline script, so both pages load scripts from that folder.

The worker writes two files next to those pages:

- `ui/catalog.js` is the model list from the local gateway's `/v1/models`, or from `magpie models` if the gateway list is empty. It refreshes about once a minute.
- `ui/feed.js` is the recent history the page shows. It is not written into `plugins.json`. Writing options reloads magpie's hook host, so a translation must not do that.

`providers:list` returns provider ids and names, not model ids. The settings panel uses those ids as `providerId/*` (every model from that provider, including ones added later) and uses the catalog for a concrete translator id. You can still type an id that is not listed.

Saving settings calls `magpie.options.set` with the previous options merged in, so `gatewayKey`, `panelPort`, `magpieBaseUrl`, and `gatewayTimeoutMs` stay. A normal save drops a pending `_compare`. Saving reloads the hook host once. The next finished reply uses the new options. The Bun hook itself does not call `magpie.options.set`.

On a history row, 对照翻译 picks another translator and sets `_compare` once. The worker translates the stored original again and stacks that result on the same row. It does not start a new card. If the worker is not running, the compare waits until the next hooked request. The page cannot download a file. Export puts the filtered rows in a text box.

History is `history.json` in the data directory. The default cap is the last 500 rows (`historyLimit`, from 20 to 2000). The script the page loads omits the gateway key, the masked text, the placeholders, the prompt, and the magpie address.

The picture below is the optional localhost settings page, taken on 2026-10-27. It is not the magpie panel. File: `docs/panel_settings.png`.

![Settings page. Global language is English, the prompt contains {language}, and two rules list a translator, a model pattern, and a per-rule language.](docs/panel_settings.png)

The localhost page is off by default. Turn it on with `"localPanel": true` or by putting `panel` in `display`, then open <http://127.0.0.1:44721/settings> (or `panelPort`). It edits the same `plugins.json` entry and listens on 127.0.0.1 only. A field that form does not send is left as it was, so an older form does not wipe the timeout or the history cap. How the file is chosen is in [docs/DESIGN.md](docs/DESIGN.md).

## How a rule matches

Rules are tried in the order you write them. The first hit wins.

| Pattern | What it matches |
| --- | --- |
| omit `agent` | every client |
| omit `model` | every model |
| `"model": "gpt-5.4"` | `gpt-5.4` and `openai/gpt-5.4`, in any case. It does not match `gpt-5.4-mini` |
| `"model": "gpt-5*"` | a full id, or the last segment, that starts with `gpt-5` |
| `"model": "*gpt*"` | `*` anywhere. `acme/foo-gpt-bar` matches. `?` stays a literal question mark |
| `"model": "deepseek/*"` | every model whose full id starts with that provider. The bare name alone does not match |
| `"agent": "codex"` | the whole word, case-insensitive |

`agent` must be the name shown on the panel card. To pin one client, first match on `model` only, read the name on the card, then add `agent`.

A rule can override the global `language`, `prompt`, `style`, `display`, and `webhookUrl`. Omit `language` on a rule to keep the global one. The global default, when you omit it too, is `简体中文`.

Vendor API keys stay in `magpie provider`. Leave `gatewayKey` unset unless your magpie already requires a specific bearer for local calls. The worker then sends `magpie-translator`. If you already set a named gateway key, put that same string in `gatewayKey`.

## Language, prompt, and where the translation goes

| Field | Default | What it does |
| --- | --- | --- |
| `language` | `简体中文` | The language name inserted into the default prompt. Any name works, such as `English`, `日本語`, or `Français` |
| `prompt` | empty | Replaces only the task sentence, up to 4000 characters. A custom sentence may contain `{language}`, `{style}`, `{model}`, and `{translator}`. They are replaced once, when the translator request is built. Any other `{token}` stays as written. Three pieces stay: an internal marker so the plugin does not translate its own request, the placeholder rule, and "Output only the rewritten text." |
| `style` | empty | One extra line about tone, up to 4000 characters |
| `display` | `log` | See the next table. This does not turn the magpie history page off |
| `panelPort` | `44721` | Localhost page port, used only when that page is on. Listens on 127.0.0.1 only |
| `localPanel` | false | Open the localhost page even when `display` has no `panel` |
| `webhookUrl` | empty | Used when `display` includes `webhook`. Must be http or https |
| `translateTimeoutMs` | `120000` | One translator call. Clamped to 10–600 seconds. A timeout, a dropped connection, or HTTP 408, 429, or 5xx is tried once more. Other 4xx errors are not. The second failure says `（已重试一次）` |
| `rewriteSameLanguage` | false | When false, prose that is already in the target language is not sent. A rule can set the same field to override this. Unknown language names are still translated. Recognized names include 简体中文, 繁体中文, English, 日本語, 한국어, and a few others. French and other Latin languages are not treated as English |
| `historyLimit` | `500` | How many rows `history.json` keeps. Clamped to 20–2000 |

The default task sentence, with the language name already filled in, is:

`Rewrite the user's text into plain, easy-to-read English. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.`

That example uses `English`. The name in the sentence is whatever `language` is for that turn. `{language}` is not left in the default sentence. Write `{language}` only in a custom `prompt` or `style` when you want the name substituted there.

These two lines are always kept:

`Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is, including the brackets and the number. Do not translate, delete, or move them.`

`Output only the rewritten text.`

| `display` value | Where to look |
| --- | --- |
| `panel` | Open `http://127.0.0.1:44721` (or your `panelPort`) |
| `log` | `~/.local/share/magpie-translator/log.jsonl` |
| `file` | `latest.txt` in that same directory. `tail -f` works as a terminal view |
| `stdout` | Printed when you run `node src/panel.mjs` in the foreground. A worker started by the hook discards stdout |
| `notify` | `notify-send`. If that command is missing, this sink is skipped |
| `webhook` | POST JSON to `webhookUrl`. The body does not include the gateway key |

Change the data directory with `MAGPIE_TRANSLATOR_HOME` or `XDG_DATA_HOME`. The default is `~/.local/share/magpie-translator`.

After you change `panelPort`, stop the process recorded in `panel.pid` in that directory. The next reply starts a worker on the new port. A worker started by the hook listens only when that job's `display` includes `panel`, or `localPanel` is true. Running `node src/panel.mjs` yourself, with no `MAGPIE_TRANSLATOR_DISPLAY`, opens the page.

If the page does not open, run this as the same user, from the directory that contains `src/panel.mjs`:

```bash
node src/panel.mjs
```

For a path install, `magpie plugin list` prints that directory. A github install prints `github:GameHoo/magpie-translator`, which is the name you pass to `plugin options`. The files are in `~/.config/magpie/plugins/node_modules/magpie-translator`. If `XDG_CONFIG_HOME` is set, replace `~/.config` with it. Run `node src/panel.mjs` in that directory. Either way, the page shares the data directory with the hook and translates jobs already in the inbox.

## What gets translated

Only the final prose a person is meant to read. Tool calls, reasoning, and thinking blocks are left out. Magpie labels each request with one of four JSON shapes: `chat`, `responses`, `anthropic`, or `gemini`. Codex usually uses `responses`. Claude Code uses `anthropic`. A typical chat app uses `chat`.

These replies are not translated:

- The whole reply is JSON, including a single ` ```json ` fence. Codex title and suggestion helpers look like this.
- The request asks for structured output (`response_format`, `text.format`, Gemini `responseMimeType: application/json`, or a schema).
- The request is a title, summary, suggestion, or description helper (metadata such as `thread_title`, a schema name, or a short instruction that says so).
- The request has a conversation shape but no user turn. A body that is only `{ "model": "..." }` is not skipped for that reason.
- The prose is already in the target language, and `rewriteSameLanguage` is off.

When a turn contains a tool call, `anthropic`, `chat`, and `gemini` turns are skipped entirely. A `responses` turn keeps text marked `final_answer` when any text has that phase. Otherwise, if there is no tool call, it keeps the non-commentary text even when `phase` is missing. If there is a tool call, it keeps only text that comes after the last tool. Commentary before a tool stays out. A Codex main answer is often a `reasoning` item followed by a `message` with no `phase`. That message is captured.

On magpie's agent route, `src/middleware.mjs` copies assistant text from `response.output_text.delta` and `response.output_item.done` onto `response.completed` when that event's `output` has no assistant text. Codex's own ChatGPT sign-in path runs the async hook and does not run this middleware. If that path's `response.completed` omits the output entirely, the plugin never sees the main answer. This was not checked against a live Codex session.

Fenced code, an unclosed fence, inline code, and lines that start with `$ ` are replaced with placeholders before the translator sees them, then restored. Placeholders the translator drops are appended at the end. Slots that were restored are not repeated. A turn that is only code is not sent. After masking, text longer than 20000 characters is cut at character 20000. The page marks that cut.

Translation runs after the turn finishes. The agent sees the original first. The translation shows up on the sinks afterward. The live stream is not rewritten.

The original flow continues in every failure case. If the hook cannot write the job to disk, the inbox has no record and the page and log do not show it. If the translator request fails or returns no text, the history and the log keep the original plus the error. The call waits `translateTimeoutMs` (default 120 seconds) and retries once on a timeout or a 5xx.

## Why the next request has no translation

The plugin does not change the bytes magpie writes to the agent. Codex, Claude Code, and Chat clients store what they received and send that back. The worker's translation request has no session id, so it is not written back into the work model's context.

The checks for that claim are in [docs/DESIGN.md](docs/DESIGN.md). Locally:

```bash
npm test
MAGPIE_BIN=/path/to/magpie npm run e2e
```

`npm test` includes "下一轮发给原模型的请求不含译文" and a case that sets `language` to `Français`. `npm run e2e` walks a real magpie gateway for a Chat follow-up turn, and checks that Responses and Anthropic client streams stay in the original text.

To look at the page without magpie:

```bash
npm run demo
```

The demo listens on <http://127.0.0.1:44721> and uses a fake translator. No vendor key is required.
