import UploadCard from "../components/UploadCard";

interface Props {
  onCreated: (caseId: string, token: string) => void;
}

export default function Landing({ onCreated }: Props) {
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

      <UploadCard onCreated={onCreated} />

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
