---
name: verify
description: Launch and drive the task-manager app (Worker API + D1 + React SPA) end-to-end locally.
---

# Verifying task-manager changes

Two independently deployable packages, run both locally against a local D1 instance.

## One-time / per-reset setup

```bash
cd worker
echo 'SETUP_TOKEN="local-dev-setup-secret"' > .dev.vars   # gitignored, safe to keep
npx wrangler d1 migrations apply task_manager_db --local
```

To fully reset local state (fresh DB, no leftover tasks/tokens):

```bash
rm -rf worker/.wrangler/state
cd worker && npx wrangler d1 migrations apply task_manager_db --local
```

## Launch

```bash
cd worker && npx wrangler dev --port 8787          # API, backgrounded
cd frontend
echo "VITE_API_BASE_URL=http://localhost:8787" > .env.local
npx vite --port 5173                                 # SPA, backgrounded
```

Bootstrap the first admin token (one-time per fresh DB):

```bash
curl -s -X POST http://localhost:8787/api/setup \
  -H "Authorization: Bearer local-dev-setup-secret" -H "Content-Type: application/json" \
  -d '{"name":"Local Admin"}'
# -> {"token": "tm_live_..."} — paste into the frontend's sign-in screen (localhost:5173)
```

## Driving it

Playwright's pre-installed Chromium works (`executablePath: '/opt/pw-browsers/chromium'`).
Playwright itself is NOT a project dependency — `npm install playwright` in a scratch dir
(with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` already set in the environment) rather than
fighting ESM global-package resolution.

Golden path worth exercising after any change: sign in → create 2 tasks → open drawer,
edit fields, add tag/link/time-log/dependency → drag a card between columns → resize to a
mobile viewport (<768px) and use the segmented control → Settings → Tokens → issue/rotate/revoke.

Push-on-it probes that have found real bugs here before:
- Try to set a dependency that would close a cycle (expect 422 + inline notice).
- PATCH the same task from outside the UI (`curl`/`fetch` with the admin token) while its
  drawer is open, using a version the UI doesn't know about yet — expect a 409 that the
  drawer surfaces as "changed elsewhere" and auto-refreshes from.
- With two browser contexts (or one context + an out-of-band API call), confirm the SSE
  feed (`/api/events`) pushes the change into the other session without a reload.

## Gotchas found

- **Durable Object streaming**: don't `await writer.write(...)` on a fresh
  `TransformStream` before returning the `Response` — the write only resolves once a
  reader attaches, which hasn't happened yet, so it deadlocks the handler. Fire-and-forget
  the write (`.catch(...)`, don't await) instead.
- **Uncontrolled drawer inputs**: text inputs in `TaskDrawer` use `defaultValue` +
  `onBlur` (to avoid a PATCH per keystroke). `defaultValue` only applies on mount, so if
  `detail` is replaced out from under the input (e.g. a 409 conflict triggers a refetch),
  the DOM won't visually update unless the input remounts. Fix in place: `key={`field-${detail.version}`}`
  on each such input forces a remount whenever the task's version changes.
- vitest-pool-workers storage isolation is per **test file**, not per test — a bootstrap
  endpoint that only works once (like `/api/setup`) must be called from a single
  `beforeAll` per file, not from each `it()`.
