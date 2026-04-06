import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const parsed = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed.set(key, "true");
      continue;
    }

    parsed.set(key, value);
    index += 1;
  }

  return parsed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function safeName(input) {
  const normalized = input.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "LocalEdgeHourlyRuns";
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function testAppServer(baseUrl) {
  try {
    const response = await fetch(baseUrl, { redirect: "manual" });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function ensureAppServer(baseUrl, repoRoot, log) {
  if (await testAppServer(baseUrl)) {
    return;
  }

  log(`Local app server was not reachable at ${baseUrl}. Starting 'npm run dev'.`);
  const child = spawn("cmd.exe", ["/c", "npm.cmd run dev > devserver.log 2>&1"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  fs.writeFileSync(path.join(repoRoot, ".devserver.pid"), `${child.pid}\n`, "utf8");

  for (let attempt = 0; attempt < 18; attempt += 1) {
    await sleep(5000);
    if (await testAppServer(baseUrl)) {
      log(`Local app server is ready at ${baseUrl}.`);
      return;
    }
  }

  throw new Error(`Local app server did not become ready at ${baseUrl} within 90 seconds.`);
}

function stopTask(taskName, log) {
  const result = spawnSync("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status === 0) {
    log(`Reached max runs and removed scheduled task '${taskName}'.`);
    return;
  }

  const details = (result.stderr || result.stdout || "").trim();
  log(`Reached max runs, but could not remove task '${taskName}': ${details || "unknown error"}`);
}

const args = parseArgs(process.argv.slice(2));
const projectId = args.get("project-id");
const taskName = args.get("task-name") || "LocalEdgeHourlyRuns";
const maxRuns = Number.parseInt(args.get("max-runs") || "10", 10);

if (!projectId) {
  throw new Error("Missing --project-id");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot);

const automationDir = path.join(repoRoot, ".automation");
fs.mkdirSync(automationDir, { recursive: true });

const statePath = path.join(automationDir, `${safeName(taskName)}.json`);
const logPath = path.join(automationDir, "local-edge-hourly-runs.log");

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
  console.log(line);
}

loadEnvFile(path.join(repoRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const internalJobSecret = requireEnv("INTERNAL_JOB_SECRET");
const baseUrl = process.env.APP_BASE_URL || "http://127.0.0.1:3000";

const state = readJson(statePath, {
  taskName,
  projectId,
  triggeredRuns: 0,
  createdAt: new Date().toISOString(),
  lastRunId: null,
  lastStatus: null,
});

if (state.triggeredRuns >= maxRuns) {
  log(`Task '${taskName}' already reached ${state.triggeredRuns} runs. No action taken.`);
  stopTask(taskName, log);
  process.exit(0);
}

await ensureAppServer(baseUrl, repoRoot, log);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("id, account_id, name, industry, location")
  .eq("id", projectId)
  .maybeSingle();

if (projectError) {
  throw new Error(`Project lookup failed: ${projectError.message}`);
}
if (!project) {
  throw new Error(`Project '${projectId}' was not found.`);
}

const { data: owner, error: ownerError } = await supabase
  .from("users")
  .select("id, email, role")
  .eq("account_id", project.account_id)
  .eq("role", "owner")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

if (ownerError) {
  throw new Error(`Owner lookup failed: ${ownerError.message}`);
}
if (!owner?.id) {
  throw new Error(`No owner user was found for account '${project.account_id}'.`);
}

const { data: inFlightRuns, error: inFlightError } = await supabase
  .from("analysis_runs")
  .select("id, status, stage, created_at")
  .eq("project_id", project.id)
  .in("status", ["queued", "running"])
  .order("created_at", { ascending: false });

if (inFlightError) {
  throw new Error(`In-flight run lookup failed: ${inFlightError.message}`);
}

if ((inFlightRuns ?? []).length > 0) {
  const latest = inFlightRuns[0];
  log(
    `Skipped triggering a new run because project '${project.name}' already has in-flight run '${latest.id}' with status '${latest.status}'.`,
  );
  process.exit(0);
}

const { data: insertedRun, error: insertError } = await supabase
  .from("analysis_runs")
  .insert({
    project_id: project.id,
    account_id: project.account_id,
    status: "queued",
    stage: "queued",
    credits_used: 0,
    triggered_by: owner.id,
  })
  .select("id")
  .single();

if (insertError) {
  throw new Error(`Run insert failed: ${insertError.message}`);
}

const dispatchResponse = await fetch(`${baseUrl}/api/internal/dispatch-runs`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-job-secret": internalJobSecret,
  },
  body: JSON.stringify({ limit: 1 }),
});

const dispatchJson = await dispatchResponse.json().catch(() => null);
if (!dispatchResponse.ok) {
  throw new Error(
    `Dispatch failed with ${dispatchResponse.status}: ${JSON.stringify(dispatchJson)}`,
  );
}

let runStatus = null;
for (let attempt = 0; attempt < 36; attempt += 1) {
  await sleep(5000);
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, status, stage, coverage_score, started_at, completed_at")
    .eq("id", insertedRun.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Run polling failed: ${error.message}`);
  }

  runStatus = data;
  if (runStatus && ["completed", "partial", "failed"].includes(runStatus.status)) {
    break;
  }
}

state.triggeredRuns += 1;
state.lastRunId = insertedRun.id;
state.lastStatus = runStatus?.status ?? "unknown";
state.lastTriggeredAt = new Date().toISOString();
writeJson(statePath, state);

const coverageText =
  typeof runStatus?.coverage_score === "number"
    ? `${Math.round(runStatus.coverage_score * 100)}%`
    : "unknown";
const processedRunIds = dispatchJson?.data?.processedRunIds ?? [];

log(
  `Triggered run '${insertedRun.id}' for '${project.name}'. Dispatch processed: ${
    processedRunIds.length > 0 ? processedRunIds.join(", ") : "none"
  }; final status: ${state.lastStatus}; coverage: ${coverageText}; count: ${state.triggeredRuns}/${maxRuns}.`,
);

if (state.triggeredRuns >= maxRuns) {
  stopTask(taskName, log);
}
