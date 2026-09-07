import { useState } from "react";
import UploadCard from "../components/UploadCard";
import { ApiRequestError, createCase } from "../api";

interface Props {
  onCreated: (caseId: string, token: string) => void;
}

export default function Landing({ onCreated }: Props) {
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  async function trySample(): Promise<void> {
    if (sampleBusy) return;
    setSampleBusy(true);
    setSampleError(null);
    try {
      const res = await fetch("/sample-bill.png");
      if (!res.ok) throw new Error("sample missing");
      const blob = await res.blob();
      const file = new File([blob], "sample-bill.png", { type: "image/png" });
      const created = await createCase(file);
      onCreated(created.caseId, created.claimToken);
    } catch (err) {
      setSampleError(
        err instanceof ApiRequestError
          ? err.message
          : "Couldn't load the sample bill. Upload your own file above instead.",
      );
      setSampleBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <h1>
          Got a medical bill that looks wrong? <span style={{ color: "var(--accent-deep)" }}>We&rsquo;ll fight it.</span>
        </h1>
        <p>
          Upload your bill or denial letter. Your advocate finds what&rsquo;s wrong, builds the
          case, writes the appeal, and chases it until you get an answer.
        </p>
      </section>

      <div className="card" style={{ marginBottom: 14 }} aria-label="Why appeals work">
        <ul className="money-list" style={{ marginTop: 0 }}>
          <li><span>Denied claims never appealed</span><strong>85%</strong></li>
          <li><span>Appeals that get overturned</span><strong>~80%</strong></li>
          <li><span>Bills containing errors</span><strong>up to 80%</strong></li>
        </ul>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: "10px 0 0" }}>
          The gap isn&rsquo;t knowledge. It&rsquo;s follow-through — Advocate finishes the job and
          measures itself in dollars recovered.
        </p>
      </div>

      <UploadCard onCreated={onCreated} />

      <div className="card no-print" style={{ marginTop: 14, textAlign: "center" }}>
        <strong>No bill handy? Try a sample.</strong>
        <p style={{ color: "var(--ink-soft)", fontSize: 14.5, margin: "4px 0 0" }}>
          One tap loads a synthetic $1,840 duplicate-charge bill — no real data, full flow in
          about three minutes.
        </p>
        {sampleError ? <div className="error-box" role="alert">{sampleError}</div> : null}
        <button className="btn secondary" type="button" disabled={sampleBusy} onClick={() => void trySample()}>
          {sampleBusy ? "Loading sample case…" : "Try with a sample bill"}
        </button>
      </div>

      <ol className="steps">
        <li>
          <strong>Step 1 · Understand</strong>
          We read your bill and show you, in plain English, what you&rsquo;re being charged and
          what looks off — in about three minutes.
        </li>
        <li>
          <strong>Step 2 · Build the case</strong>
          A few quick questions, then a real appeal letter with every claim tied to your
          documents. You approve everything before anything is sent.
        </li>
        <li>
          <strong>Step 3 · Chase it down</strong>
          Filing help, follow-up calls, deadline tracking — until there&rsquo;s an outcome.
        </li>
      </ol>

      <p className="disclaimer">
        Advocate provides document preparation and advocacy assistance. It is not a law firm and
        does not provide legal or medical advice. Nothing is ever sent to your insurer or
        provider without your explicit approval.
      </p>
    </>
  );
}
