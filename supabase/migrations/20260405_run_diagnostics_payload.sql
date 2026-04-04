BEGIN;

ALTER TABLE public.run_diagnostics
ADD COLUMN IF NOT EXISTS detail_payload jsonb;

CREATE INDEX IF NOT EXISTS run_diagnostics_detail_payload_idx
    ON public.run_diagnostics
    USING gin (detail_payload);

COMMIT;
