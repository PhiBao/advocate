# Demo video script — 3:30 cut (Devpost: 3–5 min required)

Record at 1920×1080. Phone-width browser (390px) for upload/intake, desktop for
letter review (prints well). Captions: `docs/demo-video.srt`. VO: edge-tts
`en-US-AvaMultilingualNeural`, +0% rate. All demo numbers are synthetic cases —
say so on camera.

## SCENE 0 — Title (0:00–0:10, card)
VO_0: "Advocate. Upload a medical bill. We'll fight it. Verified appeals, chased to an outcome."

## SCENE 1 — Problem (0:10–0:40, stats cards + bill b-roll from docs/test-docs)
VO_1: "Eighty five percent of denied medical claims are never appealed. Yet when people do appeal, four out of five win. And up to eighty percent of bills contain errors. The system doesn't fail because patients are wrong. It fails because appealing is a second job. AI tools today hand you a draft and walk away. We built the thing that finishes the job."

## SCENE 2 — Upload → activation (0:40–1:10, live: landing → Try with sample bill → Reading → findings)
VO_2: "No account, no signup. Upload a photo of your bill, or tap Try with a sample bill. Within a couple of minutes, your advocate shows what's actually in it. Not a summary. Specific findings. Here it flagged a duplicate charge, the same eighteen forty emergency visit billed twice, with the exact lines referenced. Plus a plain-English explainer. Billed, insurance paid, they say you owe."

## SCENE 3 — Intake → brief (1:10–1:40, tap 3 questions one-at-a-time)
VO_3: "Then a few quick questions, answerable in seconds, each one shaping the appeal strategy. Did you receive this service twice? Was it an emergency? Have you paid anything yet? When you're done, a case brief. What you're disputing, your deadline in general terms, and evidence pointing at specific lines in your documents. Never invented."

## SCENE 4 — Letter + verification, the differentiator (1:40–2:30, letter sheet, highlighted placeholders, Checked line; cutaway: blocked needs_review state)
VO_4: "Now the part most AI tools skip. Accountability. Every dollar amount and every line reference in this letter is checked against your documents by a deterministic checker. Then a second, independent verification pass reads the letter against the facts and flags anything it can't support. Invented payments, quoted text that isn't in your documents, wrong amounts. If it fails, the letter can't be approved. That gate is enforced on our servers, not just the button. Personal details stay as highlighted blanks for you to fill. Nothing is ever sent without you."

## SCENE 5 — Approve → file → track (2:30–2:55, approve → payer guide → print → I filed it → 21-day check-in on timeline)
VO_5: "You approve. That unlocks the filing guide for your payer. Portal, mail, every step. Print to PDF included. Once you file, the advocate schedules check-ins on a durable agent. If there's no response in three weeks, it nudges. This case never goes quiet."

## SCENE 6 — Outcome (2:55–3:15, record reduced, $920 saved card, share, WTP, escalation ladder flash)
VO_6: "When the insurer responds, you record the outcome, and Advocate shows what it's for. Money recovered. That's the metric this product lives on. If they say no, you still get the escalation ladder. External review, state complaint, financial assistance. The advocate doesn't disappear after the letter."

## SCENE 7 — Roadmap + close (3:15–3:30, architecture strip + team)
VO_7: "One dispute type today, medical bills. Same engine, extract, verify, chase, extends to subscriptions and deposits. Voice follow-ups are next. Built on Cloudflare workers, database, storage, and durable agents, so cases keep working while you're away. Advocate. Upload it. We'll fight it. Live now, link below. All demo cases shown are synthetic."

## Recording notes
- Use fresh cases per take; landing flow is instant.
- D4 synthetic bills (duplicate charge, denial-no-reason) give cleanest findings.
- Phone layout for upload/intake, desktop for letter review.
- If a live step is slow, cut it; keep total 3:00–3:45.
- Build: `docs/video/build.sh` (VO via edge-tts + UI captures + ffmpeg assembly).
