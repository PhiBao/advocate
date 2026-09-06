# Advocate — we'll fight your medical bill

Upload a medical bill or denial letter. Your advocate finds what's wrong, asks a
few questions, writes a verified appeal letter, and chases it until there's an
outcome — dollars recovered, not drafts generated.

**Live:** https://advocate.kiter0211.workers.dev
Built for the **AI Builders Hackathon 2026** (Devpost). One dispute type in v1:
US medical bills / claim denials.

## The product (v1, shipped)

1. **Upload** a photo/PDF — no account, private expiring claim link, auto-delete after 90 days.
2. **Understand** — vision/text extraction → validated JSON → deterministic red-flag rules → plain-English findings + bill explainer (the activation moment, ≤3 min).
3. **Intake** — up to 6 grounded questions (one at a time, yes/no or tap).
4. **Case brief** — dispute label, deadline, strategy, evidence tied to document spans.
5. **Appeal letter** — drafted from validated facts only, then verified twice: a deterministic amount/line check and an independent semantic audit. Personal details stay as `[BRACKETED]` placeholders. Unverifiable drafts are blocked from approval.
6. **Approve & file** — server-enforced approval gate, payer-specific filing guide, print-to-PDF letter sheet.
7. **Track** — filing record, 21-day check-in alarm, outcome capture (`won / reduced / denied / waiting`), recovered-dollars result card, denial escalation ladder, one-question willingness-to-pay survey.

Nothing is ever sent to an insurer or provider without explicit user approval.

## Architecture

Cloudflare Workers + D1 + R2 + Durable Objects (per-case agent with alarms), Hono API, React/Vite frontend, LLM via the DGrid gateway (OpenAI-compatible; cheap vision model verified at sub-cent per case). No vendor SDKs on the worker — plain `fetch`, provider-swappable.

```
advocate/
├── src/worker/
│   ├── index.ts      API: upload, case view, questions/answers, letter
│   │                 draft/edit/approve, filing, outcomes, WTP, cron
│   ├── extract.ts    PDF text (unpdf) + vision extraction, strict guards
│   ├── rules.ts      Deterministic red flags (duplicates, mismatch, denial…)
│   ├── intake.ts     Grounded question + brief generation, explainer
│   ├── letter.ts     Letter drafting, citation check, semantic verifier
│   ├── guides.ts     Payer filing guides
│   ├── pipeline.ts   Background case processing (always leaves "reading")
│   ├── retention.ts  Daily cron: 90-day auto-delete sweep
│   ├── CaseDO.ts     Per-case Durable Object: reminders, alarms, purge
│   ├── llm.ts        Typed LLM clients (OpenAI-compat + Anthropic, fail-closed)
│   ├── tokens.ts     Signed expiring claim tokens
│   └── db.ts         D1 access layer
├── web/              React frontend (upload → findings → intake → review → outcome)
├── migrations/       D1 schema (7 migrations)
└── docs/             Demo video script, judging deck content
```

## Why the verification layers matter

2026's core AI adoption blocker is trust (78% of SMBs won't let AI run unsupervised; consumers increasingly distrust AI output). Advocate's answer is structural, not cosmetic:

- **Extraction** is schema-guarded; the letter generator may only cite extracted fields.
- **Findings** are computed by deterministic rules over validated data — no model vibes.
- **Letters** pass a regex-level amount/line check *and* an independent semantic audit; failures surface as `needs_review` with specific reasons and block approval server-side.
- **Human approval gate** is enforced in the API, not just the UI.

## Quickstart

```bash
pnpm install
pnpm db:migrate:local
cp .dev.vars.example .dev.vars   # CLAIM_TOKEN_SECRET + LLM_API_KEY (DGrid key)

pnpm dev        # Worker on :8787
pnpm dev:web    # Vite on :5173 (proxies /api)
```

## Checks & deploy

```bash
pnpm typecheck   # strict TS, worker + web
pnpm build       # frontend -> ./public
pnpm deploy:dry
pnpm db:migrate:remote
pnpm deploy      # https://advocate.kiter0211.workers.dev
```

Secrets: `wrangler secret put CLAIM_TOKEN_SECRET` and `wrangler secret put LLM_API_KEY`.

## Privacy & security posture

- No user accounts; case access via signed expiring claim URLs (90 days).
- Users are asked to redact SSNs; documents + all case data auto-delete after 90 days (daily cron sweep: D1 + R2 + DO storage).
- Uploads: type allowlist, magic-byte sniffing, size caps, per-IP rate limiting.
- Document bytes are untrusted data — never interpolated into prompts as instructions.
- No PHI in logs; fixed error envelopes; no stack traces to clients.
- Outbound actions (letter send, calls) gated on server-side approval state.

**Compliance posture:** document preparation and advocacy assistance — not a law firm, no legal or medical advice. Nothing is sent anywhere without explicit approval.

## Status / honest limitations

- Voice follow-up calls are designed (scripted, approved, logged) but not wired in v1; the letter + filing path is the complete core.
- The semantic verifier is an LLM judging an LLM — defense in depth, with the human approval gate as the real backstop.
- Extraction can misread ambiguous EOB columns on unusual layouts; totals reconciliation is on the roadmap.

## License

MIT — see [LICENSE](./LICENSE).
