BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id
  FROM public.users
  WHERE id = auth.uid()
  LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    plan text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'solo', 'edge')),
    credit_balance integer NOT NULL DEFAULT 3,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    industry text NOT NULL,
    location text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.project_targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    url text NOT NULL,
    role text NOT NULL DEFAULT 'competitor' CHECK (role IN ('primary', 'competitor')),
    resolved_name text,
    resolved_place_id text,
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.analysis_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
    stage text,
    coverage_score numeric(4, 3),
    credits_used integer NOT NULL DEFAULT 0,
    triggered_by uuid REFERENCES public.users(id),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.run_stage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    stage text NOT NULL,
    status text NOT NULL CHECK (status IN ('completed', 'failed', 'skipped')),
    payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    target_id uuid NOT NULL REFERENCES public.project_targets(id) ON DELETE CASCADE,
    source text NOT NULL,
    signal_type text NOT NULL,
    raw_value text,
    structured_insight jsonb,
    confidence_score numeric(4, 3),
    entity_scope text NOT NULL DEFAULT 'target' CHECK (entity_scope IN ('target', 'competitor')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid UNIQUE NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    version integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
    body jsonb NOT NULL,
    coverage_score numeric(4, 3),
    approved_by uuid REFERENCES public.users(id),
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.run_diagnostics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    target_id uuid NOT NULL REFERENCES public.project_targets(id) ON DELETE CASCADE,
    source text NOT NULL,
    status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
    signals_found integer NOT NULL DEFAULT 0,
    signals_expected integer,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_targets_single_primary_idx
    ON public.project_targets (project_id)
    WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS project_targets_project_role_idx
    ON public.project_targets (project_id, role);

CREATE INDEX IF NOT EXISTS projects_account_created_idx
    ON public.projects (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analysis_runs_project_status_created_idx
    ON public.analysis_runs (project_id, status, created_at);

CREATE INDEX IF NOT EXISTS analysis_runs_account_created_idx
    ON public.analysis_runs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS signals_project_signal_created_idx
    ON public.signals (project_id, signal_type, created_at);

CREATE INDEX IF NOT EXISTS signals_run_target_idx
    ON public.signals (run_id, target_id);

CREATE INDEX IF NOT EXISTS reports_project_created_desc_idx
    ON public.reports (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS run_diagnostics_run_source_idx
    ON public.run_diagnostics (run_id, source);

CREATE INDEX IF NOT EXISTS run_diagnostics_account_created_idx
    ON public.run_diagnostics (account_id, created_at DESC);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_stage_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_select_policy ON public.accounts;
CREATE POLICY accounts_select_policy
    ON public.accounts
    FOR SELECT
    USING (id = public.current_account_id());

DROP POLICY IF EXISTS accounts_update_policy ON public.accounts;
CREATE POLICY accounts_update_policy
    ON public.accounts
    FOR UPDATE
    USING (id = public.current_account_id())
    WITH CHECK (id = public.current_account_id());

DROP POLICY IF EXISTS users_select_policy ON public.users;
CREATE POLICY users_select_policy
    ON public.users
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS users_update_policy ON public.users;
CREATE POLICY users_update_policy
    ON public.users
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS projects_select_policy ON public.projects;
CREATE POLICY projects_select_policy
    ON public.projects
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS projects_insert_policy ON public.projects;
CREATE POLICY projects_insert_policy
    ON public.projects
    FOR INSERT
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS projects_update_policy ON public.projects;
CREATE POLICY projects_update_policy
    ON public.projects
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS project_targets_select_policy ON public.project_targets;
CREATE POLICY project_targets_select_policy
    ON public.project_targets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = project_targets.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS project_targets_insert_policy ON public.project_targets;
CREATE POLICY project_targets_insert_policy
    ON public.project_targets
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = project_targets.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS project_targets_update_policy ON public.project_targets;
CREATE POLICY project_targets_update_policy
    ON public.project_targets
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = project_targets.project_id
              AND p.account_id = public.current_account_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = project_targets.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS analysis_runs_select_policy ON public.analysis_runs;
CREATE POLICY analysis_runs_select_policy
    ON public.analysis_runs
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS analysis_runs_insert_policy ON public.analysis_runs;
CREATE POLICY analysis_runs_insert_policy
    ON public.analysis_runs
    FOR INSERT
    WITH CHECK (
        account_id = public.current_account_id()
        AND EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = analysis_runs.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS analysis_runs_update_policy ON public.analysis_runs;
CREATE POLICY analysis_runs_update_policy
    ON public.analysis_runs
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS run_stage_checkpoints_select_policy ON public.run_stage_checkpoints;
CREATE POLICY run_stage_checkpoints_select_policy
    ON public.run_stage_checkpoints
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.analysis_runs r
            WHERE r.id = run_stage_checkpoints.run_id
              AND r.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS run_stage_checkpoints_insert_policy ON public.run_stage_checkpoints;
CREATE POLICY run_stage_checkpoints_insert_policy
    ON public.run_stage_checkpoints
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.analysis_runs r
            WHERE r.id = run_stage_checkpoints.run_id
              AND r.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS run_stage_checkpoints_update_policy ON public.run_stage_checkpoints;
CREATE POLICY run_stage_checkpoints_update_policy
    ON public.run_stage_checkpoints
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.analysis_runs r
            WHERE r.id = run_stage_checkpoints.run_id
              AND r.account_id = public.current_account_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.analysis_runs r
            WHERE r.id = run_stage_checkpoints.run_id
              AND r.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS signals_select_policy ON public.signals;
CREATE POLICY signals_select_policy
    ON public.signals
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS signals_insert_policy ON public.signals;
CREATE POLICY signals_insert_policy
    ON public.signals
    FOR INSERT
    WITH CHECK (
        account_id = public.current_account_id()
        AND EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = signals.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS signals_update_policy ON public.signals;
CREATE POLICY signals_update_policy
    ON public.signals
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS reports_select_policy ON public.reports;
CREATE POLICY reports_select_policy
    ON public.reports
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS reports_insert_policy ON public.reports;
CREATE POLICY reports_insert_policy
    ON public.reports
    FOR INSERT
    WITH CHECK (
        account_id = public.current_account_id()
        AND EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = reports.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS reports_update_policy ON public.reports;
CREATE POLICY reports_update_policy
    ON public.reports
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

DROP POLICY IF EXISTS run_diagnostics_select_policy ON public.run_diagnostics;
CREATE POLICY run_diagnostics_select_policy
    ON public.run_diagnostics
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS run_diagnostics_insert_policy ON public.run_diagnostics;
CREATE POLICY run_diagnostics_insert_policy
    ON public.run_diagnostics
    FOR INSERT
    WITH CHECK (
        account_id = public.current_account_id()
        AND EXISTS (
            SELECT 1
            FROM public.analysis_runs r
            WHERE r.id = run_diagnostics.run_id
              AND r.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS run_diagnostics_update_policy ON public.run_diagnostics;
CREATE POLICY run_diagnostics_update_policy
    ON public.run_diagnostics
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

COMMIT;
