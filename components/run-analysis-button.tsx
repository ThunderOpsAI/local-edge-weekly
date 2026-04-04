"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface RunAnalysisButtonProps {
  projectId: string;
  disabled?: boolean;
}

export function RunAnalysisButton({ projectId, disabled = false }: RunAnalysisButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const response = await fetch(`/api/v1/projects/${projectId}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { status?: string; message?: string }; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Run failed to start.");
        return;
      }

      setNotice(
        payload?.data?.message ?? "Run queued successfully. Refresh in a moment to see status updates.",
      );
      router.refresh();
    });
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="button button-primary"
        onClick={onClick}
        disabled={disabled || isPending}
      >
        {isPending ? "Queuing analysis..." : "Run analysis"}
      </button>
      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
