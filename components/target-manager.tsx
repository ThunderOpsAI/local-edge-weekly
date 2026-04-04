"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { TargetSummary } from "@/types/domain";

interface TargetManagerProps {
  projectId: string;
  targets: TargetSummary[];
  competitorLimit: number;
}

export function TargetManager({ projectId, targets, competitorLimit }: TargetManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [role, setRole] = useState<"primary" | "competitor">("competitor");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const competitorCount = useMemo(
    () => targets.filter((target) => !target.isPrimary).length,
    [targets],
  );

  function submitTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/v1/projects/${projectId}/targets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, role }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "We could not add that target.");
        return;
      }

      setNotice(role === "primary" ? "Primary target updated." : "Competitor added.");
      setUrl("");
      setRole("competitor");
      router.refresh();
    });
  }

  function removeTarget(targetId: string) {
    setNotice(null);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/v1/projects/${projectId}/targets/${targetId}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { deleted?: boolean }; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "We could not remove that competitor.");
        return;
      }

      setNotice("Competitor removed.");
      router.refresh();
    });
  }

  return (
    <section className="panel stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Tracked URLs</p>
          <h3>Manage the target and competitors</h3>
        </div>
        <p className="muted">
          {competitorCount}/{competitorLimit} competitor slots used
        </p>
      </div>

      <div className="target-list">
        {targets.map((target) => (
          <div key={target.id} className="target-row">
            <div>
              <strong>{target.name}</strong>
              <p className="muted">{target.url}</p>
            </div>
            <div className="page-actions">
              <span className={`chip ${target.isPrimary ? "chip-good" : "chip-neutral"}`}>
                {target.isPrimary ? "Primary" : "Competitor"}
              </span>
              {!target.isPrimary ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => removeTarget(target.id)}
                  disabled={isPending}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <form className="stack" onSubmit={submitTarget}>
        <div className="form-grid">
          <label className="field">
            <span>Target URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/"
              type="url"
              required
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as "primary" | "competitor")}>
              <option value="competitor">Competitor</option>
              <option value="primary">Primary target</option>
            </select>
          </label>
        </div>

        {notice ? <p className="muted">{notice}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        <button type="submit" className="button button-secondary" disabled={isPending}>
          {isPending ? "Saving..." : "Add URL"}
        </button>
      </form>
    </section>
  );
}
