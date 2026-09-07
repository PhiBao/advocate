# Advocate — we'll fight your medical bill

**Live:** https://advocate.kiter0211.workers.dev · [Presentation deck](https://docs.google.com/presentation/d/1KzmcoL_hZ0OVeCIDtVw0p1noJfDHZ4xg6urHDI5hKz8/edit?usp=sharing)

One dispute type in v1: US medical bills / claim denials.

## The problem

- **85%** of denied medical claims are never appealed — yet **~80%** of appeals that are filed win.
- Up to **80%** of medical bills contain errors.
- Appealing is a second job: decode the bill and the EOB, write a formal letter with exact amounts and line references, find the right portal, then chase it for weeks. AI chatbots hand you a draft and walk away. Patients give up — they don't opt out.

**The gap isn't knowledge. It's follow-through.**

## The solution

Advocate is an AI advocate that finishes the job. Upload a bill or denial letter — no account — and it finds what's wrong, asks a few questions, writes an appeal letter that **verifies itself twice** (and blocks approval when it can't), files it with you, and chases it until there's an outcome.

The product measures itself in **dollars recovered, not drafts generated.**

> **60-second try:** open the live URL → tap **“Try with a sample bill”**
> (synthetic $1,840 duplicate charge, no real data) → findings land in ~1–3 min
> → answer 3–4 tap questions → brief → verified letter → approve → filing guide
> → record outcome. Full flow, no signup.
> Sample docs also in [`docs/test-docs/`](./docs/test-docs/).

## The product (v1, shipped)

1. **Upload** a photo/PDF — no account, private expiring claim link, auto-delete after 90 days.
2. **Understand** — vision/text extraction → validated JSON → deterministic red-flag rules → plain-English findings + bill explainer (the activation moment, ≤3 min).
3. **Intake** — up to 6 grounded questions (one at a time, yes/no or tap).
4. **Case brief** — dispute label, deadline, strategy, evidence tied to document spans.
5. **Appeal letter** — drafted from validated facts only, then verified twice: a deterministic amount/line check and an independent semantic audit. Personal details stay as `[BRACKETED]` placeholders. Unverifiable drafts are blocked from approval.
6. **Approve & file** — server-enforced approval gate, payer-specific filing guide, print-to-PDF letter sheet.
7. **Track** — filing record, 21-day check-in alarm, outcome capture (`won / reduced / denied / waiting`), recovered-dollars result card, denial escalation ladder, one-question willingness-to-pay survey.

Nothing is ever sent to an insurer or provider without explicit user approval.

## Vision & roadmap

Billing disputes are everywhere — medical bills are just the wedge. The engine underneath (extract → verify → approve → chase → outcome) generalizes to any dispute where an ordinary person faces paperwork asymmetry.

1. **Voice follow-ups** — the advocate calls the insurer on an approved script, with transcripts and logged outcomes. (Designed for v1, cut for scope; the letter-to-outcome loop had to be genuinely complete first.)
2. **More dispute types** — subscriptions, security deposits, tolls, chargebacks on the same loop.
3. **Response parsing → auto-escalation** — payer replies parsed into next steps: external review, state insurance complaint, financial assistance.
4. **Outcome-based pricing** — $29–99 per dispute or a share of recovered dollars, validated by the willingness-to-pay survey already running on every outcome card.

Long-term: the trusted layer between people and bureaucracy — an advocate that keeps working after you close the tab, for any bill that looks wrong.

## How a case flows

```
upload → reading → needs_info → ready_for_review → approved → filed → resolved
   (photo/PDF,    (extract +    (answer 1–6      (brief +        (letter     (guide +    (outcome:
    201 in ms)     rules +        grounded         verified        locked,     print +     won / reduced /
                   questions)     questions)       letter)         file it)    21-day      denied / waiting)
                                                                          check-ins)
```

- Case statuses: `uploaded → reading → needs_info → ready_for_review → approved → filed → in_followup / resolved / closed`.
- Letter statuses: `draft` (approvable) · `needs_review` (blocked server-side until fixed) · `approved` (immutable, filing starts from it).
- Outcomes: `won_full / reduced / denied / no_response`, with `amountRecoveredCents` and a one-question willingness-to-pay survey (`yes / if_wins / no`).
- The pipeline runs in `waitUntil`: uploads return `201` instantly while extraction, rules, and question generation run in the background; the case page polls to findings. Every failure — scanned PDF, model hiccup, verifier outage — lands as an explicit timeline event. A case never silently sits in `reading`.
- A per-case Durable Object (`CaseAgent`) owns the clock: 21-day filing check-ins, deadline reminders, and storage purge on retention sweep.

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

## Tech stack

| Layer | Choice |
|---|---|
| Edge + API | Cloudflare Workers, Hono, strict TypeScript |
| Data | D1 (cases, documents, extractions, findings, questions, letters, outcomes) — 7 migrations |
| Files | R2 (`advocate-docs`) |
| Agents/clock | Durable Objects (`CaseAgent`: reminders, 21-day alarms, purge) + daily cron sweep |
| Frontend | React 19 + Vite, mobile-first, no accounts (signed claim links) |
| AI | Any OpenAI-compatible gateway over plain `fetch` (default: DGrid; vision model verified at <$0.001/case). Anthropic client included as fallback. No vendor SDKs — provider-swappable |
| PDF text | `unpdf` (serverless PDF.js); scanned PDFs fail to an honest “send photos” path |

## API reference

All case routes are passwordless via signed expiring claim tokens (`?token=` or `{token}` in JSON bodies). Errors use a fixed `{error: {code, message}}` envelope — no stack traces, no PHI in logs.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness probe |
| `POST /api/cases` | Multipart upload (`file`, `disputeType`) → `201 {caseId, claimToken}` |
| `GET /api/cases/:id?token=` | Full public case view (timeline, findings, explainer, questions, summary, letter, filing guide, outcome) |
| `POST /api/cases/:id/questions` | Generate (idempotent) or return intake questions |
| `POST /api/cases/:id/answers` | Submit answers → builds brief, auto-drafts letter in background |
| `POST /api/cases/:id/letter` | Return latest letter, drafting if missing (idempotent) |
| `POST /api/cases/:id/letter/edit` | New re-verified version (blocked when approved; `409 STALE` on version mismatch) |
| `POST /api/cases/:id/letter/approve` | Approve — rejected with `409 UNVERIFIED` unless the draft is fully clean |
| `POST /api/cases/:id/filed` | Record filing channel → starts the 21-day DO check-in |
| `POST /api/cases/:id/outcome` | Record `won_full / reduced / denied / no_response` + recovered dollars |
| `POST /api/cases/:id/outcome/wtp` | One-question willingness-to-pay (`yes / if_wins / no`) |

Uploads are validated three ways (declared-type allowlist, magic-byte sniffing, 15 MB cap) with per-IP rate limiting. Document bytes are untrusted data and are never interpolated into prompts as instructions.

## Configuration

`wrangler.jsonc` vars (sane defaults included):

| Var | Default | Meaning |
|---|---|---|
| `LLM_BASE_URL` / `LLM_MODEL` | DGrid / `google/gemini-2.5-flash-lite` | Model endpoint (any OpenAI-compatible API) |
| `CLAIM_TOKEN_TTL_SECONDS` | `7776000` (90 days) | Claim-link lifetime |
| `DATA_RETENTION_DAYS` | `90` | Auto-delete horizon (D1 + R2 + DO storage) |
| `MAX_UPLOAD_BYTES` | `15728640` (15 MB) | Upload cap |

Secrets (never in repo): `CLAIM_TOKEN_SECRET`, `LLM_API_KEY` — see [Checks & deploy](#checks--deploy). Local dev uses `.dev.vars` (`cp .dev.vars.example .dev.vars`); without `LLM_API_KEY` the pipeline fails closed with an honest error instead of guessing.

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
