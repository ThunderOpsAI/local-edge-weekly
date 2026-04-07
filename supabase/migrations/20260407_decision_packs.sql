BEGIN;

CREATE TABLE IF NOT EXISTS public.decision_packs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    run_id uuid NOT NULL UNIQUE REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    week_label text,
    primary_move_type text,
    primary_move_title text,
    secondary_move_type text,
    pressure_summary_json jsonb,
    why_now_md text,
    evidence_json jsonb,
    expected_effect_md text,
    confidence_score integer,
    execution_assets_json jsonb,
    watch_next_week_json jsonb,
    source_flags_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_packs_project_created_desc_idx
    ON public.decision_packs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS decision_packs_account_created_desc_idx
    ON public.decision_packs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS decision_packs_source_flags_idx
    ON public.decision_packs
    USING gin (source_flags_json);

ALTER TABLE public.decision_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_packs_select_policy ON public.decision_packs;
CREATE POLICY decision_packs_select_policy
    ON public.decision_packs
    FOR SELECT
    USING (account_id = public.current_account_id());

DROP POLICY IF EXISTS decision_packs_insert_policy ON public.decision_packs;
CREATE POLICY decision_packs_insert_policy
    ON public.decision_packs
    FOR INSERT
    WITH CHECK (
        account_id = public.current_account_id()
        AND EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = decision_packs.project_id
              AND p.account_id = public.current_account_id()
        )
    );

DROP POLICY IF EXISTS decision_packs_update_policy ON public.decision_packs;
CREATE POLICY decision_packs_update_policy
    ON public.decision_packs
    FOR UPDATE
    USING (account_id = public.current_account_id())
    WITH CHECK (account_id = public.current_account_id());

COMMIT;
