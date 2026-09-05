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
  reading: { title: "Reading your bill…", sub: "This takes about 30 seconds. Findings land here." },
  needs_info: { title: "One quick thing.", sub: "Your advocate has a question before building the case." },
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
  return (
    <>
      <div className="status-hero">
        {(state.kase.status === "reading" || state.kase.status === "uploaded") && (
          <div className="spinner" aria-hidden="true" />
        )}
        <h2>{copy?.title}</h2>
        <p>{copy?.sub}</p>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <strong>What your advocate has done</strong>
        <ul className="timeline">
          {state.kase.timeline.map((e) => (
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
