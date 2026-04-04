"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PlanType } from "@/types/domain";

interface CreateProjectFormProps {
  defaultPlan: PlanType;
}

const PLAN_COPY: Record<
  PlanType,
  { competitorLimit: number; cadence: string; diagnostics: string; rerun: string }
> = {
  trial: {
    competitorLimit: 2,
    cadence: "Monthly runs",
    diagnostics: "Diagnostics hidden in trial mode",
    rerun: "No manual reruns",
  },
  solo: {
    competitorLimit: 2,
    cadence: "Monthly runs",
    diagnostics: "Simple reports",
    rerun: "No manual reruns",
  },
  edge: {
    competitorLimit: 5,
    cadence: "Weekly runs",
    diagnostics: "Diagnostics included",
    rerun: "One extra manual rerun each month",
  },
};

function blankCompetitors(limit: number) {
  return Array.from({ length: limit }, () => "");
}

export function CreateProjectForm({ defaultPlan }: CreateProjectFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [plan, setPlan] = useState<PlanType>(defaultPlan);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("pub");
  const [location, setLocation] = useState("");
  const [primaryUrl, setPrimaryUrl] = useState("");
  const [competitors, setCompetitors] = useState<string[]>(blankCompetitors(PLAN_COPY[defaultPlan].competitorLimit));
  const [error, setError] = useState<string | null>(null);

  const planCopy = PLAN_COPY[plan];
  const activeCompetitors = useMemo(
    () => competitors.slice(0, planCopy.competitorLimit),
    [competitors, planCopy.competitorLimit],
  );

  function updatePlan(nextPlan: PlanType) {
    setPlan(nextPlan);
    setCompetitors((current) => {
      const next = [...current];
      while (next.length < PLAN_COPY[nextPlan].competitorLimit) {
        next.push("");
      }
      return next.slice(0, PLAN_COPY[nextPlan].competitorLimit);
    });
  }

  function updateCompetitor(index: number, value: string) {
    setCompetitors((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          plan,
          industry,
          location,
          primaryUrl,
          competitorUrls: activeCompetitors.filter(Boolean),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: string }
        | null;

      if (!response.ok || !payload?.data?.id) {
        setError(payload?.error ?? "We could not create the project just yet.");
        return;
      }

      router.push(`/projects/${payload.data.id}`);
      router.refresh();
    });
  }

  return (
    <form className="panel form-shell" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">Project Setup</p>
        <h2>Create a customer-ready project</h2>
        <p className="muted">
          Owners add one target, a handful of competitors, and Local Edge handles the monitoring on
          the chosen plan cadence.
        </p>
      </div>

      <div className="plan-selector">
        {(["solo", "edge"] as PlanType[]).map((planOption) => (
          <button
            key={planOption}
            type="button"
            className={`plan-card ${plan === planOption ? "plan-card-active" : ""}`}
            onClick={() => updatePlan(planOption)}
          >
            <span className="eyebrow">{planOption}</span>
            <strong>{planOption === "solo" ? "$24/mo" : "$39/mo"}</strong>
            <span className="muted">{PLAN_COPY[planOption].cadence}</span>
            <span className="muted">{PLAN_COPY[planOption].diagnostics}</span>
          </button>
        ))}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Project name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Pinsent Hotel" required />
        </label>
        <label className="field">
          <span>Industry</span>
          <select value={industry} onChange={(event) => setIndustry(event.target.value)}>
            <option value="pub">Pub</option>
            <option value="dentist">Dentist</option>
            <option value="gym">Gym</option>
            <option value="trades">Trades</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>Location</span>
        <input
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder="Wangaratta VIC"
          required
        />
      </label>

      <label className="field">
        <span>Primary business URL</span>
        <input
          value={primaryUrl}
          onChange={(event) => setPrimaryUrl(event.target.value)}
          placeholder="https://www.pinsenthotel.com.au/"
          required
          type="url"
        />
      </label>

      <div className="stack">
        <div className="section-header">
          <div>
            <p className="eyebrow">Competitors</p>
            <h3>Track up to {planCopy.competitorLimit} competitors on this plan</h3>
          </div>
          <p className="muted">{planCopy.rerun}</p>
        </div>

        {activeCompetitors.map((competitor, index) => (
          <label key={index} className="field">
            <span>Competitor URL {index + 1}</span>
            <input
              value={competitor}
              onChange={(event) => updateCompetitor(index, event.target.value)}
              placeholder="https://example.com/"
              type="url"
            />
          </label>
        ))}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="page-actions">
        <button type="submit" className="button button-primary" disabled={isPending}>
          {isPending ? "Creating project..." : "Create project"}
        </button>
        <p className="muted">
          First run data appears after the analysis worker is connected. This form already stores
          the project shell in Supabase when configured.
        </p>
      </div>
    </form>
  );
}
