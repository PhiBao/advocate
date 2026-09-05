# Advocate — we'll fight your medical bill

Upload a medical bill or denial letter. Your advocate finds what's wrong, builds the
case, writes the appeal, and chases it until you get an answer.

Built for the **AI Builders Hackathon 2026** (Devpost). One dispute type in v1:
US medical bills / claim denials.

## How it works (v1 slice)

1. **Upload** a photo/PDF — no account, private expiring claim link.
2. **Understand** — extraction + deterministic red-flag rules + plain-English findings (D2).
3. **Build & approve** — guided questions → appeal letter with document citations, human approval gate (D3–D4).
4. **File & chase** — filing guide, optional voice follow-up call, deadline tracking via Durable Objects (D5–D6).

Nothing is ever sent to an insurer or provider without explicit user approval.

## Repo layout

```
advocate/
├── src/worker/        Cloudflare Worker API (Hono): upload, cases, approvals,
│                      typed LLM client, red-flag rules, CaseAgent Durable Object
├── web/               React + Vite frontend (builds to ./public)
├── migrations/        D1 schema
├── wrangler.jsonc     Worker + assets + D1/R2/DO bindings
└── public/            built frontend (generated, gitignored)
```

## Quickstart

```bash
pnpm install

# local database
pnpm db:migrate:local

# secrets for local dev (never commit)
cp .dev.vars.example .dev.vars   # then fill in CLAIM_TOKEN_SECRET
# ANTHROPIC_API_KEY optional until D2 pipeline lands

# run API + frontend
pnpm dev          # Worker on :8787 (serves ./public if built, else API only)
pnpm dev:web      # Vite on :5173, proxies /api -> :8787
```

Generate a dev claim secret:

```bash
openssl rand -hex 32
```

## Checks

```bash
pnpm typecheck     # worker + web strict typecheck
pnpm build          # frontend build -> ./public
pnpm deploy:dry     # bundle validation without deploying
```

## Deploy

```bash
wrangler secret put CLAIM_TOKEN_SECRET
wrangler secret put ANTHROPIC_API_KEY   # needed from D2 on
pnpm db:migrate:remote
pnpm deploy
```

> **R2 note:** remote deploy requires R2 to be enabled for the Cloudflare account
> (dashboard → R2 → enable). Local dev uses emulated R2 automatically.

## Privacy posture

- No user accounts; case access via signed expiring claim URLs (`src/worker/tokens.ts`).
- Users are asked to redact SSNs; documents auto-delete after 90 days.
- Upload bytes are untrusted data: allowlist + magic-byte sniffing + size caps, and
  never interpolated into prompts.
- Human approval gate is enforced server-side before any outbound action
  (letter send, email/fax, phone call).

## License

MIT — see [LICENSE](./LICENSE).
