import { useCallback, useRef, useState } from "react";
import { ApiRequestError, createCase } from "../api";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_MB = 15;

interface Props {
  onCreated: (caseId: string, token: string) => void;
}

export default function UploadCard({ onCreated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_MB * 1_048_576) {
        setError(`That file is over ${MAX_MB} MB. Please upload a smaller photo or PDF.`);
        return;
      }
      setBusy(true);
      try {
        const res = await createCase(file);
        onCreated(res.caseId, res.claimToken);
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Something went wrong uploading. Please try again.",
        );
        setBusy(false);
      }
    },
    [onCreated],
  );

  return (
    <div className="card">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Upload your bill or denial letter"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void submit(f);
        }}
      >
        <strong>{busy ? "Sending your bill to your advocate…" : "Drop your bill or denial letter here"}</strong>
        <small>…or tap to take a photo. PDF, JPG, PNG, WebP up to {MAX_MB} MB.</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void submit(f);
          e.target.value = "";
        }}
      />
      {error ? <div className="error-box" role="alert">{error}</div> : null}
      <div className="privacy-note" aria-label="Privacy note">
        <span aria-hidden="true">🔒</span>
        <span>
          No account needed. Please black out your Social Security number — we never need it.
          Your file auto-deletes. <a href="#/privacy">How we handle your data</a>
        </span>
      </div>
    </div>
  );
}
