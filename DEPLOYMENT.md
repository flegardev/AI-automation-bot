# Deployment — AI Automation Bot

This Express 5 application writes messages, leads, and hashed conversation
credentials to local JSON files. Deploy it as one long-running process with a
persistent disk—not as Vercel, Netlify, or another ephemeral serverless
function.

## Recommended shape

| Priority    | Platform                      | Required setup                                                                    |
| ----------- | ----------------------------- | --------------------------------------------------------------------------------- |
| Primary     | Railway or Render web service | Attach a persistent disk at `/data`, set `DATA_DIR=/data`, health check `/health` |
| Alternative | Fly.io or a VPS               | Mount a durable volume at `/data` and run the Docker image                        |

The JSON store and in-memory rate limiter are single-instance components. Move
both to shared services before adding replicas.

## Production environment

Start from `.env.example` and configure server-side values in the hosting
platform. Never put them in browser code or a committed `.env`.

- `ADMIN_TOKEN`: required in production and at least 16 random characters. It
  enables the admin API; the dashboard sends it only in an Authorization header.
- `OPENAI_API_KEY`: optional. Without it, the app uses deterministic demo replies.
- `OPENAI_MODEL`: optional; defaults to `gpt-4.1-mini`.
- `OPENAI_TIMEOUT_MS`: optional; defaults to `20000` and must be at least `1000`.
- `DATA_DIR`: set to the mounted disk, normally `/data`.
- `ALLOWED_ORIGINS`: leave blank for same-origin operation.
- `TRUST_PROXY`: set to the verified number of reverse-proxy hops. Leave blank
  for direct traffic; do not copy a value without confirming the platform path.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `CHAT_RATE_LIMIT_MAX`: tune for
  expected traffic and OpenAI spend.

Admin tokens in query strings are rejected. Open `/admin`, enter the configured
token in the form, and use **Lock** when finished.

## Docker

```bash
docker build -t ai-automation-bot .
docker run --rm -p 3000:3000 \
  -e NODE_ENV=production \
  -e ADMIN_TOKEN="replace-with-a-random-secret" \
  -e OPENAI_API_KEY="" \
  -e DATA_DIR=/data \
  -v ai-bot-data:/data \
  ai-automation-bot
```

Add `-e TRUST_PROXY=1` only when one trusted proxy actually sits between the
client and this process.

The image runs as the non-root `node` user. Its health check calls `/health`,
and its persistent files are:

- `/data/messages.json`
- `/data/leads.json`
- `/data/sessions.json` (SHA-256 credential hashes, never raw browser tokens)

## Release checks

Run before deploying:

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run format:check
npm run test:security
npm test
docker build -t ai-automation-bot .
```

After starting the production image, verify:

1. `GET /health` returns `200`.
2. `/api/admin/summary` returns `401` without a bearer token and `200` with the
   correct token.
3. `/api/admin/summary?token=...` returns `400`.
4. `/api/messages` returns `401` without a conversation credential.
5. A new chat returns a scoped credential and reload restores only that thread.
6. Response headers include a Content Security Policy and omit `X-Powered-By`.

## Data and privacy

Back up the mounted volume and restrict it to the application operator. Messages
and lead contact data are stored as plain JSON by this application. When OpenAI
mode is enabled, recent conversation content is sent to the configured model.

Deploying a new version does not migrate old browser sessions: legacy messages
lack scoped credentials and cannot be restored publicly, but remain available
to the authenticated admin dashboard.
