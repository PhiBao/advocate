import { useState } from "react";
import {
  ApiRequestError,
  dollars,
  recordOutcome,
  submitWtp,
  type OutcomeResult,
} from "../api";

interface Props {
  caseId: string;
  token: string;
  disputedCents: number | null;
  existing: { result: OutcomeResult; amountRecoveredCents: number; note: string; wtp: "yes" | "if_wins" | "no" | null } | null;
  onChange: () => void;
}

const OPTIONS: Array<{ value: OutcomeResult; label: string; hint: string }> = [
  { value: "won_full", label: "They dropped it completely", hint: "You owe $0 on this" },
  { value: "reduced", label: "They reduced it", hint: "You owe less than before" },
  { value: "denied", label: "They said no", hint: "Appeal denied — see escalation options" },
  { value: "no_response", label: "No response yet", hint: "Keep tracking" },
];

export default function Outcome({ caseId, token, disputedCents, existing, onChange }: Props) {
  const [result, setResult] = useState<OutcomeResult | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [wtpAnswer, setWtpAnswer] = useState<"yes" | "if_wins" | "no" | null>(null);
  const [wtpSent, setWtpSent] = useState(false);

  async function submit(): Promise<void> {
    if (!result || busy) return;
    const needsAmount = result === "won_full" || result === "reduced";
    const parsed = Number.parseFloat(amount);
    if (needsAmount && (!Number.isFinite(parsed) || parsed <= 0)) {
      setError("Tell us how much you saved, in dollars.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordOutcome(caseId, token, result, needsAmount ? parsed : 0, "");
      onChange();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    const won = existing.result === "won_full" || existing.result === "reduced";
    return (
      <div className="card result-card" style={{ marginTop: 18 }}>
        {won ? (
          <>
            <div className="result-amount">{dollars(existing.amountRecoveredCents)}</div>
            <strong>saved on this dispute</strong>
            {disputedCents !== null && disputedCents > 0 && (
              <p style={{ color: "var(--ink-soft)", fontSize: 14.5 }}>
                Disputed {dollars(disputedCents)} → saved {dollars(existing.amountRecoveredCents)}
              </p>
            )}
            <button
              className="btn secondary no-print"
              type="button"
              onClick={() => {
                const text = `I disputed a ${disputedCents ? dollars(disputedCents) : "medical"} bill with Advocate and saved ${dollars(existing.amountRecoveredCents)}.`;
                const done = () => setShared(true);
                if (navigator.share) {
                  navigator.share({ title: "Advocate", text }).then(done, done);
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(text).then(done, done);
                } else {
                  done();
                }
              }}
            >
              {shared ? "Copied — spread the word" : "Share your win"}
            </button>
            {existing.wtp === null && !wtpSent && (
              <div className="no-print" style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                <strong style={{ fontSize: 15 }}>One honest question:</strong>
                <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 2 }}>
                  Would you pay $29 for this on your next bill?
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(
                    [
                      { v: "yes", label: "Yes" },
                      { v: "if_wins", label: "Only if it saves me money" },
                      { v: "no", label: "No" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setWtpAnswer(o.v);
                        setBusy(true);
                        submitWtp(caseId, token, o.v)
                          .then(() => setWtpSent(true))
                          .catch(() => setError("Couldn't save that — no worries, skip it."))
                          .finally(() => setBusy(false));
                      }}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 999,
                        border: wtpAnswer === o.v ? "2px solid var(--accent)" : "1.5px solid var(--line)",
                        background: wtpAnswer === o.v ? "var(--accent-soft)" : "var(--surface)",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : existing.result === "denied" ? (
          <>
            <strong>They said no — you still have moves</strong>
            <ol style={{ paddingLeft: 20, color: "var(--ink-soft)", fontSize: 15, display: "grid", gap: 6 }}>
              <li>Ask for an <strong>external review</strong> — your denial letter must explain how. An independent third party re-examines the case.</li>
              <li>File a complaint with your <strong>state insurance department</strong> — regulators track denial patterns.</li>
              <li>Ask the provider for an <strong>itemized statement and financial assistance</strong> — most hospitals have charity-care policies.</li>
            </ol>
            <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
              This isn't legal advice — it's the standard escalation ladder. Each step is free.
            </p>
          </>
        ) : (
          <>
            <strong>Still waiting — good, that's normal</strong>
            <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>
              Appeals often take 30+ days. We'll keep the check-ins coming. The moment they
              respond, record it here.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card no-print" style={{ marginTop: 18 }}>
      <strong>What happened?</strong>
      <p style={{ color: "var(--ink-soft)", fontSize: 14.5 }}>
        Heard back on your appeal? Recording it closes your case — and proves Advocate works.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setResult(o.value);
              setError(null);
            }}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 10,
              border: result === o.value ? "2px solid var(--accent)" : "1.5px solid var(--line)",
              background: result === o.value ? "var(--accent-soft)" : "var(--surface)",
              cursor: "pointer",
              fontSize: 15,
            }}
          >
            <strong>{o.label}</strong>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{o.hint}</div>
          </button>
        ))}
      </div>
      {(result === "won_full" || result === "reduced") && (
        <label style={{ display: "block", marginTop: 12, fontSize: 14, fontWeight: 700 }}>
          How much did you save? ($)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 1840"
            disabled={busy}
            style={{ display: "block", width: "100%", fontSize: 16, padding: "12px 14px", borderRadius: 10, border: "1.5px solid var(--line)", marginTop: 4 }}
          />
        </label>
      )}
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <button className="btn" type="button" disabled={busy || !result} onClick={() => void submit()}>
        Record outcome
      </button>
    </div>
  );
}
