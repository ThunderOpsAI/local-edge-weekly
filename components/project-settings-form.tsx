"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface ProjectSettingsFormProps {
  projectId: string;
  initialName: string;
  initialIndustry: string;
  initialLocation: string;
}

export function ProjectSettingsForm({
  projectId,
  initialName,
  initialIndustry,
  initialLocation,
}: ProjectSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [industry, setIndustry] = useState(initialIndustry);
  const [location, setLocation] = useState(initialLocation);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, industry, location }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "We could not save the project details.");
        return;
      }

      setNotice("Project details updated.");
      router.refresh();
    });
  }

  return (
    <form className="panel form-shell" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">Project Settings</p>
        <h3>Edit the customer-facing project details</h3>
      </div>

      <label className="field">
        <span>Project name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <div className="form-grid">
        <label className="field">
          <span>Industry</span>
          <input value={industry} onChange={(event) => setIndustry(event.target.value)} required />
        </label>
        <label className="field">
          <span>Location</span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} required />
        </label>
      </div>

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <button type="submit" className="button button-secondary" disabled={isPending}>
        {isPending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
