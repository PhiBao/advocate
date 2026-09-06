import { useEffect, useState } from "react";
import { ApiRequestError, getCase, type CasePublic } from "../api";

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

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const kase = await getCase(caseId, token);
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
    // Light polling while the case is young so "reading" flips without refresh.
    const t = window.setInterval(() => {
      void getCase(caseId, token)
        .then((kase) => {
          if (!cancelled) setState({ kind: "ready", kase });
        })
        .catch(() => undefined);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [caseId, token]);

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
  const readingLong =
    (kase.status === "reading" || kase.status === "uploaded") &&
    Date.now() - kase.created_at > 180_000;
  const heroTitle = kase.findings.length > 0 ? "Here's what we found in your bill." : copy?.title;
  const heroSub =
    kase.findings.length > 0
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

      <div className="card" style={{ marginTop: 18 }}>
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

      <p className="disclaimer">
        Keep this link — it&rsquo;s your private key to this case, no account needed. Nothing is
        ever sent to your insurer or provider without your explicit approval.
      </p>
    </>
  );
}
