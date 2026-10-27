# Design

`@magpie-community/page-translator` rewrites a finished reply beside the session. The agent keeps the original bytes. Checked against magpie 0.1.1731's plugin host, `internal/gui/pagebridge.js`, and `internal/plugin/page.go`.

## Why the reply is not rewritten

`onResponse` runs after the client has the bytes. Returning a new body does not change what the client stored. Codex, Claude Code, and Chat Completions clients send that stored text back on the next turn. Editing the stream would put the rewrite into that history, and it would also break Claude thinking signatures and tool-call bytes. The hook only reads the reply.

`src/middleware.mjs` may patch an empty Responses `response.completed` with text already present in the stream. It does not replace that text with a translation, and it does not retry. Codex's ChatGPT passthrough runs async hooks and does not run this middleware. A completed event with no output on that path is still invisible to the plugin.

## Where the second model is called

`onRequest` marks `ctx.state.own` when the request carries `MAGPIE_TRANSLATOR_SIDECAR_v1`, and otherwise publishes the public feed once per data directory per process (including a one-time backfill from `log.jsonl`). It does not call a model. Calling one here would delay the user's request.

`onResponse` returns immediately for the plugin's own request, so a compare cannot recurse. Otherwise it translates the current reply, then runs a pending `_compare`, then may list models once, then publishes the feed.

The translator call is `POST <magpie>/v1/chat/completions` inside that hook, through `ctx.fetch` when magpie provides it. `gatewayTimeoutMs` (integer 100–10000, otherwise 1000; the package default is 10000) is the host's abort deadline. `translateTimeoutMs` is stored from 10s to 600s, and the call uses the smaller of that value and the gateway cap. A slider value above 10s is kept but cannot finish. The plugin retries once on timeout, disconnect, 408, 429, or 5xx, unless the host signal is already aborted. HTTP 400 is not retried.

`options.models` is filled at most once per data directory per process, from `GET /v1/models`, when it is not already an array. The page also uses `providers:list`, `usage:summary`, and model ids already in the feed. There is no `magpie models` subprocess and no generated catalog file.

## What the page is allowed to do

The frame has `connect-src 'none'` and no inline scripts. Bridge calls used here:

- `magpie.options.get()` reads `options.feed` and the rest of the settings.
- `magpie.options.set()` saves settings, and queues compare or retry as `_compare: { nonce, entryId, translator, replace }`. The body limit is 64KiB and the host accepts one write a second. A package with hooks restarts its host on a real options change.
- `magpie.read("providers:list")` and `magpie.read("usage:summary", { period: "30d" })`. Those are the only page reads magpie implements. Neither returns a secret. Unknown permissions are ignored.

There is no page read of a plugin data file and no page-to-hook RPC. Compare and retry therefore wait until the next gateway `onResponse`. `runCompare` marks the nonce in `compare-seen.json` before the call, so a second reply does not call twice. `replace: true` overwrites the row. Otherwise the result is appended to `comparisons`.

`options.feed` is the newest public rows that fit in 48KB (`FEED_BUDGET`), so a later settings save stays under 64KiB. Public fields are `id`, `at`, `agent`, `model`, `translator`, `language`, `style`, `ms`, `original`, `translation`, `error`, `status`, `truncated`, `comparisons`, and `viewClipped` when the clipper shortened text. `gatewayKey`, `prompt`, `masked`, `slots`, and `magpieBaseUrl` stay in `history.json` only. An unchanged feed is not written, so the host is not restarted for an empty delta.

`magpie.actions` only opens a page from a provider or agent row. It cannot name a history row, so it is not used for retry.

## Files

Data directory: `$MAGPIE_TRANSLATOR_HOME`, else `$XDG_DATA_HOME/magpie-translator`, else `~/.local/share/magpie-translator`.

| File | Role |
| --- | --- |
| `history.json` | Canonical rows, mode 0600. `historyLimit` 0 clears it on the next record |
| `log.jsonl` | Append-only log when `display` includes `log` |
| `latest.txt` | Last rewrite when `display` includes `file` |
| `compare-seen.json` | Nonces already started |

`display` accepts `log`, `file`, `stdout`, `notify`, `webhook`. Unknown names, including the old `panel`, fall back to `log` when nothing valid remains. The package directory is never written. There is no `inbox/`, `panel.pid`, local port, or `ui/feed.js`.

Plugin options live in `$XDG_CONFIG_HOME/magpie/plugins.json` or `~/.config/magpie/plugins.json`. The hook finds this package by path, by `github:` spec, or by `MAGPIE_TRANSLATOR_PLUGIN`.

## What is extracted

No tools: the user-facing final text is sent. Anthropic, Chat, and Gemini replies that contain a tool call are skipped entirely. Responses keeps `final_answer` when present, otherwise the prose after the last tool call. Reasoning and thinking are dropped. Pure JSON, structured output, title or suggestion helpers, and requests with no user turn are skipped after extraction. Code is masked before the call. If no prose remains, nothing is sent. Masked text is cut at 20,000 characters.

## Checks

```bash
HOME=$(mktemp -d) bun test
bun scripts/check.mjs
```

`scripts/check.mjs` is the community checker. This package declares middleware and a page and has no `main`, so the checker skips it. Hook and page behavior is covered by the tests in `test/`.
