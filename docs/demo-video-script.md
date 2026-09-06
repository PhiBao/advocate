# Demo video script — 5 minutes (Devpost requirement)

**Goal:** judges see the problem, the working product, and the verification engine — in that order. Screen recording + voiceover. Record at 1920×1080, use a phone mockup or a narrow browser window for the product shots.

## Shot list

**0:00–0:35 — The problem (b-roll + voiceover).**
Show a printed medical bill / EOB (sample documents from `docs/test-docs`).
VO: "85% of denied medical claims are never appealed — yet when people do appeal,
four out of five win. The system doesn't fail because patients are wrong. It fails
because appealing is a second job: decode the bill, write the letter, find the
right portal, chase it for weeks. AI tools today hand you a draft and walk away.
We built the thing that finishes the job."

**0:35–1:15 — Upload → activation moment.**
Screen: land on advocate.kiter0211.workers.dev on a phone-width viewport. Drop in
the sample bill. Watch "Reading your bill…" resolve into findings.
VO: "No account, no signup. You upload a photo of your bill — or a PDF — and within
a couple of minutes your advocate shows you what's actually in it. Not a summary:
specific findings. Here it flagged a duplicate charge — the same $1,840 emergency
visit billed twice — with the exact lines referenced."
Show the explainer card: billed / insurance paid / they say you owe.

**1:15–2:00 — Intake → case brief.**
Tap through 3–4 of the one-at-a-time questions (yes/no, one choice).
VO: "Then a few quick questions — answerable in seconds, each one shaping the
appeal strategy. When you're done: a case brief. What you're disputing, your
deadline in general terms, and evidence that points at specific lines in *your*
documents — never invented."

**2:00–3:10 — The letter + the verification engine (the differentiator — slow down here).**
Screen: the appeal letter with highlighted [BRACKETED] placeholders, then the
"Checked against your documents" line.
VO: "Now the part most AI tools skip: accountability. Every dollar amount and every
line reference in this letter is checked against your documents by a deterministic
checker. Then a second, independent verification pass reads the letter against the
facts and flags anything it can't support — invented payments, quoted text that
isn't in your documents, wrong amounts. If it fails, the letter can't be approved —
that gate is enforced on our servers, not just the UI. You approve; nothing is ever
sent without you."
Optional cutaway (if you have the recording): show the blocked-approval state on a
doctored letter with the flagged issues listed.

**3:10–3:50 — Approve → file → track.**
Approve the letter. Show the payer filing guide and the print-to-PDF letter sheet.
Record "I filed it" → timeline shows the 21-day check-in scheduled.
VO: "Approval unlocks the filing guide for your payer — portal, mail, everything
step by step. Once you file, the advocate schedules check-ins. If there's no
response, it nudges. This case never goes quiet."

**3:50–4:30 — Outcome → the loop that makes it a product.**
Record "They reduced it — $920 saved". Show the result card with the big number,
the share button, the WTP question, and (if you want) the denial escalation ladder.
VO: "When the insurer responds, you record the outcome and Advocate shows what it's
for: money recovered. That's the metric this product lives on. And if they say no,
you still get the escalation ladder — external review, state complaint, financial
assistance. The advocate doesn't disappear after the letter."

**4:30–5:00 — Roadmap + team close.**
VO: "This is one dispute type today: medical bills. The same engine — extract,
verify, chase — extends to subscriptions, deposits, any billing dispute. Voice
follow-up calls are next: the advocate calls the insurer with an approved script
and logs the transcript. Built on Cloudflare's durable agent infrastructure, so
cases keep working while you're away. Advocate: upload it. We'll fight it."

## Recording notes
- Use fresh cases for each take (the landing flow is instant).
- The D4 synthetic bills (duplicate charge, denial-no-reason) produce the cleanest findings.
- Show the phone layout for upload/intake, desktop for the letter review — it prints well.
- If a live step is slow, cut it; keep total under 5:00.
