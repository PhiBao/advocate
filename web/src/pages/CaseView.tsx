import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, dollars, fetchQuestions, getCase, type CasePublic } from "../api";
import Intake from "../components/Intake";
import Outcome from "../components/Outcome";
import Review from "../components/Review";

interface Props {
  caseId: string;
  token: string;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; kase: CasePublic };

const STATUS_COPY: Record<string, { title: string; sub: string }> = {
  uploaded: { title: "Bill received.", sub: "Your advocate is picking it up." },
  reading: { title: "Reading your bill…", sub: "This usually takes under a minute. Findings land here." },
  needs_info: { title: "Your advocate has questions.", sub: "Review what's below — a few quick questions come next." },
  ready_for_review: { title: "Your case is ready to review.", sub: "Check the appeal letter before anything is sent." },
  approved: { title: "Approved.", sub: "Your advocate is filing and following up." },
  filed: { title: "Filed.", sub: "We're tracking the deadline and chasing a response." },
  in_followup: { title: "Following up.", sub: "Calls and check-ins are happening in the background." },
  resolved: { title: "Resolved.", sub: "Here's what changed and what you saved." },
  closed: { title: "Case closed.", sub: "Thanks for letting us fight this one with you." },
};

export default function CaseView({ caseId, token }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const kase = await getCase(caseId, token);
      setState({ kind: "ready", kase });
    } catch {
      // Polling failures are silent; the explicit load below reports errors.
    }
  }, [caseId, token]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const kase = await getCase(caseId, token);
        if (cancelled) return;
        // Questions may still be generating: one best-effort fetch (idempotent).
        if (
          (kase.status === "needs_info" || kase.status === "ready_for_review") &&
          kase.findings.length > 0 &&
          kase.questions.length === 0
        ) {
          try {
            await fetchQuestions(caseId, token);
            const withQ = await getCase(caseId, token);
            if (!cancelled) {
              setState({ kind: "ready", kase: withQ });
              return;
            }
          } catch {
            // Generation endpoint retries on next poll / user action.
          }
        }
        if (!cancelled) setState({ kind: "ready", kase });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof ApiRequestError
              ? err.message
              : "Couldn't load this case. Check the link and try again.",
        });
      }
    }
    void load();
    // Poll fast while the agent is working; back off once things settle.
    const t = window.setInterval(() => {
      void refresh();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [caseId, token, refresh]);

  if (state.kind === "loading") {
    return (
      <div className="status-hero">
        <div className="spinner" aria-hidden="true" />
        <p>Opening your case…</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="status-hero">
        <h2>That link didn&rsquo;t work</h2>
        <p>{state.message}</p>
        <a className="btn secondary" href="#/">
          Start a new case
        </a>
      </div>
    );
  }

  const copy = STATUS_COPY[state.kase.status] ?? STATUS_COPY["reading"];
  const kase = state.kase;
  const showIntake =
    (kase.status === "needs_info" || kase.status === "ready_for_review") &&
    kase.questions.length > 0 &&
    !kase.summary;
  const showReview =
    kase.summary !== null &&
    (kase.status === "ready_for_review" || kase.status === "approved" || kase.status === "filed");
  const showOutcome =
    kase.status === "filed" ||
    kase.status === "in_followup" ||
    kase.status === "resolved" ||
    kase.status === "closed";
  const readingLong =
    (kase.status === "reading" || kase.status === "uploaded") &&
    Date.now() - kase.created_at > 180_000;
  const won = kase.outcome !== null && (kase.outcome.result === "won_full" || kase.outcome.result === "reduced");
  const heroTitle = won
    ? `You saved ${dollars(kase.outcome?.amountRecoveredCents ?? 0)}.`
    : kase.findings.length > 0 && (kase.status === "reading" || kase.status === "needs_info" || kase.status === "ready_for_review")
      ? "Here's what we found in your bill."
      : copy?.title;
  const heroSub = won
    ? "That's real money back. Start a new case any time a bill looks wrong."
    : kase.findings.length > 0 &&
        (kase.status === "reading" || kase.status === "needs_info" || kase.status === "ready_for_review")
      ? "Review each item. Next, a few quick questions so we can build your appeal."
      : copy?.sub;
  return (
    <>
      <div className="status-hero">
        {(kase.status === "reading" || kase.status === "uploaded") && kase.findings.length === 0 && (
          <div className="spinner" aria-hidden="true" />
        )}
        <h2>{heroTitle}</h2>
        <p>{heroSub}</p>
        {readingLong && (
          <div className="slow-note" role="status">
            Still reading — this is taking longer than usual. Keep this tab open; if nothing
            appears in a couple of minutes, your file may be unreadable and we'll tell you
            plainly.
          </div>
        )}
      </div>

      {kase.explainer && (
        <div className="card" style={{ marginTop: 18 }}>
          <strong>What this {kase.explainer.documentKind === "unknown" ? "document" : kase.explainer.documentKind.toUpperCase()} says</strong>
          <ul className="money-list">
            {kase.explainer.totalBilledCents !== null && (
              <li><span>Billed</span><strong>{dollars(kase.explainer.totalBilledCents)}</strong></li>
            )}
            {kase.explainer.insurerPaidCents !== null && (
              <li><span>Insurance paid</span><strong>{dollars(kase.explainer.insurerPaidCents)}</strong></li>
            )}
            {kase.explainer.patientResponsibilityCents !== null && (
              <li className="total"><span>They say you owe</span><strong>{dollars(kase.explainer.patientResponsibilityCents)}</strong></li>
            )}
          </ul>
          {(kase.explainer.providerName || kase.explainer.payerName) && (
            <div style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 8 }}>
              {[kase.explainer.providerName, kase.explainer.payerName].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}

      {kase.summary && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent-deep)", fontWeight: 700 }}>
            Your case brief
          </div>
          <h3 style={{ margin: "6px 0 8px", fontSize: 20 }}>{kase.summary.disputeLabel}</h3>
          <p style={{ color: "var(--ink-soft)" }}>{kase.summary.strategy}</p>
          <ul className="evidence">
            {kase.summary.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p style={{ fontSize: 14.5 }}><strong>Next:</strong> {kase.summary.nextStep}</p>
          <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{kase.summary.deadlineText}</p>
        </div>
      )}

      {showIntake && (
        <Intake caseId={caseId} token={token} initial={kase.questions} onDone={() => void refresh()} />
      )}
      {showReview && (
        <Review kase={kase} caseId={caseId} token={token} onChange={() => void refresh()} />
      )}
      {showOutcome && (
        <Outcome
          caseId={caseId}
          token={token}
          disputedCents={kase.explainer?.patientResponsibilityCents ?? null}
          existing={kase.outcome}
          onChange={() => void refresh()}
        />
      )}
      {kase.findings.length > 0 && (
        <ul className="findings">
          {kase.findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className={`finding ${f.severity}`}>
              <span className="tag">
                {f.severity === "high" ? "Worth disputing" : f.severity === "medium" ? "Check this" : "Good to know"}
              </span>
              <br />
              <strong>{f.title}</strong>
              <p>{f.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="card no-print" style={{ marginTop: 18 }}>
        <strong>What your advocate has done</strong>
        <ul className="timeline">
          {kase.timeline.map((e) => (
            <li key={e.id}>
              <strong>{e.title}</strong>
              {e.body ? <div style={{ color: "var(--ink-soft)" }}>{e.body}</div> : null}
              <time>{new Date(e.created_at).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </div>

      {won && (
        <a className="btn no-print" href="#/" style={{ marginTop: 18, textDecoration: "none" }}>
          Start a new case
        </a>
      )}

      <p className="disclaimer">
        Keep this link — it&rsquo;s your private key to this case, no account needed. Nothing is
        ever sent to your insurer or provider without your explicit approval.
      </p>
    </>
  );
}
