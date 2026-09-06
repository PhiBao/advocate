import { useState } from "react";
import {
  ApiRequestError,
  approveLetter,
  editLetter,
  ensureLetter,
  markFiled,
  type CasePublic,
} from "../api";

interface Props {
  kase: CasePublic;
  caseId: string;
  token: string;
  onChange: () => void;
}

/** Render letter body with [BRACKETED] placeholders highlighted. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]+\])/g);
  return (
    <div style={{ whiteSpace: "pre-wrap", fontSize: 15.5 }}>
      {parts.map((p, i) =>
        /^\[[^\]\n]+\]$/.test(p) ? (
          <mark key={i} style={{ background: "var(--warn-soft)", padding: "0 4px", borderRadius: 4 }}>
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

const CHANNELS = [
  { value: "portal", label: "Insurer website / portal" },
  { value: "mail", label: "Mail" },
  { value: "fax", label: "Fax" },
  { value: "phone", label: "Phone call" },
  { value: "in_person", label: "In person" },
];

export default function Review({ kase, caseId, token, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [channel, setChannel] = useState("portal");
  const [fileNote, setFileNote] = useState("");

  const letter = kase.letter;
  const failed = (err: unknown, fallback: string) =>
    setError(err instanceof ApiRequestError ? err.message : fallback);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      failed(err, "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!letter) {
    return (
      <div className="card no-print" style={{ marginTop: 18 }}>
        <strong>Your appeal letter</strong>
        <p style={{ color: "var(--ink-soft)" }}>
          Your case brief is done. Next we draft the actual letter — every number checked
          against your documents.
        </p>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <button className="btn" type="button" disabled={busy} onClick={() => void run(() => ensureLetter(caseId, token))}>
          {busy ? "Drafting…" : "Draft my appeal letter"}
        </button>
      </div>
    );
  }

  const approved = letter.status === "approved";
  const filed = kase.status === "filed" || kase.status === "in_followup";

  return (
    <>
      <div className="card letter-sheet" style={{ marginTop: 18 }}>
        <div className="no-print" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent-deep)", fontWeight: 700 }}>
          Your appeal letter · version {letter.version}
        </div>
        <h3 style={{ margin: "6px 0 8px", fontSize: 19 }}>Re: {letter.subject}</h3>

        {letter.status === "needs_review" && (
          <div className="error-box" role="alert">
            We couldn't verify {letter.issues.length} item{letter.issues.length === 1 ? "" : "s"} in
            this draft: {letter.issues.join("; ")}. Edit the letter to fix them — approval stays
            locked until everything checks out.
          </div>
        )}

        {editing ? (
          <div className="no-print">
            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={140}
                disabled={busy}
                style={{ display: "block", width: "100%", fontSize: 15, padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--line)", margin: "4px 0 10px" }}
              />
            </label>
            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Letter text
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={16}
                disabled={busy}
                style={{ display: "block", width: "100%", fontSize: 14.5, padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--line)", marginTop: 4 }}
              />
            </label>
            {error ? <div className="error-box" role="alert">{error}</div> : null}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn"
                style={{ marginTop: 12 }}
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await editLetter(caseId, token, letter.version, subject, bodyText);
                    setEditing(false);
                  })
                }
              >
                Save new version
              </button>
              <button className="btn secondary" style={{ marginTop: 12 }} type="button" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <Body text={letter.bodyMd} />
            {letter.citations.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--ink-soft)" }}>
                Checked against your documents
                {letter.citations.some((c) => /line/i.test(c.span))
                  ? `: ${letter.citations.filter((c) => /line/i.test(c.span)).map((c) => c.span).join(", ")}`
                  : ""}
                .
              </div>
            )}
          </>
        )}

        {error && !editing ? <div className="error-box" role="alert">{error}</div> : null}

        {!approved && !editing && (
          <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button
              className="btn"
              style={{ marginTop: 0 }}
              type="button"
              disabled={busy || letter.status !== "draft"}
              onClick={() => void run(() => approveLetter(caseId, token, letter.version))}
            >
              {letter.status === "draft" ? "Approve this letter" : "Fix issues to approve"}
            </button>
            <button
              className="btn secondary"
              style={{ marginTop: 0 }}
              type="button"
              disabled={busy}
              onClick={() => {
                setSubject(letter.subject);
                setBodyText(letter.bodyMd);
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
        {approved && (
          <div className="no-print" style={{ marginTop: 12, fontSize: 14.5, color: "var(--accent-deep)", fontWeight: 700 }}>
            ✓ Approved — fill the highlighted parts, then file it with the guide below.
          </div>
        )}
      </div>

      <div className="card no-print" style={{ marginTop: 18 }}>
        <strong>How to file with {kase.filingGuide.payer}</strong>
        <ol style={{ paddingLeft: 20, color: "var(--ink-soft)", fontSize: 15, display: "grid", gap: 6 }}>
          {kase.filingGuide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {kase.filingGuide.portalUrl && (
          <p style={{ fontSize: 14.5 }}>
            Portal:{" "}
            <a href={kase.filingGuide.portalUrl} target="_blank" rel="noreferrer">
              {kase.filingGuide.portalUrl.replace("https://", "")}
            </a>
          </p>
        )}
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{kase.filingGuide.note}</p>
        <button className="btn secondary" type="button" onClick={() => window.print()}>
          Print / save letter as PDF
        </button>
      </div>

      {approved && !filed && (
        <div className="card no-print" style={{ marginTop: 18 }}>
          <strong>Filed it? Tell us how.</strong>
          <p style={{ color: "var(--ink-soft)", fontSize: 14.5 }}>
            We'll start the 3-week check-in so nothing goes quiet.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {CHANNELS.map((ch) => (
              <label key={ch.value} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}>
                <input
                  type="radio"
                  name="channel"
                  value={ch.value}
                  checked={channel === ch.value}
                  onChange={() => setChannel(ch.value)}
                />
                {ch.label}
              </label>
            ))}
          </div>
          <input
            aria-label="Filing reference (optional)"
            value={fileNote}
            onChange={(e) => setFileNote(e.target.value)}
            placeholder="Confirmation # or reference (optional)"
            maxLength={500}
            disabled={busy}
            style={{ width: "100%", fontSize: 15, padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--line)", marginTop: 10 }}
          />
          {error ? <div className="error-box" role="alert">{error}</div> : null}
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void run(() => markFiled(caseId, token, channel, fileNote.trim()))}
          >
            I filed it
          </button>
        </div>
      )}
    </>
  );
}
