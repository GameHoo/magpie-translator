# Design

`@magpie-community/page-translator` rewrites a finished reply beside the session. The agent keeps the original bytes. The model call does not run inside a magpie hook.

This package is not in the magpie-community registry. Checked against magpie `f8cd964` on 2026-10-27: `internal/plugin/host.js` (hook budget), `internal/plugin/store.go` (`checkList` restarts the host when `plugins.json` changes), `internal/gui/pagebridge.js`, `internal/plugin/page.go`, `internal/gateway/lan.go`, and `internal/plugin/tools.go`.

## Why the call is not inside the hook

Magpie aborts `onRequest` and `onResponse` at `gatewayTimeoutMs`. That value is an integer from 100 to 10000, otherwise 1000. The whole hook chain is also capped at 10 seconds. A real rewrite takes 12–105 seconds, so a call started in the hook is aborted, and the abort also cancels its `fetch`.

This package does not set `gatewayTimeoutMs`. The hook returns in well under a second.

`onRequest` sets `ctx.state.own` when the body contains `MAGPIE_TRANSLATOR_SIDECAR_v1`. It does not edit the body and it does not call a model.

`onResponse` returns immediately for the plugin's own request. Otherwise it writes one JSON file under the data-directory `inbox/` and returns. The return value is discarded. The client already has its bytes. The hook does not write `plugins.json`.

There is no middleware. Nothing in this package rewrites a stream, including an empty `response.completed`. A Codex passthrough whose completed event has no output is still invisible.

## Where the second model is called

`src/worker.mjs` is one detached process. It publishes a private lock file and links that name onto `worker.lock`. The link fails when the name is already taken. The lock stores a random token, a heartbeat, a hash of the worker sources, the parent pid, and the worker pid. The worker rewrites the heartbeat every 2 seconds. The lock is stale only when that heartbeat is older than 8 seconds. A stale lock is removed by renaming it to a per-attempt grave and checking that the grave still has the same stale token. If the grave is a newer lock, it is linked back onto `worker.lock`. A failed link leaves the grave in place so the new owner's file is kept. This package never signals a process. Parent liveness is `process.kill(pid, 0)` only. A hash change writes `worker.stop`. The running worker finishes the job it already started and exits.

The child environment is `PATH`, `HOME`, the XDG config and data variables, `TMPDIR`, `MAGPIE_BASE_URL` when set, `MAGPIE_TRANSLATOR_HOME`, `MAGPIE_TRANSLATOR_PARENT_PID`, and `MAGPIE_TRANSLATOR_LOCK_TOKEN`. The gateway key stays out of the environment. The process is spawned with `windowsHide`.

When the parent pid is gone, the worker finishes the current job, drains the queue, and picks up a `processing/` file only after its claim heartbeat is older than 8 seconds. It writes the options summary only when the queue is empty, then exits. If that write keeps conflicting, the retry stops after 10 seconds. It exits before taking another job when this plugin's entry has `off: true`, when `worker.stop` is present and the parent is still alive, or when `plugins.json` exists and no longer lists this package. A missing `plugins.json` does not count as uninstalled.

The call is one `POST <magpie>/v1/chat/completions`. `translateTimeoutMs` is 10 seconds to 10 minutes, default 2 minutes. The plugin does not retry. Loopback requests send no `Authorization` header. Magpie treats a loopback request with no forwarding headers as local and accepts it without a key (`internal/gateway/lan.go`). A remote `magpieBaseUrl` needs `gateway.key`. That file lives in the data directory, mode 0600. A value left in `options.gatewayKey` is moved there and deleted from `plugins.json` only when the fresh file still has that same value. `MAGPIE_TRANSLATOR_GATEWAY_KEY` is used only when the file is absent. A 401 or 403 is stored on the history row and shown on the page.

`User-Agent` is `magpie-translator/` plus the version in `package.json`.

Code masking is off unless `maskCode` is true. The default path sends the text as it is, then `keepCode` puts the original fenced blocks back, including ones the model dropped. With masking on, mermaid fences stay in the text, and a placeholder is restored only when it is alone on its line. Anything else is appended after a blank line.

`notify` and `webhook` run only when `display` lists them, and only when `ctx.origin` is `local`, unless `allowRemoteExport` is true. `log`, `file`, and `stdout` still write on disk.

## How a job survives a crash

`history.json`, `compare-seen.json`, `feed.json`, and the plugins list are written to a temp file and renamed into place. A compare nonce and a queued job are claimed by an exclusive create or a rename into `processing/`.

On startup, a `processing/` job moves back to `inbox/` only when its heartbeat is older than 8 seconds. A fresh claim stays put, so two workers that overlap do not translate it twice. A compare claim with a stale heartbeat is removed, so the same nonce can run again. `compare-seen.json` is updated only after the history write succeeds. A model error that was stored counts as finished. A crash before that write runs the compare again. A job id already in `history.json`, or already marked under `delivered/`, is not translated again and is not sent to the webhook again. Compare reads `_compare` from options inside the worker. A stranded job is picked up once its heartbeat is stale. It does not wait for another gateway reply.

The inbox keeps at most 100 jobs. Each dropped job is appended to `log.jsonl`, stored in `dropped.json`, and copied onto `options.feed.dropped` so the history page can list it. A settings save that sees newer `plugins.json` bytes throws status 409 and leaves the file alone. The page shows that conflict in the toast and in `#jobError`.

A write to `plugins.json` reads the file again and merges `options.feed` onto that latest copy. `options.gatewayKey` is removed only when it still equals the value copied into `gateway.key`. If the bytes change once more before the rename, that attempt is skipped. A settings save refuses to write when the bytes changed after it was read. The inbox keeps at most 100 jobs and drops the oldest file to make room.

## What the page shows

The frame has `connect-src 'none'` and no inline scripts. The bridge used here is:

- `magpie.options.get()` and `magpie.options.set()`. A write is at most 64KiB and at most once a second. For a hooks package, a real change restarts the host.
- `magpie.read("providers:list")` and `magpie.read("usage:summary")`. Those are the only page reads magpie implements.

The history list is `options.feed`. The worker publishes `publicFeed()` there. The slice stays under `FEED_BUDGET` (48,000 bytes). The worker writes it only when the queue is empty and the canonical JSON changed, after the summary has been stable for 3 seconds, and at most once every 15 seconds. An identical summary does not touch `plugins.json`, so `checkList` does not restart the host. A real write does restart the host on the next gateway request. That restart is the reason this package is not submitted upstream.

An empty feed is not written over a missing `feed`, so the first idle start does not restart the host. Clearing history does publish an empty list, so the page can drop rows that were removed.

`page/payload.js` builds the object that `options.set` sends. It drops `feed`, `models`, and the previous `_compare`. A gateway key already stored in options is dropped too, so a later settings save does not echo it. A key typed into the settings field is sent once. The worker moves it. The payload measures UTF-8 bytes. Over 60KiB it returns an error. The page shows that error in the toast and in `#jobError`, and it does not call `set`. Language is one of ten names in a `<select>`. An unknown stored name snaps to `简体中文`.

Compare and retry set a small `_compare: { nonce, entryId, translator, replace }`. The host restart from `options.set` loads the hook, which starts the worker.

## What magpie does not offer

These were checked and do not fit a long rewrite or a direct history read:

- The page bridge has no method that calls the gateway or a model.
- Page reads are only `usage:summary` and `providers:list`. There is no page read of a plugin data file.
- Tools run for at most 55 seconds and return their result to the calling agent.
- An agent package writes another program's config. It does not run this plugin's jobs.
- There is no plugin cron, queue, or background-job API. `onUsage` is a 250ms callback.

The options summary is the route the page can read today. Host support that would remove the restart: a page read of this plugin's data directory, or a long job that does not go through `plugins.json`.

## Files

Data directory: `$MAGPIE_TRANSLATOR_HOME`, else `$XDG_DATA_HOME/magpie-translator`, else `~/.local/share/magpie-translator`.

| File | Role |
| --- | --- |
| `inbox/*.json` | One queued rewrite, at most 100, written by rename |
| `processing/` | Claimed job or compare claim, with token and heartbeat. Recovered when the heartbeat is older than 8 seconds |
| `delivered/` | Job ids already stored, so history and webhook run once |
| `dropped.json` | Jobs dropped because the inbox was over 100 |
| `history.json` | Canonical rows, mode 0600. `historyLimit` 0 clears it on the next record |
| `feed.json` | Public slice. Written only when the JSON changed |
| `feed-state.json` | Hash and time of the last options publish |
| `log.jsonl` | Append-only log when `display` includes `log`, plus one line per dropped job |
| `latest.txt` | Last rewrite when `display` includes `file` |
| `compare-seen.json` | Nonces whose result is already stored |
| `worker.lock` | Token, heartbeat, source hash, parent pid, and worker pid |
| `worker.stop` | Cooperative stop. The worker finishes the current job and exits |
| `gateway.key` | Optional gateway key, mode 0600. Required for a remote `magpieBaseUrl` |

`display` accepts `log`, `file`, `stdout`, `notify`, `webhook`. The package directory is never written. There is no local port.

Plugin options live in `$XDG_CONFIG_HOME/magpie/plugins.json` or `~/.config/magpie/plugins.json`.

## What is extracted

No tools: the user-facing final text is queued. Anthropic, Chat, and Gemini replies that contain a tool call are skipped. Responses keeps `final_answer` when present, otherwise the prose after the last tool call. Reasoning and thinking are dropped. Pure JSON, structured output, title or suggestion helpers, and requests with no user turn are skipped. Text already in the target language is skipped unless `rewriteSameLanguage` is on. Sent text is cut at 20,000 characters.

## Checks

```bash
HOME=$(mktemp -d) bun test
bun scripts/check.mjs
```

`scripts/check.mjs` is the community checker. This package has a page and no `main`, so the checker skips it. Hook, queue, worker, and page behavior are covered by `test/`. `test/spawn.test.mjs` starts the real worker process.
