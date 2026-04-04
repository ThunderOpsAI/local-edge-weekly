import type { ProjectLifecycleStatus } from "@/types/domain";

interface StatusChipProps {
  tone: "good" | "warn" | "neutral";
  label: string;
}

const toneClassMap: Record<StatusChipProps["tone"], string> = {
  good: "chip chip-good",
  warn: "chip chip-warn",
  neutral: "chip chip-neutral",
};

export function StatusChip({ tone, label }: StatusChipProps) {
  return <span className={toneClassMap[tone]}>{label}</span>;
}

export function getStatusTone(status: ProjectLifecycleStatus): StatusChipProps["tone"] {
  if (status === "completed") {
    return "good";
  }

  if (status === "partial" || status === "queued" || status === "running") {
    return "warn";
  }

  return "neutral";
}
