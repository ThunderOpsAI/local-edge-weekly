import type { CreateProjectInput } from "@/lib/api-contract";
import { getAccountContext } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AccountSummary,
  ComparisonRow,
  CompetitorDelta,
  CoverageBlock,
  DashboardData,
  DashboardMetric,
  DiagnosticsTarget,
  OpportunityCard,
  PlanType,
  PlaybookAction,
  ProjectLifecycleStatus,
  ProjectSummary,
  ReportLead,
  RunCadence,
  RunSummary,
  SourceDiagnostics,
  TrendSnapshot,
  TrendSeries,
  WeeklyIntelReport,
} from "@/types/domain";

const PLAN_SETTINGS: Record<
  PlanType,
  {
    cadence: RunCadence;
    diagnosticsEnabled: boolean;
    playbookActionsPerRun: number;
    manualRerunAvailable: boolean;
    competitorLimit: number;
  }
> = {
  trial: {
    cadence: "monthly",
    diagnosticsEnabled: false,
    playbookActionsPerRun: 1,
    manualRerunAvailable: false,
    competitorLimit: 2,
  },
  solo: {
    cadence: "monthly",
    diagnosticsEnabled: false,
    playbookActionsPerRun: 1,
    manualRerunAvailable: false,
    competitorLimit: 2,
  },
  edge: {
    cadence: "weekly",
    diagnosticsEnabled: true,
    playbookActionsPerRun: 3,
    manualRerunAvailable: true,
    competitorLimit: 5,
  },
};

interface AccountRow {
  id: string;
  name: string;
  plan: PlanType;
}

interface ProjectRow {
  id: string;
  account_id: string;
  name: string;
  industry: string;
  location: string;
  created_at: string;
  archived_at: string | null;
}

interface ProjectTargetRow {
  id: string;
  project_id: string;
  url: string;
  role: "primary" | "competitor";
  resolved_name: string | null;
  resolved_place_id: string | null;
  is_primary: boolean;
  created_at: string;
}

interface AnalysisRunRow {
  id: string;
  project_id: string;
  status: ProjectLifecycleStatus;
  stage: string | null;
  coverage_score: number | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

interface ReportRow {
  id: string;
  project_id: string;
  coverage_score: number | null;
  body: WeeklyIntelReport;
  created_at: string;
}

interface RunDiagnosticRow {
  id: string;
  run_id: string;
  account_id: string;
  target_id: string;
  source: string;
  status: "success" | "partial" | "failed";
  signals_found: number;
  signals_expected: number | null;
  error_message: string | null;
  created_at: string;
}

interface PendingTargetInsert {
  project_id: string;
  url: string;
  role: "primary" | "competitor";
  is_primary: boolean;
}

function readNumber(value?: number | null, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return fallback;
}

function normalizeWebsite(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function displayTargetName(target: Pick<ProjectTargetRow, "resolved_name" | "url">): string {
  return target.resolved_name ?? normalizeWebsite(target.url);
}

function buildEmptyDiagnostics(): SourceDiagnostics {
  return {
    source_stats: {
      success: 0,
      fail: 0,
      failure_ratio: 0,
    },
    google_maps: [],
  };
}

function mapRunStatus(status: string | null | undefined): ProjectLifecycleStatus {
  if (
    status === "draft" ||
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "partial" ||
    status === "failed"
  ) {
    return status;
  }

  return "draft";
}

function mapPlan(plan: string | null | undefined): PlanType {
  if (plan === "trial" || plan === "solo" || plan === "edge") {
    return plan;
  }

  return "trial";
}

function getPlanSettings(plan: PlanType) {
  return PLAN_SETTINGS[plan];
}

function buildAccountSummary(account: AccountRow): AccountSummary {
  const plan = mapPlan(account.plan);
  const settings = getPlanSettings(plan);

  return {
    id: account.id,
    name: account.name,
    plan,
    cadence: settings.cadence,
    diagnosticsEnabled: settings.diagnosticsEnabled,
    playbookActionsPerRun: settings.playbookActionsPerRun,
    manualRerunAvailable: settings.manualRerunAvailable,
  };
}

function formatCoverage(coverageScore: number): string {
  return `${Math.round(coverageScore * 100)}%`;
}

function parseRatingFromSummary(summary: string): string {
  const match = summary.match(/Rating\s+([0-9.]+)\s+from\s+([0-9,]+)/i);
  if (!match) {
    return "Not captured";
  }

  return `${match[1]} stars`;
}

function parseReviewVolumeFromSummary(summary: string): string {
  const match = summary.match(/from\s+([0-9,]+)\s+reviews?/i);
  if (!match) {
    return "N/A";
  }

  return `${match[1]} reviews`;
}

function buildCoverageBlock(
  project: ProjectSummary,
  diagnostics: SourceDiagnostics,
  leads: ReportLead[],
  deltas: CompetitorDelta[],
): CoverageBlock {
  const resolvedSources = diagnostics.source_stats.success;
  const missingSources = diagnostics.source_stats.fail;
  const helper =
    leads.length > 0 || deltas.length > 0
      ? "Coverage combines resolved source collection and the signals that survived filtering."
      : "No strong insights yet. The first completed run will populate coverage and source health.";

  return {
    score: project.coverageScore,
    resolvedSources,
    missingSources,
    helper,
  };
}

function buildMetrics(
  project: ProjectSummary,
  diagnostics: SourceDiagnostics,
  leads: ReportLead[],
  deltas: CompetitorDelta[],
): DashboardMetric[] {
  return [
    {
      label: "Coverage",
      value: formatCoverage(project.coverageScore),
      helper: "How much of the expected signal surface resolved on the latest run.",
      tone: project.coverageScore >= 0.65 ? "good" : "warn",
    },
    {
      label: "Insights ready",
      value: String(leads.length + deltas.length),
      helper: "Combined target and competitor opportunities available for the summary email.",
      tone: leads.length + deltas.length > 0 ? "good" : "neutral",
    },
    {
      label: "Resolved venues",
      value: `${diagnostics.source_stats.success}`,
      helper: "Businesses that resolved cleanly through source collection.",
      tone: diagnostics.source_stats.fail === 0 ? "good" : "warn",
    },
    {
      label: "Cadence",
      value: project.cadence === "weekly" ? "Weekly" : "Monthly",
      helper: `Plan-driven run schedule for the owner on the ${project.plan} plan.`,
      tone: "neutral",
    },
  ];
}

function buildComparisonRows(
  diagnostics: SourceDiagnostics,
  project: ProjectSummary,
  deltas: CompetitorDelta[],
): ComparisonRow[] {
  const diagnosticsByName = new Map(
    diagnostics.google_maps.map((entry) => [(entry.resolved_name ?? entry.cafe).toLowerCase(), entry]),
  );
  const venueNames = [project.primaryTarget, ...project.competitors];

  return venueNames.map((venue) => {
    const diag = diagnosticsByName.get(venue.toLowerCase());
    const ratingSummary = deltas.find((delta) => delta.name.toLowerCase().includes(venue.toLowerCase()));

    return {
      venue,
      rating: diag?.rating ? `${diag.rating.toFixed(1)} stars` : parseRatingFromSummary(ratingSummary?.summary ?? ""),
      reviewVolume: diag?.reviews_count
        ? `${diag.reviews_count} reviews`
        : parseReviewVolumeFromSummary(ratingSummary?.summary ?? ""),
      website: diag?.details_context?.website ?? "Not detected",
      status: diag?.resolved ? "Resolved" : "Awaiting run",
    };
  });
}

function buildTrendSnapshot(
  runs: RunSummary[],
  project: ProjectSummary,
  diagnostics: SourceDiagnostics,
): TrendSnapshot {
  const completedRuns = runs.filter((run) => run.status === "completed" || run.status === "partial");
  if (completedRuns.length < 2) {
    return {
      unlocked: false,
      helper: "Trend charts unlock after run 2. Until then, show setup health and the latest report only.",
      series: [],
    };
  }

  const reviewVolume = diagnostics.google_maps.reduce(
    (max, entry) => Math.max(max, readNumber(entry.reviews_count, 0)),
    0,
  );
  const coverageSeries: TrendSeries = {
    label: "Coverage",
    color: "#0a6e5c",
    points: completedRuns
      .slice(0, 6)
      .reverse()
      .map((run) => ({
        label: new Date(run.createdAt).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
        }),
        value: Math.round(run.coverageScore * 100),
      })),
  };

  const signalSeries: TrendSeries = {
    label: "Signal volume",
    color: "#8f4b1f",
    points: completedRuns
      .slice(0, 6)
      .reverse()
      .map((run, index) => ({
        label: new Date(run.createdAt).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
        }),
        value: Math.max(1, Math.round(project.coverageScore * 10) - index + Math.round(reviewVolume / 400)),
      })),
  };

  return {
    unlocked: true,
    helper: "Coverage and signal volume help owners see whether momentum is improving between reports.",
    series: [coverageSeries, signalSeries],
  };
}

function buildPlaybook(
  project: ProjectSummary,
  leads: ReportLead[],
  deltas: CompetitorDelta[],
): PlaybookAction[] {
  const actions: PlaybookAction[] = [];
  const limit = project.playbookActionsPerRun;

  if (leads[0]) {
    actions.push({
      title: "Turn the strongest lead into this week's campaign angle",
      detail: leads[0].hook,
      priority: "High",
    });
  }

  if (deltas[0]) {
    actions.push({
      title: "Address the clearest competitor weakness in messaging",
      detail: `Use the competitor shift around "${deltas[0].summary}" to frame the target as the safer choice.`,
      priority: "High",
    });
  }

  if (deltas[1]) {
    actions.push({
      title: "Audit the competitor websites for gaps you can beat",
      detail: `Detected public signals on ${deltas[1].name}. Mirror what works and close any obvious booking or pricing confusion.`,
      priority: "Medium",
    });
  }

  return actions.slice(0, limit);
}

function buildOpportunities(
  leads: ReportLead[],
  deltas: CompetitorDelta[],
  coverage: CoverageBlock,
): OpportunityCard[] {
  const cards: OpportunityCard[] = [];

  if (leads[0]) {
    cards.push({
      title: "Target advantage",
      summary: leads[0].gap,
      sourceLabel: "Review signal",
      tone: "good",
    });
  }

  if (deltas[0]) {
    cards.push({
      title: "Competitor opening",
      summary: deltas[0].summary,
      sourceLabel: "Competitor delta",
      tone: deltas[0].impact >= 6 ? "warn" : "neutral",
    });
  }

  cards.push({
    title: "Source confidence",
    summary: coverage.helper,
    sourceLabel: "Coverage model",
    tone: coverage.score >= 0.65 ? "good" : "warn",
  });

  return cards;
}

function mapProjectSummary(
  project: ProjectRow,
  account: AccountSummary,
  targets: ProjectTargetRow[],
  latestRun?: AnalysisRunRow | null,
  latestReport?: ReportRow | null,
): ProjectSummary {
  const primaryTarget = targets.find((target) => target.is_primary || target.role === "primary");
  const competitors = targets
    .filter((target) => !target.is_primary && target.role !== "primary")
    .map(displayTargetName);

  return {
    id: project.id,
    name: project.name,
    industry: project.industry,
    location: project.location,
    primaryTarget: primaryTarget ? displayTargetName(primaryTarget) : "Not set",
    competitors,
    coverageScore: latestReport?.coverage_score ?? latestRun?.coverage_score ?? 0,
    lastRunAt: latestReport?.created_at ?? latestRun?.created_at ?? project.created_at,
    reportStatus: latestRun ? mapRunStatus(latestRun.status) : "draft",
    plan: account.plan,
    cadence: account.cadence,
    diagnosticsEnabled: account.diagnosticsEnabled,
    playbookActionsPerRun: account.playbookActionsPerRun,
    manualRerunAvailable: account.manualRerunAvailable,
  };
}

async function getSupabaseAccount(accountId: string): Promise<AccountSummary | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, plan")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return buildAccountSummary(data as AccountRow);
}

async function getSupabaseProjectRows(accountId: string, projectIds?: string[]) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("projects")
    .select("id, account_id, name, industry, location, created_at, archived_at")
    .eq("account_id", accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (projectIds && projectIds.length > 0) {
    query = query.in("id", projectIds);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data ?? []) as ProjectRow[];
}

async function getSupabaseTargets(projectIds: string[]) {
  if (projectIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("project_targets")
    .select("id, project_id, url, role, resolved_name, resolved_place_id, is_primary, created_at")
    .in("project_id", projectIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ProjectTargetRow[];
}

async function getRunsByProject(accountId: string, projectIds: string[]) {
  if (projectIds.length === 0) {
    return new Map<string, AnalysisRunRow[]>();
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return new Map<string, AnalysisRunRow[]>();
  }

  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, project_id, status, stage, coverage_score, created_at, started_at, completed_at")
    .eq("account_id", accountId)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const runsByProject = new Map<string, AnalysisRunRow[]>();
  for (const row of (data ?? []) as AnalysisRunRow[]) {
    const collection = runsByProject.get(row.project_id) ?? [];
    collection.push(row);
    runsByProject.set(row.project_id, collection);
  }

  return runsByProject;
}

async function getLatestReportsByProject(accountId: string, projectIds: string[]) {
  if (projectIds.length === 0) {
    return new Map<string, ReportRow>();
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return new Map<string, ReportRow>();
  }

  const { data, error } = await supabase
    .from("reports")
    .select("id, project_id, coverage_score, body, created_at")
    .eq("account_id", accountId)
    .in("project_id", projectIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const latestReports = new Map<string, ReportRow>();
  for (const row of (data ?? []) as ReportRow[]) {
    if (!latestReports.has(row.project_id)) {
      latestReports.set(row.project_id, row);
    }
  }

  return latestReports;
}

export async function getAccountSummary(): Promise<AccountSummary | null> {
  const context = await getAccountContext();
  if (!context) {
    return null;
  }

  return getSupabaseAccount(context.accountId);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const context = await getAccountContext();
  if (!context) {
    return [];
  }

  const account = await getSupabaseAccount(context.accountId);
  if (!account) {
    return [];
  }

  const projects = await getSupabaseProjectRows(context.accountId);
  if (projects.length === 0) {
    return [];
  }

  const projectIds = projects.map((project) => project.id);
  const [targets, runsByProject, latestReports] = await Promise.all([
    getSupabaseTargets(projectIds),
    getRunsByProject(context.accountId, projectIds),
    getLatestReportsByProject(context.accountId, projectIds),
  ]);

  return projects.map((project) =>
    mapProjectSummary(
      project,
      account,
      targets.filter((target) => target.project_id === project.id),
      (runsByProject.get(project.id) ?? [])[0],
      latestReports.get(project.id),
    ),
  );
}

export async function getProject(projectId: string): Promise<ProjectSummary | null> {
  const context = await getAccountContext();
  if (!context) {
    return null;
  }

  const account = await getSupabaseAccount(context.accountId);
  if (!account) {
    return null;
  }

  const projects = await getSupabaseProjectRows(context.accountId, [projectId]);
  if (projects.length === 0) {
    return null;
  }

  const [targets, runsByProject, latestReports] = await Promise.all([
    getSupabaseTargets([projectId]),
    getRunsByProject(context.accountId, [projectId]),
    getLatestReportsByProject(context.accountId, [projectId]),
  ]);

  return mapProjectSummary(
    projects[0],
    account,
    targets.filter((target) => target.project_id === projectId),
    (runsByProject.get(projectId) ?? [])[0],
    latestReports.get(projectId),
  );
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary | null> {
  const context = await getAccountContext();
  const supabase = getSupabaseServerClient();
  if (!context || !supabase) {
    return null;
  }

  const nextPlan = mapPlan(input.plan);
  const { error: accountUpdateError } = await supabase
    .from("accounts")
    .update({ plan: nextPlan })
    .eq("id", context.accountId);

  if (accountUpdateError) {
    throw accountUpdateError;
  }

  const account = await getSupabaseAccount(context.accountId);
  if (!account) {
    return null;
  }

  const settings = getPlanSettings(account.plan);
  const competitorUrls = input.competitorUrls.slice(0, settings.competitorLimit);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      account_id: context.accountId,
      name: input.name,
      industry: input.industry,
      location: input.location,
    })
    .select("id, account_id, name, industry, location, created_at, archived_at")
    .single();

  if (projectError) {
    throw projectError;
  }

  const targetsPayload: PendingTargetInsert[] = [
    {
      project_id: project.id as string,
      url: input.primaryUrl,
      role: "primary",
      is_primary: true,
    },
    ...competitorUrls.map((url) => ({
      project_id: project.id as string,
      url,
      role: "competitor" as const,
      is_primary: false,
    })),
  ];

  const { error: targetsError } = await supabase.from("project_targets").insert(targetsPayload);
  if (targetsError) {
    throw targetsError;
  }

  return mapProjectSummary(
    project as ProjectRow,
    account,
    targetsPayload.map((target, index) => ({
      id: `pending-${index}`,
      project_id: target.project_id,
      url: target.url,
      role: target.role,
      resolved_name: null,
      resolved_place_id: null,
      is_primary: target.is_primary,
      created_at: new Date().toISOString(),
    })),
    null,
    null,
  );
}

export async function getLatestReport(projectId: string): Promise<WeeklyIntelReport | null> {
  const context = await getAccountContext();
  const supabase = getSupabaseServerClient();
  if (!context || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("reports")
    .select("body")
    .eq("account_id", context.accountId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.body as WeeklyIntelReport | undefined) ?? null;
}

export async function getDiagnostics(projectId: string): Promise<SourceDiagnostics> {
  const context = await getAccountContext();
  const supabase = getSupabaseServerClient();
  if (!context || !supabase) {
    return buildEmptyDiagnostics();
  }

  const { data: latestRun, error: runError } = await supabase
    .from("analysis_runs")
    .select("id")
    .eq("account_id", context.accountId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    throw runError;
  }

  if (!latestRun?.id) {
    return buildEmptyDiagnostics();
  }

  const [{ data: diagnosticsRows, error: diagnosticsError }, targets] = await Promise.all([
    supabase
      .from("run_diagnostics")
      .select("id, run_id, account_id, target_id, source, status, signals_found, signals_expected, error_message, created_at")
      .eq("account_id", context.accountId)
      .eq("run_id", latestRun.id)
      .order("created_at", { ascending: true }),
    getSupabaseTargets([projectId]),
  ]);

  if (diagnosticsError) {
    throw diagnosticsError;
  }

  const rows = (diagnosticsRows ?? []) as RunDiagnosticRow[];
  const googleDiagnostics = rows.filter((row) => row.source === "google_maps");
  if (googleDiagnostics.length === 0) {
    return buildEmptyDiagnostics();
  }

  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const successCount = googleDiagnostics.filter((row) => row.status === "success").length;
  const failCount = googleDiagnostics.filter((row) => row.status === "failed").length;

  return {
    source_stats: {
      success: successCount,
      fail: failCount,
      failure_ratio: googleDiagnostics.length === 0 ? 0 : failCount / googleDiagnostics.length,
    },
    google_maps: googleDiagnostics.map((row): DiagnosticsTarget => {
      const target = targetsById.get(row.target_id);
      return {
        cafe: target ? displayTargetName(target) : row.target_id,
        override_present: false,
        resolved: row.status !== "failed",
        resolved_name: target?.resolved_name ?? undefined,
        attempts: row.error_message
          ? [
              {
                api_status: row.status.toUpperCase(),
                via: row.source,
                query: target?.url ?? row.target_id,
                error_message: row.error_message,
              },
            ]
          : [],
      };
    }),
  };
}

export async function listRuns(projectId: string): Promise<RunSummary[]> {
  const context = await getAccountContext();
  const supabase = getSupabaseServerClient();
  if (!context || !supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, project_id, status, stage, coverage_score, created_at, started_at, completed_at")
    .eq("account_id", context.accountId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as AnalysisRunRow[]).map((run) => ({
    id: run.id,
    projectId: run.project_id,
    status: mapRunStatus(run.status),
    stage: run.stage ?? "queued",
    coverageScore: run.coverage_score ?? 0,
    createdAt: run.created_at,
    durationLabel: run.completed_at && run.started_at ? "Completed" : "In progress",
  }));
}

export function parseLeads(report: WeeklyIntelReport): ReportLead[] {
  return report.target_leads.map(([name, gap, hook]) => ({ name, gap, hook }));
}

export function parseCompetitorDeltas(report: WeeklyIntelReport): CompetitorDelta[] {
  return report.competitor_delta.map(([name, summary, impact]) => ({
    name,
    summary,
    impact,
  }));
}

export async function getDashboardData(projectId: string): Promise<DashboardData | null> {
  const [account, project] = await Promise.all([getAccountSummary(), getProject(projectId)]);
  if (!account || !project) {
    return null;
  }

  const [report, diagnostics, runs] = await Promise.all([
    getLatestReport(projectId),
    getDiagnostics(projectId),
    listRuns(projectId),
  ]);

  const leads = report ? parseLeads(report) : [];
  const deltas = report ? parseCompetitorDeltas(report) : [];
  const coverage = buildCoverageBlock(project, diagnostics, leads, deltas);
  const metrics = buildMetrics(project, diagnostics, leads, deltas);
  const opportunities = buildOpportunities(leads, deltas, coverage);
  const playbook = buildPlaybook(project, leads, deltas);
  const comparison = buildComparisonRows(diagnostics, project, deltas);
  const trends = buildTrendSnapshot(runs, project, diagnostics);

  return {
    project,
    account,
    report,
    diagnostics,
    runs,
    leads,
    deltas,
    metrics,
    opportunities,
    playbook,
    comparison,
    trends,
    coverage,
  };
}
