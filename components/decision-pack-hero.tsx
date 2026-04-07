"use client";

import { useState } from "react";

import type { DecisionPack } from "@/types/domain";

interface DecisionPackHeroProps {
  decisionPack: DecisionPack;
}

function formatPressureLabel(value: string) {
  return value
    .replace(/_pressure$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pressureTone(level: string) {
  if (level === "high") {
    return "chip chip-warn";
  }
  if (level === "medium") {
    return "chip chip-neutral";
  }
  return "chip chip-good";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="button button-ghost copy-button" onClick={copyValue}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function DecisionPackHero({ decisionPack }: DecisionPackHeroProps) {
  const [view, setView] = useState<"owner" | "evidence">("owner");
  const assets = decisionPack.execution_assets;
  const promoLines = assets.promo_lines ?? [];

  return (
    <article className="panel hero-panel decision-pack-hero">
      <div className="section-header decision-pack-header">
        <div>
          <p className="eyebrow">The Move</p>
          <h2>{decisionPack.primary_move.title}</h2>
          <p className="muted">{decisionPack.why_now}</p>
        </div>
        <div className="decision-pack-score">
          <span className="metric-label">Confidence</span>
          <strong>{decisionPack.confidence_score}/100</strong>
          {decisionPack.source_flags?.demo_flag ? <span className="chip chip-neutral">Demo Data</span> : null}
        </div>
      </div>

      <div className="pressure-chip-row">
        {decisionPack.pressure_summary.slice(0, 4).map((item) => (
          <span key={item.type} className={pressureTone(item.level)}>
            {formatPressureLabel(item.type)}: {item.level}
          </span>
        ))}
      </div>

      <div className="decision-toggle" role="group" aria-label="Decision pack view">
        <button
          type="button"
          className={`button ${view === "owner" ? "button-primary" : "button-secondary"}`}
          aria-pressed={view === "owner"}
          onClick={() => setView("owner")}
        >
          Owner
        </button>
        <button
          type="button"
          className={`button ${view === "evidence" ? "button-primary" : "button-secondary"}`}
          aria-pressed={view === "evidence"}
          onClick={() => setView("evidence")}
        >
          Evidence
        </button>
      </div>

      {view === "owner" ? (
        <div className="dashboard-grid decision-pack-grid">
          <div className="report-callout">
            <span className="metric-label">Why Now</span>
            <p>{decisionPack.why_now}</p>
          </div>
          <div className="report-callout">
            <span className="metric-label">Expected Effect</span>
            <p>{decisionPack.expected_effect}</p>
          </div>
          <div className="report-callout full-span">
            <div className="section-header">
              <div>
                <span className="metric-label">Owner Brief</span>
                <p>{assets.owner_brief}</p>
              </div>
              <CopyButton value={assets.owner_brief} />
            </div>
          </div>
          <div className="report-callout">
            <div className="section-header">
              <div>
                <span className="metric-label">Staff Brief</span>
                <p>{assets.staff_brief}</p>
              </div>
              <CopyButton value={assets.staff_brief} />
            </div>
          </div>
          <div className="report-callout">
            <span className="metric-label">Promo Lines</span>
            <div className="asset-list">
              {promoLines.map((line) => (
                <div key={line} className="asset-row">
                  <span>{line}</span>
                  <CopyButton value={line} />
                </div>
              ))}
            </div>
          </div>
          <div className="report-callout">
            <div className="section-header">
              <div>
                <span className="metric-label">SMS Caption</span>
                <p>{assets.sms_caption}</p>
              </div>
              <CopyButton value={assets.sms_caption} />
            </div>
          </div>
          <div className="report-callout">
            <div className="section-header">
              <div>
                <span className="metric-label">Delivery Description</span>
                <p>{assets.delivery_description}</p>
              </div>
              <CopyButton value={assets.delivery_description} />
            </div>
          </div>
          <div className="report-callout full-span">
            <span className="metric-label">Watch Next Week</span>
            <div className="subtle-list">
              {decisionPack.watch_next_week.map((item) => (
                <div key={item} className="subtle-list-item">
                  <span className="subtle-bullet" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="list-grid">
          {decisionPack.evidence_items.length > 0 ? (
            decisionPack.evidence_items.map((item, index) => (
              <div key={`${item.competitor}-${item.signal_type}-${index}`} className="delta-row evidence-row">
                <div>
                  <h4>{item.competitor}</h4>
                  <p className="muted">{item.summary ?? item.signal_type}</p>
                  <span className="metric-label">
                    {item.source} {item.week ? `- ${item.week}` : ""}
                  </span>
                </div>
                {item.demo_flag ? <span className="chip chip-neutral">Demo Data</span> : null}
              </div>
            ))
          ) : (
            <p className="muted">No evidence items were stored for this decision pack.</p>
          )}
        </div>
      )}
    </article>
  );
}
