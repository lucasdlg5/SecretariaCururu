-- ==============================================================================
-- MIGRATION: 0001_initial_schema.sql
-- Sistema de Automação e Conciliação de Contas Domésticas
-- ==============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE bill_category AS ENUM (
        'LUZ',
        'AGUA',
        'INTERNET',
        'GAS',
        'CONDOMINIO',
        'ALUGUEL',
        'OUTROS'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE provider_mode AS ENUM (
        'WEB_AUTOMATION',
        'MANUAL_REMINDER',
        'EMAIL_WATCH'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE cycle_status AS ENUM (
        'PENDING',
        'RUNNING',
        'WAITING_CAPTCHA',
        'NOT_FOUND_YET',
        'PDF_CAPTURED',
        'PAID_RECONCILED',
        'MANUAL_REQUIRED',
        'PROVIDER_DOWN'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE captcha_status AS ENUM (
        'PENDING',
        'SOLVED',
        'EXPIRED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TABLES
-- ------------------------------------------------------------------------------

-- 2.1. bill_providers
CREATE TABLE IF NOT EXISTS public.bill_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category bill_category NOT NULL,
    mode provider_mode NOT NULL DEFAULT 'WEB_AUTOMATION',
    is_active BOOLEAN NOT NULL DEFAULT true,
    trigger_day INTEGER NOT NULL CHECK (trigger_day BETWEEN 1 AND 31),
    due_day_default INTEGER NOT NULL CHECK (due_day_default BETWEEN 1 AND 31),
    workflow_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    fallback_workflow_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    encrypted_secrets JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_retry_days INTEGER NOT NULL DEFAULT 3 CHECK (max_retry_days >= 1 AND max_retry_days <= 15),
    portal_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2. bill_cycles
CREATE TABLE IF NOT EXISTS public.bill_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.bill_providers(id) ON DELETE CASCADE,
    reference_month TEXT NOT NULL CHECK (reference_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    status cycle_status NOT NULL DEFAULT 'PENDING',
    amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
    due_date DATE,
    barcode_hash TEXT,
    invoice_drive_file_id TEXT,
    invoice_drive_url TEXT,
    receipt_drive_file_id TEXT,
    receipt_drive_url TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_bill_cycles_provider_month UNIQUE (provider_id, reference_month)
);

-- 2.3. execution_logs
CREATE TABLE IF NOT EXISTS public.execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID REFERENCES public.bill_cycles(id) ON DELETE SET NULL,
    provider_id UUID NOT NULL REFERENCES public.bill_providers(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    step_reached TEXT,
    sanitized_message TEXT NOT NULL,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4. captcha_challenges
CREATE TABLE IF NOT EXISTS public.captcha_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES public.bill_cycles(id) ON DELETE CASCADE,
    status captcha_status NOT NULL DEFAULT 'PENDING',
    solution_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes')
);

-- ------------------------------------------------------------------------------
-- 3. INDEXES & TRIGGERS
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bill_providers_active_trigger
    ON public.bill_providers(is_active, trigger_day);

CREATE INDEX IF NOT EXISTS idx_bill_cycles_reference_month_status
    ON public.bill_cycles(reference_month, status);

CREATE INDEX IF NOT EXISTS idx_bill_cycles_provider_id
    ON public.bill_cycles(provider_id);

CREATE INDEX IF NOT EXISTS idx_execution_logs_provider_started
    ON public.execution_logs(provider_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_logs_cycle_id
    ON public.execution_logs(cycle_id);

CREATE INDEX IF NOT EXISTS idx_captcha_challenges_status_expires
    ON public.captcha_challenges(status, expires_at DESC);

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_bill_providers_updated_at ON public.bill_providers;
CREATE TRIGGER set_bill_providers_updated_at
    BEFORE UPDATE ON public.bill_providers
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_bill_cycles_updated_at ON public.bill_cycles;
CREATE TRIGGER set_bill_cycles_updated_at
    BEFORE UPDATE ON public.bill_cycles
    FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- ------------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.bill_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captcha_challenges ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated Dashboard users
DROP POLICY IF EXISTS "Authenticated users can read bill_providers" ON public.bill_providers;
CREATE POLICY "Authenticated users can read bill_providers"
    ON public.bill_providers FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert bill_providers" ON public.bill_providers;
CREATE POLICY "Authenticated users can insert bill_providers"
    ON public.bill_providers FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update bill_providers" ON public.bill_providers;
CREATE POLICY "Authenticated users can update bill_providers"
    ON public.bill_providers FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete bill_providers" ON public.bill_providers;
CREATE POLICY "Authenticated users can delete bill_providers"
    ON public.bill_providers FOR DELETE
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage bill_cycles" ON public.bill_cycles;
CREATE POLICY "Authenticated users can manage bill_cycles"
    ON public.bill_cycles FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view execution_logs" ON public.execution_logs;
CREATE POLICY "Authenticated users can view execution_logs"
    ON public.execution_logs FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can view captcha_challenges" ON public.captcha_challenges;
CREATE POLICY "Authenticated users can view captcha_challenges"
    ON public.captcha_challenges FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
