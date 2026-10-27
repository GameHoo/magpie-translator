<p align="center">
  <img src="docs/icon.svg" width="96" height="96" alt="magpie-translator">
</p>

<h1 align="center">magpie-translator</h1>

<p align="center">One model answers. A second model rewrites that final reply in the style of your prompt. The original stays in the session. The rewrite never does.</p>

<p align="center"><a href="README.zh-CN.md">中文</a> · <a href="docs/DESIGN.md">Design notes</a> · MIT</p>

Package name: `@magpie-community/page-translator`.

## What it does

A [magpie](https://github.com/yetone/magpie) plugin. After a reply finishes, the hook sends the final prose to a translator model you choose. The result shows on the **Translations** page in magpie's sidebar. It can also go to a log, a file, a desktop notification, or a webhook.

- The agent receives the original bytes. Nothing is written back into the session, so the next turn does not contain the rewrite.
- Fenced code, inline code, and `$ ` command lines are replaced with placeholders and put back afterwards.
- The prompt is yours. Translation is one use. The same plugin can simplify, restructure, or change tone.
- A new install translates nothing until you add a rule.

The default task, used when `prompt` is empty, is:

```text
Rewrite the user's text into plain, easy-to-read {language}. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.
```

`{language}` is replaced with the language name (default `简体中文`). The settings box shows this same sentence. Saving it unchanged stores an empty prompt.

## Install

magpie 0.1.1273 or newer. The translator model must already work in magpie (`magpie models`).

```bash
magpie plugin add github:GameHoo/magpie-translator
magpie plugin list
```

Once this package is in the community registry, the install name is `@magpie-community/page-translator`. If a command says `no plugin`, use the name `magpie plugin list` prints: a GitHub install is `github:GameHoo/magpie-translator`, a path install is that path.

Open **Translator** in magpie's settings, add a rule (source model on the left, translator model on the right), and save. Or:

```bash
magpie plugin options <name-from-plugin-list> '{
  "language": "简体中文",
  "rules": [
    { "model": "gpt-*", "translator": "traex/gemini-3-flash" },
    { "model": "*",     "translator": "your-provider/your-model" }
  ]
}'
```

`magpie plugin options` replaces the whole options object. The settings panel keeps fields it does not edit.

Rules match top to bottom and stop at the first hit. Omit `agent` or `model` to mean every client or every model. `model` is a case-insensitive glob (`gpt-*`, `deepseek/*`, `*gpt*`). `agent` is a whole word. A rule may set its own `language`, `prompt`, `style`, `display`, `webhookUrl`, and `rewriteSameLanguage`.

## Settings

The panel writes the same `options` object as the CLI, in magpie's `plugins.json`. The next reply uses the new settings.

| Panel | Field | Default | Notes |
| --- | --- | --- | --- |
| Switch | `enabled` | on | Off stops new rewrites. The plugin stays installed |
| Language | `language` | `简体中文` | Any human-readable name |
| Style | `style` | empty | Presets fill `{style}`: plain, keep terms, brief, detailed |
| Placement | `placement` | `beside` | History page only: `below`, `beside`, or `only` |
| Translator badge | `showTranslatorBadge` | on | Model and latency on the card |
| Collapse original | `collapseOriginal` | off | Only when placement is `below` |
| Skip same language | `rewriteSameLanguage` (inverted) | skip | A local script check. Unknown languages are still sent |
| Code stays put | — | always | Cannot be turned off |
| Timeout | `translateTimeoutMs` | 10s | The slider stores 10–120s. The hook cannot wait longer than `gatewayTimeoutMs` (10s at most) |
| History | `historyLimit` | 500 | 100, 500, 1000, 5000, or `0` to keep none |
| Rules | `rules` | `[]` | Empty means do nothing |
| Prompt | `prompt` | empty | Placeholders: `{language}` `{style}` `{model}` `{translator}` |

CLI-only: `display` (`log`, `file`, `stdout`, `notify`, `webhook`; default `["log"]`), `webhookUrl`, `gatewayKey`, `magpieBaseUrl`, `gatewayTimeoutMs` (100–10000, default 10000).

## History page

Sidebar → **Translations** (`翻译记录`).

- Success rate and median latency, search, and filters for agent, source model, translator, and status.
- Side-by-side original and rewrite, copy either side, and a note when code moved or text was clipped.
- **Compare** sends the same original to another model. **Retry** runs the same translator again. Both are queued and run on the next reply that passes through magpie.
- Failures and timeouts keep the original and the error. Timeouts, disconnects, and HTTP 408 / 429 / 5xx are retried once by the plugin.
- Copy the filtered rows as JSON or Markdown.

## Where data is stored

Full history stays on disk, mode `0600`:

- `$MAGPIE_TRANSLATOR_HOME`, or `$XDG_DATA_HOME/magpie-translator`, or `~/.local/share/magpie-translator/`
- `history.json` — full rows, including the masked text and the prompt used for compare. No gateway key
- `log.jsonl`, `latest.txt` (when `display` includes `file`), `compare-seen.json`

The page cannot read that directory. The hook publishes a public slice into magpie's plugin options (`~/.config/magpie/plugins.json`, or `$XDG_CONFIG_HOME/magpie/plugins.json`) as `options.feed`. The page loads it with `magpie.options.get()`. The slice is the newest rows that fit in about 48KB. It has no gateway key, prompt, masked text, or magpie address. Older rows and unclipped full text remain in `history.json`. A row that is too long is marked clipped on the page.

The original is sent only to the translator model you configured, through the local magpie gateway. The plugin opens no port of its own. Webhook is off unless you set it, and the body has no gateway key.

`historyLimit: 0` clears `history.json` on the next rewrite and does not backfill the log.

## How it runs

Translation happens inside `onResponse` in `src/hooks.mjs`. The hook `POST`s magpie's `/v1/chat/completions` and waits, capped by `gatewayTimeoutMs`. `onRequest` does not rewrite the body and does not wait on a model. `magpie plugin list` still prints `async gateway hook onRequest` for every async hook. That string is magpie's.

`src/middleware.mjs` is one file with no imports. It only fills an empty Responses `response.completed` from text already in the stream. It does not inject the rewrite and does not retry.

The page is sandboxed: no network, no inline scripts. It may call `magpie.read` only for `providers:list` and `usage:summary`. Compare and retry are `magpie.options.set({ _compare })`. The host restarts the hook, and the job runs on the next gateway reply. Publishing `options.feed` also restarts the hook on the next request when the JSON changed. An unchanged feed is not written.

There is no background worker and no local HTTP panel.

Tool calls, reasoning, pure JSON, structured-output requests, title helpers, code-only replies, and (by default) text already in the target language are skipped. Masked prose longer than 20,000 characters is cut.

## Develop

```bash
HOME=$(mktemp -d) bun test
bun scripts/check.mjs
```

## License

[MIT](LICENSE)
