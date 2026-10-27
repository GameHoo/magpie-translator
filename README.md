# magpie-translator

This plugin translates the final reply of a work model with another model you already configured in magpie. Set `language` to any language name. The agent still receives the original reply, and the next request sent back to the work model does not contain the translation.

The default language is `简体中文`. A rule can override it with `English`, `日本語`, `Français`, or any other name a person would recognize. The default instruction is English and inserts that name. It does not assume the translation is Chinese.

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

3. Write the rules. `translator` is an id from step 1. `model` can be one of those ids, or a prefix that ends with `*`. The next section says how a prefix matches. An empty `rules` array translates nothing. This example translates matching work models into English, and Claude models into Japanese. `gpt-5*` and `claude-*` are prefixes, not lines copied from `magpie models`:

   ```bash
   magpie plugin options <name> '{
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

   A single rule into French:

   ```json
   { "model": "gpt-5*", "translator": "deepseek/deepseek-chat", "language": "Français" }
   ```

   The JSON you pass to `plugin options` replaces the plugin's options. It does not merge with the previous JSON. The next finished reply uses the new `language`. You do not restart magpie for that change. Each reply is translated once, from the original into that rule's language. The translation is not sent back to the work model, so it is not translated again into a second language.

4. Let the work model answer one turn through magpie. Point the client magpie already routes (Codex, Claude Code, or another client) at magpie, then ask it something. Open <http://127.0.0.1:44721>. Before any matching reply, the page says there is no translation yet. After one, the card shows the language, work model, and translator from that turn. The page chrome is Chinese. The language of the translation is the `language` on the card, not the language of the chrome.

The two pictures below are that page in a 1440-pixel-wide window, taken on 2026-10-27 from `npm run demo`. Headings and buttons stay Chinese. The language line on each card is that turn's `language`. In these pictures it is `简体中文`. The footer shows port 44751 because that run set `MAGPIE_TRANSLATOR_PORT`. With no port set, `npm run demo` uses 44721.

A finished card keeps fenced commands in their original form. File: `docs/panel_success.png`.

![Finished card. The status is 已转述. The translation is two Chinese sentences, and the command stat -c %Y file stays in a code block.](docs/panel_success.png)

A card whose translator cannot be reached keeps the original sentence and shows the error. File: `docs/panel_failure.png`.

![Failed card. The status is 转述失败. The error is fetch failed. The original English sentence is still on the card.](docs/panel_failure.png)

`npm run demo` uses a fake translator on this machine, so this failure is a connection error. A live translator that returns an error shows that error text in the same place.

`magpie.options` inside `package.json` is only an example. The live config is what `magpie plugin options` writes.

## Settings page

Open <http://127.0.0.1:44721/settings> (or the port in `panelPort`). The form edits the same `plugins.json` entry as `magpie plugin options`. Saving writes that entry and leaves every other plugin alone. A magpie that is already running reads the new file on the next request. You do not restart it. A reply that has already started keeps the old options.

You can set the global language, prompt, style, and display, and you can add, edit, delete, and reorder rules. Pick a translator from the model list magpie reports, or type an id that is not in the list. The prompt box is multiple lines. 恢复默认 clears it; an empty prompt uses the default task sentence. `gatewayKey`, `panelPort`, `magpieBaseUrl`, and `gatewayTimeoutMs` are not on the form. Saving keeps the values already stored.

The page listens on 127.0.0.1 only. This page can save. A page at any other address cannot. The picture below is that page in a 1440-pixel-wide window, taken on 2026-10-27. File: `docs/panel_settings.png`.

![Settings page. Global language is English, the prompt contains {language}, and two rules list a translator, a model pattern, and a per-rule language.](docs/panel_settings.png)

How the file is chosen, and why the hook does not call `magpie.options.set`, is in [docs/DESIGN.md](docs/DESIGN.md).

## How a rule matches

Rules are tried in the order you write them. The first hit wins.

| Pattern | What it matches |
| --- | --- |
| omit `agent` | every client |
| omit `model` | every model |
| `"model": "gpt-5.4"` | `gpt-5.4` and `openai/gpt-5.4`. It does not match `gpt-5.4-mini` |
| `"model": "gpt-5*"` | a full id, or the last segment, that starts with `gpt-5` |
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
| `display` | `panel,log` | See the next table |
| `panelPort` | `44721` | Page port. Listens on 127.0.0.1 only |
| `webhookUrl` | empty | Used when `display` includes `webhook`. Must be http or https |

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

After you change `panelPort`, stop the process recorded in `panel.pid` in that directory. The next reply starts a worker on the new port. Changing only `display` applies to the next job. Adding `panel` opens the page if it was not listening.

If the page does not open, run this as the same user, from the directory that contains `src/panel.mjs`:

```bash
node src/panel.mjs
```

For a path install, `magpie plugin list` prints that directory. A github install prints `github:GameHoo/magpie-translator`, which is the name you pass to `plugin options`. The files are in `~/.config/magpie/plugins/node_modules/magpie-translator`. If `XDG_CONFIG_HOME` is set, replace `~/.config` with it. Run `node src/panel.mjs` in that directory. Either way, the page shares the data directory with the hook and translates jobs already in the inbox.

## What gets translated

Only the final prose a person is meant to read. Tool calls, reasoning, and thinking blocks are left out. Magpie labels each request with one of four JSON shapes: `chat`, `responses`, `anthropic`, or `gemini`. Codex usually uses `responses`. Claude Code uses `anthropic`. A typical chat app uses `chat`. When a turn contains a tool call, `anthropic`, `chat`, and `gemini` turns are skipped entirely. A `responses` turn that contains a tool call keeps only text whose `phase` is `final_answer`. A `responses` turn with no tool call is translated even when the text has no `phase`. Commentary is skipped.

Fenced code, an unclosed fence, inline code, and lines that start with `$ ` are replaced with placeholders before the translator sees them, then restored. Placeholders the translator drops are appended at the end. Slots that were restored are not repeated. A turn that is only code is not sent. After masking, text longer than 20000 characters is cut at character 20000. The page marks that cut.

Translation runs after the turn finishes. The agent sees the original first. The translation shows up on the sinks afterward. The live stream is not rewritten.

The original flow continues in every failure case. If the hook cannot write the job to disk, the inbox has no record and the page and log do not show it. If the translator request fails or returns no text, the page and the log keep the original plus the error.

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
