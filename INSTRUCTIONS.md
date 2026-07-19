# Task Manager — Operator Guide

Practical, day-to-day instructions for whoever administers this deployment: signing in, adding humans, enabling AI agents, and recovering if you get locked out. For architecture and local dev setup see [`README.md`](README.md); for the full API/schema contract see [`docs/app-spec.md`](docs/app-spec.md).

## URLs

| Page | URL |
| :--- | :--- |
| Sign in | `https://<your-frontend-domain>/sign-in` (e.g. `https://tasks.rysr.com/sign-in`) |
| Board | `https://<your-frontend-domain>/` |
| Token admin (admin scope only) | `https://<your-frontend-domain>/settings/tokens` |
| Local dev | `http://localhost:5173/sign-in` |

There is no separate URL for first-time setup — it's the **"First-time setup"** tab on the same sign-in page.

## First-time setup (one-time only)

Done once per deployment, right after the Worker is first deployed with a `SETUP_TOKEN` secret:

1. Go to `/sign-in` → **"First-time setup"** tab.
2. Paste the `SETUP_TOKEN` value (the Workers secret set via `wrangler secret put SETUP_TOKEN`).
3. Submit. The app mints the first `admin`-scoped token, shows it once, and signs you in with it.

`POST /api/setup` refuses permanently after this — the moment any `admin`-scoped token row exists (even a revoked one), the endpoint returns `403` regardless of the secret. See **Lockout recovery** below if you ever need to redo this.

## Everyday sign-in

There's no username/password and no server-side session — the bearer token *is* the credential:

1. Go to `/sign-in` → **"Sign in"** tab.
2. Paste your token.
3. The app validates it against the API and stores it in that browser's `localStorage`. You stay signed in on that browser until you sign out or clear storage — sign in again with the same token on any other browser/device.

## Adding another human

As an admin:

1. Go to **Settings → Tokens → Issue token**.
2. Name it (e.g. `"Jane — laptop"`), scope = `human`, optional expiry.
3. Submit — the plaintext token is shown **exactly once**. Copy it now.
4. Send it to that person through some reasonably secure channel (not a public channel — it's a live credential). They paste it into their own `/sign-in` → "Sign in" tab.

## Enabling an AI agent

1. Go to **Settings → Tokens → Issue token**.
2. Name it (e.g. `"Claude Agent - Prod"`), scope = `agent`, optional expiry.
3. Copy the plaintext token shown once.
4. Configure the agent to send it as `Authorization: Bearer <token>` on every request.

What an `agent`-scoped token can and can't do:

- Full read/write on `/api/tasks/*` and the agent-optimized `/api/agent/agenda`, `/api/agent/actionable`, `/api/agent/blocked` endpoints.
- **Cannot** call anything under `/api/admin/*` (`403 Forbidden`).
- Rate-limited to **60 requests/minute** by default (`429 Too Many Requests` past that).

Example usage:

```bash
# What's actionable right now?
curl https://api.tasks.rysr.com/api/agent/actionable \
  -H "Authorization: Bearer tm_live_..."

# Move a task to in_progress (version is required — read it from the entity first)
curl -X PATCH https://api.tasks.rysr.com/api/tasks/<task-id> \
  -H "Authorization: Bearer tm_live_..." -H "Content-Type: application/json" \
  -d '{"version": 3, "status": "in_progress"}'
```

## Rotating or revoking a token

Both are in **Settings → Tokens**, per row, behind a confirmation prompt:

- **Rotate** — invalidates the old token immediately and issues a replacement under the same name/scope, plaintext shown once. Use this for routine credential hygiene or if a token may have leaked.
- **Revoke** — invalidates the token immediately, no grace period. Use this when someone/something should lose access for good. The row is kept (not deleted) so its audit history stays intact.

## Lockout recovery

If every admin token is lost, expired, or revoked and nobody can sign in: `/api/setup` won't help — it refuses as soon as any `admin`-scoped row has ever existed, whether or not it's still valid. The only way back in is a direct database operation against the D1 instance:

```bash
cd worker
npx wrangler d1 execute task_manager_db --remote \
  --command "DELETE FROM api_tokens WHERE scope = 'admin'"
```

This removes the admin-token rows (and their audit history alongside them — there's no way to reopen setup without doing this). Afterwards, `/api/setup` works again: go to `/sign-in` → "First-time setup" and paste your `SETUP_TOKEN` secret to mint a fresh first admin token.

If you don't have the `SETUP_TOKEN` value either, retrieve or reset it first:

```bash
npx wrangler secret put SETUP_TOKEN
```

(Setting it again just overwrites the secret — it doesn't require knowing the old value.)

## Things worth knowing

- **No auto sign-out.** If a token is revoked or expires while someone is actively using the UI, they aren't automatically redirected to sign-in — API calls just start failing with error messages. They need to sign out and back in with a valid token.
- **Custom domains.** If the frontend and Worker API live on different Cloudflare custom domains, two settings must stay in sync with whatever those domains actually are: the Worker's `ALLOWED_ORIGIN` var (CORS) must match the frontend's real origin, and the frontend's `VITE_API_BASE_URL` must point at the Worker's domain. Both require a redeploy of the affected project after changing.
- **Plaintext tokens are shown exactly once** — at issuance or rotation. There is no way to retrieve a plaintext token again later; if it's lost, rotate it.
