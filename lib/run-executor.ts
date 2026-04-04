import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountContext } from "@/lib/auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type { ProjectLifecycleStatus, SourceDiagnostics, WeeklyIntelReport } from "@/types/domain";

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";
const PROJECT_CONFIG_NAME = "project-config.json";
const OUTPUT_DIR_NAME = "pipeline-output";
const COVERAGE_THRESHOLD = 0.4;
const STALE_RUN_MINUTES = 20;

interface ProjectRow {
  id: string;
  account_id: string;
  name: string;
  industry: string;
  location: string;
}

interface ProjectTargetRow {
  id: string;
  project_id: string;
  url: string;
  role: "primary" | "competitor";
  resolved_name: string | null;
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
    return parsed.hostname
      .replace(/^www\./, "")
      .replace(/\.[a-z]{2,}$/i, "")
      .replace(/[-_.]+/g, " ")
      .trim();
  } catch {
    return url;
  }
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    return target.resolved_name;
  }

  if (target.is_primary && projectName) {
    return projectName;
  }

  const title = await fetchWebsiteTitle(target.url);
  if (title) {
    return title;
  }

  return titleCase(slugFromUrl(target.url));
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
    .select("id, project_id, url, role, resolved_name, is_primary")
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

async function createProjectConfig(project: ProjectRow, targets: ProjectTargetRow[]) {
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

  return {
    last_scan_date: new Date().toISOString().slice(0, 10),
    location_focus: project.location,
    targets: primary.map(({ name }) => ({
      name,
      focus: `Primary ${project.industry} in ${project.location}`,
    })),
    competition: competitors.map(({ name }) => ({
      name,
      focus: `Competitor ${project.industry} in ${project.location}`,
    })),
  };
}

function stageCheckpointPayload(stage: string, payload: Record<string, unknown>) {
  return {
    stage,
    status: "completed",
    payload,
  };
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
  report: WeeklyIntelReport,
) {
  const targetByName = new Map(
    targets.map((target) => [
      (target.resolved_name ?? titleCase(slugFromUrl(target.url)) ?? "").toLowerCase(),
      target,
    ]),
  );

  const rows = [
    ...report.target_leads.map(([name, gap, hook]) => {
      const target = targetByName.get(name.toLowerCase()) ?? targets.find((entry) => entry.is_primary) ?? targets[0];
      return {
        run_id: runId,
        account_id: accountId,
        project_id: projectId,
        target_id: target?.id,
        source: "report_generation",
        signal_type: mapSignalType(gap, "target"),
        raw_value: `${gap} ${hook}`.trim(),
        structured_insight: { gap, hook },
        confidence_score: 0.8,
        entity_scope: "target",
      };
    }),
    ...report.competitor_delta.map(([name, summary, impact]) => {
      const target =
        targetByName.get(name.toLowerCase()) ??
        targets.find((entry) => !entry.is_primary && entry.role !== "primary") ??
        targets[0];
      return {
        run_id: runId,
        account_id: accountId,
        project_id: projectId,
        target_id: target?.id,
        source: "report_generation",
        signal_type: mapSignalType(summary, "competitor"),
        raw_value: summary,
        structured_insight: { impact, venue: name },
        confidence_score: Math.min(0.95, Math.max(0.4, impact / 10)),
        entity_scope: "competitor",
      };
    }),
  ].filter((row) => row.target_id);

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
  const targetByName = new Map(
    targets.map((target) => [
      (target.resolved_name ?? titleCase(slugFromUrl(target.url))).toLowerCase(),
      target,
    ]),
  );

  const rows = diagnostics.google_maps
    .map((entry) => {
      const target =
        targetByName.get((entry.resolved_name ?? entry.cafe).toLowerCase()) ??
        targets.find((item) => titleCase(slugFromUrl(item.url)).toLowerCase() === entry.cafe.toLowerCase()) ??
        null;

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
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from("run_diagnostics").insert(rows);
  if (error) {
    throw error;
  }
}

async function persistReport(
  supabase: SupabaseClient,
  runId: string,
  accountId: string,
  projectId: string,
  report: WeeklyIntelReport,
  coverageScore: number,
) {
  const { error } = await supabase.from("reports").insert({
    run_id: runId,
    account_id: accountId,
    project_id: projectId,
    version: 1,
    status: "draft",
    body: report,
    coverage_score: coverageScore,
  });

  if (error) {
    throw error;
  }
}

async function runPythonPipeline(configPath: string, outputDir: string) {
  const root = process.cwd();

  return await new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["pipeline.py"], {
      cwd: root,
      env: {
        ...process.env,
        PROJECT_CONFIG_PATH: configPath,
        PIPELINE_OUTPUT_DIR: outputDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Pipeline exited with code ${code}`));
    });
  });
}

async function readRunArtifacts(outputDir: string) {
  const [reportRaw, diagnosticsRaw] = await Promise.all([
    readFile(path.join(outputDir, "weekly_intel_report.json"), "utf-8"),
    readFile(path.join(outputDir, "source_diagnostics.json"), "utf-8"),
  ]);

  return {
    report: JSON.parse(reportRaw) as WeeklyIntelReport,
    diagnostics: JSON.parse(diagnosticsRaw) as SourceDiagnostics,
  };
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "local-edge-run-"));
  const outputDir = path.join(tempRoot, OUTPUT_DIR_NAME);
  const configPath = path.join(tempRoot, PROJECT_CONFIG_NAME);

  try {
    await updateRun(supabase, runId, {
      status: "running",
      stage: "input_normalization",
      started_at: run.started_at ?? new Date().toISOString(),
    });

    const projectConfig = await createProjectConfig(project, targets);
    await writeFile(configPath, JSON.stringify(projectConfig, null, 2), "utf-8");
    await insertCheckpoint(supabase, runId, "input_normalization", {
      target_count: projectConfig.targets.length,
      competitor_count: projectConfig.competition.length,
      location_focus: project.location,
    });

    await updateRun(supabase, runId, { stage: "source_collection" });
    await runPythonPipeline(configPath, outputDir);
    await insertCheckpoint(supabase, runId, "source_collection", {
      pipeline_output_dir: outputDir,
    });

    await updateRun(supabase, runId, { stage: "report_generation" });
    const { report, diagnostics } = await readRunArtifacts(outputDir);
    const coverageScore = computeCoverageScore(report, diagnostics);
    const finalStatus: ProjectLifecycleStatus = coverageScore < COVERAGE_THRESHOLD ? "partial" : "completed";

    await persistDiagnostics(supabase, runId, run.account_id, targets, diagnostics);
    await persistSignals(supabase, runId, run.account_id, project.id, targets, report);
    await persistReport(supabase, runId, run.account_id, project.id, report, coverageScore);
    await insertCheckpoint(supabase, runId, "report_generation", {
      market_status: report.market_status,
      coverage_score: coverageScore,
      target_leads: report.target_leads.length,
      competitor_deltas: report.competitor_delta.length,
      diagnostics,
    });

    await updateRun(supabase, runId, {
      status: finalStatus,
      stage: "done",
      coverage_score: coverageScore,
      completed_at: new Date().toISOString(),
    });

    return {
      runId,
      status: finalStatus,
      coverageScore,
    };
  } catch (error) {
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function dispatchQueuedRuns(limit = 1): Promise<DispatchResult> {
  const supabase = getAdminClientOrThrow();
  const requeuedRunIds = await requeueStaleRuns(supabase);
  const processedRunIds: string[] = [];

  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimQueuedRun(supabase);
    if (!claimed) {
      break;
    }

    await processQueuedRun(claimed.id);
    processedRunIds.push(claimed.id);
  }

  return {
    processedRunIds,
    requeuedRunIds,
  };
}
