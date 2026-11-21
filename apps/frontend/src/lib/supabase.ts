import { createClient } from '@supabase/supabase-js';
import {
  type BillCycleRow,
  type BillProviderRow,
  type Database,
  type ExecutionLogRow,
  PROVIDER_TEMPLATES,
} from '@secretaria/shared';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const isSupabaseConfigured =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);

export const BACKEND_API_URL =
  import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3000';

// ============================================================================
// Realistic Initial Seed State (used when running in local demo / offline mode)
// ============================================================================
export const DEMO_PROVIDERS: BillProviderRow[] = PROVIDER_TEMPLATES.map((tpl, idx) => ({
  id: `prov-${tpl.id}`,
  name: tpl.name,
  category: tpl.category,
  mode: tpl.mode,
  is_active: tpl.is_active,
  trigger_day: tpl.trigger_day,
  due_day_default: tpl.due_day_default,
  portal_url: tpl.portal_url,
  workflow_steps: tpl.workflow_steps,
  fallback_workflow_steps: tpl.fallback_workflow_steps,
  encrypted_secrets: {},
  max_retry_days: 3,
  created_at: new Date(Date.now() - idx * 86400000).toISOString(),
  updated_at: new Date().toISOString(),
}));

export const DEMO_CYCLES: BillCycleRow[] = [
  {
    id: 'cyc-edp-2026-11',
    provider_id: 'prov-edp-luz',
    reference_month: '2026-11',
    status: 'PAID_RECONCILED',
    amount_cents: 24890,
    due_date: '2026-11-15',
    barcode_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    invoice_drive_file_id: 'drive-inv-edp-11',
    invoice_drive_url: 'https://drive.google.com/file/d/drive-inv-edp-11/view',
    receipt_drive_file_id: 'drive-rec-edp-11',
    receipt_drive_url: 'https://drive.google.com/file/d/drive-rec-edp-11/view',
    attempt_count: 1,
    last_attempt_at: '2026-11-05T11:02:10Z',
    paid_at: '2026-11-14T18:22:00Z',
    created_at: '2026-11-05T11:00:00Z',
    updated_at: '2026-11-14T18:22:00Z',
  },
  {
    id: 'cyc-njci-2026-11',
    provider_id: 'prov-njci-internet',
    reference_month: '2026-11',
    status: 'PDF_CAPTURED',
    amount_cents: 11990,
    due_date: '2026-11-20',
    barcode_hash: '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
    invoice_drive_file_id: 'drive-inv-njci-11',
    invoice_drive_url: 'https://drive.google.com/file/d/drive-inv-njci-11/view',
    receipt_drive_file_id: null,
    receipt_drive_url: null,
    attempt_count: 1,
    last_attempt_at: '2026-11-08T11:03:45Z',
    paid_at: null,
    created_at: '2026-11-08T11:00:00Z',
    updated_at: '2026-11-08T11:03:45Z',
  },
  {
    id: 'cyc-comgas-2026-11',
    provider_id: 'prov-comgas-gas',
    reference_month: '2026-11',
    status: 'PDF_CAPTURED',
    amount_cents: 8740,
    due_date: '2026-11-22',
    barcode_hash: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
    invoice_drive_file_id: 'drive-inv-comgas-11',
    invoice_drive_url: 'https://drive.google.com/file/d/drive-inv-comgas-11/view',
    receipt_drive_file_id: null,
    receipt_drive_url: null,
    attempt_count: 1,
    last_attempt_at: '2026-11-10T11:01:22Z',
    paid_at: null,
    created_at: '2026-11-10T11:00:00Z',
    updated_at: '2026-11-10T11:01:22Z',
  },
  {
    id: 'cyc-condo-2026-11',
    provider_id: 'prov-condominio-manual',
    reference_month: '2026-11',
    status: 'PAID_RECONCILED',
    amount_cents: 68500,
    due_date: '2026-11-10',
    barcode_hash: null,
    invoice_drive_file_id: 'drive-inv-condo-11',
    invoice_drive_url: 'https://drive.google.com/file/d/drive-inv-condo-11/view',
    receipt_drive_file_id: 'drive-rec-condo-11',
    receipt_drive_url: 'https://drive.google.com/file/d/drive-rec-condo-11/view',
    attempt_count: 1,
    last_attempt_at: '2026-11-01T11:00:15Z',
    paid_at: '2026-11-09T14:10:00Z',
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-09T14:10:00Z',
  },
  {
    id: 'cyc-aluguel-2026-11',
    provider_id: 'prov-aluguel-manual',
    reference_month: '2026-11',
    status: 'PAID_RECONCILED',
    amount_cents: 245000,
    due_date: '2026-11-05',
    barcode_hash: null,
    invoice_drive_file_id: 'drive-inv-aluguel-11',
    invoice_drive_url: 'https://drive.google.com/file/d/drive-inv-aluguel-11/view',
    receipt_drive_file_id: 'drive-rec-aluguel-11',
    receipt_drive_url: 'https://drive.google.com/file/d/drive-rec-aluguel-11/view',
    attempt_count: 1,
    last_attempt_at: '2026-11-01T11:00:05Z',
    paid_at: '2026-11-04T16:40:00Z',
    created_at: '2026-11-01T11:00:00Z',
    updated_at: '2026-11-04T16:40:00Z',
  },
];

export const DEMO_MONTHLY_HISTORY = [
  { month: '2026-06', LUZ: 215.4, INTERNET: 119.9, GAS: 74.2, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
  { month: '2026-07', LUZ: 232.1, INTERNET: 119.9, GAS: 91.8, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
  { month: '2026-08', LUZ: 228.0, INTERNET: 119.9, GAS: 96.5, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
  { month: '2026-09', LUZ: 219.75, INTERNET: 119.9, GAS: 82.1, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
  { month: '2026-10', LUZ: 241.3, INTERNET: 119.9, GAS: 79.9, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
  { month: '2026-11', LUZ: 248.9, INTERNET: 119.9, GAS: 87.4, CONDOMINIO: 685.0, ALUGUEL: 2450.0 },
];

export const DEMO_EXECUTION_LOGS: ExecutionLogRow[] = [
  {
    id: 'log-1',
    cycle_id: 'cyc-comgas-2026-11',
    provider_id: 'prov-comgas-gas',
    started_at: '2026-11-10T11:00:00Z',
    finished_at: '2026-11-10T11:01:22Z',
    status: 'SUCCESS',
    step_reached: 'STEP_11_download_pdf',
    sanitized_message:
      'Fatura capturada e salva no Drive (2026-11_GAS_GAS_COMGAS_FATURA.pdf).',
    error_code: null,
    created_at: '2026-11-10T11:01:22Z',
  },
  {
    id: 'log-2',
    cycle_id: 'cyc-njci-2026-11',
    provider_id: 'prov-njci-internet',
    started_at: '2026-11-08T11:00:00Z',
    finished_at: '2026-11-08T11:03:45Z',
    status: 'SUCCESS',
    step_reached: 'STEP_9_download_pdf',
    sanitized_message:
      'CAPTCHA HITL resolvido via Telegram para CPF [REDACTED_CPF]. PDF salvo (2026-11_INTERNET_INTERNET_NJCI_FATURA.pdf).',
    error_code: null,
    created_at: '2026-11-08T11:03:45Z',
  },
  {
    id: 'log-3',
    cycle_id: 'cyc-edp-2026-11',
    provider_id: 'prov-edp-luz',
    started_at: '2026-11-05T11:00:00Z',
    finished_at: '2026-11-05T11:02:10Z',
    status: 'SUCCESS',
    step_reached: 'STEP_12_download_pdf',
    sanitized_message:
      'Login com [REDACTED_EMAIL] e UC [REDACTED_SECRET] concluído. Modais dispensados. PDF salvo (2026-11_LUZ_LUZ_EDP_FATURA.pdf).',
    error_code: null,
    created_at: '2026-11-05T11:02:10Z',
  },
  {
    id: 'log-4',
    cycle_id: 'cyc-edp-2026-11',
    provider_id: 'prov-edp-luz',
    started_at: '2026-11-04T11:00:00Z',
    finished_at: '2026-11-04T11:00:40Z',
    status: 'NOT_FOUND_YET',
    step_reached: 'STEP_12_download_pdf',
    sanitized_message:
      'Fatura do ciclo 2026-11 ainda não emitida no portal EDP para [REDACTED_EMAIL]. Agendado para o dia seguinte.',
    error_code: null,
    created_at: '2026-11-04T11:00:40Z',
  },
];
