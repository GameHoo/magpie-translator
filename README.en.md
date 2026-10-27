<p align="center"><img src="docs/icon.svg" width="96" height="96" alt="magpie-translator"></p>

# magpie-translator

**One model works; another rewrites its final reply into plain language, in the language you pick. The original goes back to the session unchanged, and the translation never enters it.**

[中文说明](README.md) · [Design notes](docs/DESIGN.md) · MIT

## Why a side channel

If you ask Codex or Claude Code to answer in your language, the session history is in that language too, and the next turn reads it. magpie-translator is a [magpie](https://github.com/yetone/magpie) plugin that stays out of that path:

- The agent receives the original reply. The plugin does not change the bytes magpie sends to the client.
- The translation request is sent separately to your local magpie with no session id, so the next request to the work model doesn't contain the translation. A test checks this.
- Code blocks, inline code, and `$ ` commands are masked before translation and restored untouched.

## Screenshots

<!-- TODO: docs/settings.png: the Translator panel in magpie Settings -->
![Translator settings panel](docs/settings.png)

<!-- TODO: docs/history.png: the Translations page with a compare column -->
![Translations page](docs/history.png)

## Install

Requires a running magpie, version 0.1.1273 or later (checked against 0.1.1731). The translator models must already work in magpie (`magpie models`).

```bash
magpie plugin add github:GameHoo/magpie-translator
magpie plugin off|on magpie-translator
magpie plugin update
```

It's also listed under **Plugins → Discover → Unofficial**, because the repository has the `magpie-plugin` topic. If the short name isn't found, use the name `magpie plugin list` prints (`github:GameHoo/magpie-translator`).

## Quick start

There are no rules after install, so nothing is translated yet. Add one in magpie Settings → **Translator**, or with the CLI:

```bash
magpie plugin options magpie-translator '{
  "language": "English",
  "rules": [
    { "model": "gpt-*", "translator": "traex/doubao-seed-2.1-pro" },
    { "model": "*",     "translator": "grok/grok-4.7-build-fast" }
  ]
}'
```

Translator ids come from `magpie models`; the ones above are examples. Rules are tried top to bottom, and the first match wins. `magpie plugin options` **replaces** all options rather than merging them. The settings panel keeps fields it doesn't show.

## Settings (Translator panel)

| Setting | Field | Default |
| --- | --- | --- |
| On/off switch | `enabled` | on |
| Target language | `language` | `简体中文`; any language name works |
| Style preset: plain, keep terms, brief, full | `style` | plain |
| Placement on the Translations page: below, side by side, translation only | `placement` | side by side |
| Translator badge / collapse original | `showTranslatorBadge` / `collapseOriginal` | on / off |
| Skip replies already in the target language | `rewriteSameLanguage` (inverted) | skip |
| Timeout | `translateTimeoutMs` | 120 s (10–120 s in the panel; up to 600 s via CLI) |
| History kept | `historyLimit` | 500 (100, 500, 1000, 5000, or 0 = don't keep) |
| Rules: source → translator, with optional per-rule language and prompt | `rules` | `[]` |
| Prompt, with `{language}` `{style}` `{model}` `{translator}` and reset | `prompt` | empty, which uses the built-in English task sentence |

These fields can only be set from the CLI: `display` (`log` by default; also `file`, `panel`, `stdout`, `notify`, `webhook`), `webhookUrl`, `localPanel`, `panelPort`, `gatewayKey`, `magpieBaseUrl`.

## Translations page

- Original and translation are shown side by side, aligned by paragraph, with synced scrolling.
- Search, and filter by agent, source model, translator, and status. A header shows the success rate and median latency.
- **Compare with another model**, then mark the better one.
- Failed and timed-out cards keep the original and the error, with **Retry** and **Retry with another model** buttons. Timeouts, dropped connections, and HTTP 408/429/5xx are retried once automatically.
- Export the filtered rows as JSON or Markdown, copied to the clipboard.

## How it works

The `onRequest` and `onResponse` hooks (`src/hooks.mjs`, run by magpie's Bun) plus an `onEvent` middleware (`src/middleware.mjs`) capture the final reply after the turn ends. They mask the code and drop a job in a local inbox. A background worker calls your local magpie (`/v1/chat/completions`) with the translator model and writes `history.json`. Magpie runs plugin pages in a sandboxed iframe with no `fetch`, so the worker publishes `ui/feed.js` and `ui/catalog.js` for the page and panel to load. Saving settings, compare, and retry go through `magpie.options.set`.

## Privacy

Text goes only to the translator model you choose, through your local magpie. The plugin contacts no other service. History stays in `~/.local/share/magpie-translator/`. The optional localhost page (`127.0.0.1:44721`) is off by default and binds to localhost only.

## License

MIT
