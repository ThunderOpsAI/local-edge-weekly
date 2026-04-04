"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ReportApprovalButtonProps {
  reportId: string;
  disabled?: boolean;
}

export function ReportApprovalButton({ reportId, disabled = false }: ReportApprovalButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onApprove() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const response = await fetch(`/api/v1/reports/${reportId}/approve`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "approved" }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { report?: { id?: string }; email?: { delivered?: boolean; reason?: string } }; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "We could not approve that report.");
        return;
      }

      if (payload?.data?.email?.delivered) {
        setNotice("Report approved and email delivered.");
      } else if (payload?.data?.email?.reason === "missing_config") {
        setNotice("Report approved. Email was skipped because Resend is not configured yet.");
      } else {
        setNotice("Report approved.");
      }
      router.refresh();
    });
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="button button-secondary"
        onClick={onApprove}
        disabled={disabled || isPending}
      >
        {isPending ? "Approving..." : "Approve report"}
      </button>
      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
