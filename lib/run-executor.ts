import { spawn } from "node:child_process";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountContext } from "@/lib/auth";
import { sendRunSummaryEmail } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type { ProjectLifecycleStatus, SourceDiagnostics, WeeklyIntelReport } from "@/types/domain";

const PYTHON_BIN =
  process.env.PYTHON_BIN ??
  (process.env.NODE_ENV === "production" ? "python3" : "python");
const COVERAGE_THRESHOLD = 0.4;
const STALE_RUN_MINUTES = 20;

interface ProjectRow {
  id: string;
  account_id: string;
  name: string;
  industry: string;
  location: string;
}

interface AccountUserRow {
  id: string;
  email: string;
  role: "owner" | "member";
}

interface ProjectTargetRow {
  id: string;
  project_id: string;
  url: string;
  role: "primary" | "competitor";
  resolved_name: string | null;
  resolved_place_id?: string | null;
  is_primary: boolean;
}

interface AnalysisRunRow {
  id: string;
  project_id: string;
  account_id: string;
  status: ProjectLifecycleStatus;
  stage: string | null;
  started_at: string | null;
}

interface PersistedRunResult {
  runId: string;
  status: ProjectLifecycleStatus;
  coverageScore: number;
}

interface QueuedRunResult {
  runId: string;
  status: "queued";
}

interface DispatchResult {
  processedRunIds: string[];
  requeuedRunIds: string[];
}

interface PipelineSignal {
  source: string;
  cafe: string;
  kind: string;
  summary: string;
  impact: number;
  confidence: number;
  happened_at?: string | null;
}

interface PipelineFinalOutput {
  report: WeeklyIntelReport;
  noise_log: Array<Record<string, unknown>>;
  resolved_signals: PipelineSignal[];
  source_diagnostics: SourceDiagnostics;
  dashboard_summary: string;
  stage_outputs?: Record<string, Record<string, unknown>>;
}

interface TargetIdentity {
  target: ProjectTargetRow;
  canonicalName: string;
  aliases: Set<string>;
  compactAliases: Set<string>;
}

function getAdminClientOrThrow() {
  const supabase = getSupabaseServiceRoleClient();
  if (!supabase) {
    throw new Error("Supabase service role is not configured");
  }

  return supabase;
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathSegment = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .find((segment) => segment && !["home", "index", "index.html"].includes(segment.toLowerCase()));

    if (pathSegment && parsed.hostname.includes("facebook.com")) {
      return pathSegment.replace(/[-_.]+/g, " ").trim();
    }

    const hostParts = parsed.hostname.replace(/^www\./, "").split(".");
    const domainParts = hostParts.slice(0, Math.max(1, hostParts.length - Math.min(2, hostParts.length - 1)));
    return domainParts.join(" ").replace(/[-_.]+/g, " ").trim();
  } catch {
    return url;
  }
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      part.toUpperCase() === part && part.length <= 4
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(" ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ");
}

function splitJoinedWords(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");
}

function cleanDisplayName(value: string): string {
  return titleCase(
    splitJoinedWords(decodeHtmlEntities(value))
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function normalizeComparableName(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return decodeHtmlEntities(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactName(value: string | null | undefined): string {
  return normalizeComparableName(value).replace(/\s+/g, "");
}

function isMeaningfulTitle(value: string | null): value is string {
  if (!value) {
    return false;
  }

  const normalized = normalizeComparableName(value);
  if (!normalized) {
    return false;
  }

  return ![
    "home",
    "welcome",
    "facebook",
    "instagram",
    "menu",
    "homepage",
    "index",
  ].includes(normalized);
}

async function fetchWebsiteTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "LocalEdgeBot/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!match?.[1]) {
      return null;
    }

    return match[1]
      .replace(/\|.*$/, "")
      .replace(/-.*$/, "")
      .trim();
  } catch {
    return null;
  }
}

async function normalizeTargetName(target: ProjectTargetRow, projectName?: string) {
  if (target.resolved_name) {
    return cleanDisplayName(target.resolved_name);
  }

  const title = await fetchWebsiteTitle(target.url);
  if (isMeaningfulTitle(title)) {
    return cleanDisplayName(title);
  }

  const fallback = cleanDisplayName(slugFromUrl(target.url));
  if (fallback) {
    return fallback;
  }

  return projectName ? cleanDisplayName(projectName) : cleanDisplayName(target.url);
}

function buildTargetAliases(target: ProjectTargetRow, canonicalName: string) {
  const aliases = new Set<string>();
  const addAlias = (value: string | null | undefined) => {
    const normalized = normalizeComparableName(value);
    if (normalized) {
      aliases.add(normalized);
    }
  };

  addAlias(canonicalName);
  addAlias(target.resolved_name);
  addAlias(slugFromUrl(target.url));
  addAlias(cleanDisplayName(slugFromUrl(target.url)));

  try {
    const parsed = new URL(target.url);
    addAlias(parsed.hostname.replace(/^www\./, ""));
    addAlias(parsed.pathname.split("/").find(Boolean) ?? "");
  } catch {
    addAlias(target.url);
  }

  return aliases;
}

function toCompactAliases(aliases: Set<string>) {
  return new Set(
    Array.from(aliases)
      .map((alias) => normalizeCompactName(alias))
      .filter(Boolean),
  );
}

function buildTargetIdentities(targets: ProjectTargetRow[], canonicalNames: Map<string, string>) {
  return targets.map((target) => {
    const canonicalName =
      canonicalNames.get(target.id) ??
      cleanDisplayName(target.resolved_name ?? slugFromUrl(target.url) ?? target.url);
    const aliases = buildTargetAliases(target, canonicalName);

    return {
      target,
      canonicalName,
      aliases,
      compactAliases: toCompactAliases(aliases),
    } satisfies TargetIdentity;
  });
}

function matchTargetIdentity(
  identities: TargetIdentity[],
  candidateNames: Array<string | null | undefined>,
  placeId?: string | null,
) {
  if (placeId) {
    const matchByPlaceId = identities.find((identity) => identity.target.resolved_place_id === placeId);
    if (matchByPlaceId) {
      return matchByPlaceId;
    }
  }

  const normalizedCandidates = candidateNames
    .map((candidate) => normalizeComparableName(candidate))
    .filter(Boolean);
  const compactCandidates = candidateNames
    .map((candidate) => normalizeCompactName(candidate))
    .filter(Boolean);

  for (const candidate of normalizedCandidates) {
    const directMatch = identities.find((identity) => identity.aliases.has(candidate));
    if (directMatch) {
      return directMatch;
    }
  }

  for (const candidate of normalizedCandidates) {
    const fuzzyMatch = identities.find((identity) =>
      Array.from(identity.aliases).some((alias) => alias.includes(candidate) || candidate.includes(alias)),
    );
    if (fuzzyMatch) {
      return fuzzyMatch;
    }
  }

  for (const candidate of compactCandidates) {
    const compactMatch = identities.find((identity) => identity.compactAliases.has(candidate));
    if (compactMatch) {
      return compactMatch;
    }
  }

  for (const candidate of compactCandidates) {
    const compactFuzzyMatch = identities.find((identity) =>
      Array.from(identity.compactAliases).some((alias) => alias.includes(candidate) || candidate.includes(alias)),
    );
    if (compactFuzzyMatch) {
      return compactFuzzyMatch;
    }
  }

  return null;
}

function extractSignalVenueCandidates(signal: PipelineSignal) {
  const candidates = [signal.cafe];
  const summaryPrefix = signal.summary.match(/^([^:]+):/);
  if (summaryPrefix?.[1]) {
    candidates.push(summaryPrefix[1]);
  }

  const summaryVenue = signal.summary.match(/^Position\s+(.+?)\s+as the alternative/i);
  if (summaryVenue?.[1]) {
    candidates.push(summaryVenue[1]);
  }

  return candidates;
}

async function loadProject(
  supabase: SupabaseClient,
  projectId: string,
  accountId: string,
) {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, account_id, name, industry, location")
    .eq("id", projectId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (projectError) {
    throw projectError;
  }

  if (!project) {
    return null;
  }

  const { data: targets, error: targetsError } = await supabase
    .from("project_targets")
    .select("id, project_id, url, role, resolved_name, resolved_place_id, is_primary")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (targetsError) {
    throw targetsError;
  }

  return {
    project: project as ProjectRow,
    targets: (targets ?? []) as ProjectTargetRow[],
  };
}

async function loadAccountOwner(
  supabase: SupabaseClient,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, role")
    .eq("account_id", accountId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AccountUserRow | null) ?? null;
}

async function loadRun(
  supabase: SupabaseClient,
  runId: string,
) {
  const { data: run, error } = await supabase
    .from("analysis_runs")
    .select("id, project_id, account_id, status, stage, started_at")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (run as AnalysisRunRow | null) ?? null;
}

async function claimQueuedRun(supabase: SupabaseClient): Promise<AnalysisRunRow | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidate, error: candidateError } = await supabase
      .from("analysis_runs")
      .select("id, project_id, account_id, status, stage, started_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidateError) {
      throw candidateError;
    }

    if (!candidate) {
      return null;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("analysis_runs")
      .update({
        status: "running",
        stage: "dispatching",
        started_at: candidate.started_at ?? new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id, project_id, account_id, status, stage, started_at")
      .maybeSingle();

    if (claimError) {
      throw claimError;
    }

    if (claimed) {
      console.log("[RUNNER] Claimed queued run", {
        runId: claimed.id,
        projectId: claimed.project_id,
        accountId: claimed.account_id,
      });
      return claimed as AnalysisRunRow;
    }
  }

  return null;
}

async function requeueStaleRuns(supabase: SupabaseClient) {
  const threshold = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("analysis_runs")
    .update({
      status: "queued",
      stage: "queued",
    })
    .eq("status", "running")
    .lt("started_at", threshold)
    .is("completed_at", null)
    .select("id");

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function findInFlightRunId(
  supabase: SupabaseClient,
  projectId: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id")
    .eq("project_id", projectId)
    .eq("account_id", accountId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.id as string | undefined) ?? null;
}

async function createPipelinePayload(project: ProjectRow, targets: ProjectTargetRow[]) {
  const normalizedTargets = await Promise.all(
    targets.map(async (target) => ({
      target,
      name: await normalizeTargetName(target, project.name),
    })),
  );

  const primary = normalizedTargets.filter(({ target }) => target.is_primary || target.role === "primary");
  const competitors = normalizedTargets.filter(
    ({ target }) => !target.is_primary && target.role !== "primary",
  );

  const targetNameMap = Object.fromEntries(
    normalizedTargets.map(({ target, name }) => [target.id, name]),
  );

  return {
    last_scan_date: new Date().toISOString().slice(0, 10),
    location_focus: project.location,
    project_id: project.id,
    project_name: project.name,
    industry: project.industry,
    targets: primary.map(({ name }) => ({
      name,
      focus: `Primary ${project.industry} in ${project.location}`,
    })),
    competition: competitors.map(({ name }) => ({
      name,
      focus: `Competitor ${project.industry} in ${project.location}`,
    })),
    target_name_map: targetNameMap,
  };
}

function stageCheckpointPayload(stage: string, payload: Record<string, unknown>) {
  return {
    stage,
    status: "completed",
    payload,
  };
}

function isMissingColumnError(error: unknown, column: string) {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : error instanceof Error
        ? error.message
        : "";

  return message.toLowerCase().includes(`'${column.toLowerCase()}' column`);
}

async function insertCheckpoint(
  supabase: SupabaseClient,
  runId: string,
  stage: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("run_stage_checkpoints").insert({
    run_id: runId,
    ...stageCheckpointPayload(stage, payload),
  });

  if (error) {
    throw error;
  }
}

async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  values: Partial<{
    status: ProjectLifecycleStatus;
    stage: string;
    coverage_score: number;
    started_at: string;
    completed_at: string;
  }>,
) {
  const { error } = await supabase.from("analysis_runs").update(values).eq("id", runId);
  if (error) {
    throw error;
  }
}

function computeCoverageScore(report: WeeklyIntelReport, diagnostics: SourceDiagnostics) {
  const foundSignals = report.target_leads.length + report.competitor_delta.length;
  const expectedSignals = Math.max(1, diagnostics.source_stats.success + diagnostics.source_stats.fail);
  return Math.min(1, foundSignals / expectedSignals);
}

function mapSignalType(summary: string, entityScope: "target" | "competitor") {
  if (entityScope === "target") {
    return "target_lead";
  }

  if (/rating/i.test(summary)) {
    return "review_snapshot";
  }

  if (/keywords/i.test(summary)) {
    return "website_keyword";
  }

  return "competitor_delta";
}

async function persistSignals(
  supabase: SupabaseClient,
  runId: string,
  accountId: string,
  projectId: string,
  targets: ProjectTargetRow[],
  signals: PipelineSignal[],
) {
  const targetIdentities = buildTargetIdentities(
    targets,
    new Map(targets.map((target) => [target.id, cleanDisplayName(target.resolved_name ?? slugFromUrl(target.url))])),
  );
  const primaryTarget = targetIdentities.find((entry) => entry.target.is_primary || entry.target.role === "primary");
  const competitorTarget = targetIdentities.find(
    (entry) => !entry.target.is_primary && entry.target.role !== "primary",
  );

  const rows = signals
    .map((signal) => {
      const matchedTarget =
        matchTargetIdentity(targetIdentities, extractSignalVenueCandidates(signal)) ??
        (signal.kind === "review_strength" ? primaryTarget : competitorTarget) ??
        primaryTarget ??
        competitorTarget ??
        null;

      const target = matchedTarget?.target;
      const entityScope: "target" | "competitor" = matchedTarget?.target.is_primary ? "target" : "competitor";

      return {
        run_id: runId,
        account_id: accountId,
        project_id: projectId,
        target_id: target?.id,
        source: signal.source,
        signal_type: mapSignalType(signal.summary, entityScope),
        raw_value: signal.summary,
        structured_insight: {
          kind: signal.kind,
          venue: matchedTarget?.canonicalName ?? cleanDisplayName(signal.cafe),
          impact: signal.impact,
          confidence: signal.confidence,
          happened_at: signal.happened_at ?? null,
        },
        confidence_score: Math.min(0.99, Math.max(0.1, signal.confidence / 10)),
        entity_scope: entityScope,
      };
    })
    .filter((row) => row.target_id);

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    throw error;
  }
}

async function persistDiagnostics(
  supabase: SupabaseClient,
  runId: string,
  accountId: string,
  targets: ProjectTargetRow[],
  diagnostics: SourceDiagnostics,
) {
  const targetIdentities = buildTargetIdentities(
    targets,
    new Map(targets.map((target) => [target.id, cleanDisplayName(target.resolved_name ?? slugFromUrl(target.url))])),
  );

  const rows = diagnostics.google_maps
    .map((entry) => {
      const target = matchTargetIdentity(
        targetIdentities,
        [entry.resolved_name, entry.cafe, entry.details_context?.website ?? null],
        entry.place_id,
      )?.target ?? null;

      if (!target) {
        return null;
      }

      return {
        run_id: runId,
        account_id: accountId,
        target_id: target.id,
        source: "google_maps",
        status: entry.resolved ? "success" : "failed",
        signals_found: entry.resolved ? 1 : 0,
        signals_expected: 1,
        error_message: entry.attempts[entry.attempts.length - 1]?.error_message ?? null,
        detail_payload: entry,
      };
    })
    .filter(
      (
        row,
      ): row is {
        run_id: string;
        account_id: string;
        target_id: string;
        source: string;
        status: "success" | "failed";
        signals_found: number;
        signals_expected: number;
        error_message: string | null;
        detail_payload: SourceDiagnostics["google_maps"][number];
      } => Boolean(row),
    );

  if (rows.length === 0) {
    return;
  }

  let { error } = await supabase.from("run_diagnostics").insert(rows);
  if (!error) {
    return;
  }

  if (isMissingColumnError(error, "account_id") || isMissingColumnError(error, "detail_payload")) {
    const legacyRows = rows.map(({ account_id: _accountId, detail_payload: _detailPayload, ...row }) => row);
    const retry = await supabase.from("run_diagnostics").insert(legacyRows);
    error = retry.error;
  }

  if (error) {
    throw error;
  }
}

async function syncTargetResolutions(
  supabase: SupabaseClient,
  targets: ProjectTargetRow[],
  diagnostics: SourceDiagnostics,
) {
  const targetIdentities = buildTargetIdentities(
    targets,
    new Map(targets.map((target) => [target.id, cleanDisplayName(target.resolved_name ?? slugFromUrl(target.url))])),
  );

  for (const entry of diagnostics.google_maps) {
    if (!entry.resolved || !entry.place_id) {
      continue;
    }

    const target = matchTargetIdentity(
      targetIdentities,
      [entry.resolved_name, entry.cafe, entry.details_context?.website ?? null],
      entry.place_id,
    )?.target;
    if (!target) {
      continue;
    }

    const { error } = await supabase
      .from("project_targets")
      .update({
        resolved_name: entry.resolved_name ?? entry.cafe,
        resolved_place_id: entry.place_id,
      })
      .eq("id", target.id);

    if (error) {
      throw error;
    }
  }
}

async function persistReport(
  supabase: SupabaseClient,
  runId: string,
  accountId: string,
  projectId: string,
  report: WeeklyIntelReport,
  coverageScore: number,
  previousReport: WeeklyIntelReport | null,
) {
  const latestRating = report.competitor_delta.find((entry) => /rating/i.test(entry[1]));
  const previousRating = previousReport?.competitor_delta.find((entry) => /rating/i.test(entry[1]));
  const { error } = await supabase.from("reports").insert({
    run_id: runId,
    account_id: accountId,
    project_id: projectId,
    version: 1,
    status: "approved",
    approved_at: new Date().toISOString(),
    body: {
      ...report,
      delta_summary: {
        rating_change: latestRating?.[1] && previousRating?.[1] ? `${previousRating[1]} -> ${latestRating[1]}` : null,
        signal_count_change: previousReport
          ? report.target_leads.length + report.competitor_delta.length - (previousReport.target_leads.length + previousReport.competitor_delta.length)
          : null,
      },
    },
    coverage_score: coverageScore,
  });

  if (error) {
    throw error;
  }
}

async function loadPreviousReport(
  supabase: SupabaseClient,
  projectId: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("reports")
    .select("body")
    .eq("project_id", projectId)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.body as WeeklyIntelReport | undefined) ?? null;
}

async function runPythonPipeline(payload: Record<string, unknown>) {
  const root = process.cwd();
  const bootstrap = [
    "import json, os, sys",
    "from pipeline import run_pipeline",
    "payload = json.loads(os.environ['PIPELINE_PAYLOAD_JSON'])",
    "result = run_pipeline(payload)",
    "json.dump(result.get('final_output', {}), sys.stdout)",
  ].join("; ");

  return await new Promise<PipelineFinalOutput>((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-c", bootstrap], {
      cwd: root,
      env: {
        ...process.env,
        PIPELINE_PAYLOAD_JSON: JSON.stringify(payload),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as PipelineFinalOutput);
          return;
        } catch (error) {
          reject(new Error(`Unable to parse pipeline output: ${error instanceof Error ? error.message : "Unknown parse error"}`));
          return;
        }
      }

      reject(new Error(stderr.trim() || `Pipeline exited with code ${code}`));
    });
  });
}

export async function enqueueProjectRun(
  projectId: string,
  context: AccountContext,
): Promise<QueuedRunResult> {
  const supabase = getAdminClientOrThrow();

  const loaded = await loadProject(supabase, projectId, context.accountId);
  if (!loaded) {
    throw new Error("Project not found");
  }

  if (loaded.targets.length === 0) {
    throw new Error("Project has no targets configured");
  }

  const inFlightRunId = await findInFlightRunId(supabase, projectId, context.accountId);
  if (inFlightRunId) {
    throw new Error("A run is already queued or running for this project");
  }

  const { data: run, error: runInsertError } = await supabase
    .from("analysis_runs")
    .insert({
      project_id: loaded.project.id,
      account_id: context.accountId,
      status: "queued",
      stage: "queued",
      credits_used: 0,
      triggered_by: context.user.id,
    })
    .select("id")
    .single();

  if (runInsertError) {
    throw runInsertError;
  }

  return {
    runId: run.id as string,
    status: "queued",
  };
}

export async function processQueuedRun(runId: string): Promise<PersistedRunResult> {
  const supabase = getAdminClientOrThrow();
  console.log("[RUNNER] Processing queued run", { runId });
  const run = await loadRun(supabase, runId);

  if (!run) {
    throw new Error("Run not found");
  }

  if (run.status === "completed" || run.status === "partial") {
    return {
      runId,
      status: run.status,
      coverageScore: 0,
    };
  }

  if (run.status === "queued") {
    await updateRun(supabase, runId, {
      status: "running",
      stage: "dispatching",
      started_at: run.started_at ?? new Date().toISOString(),
    });
  }

  const loaded = await loadProject(supabase, run.project_id, run.account_id);
  if (!loaded) {
    throw new Error("Project not found");
  }

  const { project, targets } = loaded;
  const owner = await loadAccountOwner(supabase, run.account_id);
  const previousReport = await loadPreviousReport(supabase, project.id, run.account_id);

  try {
    await updateRun(supabase, runId, {
      status: "running",
      stage: "input_normalization",
      started_at: run.started_at ?? new Date().toISOString(),
    });

    const pipelinePayload = await createPipelinePayload(project, targets);
    console.log("[RUNNER] Running Python pipeline", {
      runId,
      projectId: project.id,
      targetCount: targets.length,
    });
    const pipelineResult = await runPythonPipeline(pipelinePayload);
    const report = pipelineResult.report;
    const diagnostics = pipelineResult.source_diagnostics;
    const coverageScore = computeCoverageScore(report, diagnostics);
    const persistenceWarnings: string[] = [];

    const stageOutputs = pipelineResult.stage_outputs ?? {};
    for (const [stageName, payload] of Object.entries(stageOutputs)) {
      await updateRun(supabase, runId, { stage: stageName });
      await insertCheckpoint(supabase, runId, stageName, payload);
    }

    await updateRun(supabase, runId, { stage: "report_generation" });
    await persistReport(supabase, runId, run.account_id, project.id, report, coverageScore, previousReport);

    try {
      await persistDiagnostics(supabase, runId, run.account_id, targets, diagnostics);
    } catch (error) {
      persistenceWarnings.push(error instanceof Error ? error.message : "Failed to persist diagnostics");
    }

    try {
      await syncTargetResolutions(supabase, targets, diagnostics);
    } catch (error) {
      persistenceWarnings.push(error instanceof Error ? error.message : "Failed to sync target resolutions");
    }

    try {
      await persistSignals(supabase, runId, run.account_id, project.id, targets, pipelineResult.resolved_signals ?? []);
    } catch (error) {
      persistenceWarnings.push(error instanceof Error ? error.message : "Failed to persist signals");
    }

    const finalStatus: ProjectLifecycleStatus =
      persistenceWarnings.length > 0 || coverageScore < COVERAGE_THRESHOLD ? "partial" : "completed";

    await insertCheckpoint(supabase, runId, "report_generation", {
      market_status: report.market_status,
      coverage_score: coverageScore,
      target_leads: report.target_leads.length,
      competitor_deltas: report.competitor_delta.length,
      diagnostics,
      persistence_warnings: persistenceWarnings,
    });

    await updateRun(supabase, runId, {
      status: finalStatus,
      stage: "done",
      coverage_score: coverageScore,
      completed_at: new Date().toISOString(),
    });

    if (owner?.email) {
      const emailResult = await sendRunSummaryEmail({
        to: owner.email,
        project: {
          id: project.id,
          name: project.name,
          industry: project.industry,
          location: project.location,
        },
        report: {
          id: runId,
          runId,
          projectId: project.id,
          projectName: project.name,
          status: "approved",
          coverageScore,
          createdAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          body: report,
        },
      }).catch((error) => ({
        delivered: false as const,
        reason: error instanceof Error ? error.message : "Email delivery failed",
      }));

      await insertCheckpoint(supabase, runId, "email_delivery", {
        delivered: emailResult.delivered,
        reason: "reason" in emailResult ? emailResult.reason : null,
      });
    }

    return {
      runId,
      status: finalStatus,
      coverageScore,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[RUNNER] Queued run failed", { runId, error: errorMessage, stack: errorStack });
    await updateRun(supabase, runId, {
      status: "failed",
      stage: "failed",
      completed_at: new Date().toISOString(),
    });

    const message = error instanceof Error ? error.message : "Unknown run failure";
    const { error: checkpointError } = await supabase.from("run_stage_checkpoints").insert({
      run_id: runId,
      stage: "failed",
      status: "failed",
      payload: { message },
    });
    if (checkpointError) {
      throw checkpointError;
    }

    throw error;
  }
}

export async function dispatchQueuedRuns(limit = 1): Promise<DispatchResult> {
  const supabase = getAdminClientOrThrow();
  console.log("[RUNNER] Dispatch requested", { limit });
  const requeuedRunIds = await requeueStaleRuns(supabase);
  if (requeuedRunIds.length > 0) {
    console.log("[RUNNER] Requeued stale runs", { requeuedRunIds });
  }
  const processedRunIds: string[] = [];

  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimQueuedRun(supabase);
    if (!claimed) {
      console.log("[RUNNER] No queued runs available");
      break;
    }

    try {
      await processQueuedRun(claimed.id);
      processedRunIds.push(claimed.id);
    } catch (error) {
      // processQueuedRun already marked the run as failed and wrote a checkpoint
      // before re-throwing. Don't let one bad run abort the rest of the batch.
      console.error("[RUNNER] Run failed during dispatch, continuing batch", { runId: claimed.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  console.log("[RUNNER] Dispatch finished", { processedRunIds, requeuedRunIds });
  return {
    processedRunIds,
    requeuedRunIds,
  };
}
