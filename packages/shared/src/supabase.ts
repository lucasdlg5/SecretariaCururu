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
