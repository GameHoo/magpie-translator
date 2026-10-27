# Design

`@magpie-community/page-translator` rewrites a finished reply beside the session. The agent keeps the original bytes. The model call does not run inside a magpie hook.

Checked against magpie `f8cd964`: `internal/plugin/host.js` (hook budget), `internal/gui/pagebridge.js`, `internal/plugin/page.go`, and `internal/plugin/tools.go`.

## Why the call is not inside the hook

Magpie aborts `onRequest` and `onResponse` at `gatewayTimeoutMs`. That value is an integer from 100 to 10000, otherwise 1000. The whole hook chain is also capped at 10 seconds. A real rewrite takes 12–105 seconds, so a call started in the hook is aborted, and the abort also cancels its `fetch`.

This package does not set `gatewayTimeoutMs`. The hook returns in well under a second.

`onRequest` sets `ctx.state.own` when the body contains `MAGPIE_TRANSLATOR_SIDECAR_v1`. It does not edit the body and it does not call a model.

`onResponse` returns immediately for the plugin's own request. Otherwise it writes one JSON file under the data-directory `inbox/` and returns. The return value is discarded. The client already has its bytes.

There is no middleware. Nothing in this package rewrites a stream, including an empty `response.completed`. A Codex passthrough whose completed event has no output is still invisible.

## Where the second model is called

`src/worker.mjs` is a detached process. Loading the hook starts it, and so does a new job, unless `MAGPIE_TRANSLATOR_NO_SPAWN=1`. It writes only in the data directory. It does not write `plugins.json` and it does not write the package directory. `worker.json` stores the pid and a hash of the worker sources. A hash change replaces the process. After about 20 idle seconds it exits. The next hook load starts it again.

The call is one `POST <magpie>/v1/chat/completions`. `translateTimeoutMs` is 10 seconds to 10 minutes, default 2 minutes. The plugin does not retry. `Authorization` is sent only when `MAGPIE_TRANSLATOR_GATEWAY_KEY` is set. Options have no gateway key, and a settings save deletes `gatewayKey`, `feed`, and `models` if they were stored.

`User-Agent` is `magpie-translator/` plus the version in `package.json`.

Code masking is off unless `maskCode` is true. The default path sends the text as it is, then `keepCode` puts the original fenced blocks back, including ones the model dropped. With masking on, mermaid fences stay in the text, and a placeholder is restored only when it is alone on its line. Anything else is appended after a blank line.

`notify` and `webhook` run only when `display` lists them, and only when `ctx.origin` is `local`, unless `allowRemoteExport` is true. `log`, `file`, and `stdout` still write on disk.

## What the page can do

The frame has `connect-src 'none'` and no inline scripts. The bridge used here is:

- `magpie.options.get()` and `magpie.options.set()`. A write is at most 64KiB and at most once a second. For a hooks package, a real change restarts the host.
- `magpie.read("providers:list")` and `magpie.read("usage:summary")`. Those are the only page reads magpie implements.

`page/payload.js` builds the object that `options.set` sends. It drops `feed`, `models`, `gatewayKey`, and the previous `_compare`. It measures UTF-8 bytes. Over 60KiB it returns an error. The page shows that error in the toast and in `#jobError`, and it does not call `set`. Language is one of ten names in a `<select>`. An unknown stored name snaps to `简体中文`.

Compare and retry set a small `_compare: { nonce, entryId, translator, replace }`. The worker reads it from `plugins.json` and does not write that file back. The nonce is marked in `compare-seen.json` before the call. The host restart from `options.set` loads the hook, which starts the worker, so the job does not wait for another gateway reply.

## What magpie does not offer

These were checked and do not fit a long rewrite:

- The page bridge has no method that calls the gateway or a model.
- Page reads are only `usage:summary` and `providers:list`.
- Tools run for at most 55 seconds and return their result to the calling agent.
- An agent package writes another program's config. It does not run this plugin's jobs.
- There is no plugin cron, queue, or background-job API. `onUsage` is a 250ms callback.

The history page therefore cannot see `history.json`. `feed.json` is written in the data directory for a person looking at the files, and for a future host read. It is not copied into `plugins.json`, because every change there restarts the host, and `publicFeed` used to stamp a new time on every call.

Host support that would close the gap: a page read of this plugin's data directory, or a bridge call that can run a model without the 10 second hook cap.

## Files

Data directory: `$MAGPIE_TRANSLATOR_HOME`, else `$XDG_DATA_HOME/magpie-translator`, else `~/.local/share/magpie-translator`.

| File | Role |
| --- | --- |
| `inbox/*.json` | One queued rewrite. The worker deletes the file when it takes the job |
| `history.json` | Canonical rows, mode 0600. `historyLimit` 0 clears it on the next record |
| `feed.json` | Public slice. Written only when the JSON changed |
| `log.jsonl` | Append-only log when `display` includes `log` |
| `latest.txt` | Last rewrite when `display` includes `file` |
| `compare-seen.json` | Nonces already started |
| `worker.json` | Pid and source hash |

`display` accepts `log`, `file`, `stdout`, `notify`, `webhook`. The package directory is never written. There is no `panel.pid` and no local port.

Plugin options live in `$XDG_CONFIG_HOME/magpie/plugins.json` or `~/.config/magpie/plugins.json`. The worker reads this file. Nothing in the hook or the worker writes it.

## What is extracted

No tools: the user-facing final text is queued. Anthropic, Chat, and Gemini replies that contain a tool call are skipped. Responses keeps `final_answer` when present, otherwise the prose after the last tool call. Reasoning and thinking are dropped. Pure JSON, structured output, title or suggestion helpers, and requests with no user turn are skipped. Text already in the target language is skipped unless `rewriteSameLanguage` is on. Sent text is cut at 20,000 characters.

## Checks

```bash
HOME=$(mktemp -d) bun test
bun scripts/check.mjs
```

`scripts/check.mjs` is the community checker. This package has a page and no `main`, so the checker skips it. Hook, queue, worker, and page behavior are covered by `test/`.
