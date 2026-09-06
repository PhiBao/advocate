import { useState } from "react";
import { ApiRequestError, submitAnswers, type IntakeQuestion } from "../api";

interface Props {
  caseId: string;
  token: string;
  initial: IntakeQuestion[];
  onDone: () => void;
}

/** One-question-at-a-time intake. Answers submit as a batch when complete. */
export default function Intake({ caseId, token, initial, onDone }: Props) {
  const [questions, setQuestions] = useState<IntakeQuestion[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = questions.findIndex((q) => !q.answer);
  const current = index === -1 ? undefined : questions[index];
  const done = questions.filter((q) => q.answer).length;

  async function answer(value: string): Promise<void> {
    if (!current || busy) return;
    setError(null);
    const next = questions.map((q, i) => (i === index ? { ...q, answer: value } : q));
    setQuestions(next);
    setText("");
    const remaining = next.filter((q) => !q.answer);
    if (remaining.length > 0) return;
    // All answered: submit the batch and build the brief.
    setBusy(true);
    try {
      const res = await submitAnswers(
        caseId,
        token,
        next.map((q) => ({ key: q.key, value: q.answer ?? "" })),
      );
      setQuestions(res.questions);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Couldn't save that. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <div className="card" style={{ marginTop: 18 }}>
        <strong>Building your case brief…</strong>
        <p style={{ color: "var(--ink-soft)" }}>This usually takes under a minute.</p>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        {busy ? null : (
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setBusy(true);
              setError(null);
              submitAnswers(caseId, token, [])
                .then((res) => {
                  setQuestions(res.questions);
                  onDone();
                })
                .catch((err: unknown) => {
                  setError(
                    err instanceof ApiRequestError
                      ? err.message
                      : "Couldn't build the brief. Try again in a moment.",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            Build my case brief
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ fontSize: 13, color: "var(--ink-faint)", marginBottom: 8 }}>
        Question {done + 1} of {questions.length} · a few quick answers build your appeal
      </div>
      <strong style={{ fontSize: 18 }}>{current.prompt}</strong>

      {current.kind === "yes_no" && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn" style={{ marginTop: 0 }} type="button" disabled={busy} onClick={() => void answer("Yes")}>
            Yes
          </button>
          <button className="btn secondary" style={{ marginTop: 0 }} type="button" disabled={busy} onClick={() => void answer("No")}>
            No
          </button>
        </div>
      )}

      {current.kind === "single_choice" && (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {current.options.map((o) => (
            <button key={o} className="btn secondary" style={{ marginTop: 0 }} type="button" disabled={busy} onClick={() => void answer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}

      {current.kind === "short_text" && (
        <form
          style={{ marginTop: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void answer(text.trim());
          }}
        >
          <input
            aria-label={current.prompt}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a short answer…"
            maxLength={500}
            disabled={busy}
            style={{
              width: "100%",
              fontSize: 16,
              padding: "12px 14px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
            }}
          />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>
            Continue
          </button>
        </form>
      )}

      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </div>
  );
}
