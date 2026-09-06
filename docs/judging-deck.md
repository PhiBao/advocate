# Judging deck content — 10 slides (paste into Google Slides/Keynote)

Per Devpost requirements: Problem Statement, Solution Overview, Target Users,
Product Features, Technical Architecture, AI Technologies Used, Impact and Value
Proposition, Future Roadmap.

---

## Slide 1 — Title
**Advocate — upload it. We'll fight it.**
The AI advocate that fights medical bills and claim denials end to end.
Live demo: advocate.kiter0211.workers.dev · Team, AI Builders Hackathon 2026

## Slide 2 — Problem statement
- **85%** of denied claims are never appealed *(verified industry data)*
- **80.7%** of appealed denials are overturned — appealing works
- Up to **80%** of bills contain errors
- Today: patients paste bills into ChatGPT "with mixed results," or give up
- **The gap isn't knowledge. It's follow-through.**

## Slide 3 — Target users
- Insured US adults & family caregivers with a disputed bill ≥ $200
- Non-experts, stressed, time-poor — they give up, not opt out
- Students first (we are the users) → households → any billing dispute

## Slide 4 — Solution overview
Upload → **Findings** (specific, line-referenced) → guided questions →
**case brief** → **verified appeal letter** → approve → **file & track** →
**outcome ($ recovered)**.
One screenshot strip of the five screens.

## Slide 5 — Product features (what's shipped, live)
- No-account, privacy-first intake (signed expiring links, 90-day auto-delete cron)
- Deterministic red-flag engine: duplicates, bill/EOB mismatch, denial w/o reason, balance billing
- One-tap intake; grounded case brief with span-tied evidence
- Two-layer letter verification + server-enforced approval gate
- Payer filing guides, 21-day check-in alarms, outcome capture + WTP survey

## Slide 6 — Technical architecture
- Cloudflare Workers + D1 + R2 + **Durable Objects** (per-case agent, alarms, follow-ups)
- Hono API, React/Vite, strict TypeScript, 7 migrations
- LLM via **DGrid gateway** (OpenAI-compatible) — vision extraction verified at **<$0.001/case**
- Diagram: upload → extraction/guard → rules → intake → brief → letter/verify → approve → file → outcome

## Slide 7 — AI technologies used (and where AI is NOT used)
- Vision + text LLM: document extraction (schema-guarded, fail-closed)
- LLM: grounded questions, brief, letter drafting, semantic audit pass
- **Not AI:** red-flag rules (deterministic), citation checker (regex/exact), approval gate (server-enforced)
- Point: AI where it compresses work; structure where trust is non-negotiable

## Slide 8 — Impact & value proposition
- The metric: **dollars recovered per dispute** (instrumented in-product)
- Verified overturn rates (80%) × average disputed amounts → every completed case should return multiples of its cost
- Honest state: pre-launch validation, WTP survey live on outcome card
- Demo numbers from synthetic cases; real-user validation in progress

## Slide 9 — Future roadmap
1. Voice follow-up calls (approved scripts, transcripts, logged outcomes)
2. More dispute types: subscriptions, deposits, tolls, chargebacks
3. Payer-response parsing → auto-drafted escalations (external review)
4. Outcome-based pricing ($29–99/dispute or % recovered) — WTP survey running

## Slide 10 — Team & ask
- Team, roles, what we built in N days
- Live URL + repo + 60-second recap of the verification engine
- "The advocate keeps working after you close the tab."

---

### Speaker notes (30–45s per slide)
Keep slides 5–7 tight; the demo video carries the product. On slide 8, be explicit
that recovered-dollar numbers shown in the demo are from test cases — judges reward
honesty over inflated claims.
