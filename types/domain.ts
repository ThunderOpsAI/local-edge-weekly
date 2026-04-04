export type MarketStatus = "Growth" | "Stagnant" | "Volatile";
export type ProjectLifecycleStatus =
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";
export type PlanType = "trial" | "solo" | "edge";
export type RunCadence = "weekly" | "monthly";

export interface ReportLead {
  name: string;
  gap: string;
  hook: string;
}

export interface CompetitorDelta {
  name: string;
  summary: string;
  impact: number;
}

export interface WeeklyIntelReport {
  timestamp: string;
  market_status: MarketStatus;
  competitor_delta: [string, string, number][];
  target_leads: [string, string, string][];
}

export interface DiagnosticsTarget {
  cafe: string;
  override_present: boolean;
  resolved: boolean;
  resolved_name?: string;
  place_id?: string;
  rating?: number;
  reviews_count?: number;
  details_context?: {
    api_status?: string;
    website?: string;
    price_level?: number | null;
    opening_hours?: string[];
    reviews_fetched?: number;
  } | null;
  attempts: Array<{
    api_status: string;
    via: string;
    query: string;
    name?: string | null;
    place_id?: string | null;
    rating?: number | null;
    reviews_count?: number | null;
    http_status?: number | null;
    error_message?: string | null;
  }>;
}

export interface SourceDiagnostics {
  source_stats: {
    success: number;
    fail: number;
    failure_ratio: number;
  };
  google_maps: DiagnosticsTarget[];
}

export interface AccountSummary {
  id: string;
  name: string;
  plan: PlanType;
  cadence: RunCadence;
  diagnosticsEnabled: boolean;
  playbookActionsPerRun: number;
  manualRerunAvailable: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  industry: string;
  location: string;
  primaryTarget: string;
  competitors: string[];
  coverageScore: number;
  lastRunAt: string;
  reportStatus: ProjectLifecycleStatus;
  plan: PlanType;
  cadence: RunCadence;
  diagnosticsEnabled: boolean;
  playbookActionsPerRun: number;
  manualRerunAvailable: boolean;
}

export interface RunSummary {
  id: string;
  projectId: string;
  status: ProjectLifecycleStatus;
  stage: string;
  coverageScore: number;
  createdAt: string;
  durationLabel?: string;
}

export interface DashboardMetric {
  label: string;
  value: string;
  helper: string;
  tone: "good" | "warn" | "neutral";
}

export interface OpportunityCard {
  title: string;
  summary: string;
  sourceLabel: string;
  tone: "good" | "warn" | "neutral";
}

export interface PlaybookAction {
  title: string;
  detail: string;
  priority: "High" | "Medium" | "Low";
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface TrendSeries {
  label: string;
  color: string;
  points: TrendPoint[];
}

export interface TrendSnapshot {
  unlocked: boolean;
  helper: string;
  series: TrendSeries[];
}

export interface ComparisonRow {
  venue: string;
  rating: string;
  reviewVolume: string;
  website: string;
  status: string;
}

export interface CoverageBlock {
  score: number;
  resolvedSources: number;
  missingSources: number;
  helper: string;
}

export interface DashboardData {
  project: ProjectSummary;
  account: AccountSummary;
  report: WeeklyIntelReport | null;
  diagnostics: SourceDiagnostics;
  runs: RunSummary[];
  leads: ReportLead[];
  deltas: CompetitorDelta[];
  metrics: DashboardMetric[];
  opportunities: OpportunityCard[];
  playbook: PlaybookAction[];
  comparison: ComparisonRow[];
  trends: TrendSnapshot;
  coverage: CoverageBlock;
}
