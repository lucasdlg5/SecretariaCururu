import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  BillCategory,
  CaptchaStatus,
  CycleStatus,
  EncryptedSecretsMap,
  ProviderMode,
  WorkflowStep,
} from './schemas.js';

// ============================================================================
// Database Row & Insert/Update Types
// ============================================================================
export type BillProviderRow = {
  id: string;
  name: string;
  category: BillCategory;
  mode: ProviderMode;
  is_active: boolean;
  trigger_day: number;
  due_day_default: number;
  portal_url: string | null;
  workflow_steps: WorkflowStep[];
  fallback_workflow_steps: WorkflowStep[];
  encrypted_secrets: EncryptedSecretsMap;
  max_retry_days: number;
  created_at: string;
  updated_at: string;
};

export type BillCycleRow = {
  id: string;
  provider_id: string;
  reference_month: string; // YYYY-MM
  status: CycleStatus;
  amount_cents: number | null;
  due_date: string | null;
  barcode_hash: string | null;
  invoice_drive_file_id: string | null;
  invoice_drive_url: string | null;
  receipt_drive_file_id: string | null;
  receipt_drive_url: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  paid_at: string | null;
  consumption_value?: number | null;
  consumption_unit?: string | null;
  unit_tariff_brl?: number | null;
  tax_amount_cents?: number | null;
  tariff_flag?: string | null;
  billing_days?: number | null;
  predicted_due_date?: string | null;
  bi_metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ExecutionLogRow = {
  id: string;
  cycle_id: string | null;
  provider_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  step_reached: string | null;
  sanitized_message: string;
  error_code: string | null;
  created_at: string;
};

export type CaptchaChallengeRow = {
  id: string;
  cycle_id: string;
  status: CaptchaStatus;
  solution_text: string | null;
  created_at: string;
  expires_at: string;
};

export type Database = {
  public: {
    Tables: {
      bill_providers: {
        Row: BillProviderRow;
        Insert: {
          id?: string;
          name: string;
          category: BillCategory;
          mode?: ProviderMode;
          is_active?: boolean;
          trigger_day: number;
          due_day_default: number;
          portal_url?: string | null;
          workflow_steps?: WorkflowStep[];
          fallback_workflow_steps?: WorkflowStep[];
          encrypted_secrets?: EncryptedSecretsMap;
          max_retry_days?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BillProviderRow>;
        Relationships: [];
      };
      bill_cycles: {
        Row: BillCycleRow;
        Insert: {
          id?: string;
          provider_id: string;
          reference_month: string;
          status?: CycleStatus;
          amount_cents?: number | null;
          due_date?: string | null;
          barcode_hash?: string | null;
          invoice_drive_file_id?: string | null;
          invoice_drive_url?: string | null;
          receipt_drive_file_id?: string | null;
          receipt_drive_url?: string | null;
          attempt_count?: number;
          last_attempt_at?: string | null;
          paid_at?: string | null;
          consumption_value?: number | null;
          consumption_unit?: string | null;
          unit_tariff_brl?: number | null;
          tax_amount_cents?: number | null;
          tariff_flag?: string | null;
          billing_days?: number | null;
          predicted_due_date?: string | null;
          bi_metadata?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<BillCycleRow>;
        Relationships: [
          {
            foreignKeyName: 'bill_cycles_provider_id_fkey';
            columns: ['provider_id'];
            isOneToOne: false;
            referencedRelation: 'bill_providers';
            referencedColumns: ['id'];
          },
        ];
      };
      execution_logs: {
        Row: ExecutionLogRow;
        Insert: {
          id?: string;
          cycle_id?: string | null;
          provider_id: string;
          started_at?: string;
          finished_at?: string | null;
          status: string;
          step_reached?: string | null;
          sanitized_message: string;
          error_code?: string | null;
          created_at?: string;
        };
        Update: Partial<ExecutionLogRow>;
        Relationships: [];
      };
      captcha_challenges: {
        Row: CaptchaChallengeRow;
        Insert: {
          id?: string;
          cycle_id: string;
          status?: CaptchaStatus;
          solution_text?: string | null;
          created_at?: string;
          expires_at?: string;
        };
        Update: Partial<CaptchaChallengeRow>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      bill_category: BillCategory;
      provider_mode: ProviderMode;
      cycle_status: CycleStatus;
      captcha_status: CaptchaStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Creates a server-side Supabase client using SUPABASE_SERVICE_ROLE_KEY
 * for backend/worker operations (bypasses RLS safely in trusted server environments).
 */
export function createServiceSupabaseClient(
  supabaseUrl?: string,
  serviceRoleKey?: string
): TypedSupabaseClient {
  const url = supabaseUrl ?? process.env.SUPABASE_URL;
  const key = serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no servidor/worker.'
    );
  }

  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Helper to format a reference month string (YYYY-MM) from a Date.
 */
export function formatReferenceMonth(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Converts Brazilian currency string (e.g., "1.234,56" or "R$ 245,90") to integer cents (e.g., 123456 or 24590).
 */
export function parseBrlToCents(raw: string): number | null {
  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (!cleaned) return null;

  // Handle standard Brazilian format 1.234,56 or 234,56
  let normalized: string;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned;
  }

  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

/**
 * Formats integer cents (e.g., 24590) to Brazilian Real string ("R$ 245,90").
 */
export function formatCentsToBrl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'R$ --';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

export interface HistoricalCycleDueInput {
  reference_month: string; // YYYY-MM
  due_date?: string | null; // YYYY-MM-DD
  paid_at?: string | null; // ISO timestamp
  amount_cents?: number | null;
}

export interface DueDatePredictionResult {
  predictedDueDate: string; // YYYY-MM-DD
  predictedDay: number;
  monthOffset: number; // 0 = same month as reference_month, 1 = following month
  predictedAmountCents: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'DEFAULT_FALLBACK';
  sampleSize: number;
  explanation: string;
}

/**
 * Predicts the due date (and expected amount) of a bill cycle (especially MANUAL_REQUIRED)
 * based on the provider's historical cycles:
 * 1. Analyzes whether past cycles due_date fell in the SAME month as `reference_month`
 *    (e.g., Aluguel 2026-07 -> due 2026-07-30, offset = 0) or the NEXT month
 *    (e.g., Luz 2026-07 -> due 2026-08-08, offset = +1).
 * 2. Applies weighted recency / mode on the historical day-of-month (giving double weight to the most recent cycle
 *    so regime shifts like Condomínio moving from day 30 to day 10 in Set/2026 are immediately reflected).
 * 3. Adjusts automatically if the predicted date falls on a Saturday (+2 days) or Sunday (+1 day),
 *    and clamps to the last valid day of the target month (e.g., Feb 28).
 */
export function predictDueDateFromHistory(params: {
  targetReferenceMonth: string; // YYYY-MM
  historicalCycles: HistoricalCycleDueInput[];
  defaultDueDay?: number;
}): DueDatePredictionResult {
  const { targetReferenceMonth, historicalCycles, defaultDueDay = 10 } = params;

  const validSamples = historicalCycles
    .filter((c) => c.reference_month < targetReferenceMonth && (c.due_date || c.paid_at))
    .sort((a, b) => b.reference_month.localeCompare(a.reference_month));

  const [refYearStr, refMonthStr] = targetReferenceMonth.split('-');
  const refYear = Number.parseInt(refYearStr, 10);
  const refMonth = Number.parseInt(refMonthStr, 10);

  if (validSamples.length === 0) {
    const maxDay = new Date(Date.UTC(refYear, refMonth, 0)).getUTCDate();
    const clampedDay = Math.min(defaultDueDay, maxDay);
    const predictedDueDate = `${targetReferenceMonth}-${String(clampedDay).padStart(2, '0')}`;
    return {
      predictedDueDate,
      predictedDay: clampedDay,
      monthOffset: 0,
      predictedAmountCents: null,
      confidence: 'DEFAULT_FALLBACK',
      sampleSize: 0,
      explanation: `Baseado no dia padrão do provedor (dia ${clampedDay})`,
    };
  }

  // Extract day of month and month offset from each historical sample
  const extracted: Array<{
    day: number;
    offset: number;
    amountCents: number | null;
    weight: number;
  }> = [];

  validSamples.forEach((sample, idx) => {
    const rawDate = sample.due_date ?? sample.paid_at?.slice(0, 10);
    if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return;

    const [dYear, dMonth, dDay] = rawDate.split('-').map((n) => Number.parseInt(n, 10));
    const [sYear, sMonth] = sample.reference_month
      .split('-')
      .map((n) => Number.parseInt(n, 10));

    const monthDiff = (dYear - sYear) * 12 + (dMonth - sMonth);
    const offset = monthDiff >= 1 ? 1 : 0;
    // Give highest weight to the most recent cycle (captures regime changes like Condomínio moving to day 10)
    const weight = idx === 0 ? 3 : idx === 1 ? 2 : 1;

    extracted.push({
      day: dDay,
      offset,
      amountCents: sample.amount_cents ?? null,
      weight,
    });
  });

  if (extracted.length === 0) {
    const maxDay = new Date(Date.UTC(refYear, refMonth, 0)).getUTCDate();
    const clampedDay = Math.min(defaultDueDay, maxDay);
    return {
      predictedDueDate: `${targetReferenceMonth}-${String(clampedDay).padStart(2, '0')}`,
      predictedDay: clampedDay,
      monthOffset: 0,
      predictedAmountCents: null,
      confidence: 'DEFAULT_FALLBACK',
      sampleSize: 0,
      explanation: `Baseado no dia padrão (dia ${clampedDay})`,
    };
  }

  // Weighted mode for day-of-month
  const dayScores = new Map<number, number>();
  let offsetScore0 = 0;
  let offsetScore1 = 0;

  for (const item of extracted) {
    dayScores.set(item.day, (dayScores.get(item.day) ?? 0) + item.weight);
    if (item.offset === 1) {
      offsetScore1 += item.weight;
    } else {
      offsetScore0 += item.weight;
    }
  }

  let bestDay = extracted[0].day;
  let bestScore = -1;
  for (const [day, score] of dayScores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestDay = day;
    }
  }

  const monthOffset = offsetScore1 > offsetScore0 ? 1 : 0;

  // Compute target year & month applying offset
  const targetDateObj = new Date(Date.UTC(refYear, refMonth - 1 + monthOffset, 1));
  const targetYear = targetDateObj.getUTCFullYear();
  const targetMonth = targetDateObj.getUTCMonth() + 1;
  const maxDaysInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth, 0)
  ).getUTCDate();
  const clampedDay = Math.min(bestDay, maxDaysInTargetMonth);

  // Check if predicted date falls on a weekend (Saturday = 6 -> +2d, Sunday = 0 -> +1d) for utility bills
  const candidateDate = new Date(Date.UTC(targetYear, targetMonth - 1, clampedDay));
  const dayOfWeek = candidateDate.getUTCDay();
  let weekendNote = '';
  if (dayOfWeek === 6 && clampedDay < 28) {
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 2);
    weekendNote = ' (ajustado de sábado para segunda-feira útil)';
  } else if (dayOfWeek === 0 && clampedDay < 28) {
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
    weekendNote = ' (ajustado de domingo para segunda-feira útil)';
  }

  const finalYear = candidateDate.getUTCFullYear();
  const finalMonth = String(candidateDate.getUTCMonth() + 1).padStart(2, '0');
  const finalDay = String(candidateDate.getUTCDate()).padStart(2, '0');
  const predictedDueDate = `${finalYear}-${finalMonth}-${finalDay}`;

  // Predict amount from the most recent historical cycle with a valid amount
  const recentWithAmount = extracted.find(
    (e) => e.amountCents !== null && e.amountCents > 0
  );
  const predictedAmountCents = recentWithAmount?.amountCents ?? null;

  const confidence = extracted.length >= 2 ? 'HIGH' : 'MEDIUM';
  const explanation = `Previsto pelo histórico de ${extracted.length} fatura(s) anterior(es) (padrão dia ${bestDay}${weekendNote})`;

  return {
    predictedDueDate,
    predictedDay: Number.parseInt(finalDay, 10),
    monthOffset,
    predictedAmountCents,
    confidence,
    sampleSize: extracted.length,
    explanation,
  };
}
