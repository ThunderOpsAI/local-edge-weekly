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
export type DecisionMoveType =
  | "launch_bundle"
  | "defend_value"
  | "win_lunch"
  | "extend_late_night"
  | "push_group_order"
  | "highlight_signature"
  | "test_limited_offer"
  | "hold_position";

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
  decision_pack_id?: string | null;
}

export interface DecisionMove {
  type: DecisionMoveType | string;
  title: string;
  score: number;
}

export interface PressureSummaryItem {
  type: string;
  level: "high" | "medium" | "low" | string;
  score?: number;
  competitors?: Array<{
    competitor: string;
    score: number;
  }>;
}

export interface DecisionEvidenceItem {
  competitor: string;
  signal_type: string;
  week?: string | null;
  source: string;
  summary?: string;
  demo_flag?: boolean;
}

export interface DecisionExecutionAssets {
  owner_brief: string;
  staff_brief: string;
  promo_lines: string[];
  sms_caption: string;
  delivery_description: string;
}

export interface CompetitorSnapshot {
  competitor: string;
  url?: string | null;
  trigger_score?: number | null;
  current_image_url?: string | null;
  previous_image_url?: string | null;
  diff_summary: string;
  capture_note?: string | null;
  demo_flag?: boolean;
}

export interface DecisionPack {
  id?: string;
  projectId?: string;
  runId?: string;
  weekLabel?: string | null;
  primary_move: DecisionMove;
  secondary_move?: DecisionMove | null;
  pressure_summary: PressureSummaryItem[];
  why_now: string;
  evidence_items: DecisionEvidenceItem[];
  expected_effect: string;
  confidence_score: number;
  execution_assets: DecisionExecutionAssets;
  watch_next_week: string[];
  source_flags?: {
    demo_flag?: boolean;
    sources_fired?: string[];
    snapshot_candidates?: CompetitorSnapshot[];
    [key: string]: unknown;
  };
}

export interface DiagnosticsTarget {
  cafe: string;
  override_present: boolean;
  resolved: boolean;
  resolved_name?: string;
  place_id?: string;
  reason?: string;
  request_exception?: boolean;
  error_message?: string;
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

export interface RedditDiagnosticsTarget {
  cafe: string;
  fetched: boolean;
  posts_found: number;
  subreddits: string[];
  attempts: Array<{
    subreddit: string;
    http_status?: number | null;
    error_message?: string | null;
  }>;
}

export interface CompetitorWebsiteDiagnosticsTarget {
  cafe: string;
  url: string;
  fetched: boolean;
  matched_keywords: string[];
  http_status?: number | null;
  error_message?: string | null;
}

export interface SourceDiagnostics {
  source_stats: {
    success: number;
    fail: number;
    failure_ratio: number;
  };
  google_maps: DiagnosticsTarget[];
  reddit: RedditDiagnosticsTarget[];
  competitor_urls: CompetitorWebsiteDiagnosticsTarget[];
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

export interface TargetSummary {
  id: string;
  url: string;
  name: string;
  role: "primary" | "competitor";
  isPrimary: boolean;
  placeId?: string | null;
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

export interface ReportRecord {
  id: string;
  runId: string;
  projectId: string;
  projectName?: string;
  status: "draft" | "approved" | "archived";
  coverageScore: number;
  createdAt: string;
  approvedAt?: string | null;
  body: WeeklyIntelReport;
  decisionPack?: DecisionPack | null;
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

export interface RunCheckpoint {
  id: string;
  stage: string;
  status: "completed" | "failed" | "skipped";
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  startedAt?: string | null;
  completedAt?: string | null;
  checkpoints: RunCheckpoint[];
}

export interface DashboardMetric {
  label: string;
  value: string;
  helper: string;
  tone: "good" | "warn" | "neutral";
  href?: string;
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

export interface TrendDeltaCard {
  title: string;
  summary: string;
  tone: "good" | "warn" | "neutral";
}

export interface ProjectTrendData {
  snapshot: TrendSnapshot;
  deltas: TrendDeltaCard[];
}

export interface AdminRunRow {
  id: string;
  projectId: string;
  projectName: string;
  status: ProjectLifecycleStatus;
  stage: string;
  coverageScore: number;
  createdAt: string;
}

export interface AdminReportRow {
  id: string;
  projectId: string;
  projectName: string;
  status: "draft" | "approved" | "archived";
  coverageScore: number;
  createdAt: string;
}

export interface AdminOverviewData {
  account: AccountSummary;
  projectsCount: number;
  runsInFlight: number;
  failedRuns: number;
  approvedReports: number;
  recentRuns: AdminRunRow[];
  recentReports: AdminReportRow[];
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
  reportRecord: ReportRecord | null;
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
