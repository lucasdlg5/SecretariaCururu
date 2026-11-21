import { z } from 'zod';

// ============================================================================
// 1. Enums & Core Domain Schemas
// ============================================================================
export const BillCategorySchema = z.enum([
  'LUZ',
  'AGUA',
  'INTERNET',
  'GAS',
  'CONDOMINIO',
  'ALUGUEL',
  'OUTROS',
]);
export type BillCategory = z.infer<typeof BillCategorySchema>;

export const ProviderModeSchema = z.enum([
  'WEB_AUTOMATION',
  'MANUAL_REMINDER',
  'EMAIL_WATCH',
]);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export const CycleStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'WAITING_CAPTCHA',
  'NOT_FOUND_YET',
  'PDF_CAPTURED',
  'PAID_RECONCILED',
  'MANUAL_REQUIRED',
  'PROVIDER_DOWN',
]);
export type CycleStatus = z.infer<typeof CycleStatusSchema>;

export const CaptchaStatusSchema = z.enum(['PENDING', 'SOLVED', 'EXPIRED']);
export type CaptchaStatus = z.infer<typeof CaptchaStatusSchema>;

export const DriveFolderLayoutSchema = z.enum(['BY_MONTH', 'BY_TYPE']);
export type DriveFolderLayout = z.infer<typeof DriveFolderLayoutSchema>;

// ============================================================================
// 2. Declarative Playwright Workflow Step Schemas (JSONB validation)
// ============================================================================
export const GotoStepSchema = z.object({
  action: z.literal('goto'),
  url: z.string().url('URL inválida no passo goto'),
  description: z.string().optional(),
});

export const FillSecretStepSchema = z.object({
  action: z.literal('fill_secret'),
  selector: z.string().min(1, 'Seletor obrigatório em fill_secret'),
  secretKey: z
    .string()
    .min(1, 'Chave de secret obrigatória')
    .regex(/^[A-Z0-9_]+$/, 'secretKey deve estar em UPPER_SNAKE_CASE'),
  description: z.string().optional(),
});

export const ClickStepSchema = z.object({
  action: z.literal('click'),
  selector: z.string().min(1, 'Seletor obrigatório em click'),
  textFallback: z.string().optional(),
  description: z.string().optional(),
});

export const DismissOptionalModalStepSchema = z.object({
  action: z.literal('dismiss_optional_modal'),
  selector: z.string().min(1, 'Seletor obrigatório em dismiss_optional_modal'),
  timeoutMs: z.number().int().min(500).max(30000).default(4000),
  description: z.string().optional(),
});

export const WaitForStepSchema = z.object({
  action: z.literal('wait_for'),
  selector: z.string().min(1, 'Seletor obrigatório em wait_for'),
  timeoutMs: z.number().int().min(500).max(60000).default(15000),
  description: z.string().optional(),
});

export const CaptchaHitlStepSchema = z.object({
  action: z.literal('captcha_hitl'),
  imageSelector: z.string().min(1, 'imageSelector obrigatório em captcha_hitl'),
  inputSelector: z.string().min(1, 'inputSelector obrigatório em captcha_hitl'),
  mode: z.enum(['IMAGE_OR_MANUAL_LINK']).default('IMAGE_OR_MANUAL_LINK'),
  description: z.string().optional(),
});

export const DownloadPdfStepSchema = z.object({
  action: z.literal('download_pdf'),
  triggerSelector: z.string().min(1, 'triggerSelector obrigatório em download_pdf'),
  description: z.string().optional(),
});

export const ExtractValueStepSchema = z.object({
  action: z.literal('extract_value'),
  selector: z.string().min(1, 'Seletor obrigatório em extract_value'),
  regex: z.string().default('R\\$\\s*([\\d\\.,]+)'),
  description: z.string().optional(),
});

export const WorkflowStepSchema = z.discriminatedUnion('action', [
  GotoStepSchema,
  FillSecretStepSchema,
  ClickStepSchema,
  DismissOptionalModalStepSchema,
  WaitForStepSchema,
  CaptchaHitlStepSchema,
  DownloadPdfStepSchema,
  ExtractValueStepSchema,
]);

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowStepsArraySchema = z.array(WorkflowStepSchema);

// ============================================================================
// 3. Encrypted Secrets Schema (AES-256-GCM Payload)
// ============================================================================
export const EncryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
});
export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;

export const EncryptedSecretsMapSchema = z.record(
  z.string().regex(/^[A-Z0-9_]+$/),
  EncryptedPayloadSchema
);
export type EncryptedSecretsMap = z.infer<typeof EncryptedSecretsMapSchema>;

// ============================================================================
// 4. Provider Creation / Update Wizard Schema
// ============================================================================
export const CreateProviderInputSchema = z
  .object({
    name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(80),
    category: BillCategorySchema,
    mode: ProviderModeSchema,
    is_active: z.boolean().default(true),
    trigger_day: z.number().int().min(1).max(31),
    due_day_default: z.number().int().min(1).max(31),
    portal_url: z.string().url('URL do portal inválida').nullable().optional(),
    max_retry_days: z.number().int().min(1).max(15).default(3),
    workflow_steps: WorkflowStepsArraySchema.default([]),
    fallback_workflow_steps: WorkflowStepsArraySchema.default([]),
    plain_secrets: z.record(z.string().regex(/^[A-Z0-9_]+$/), z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'WEB_AUTOMATION' && data.workflow_steps.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workflow_steps'],
        message: 'Provedores com automação web devem ter pelo menos 1 passo de workflow.',
      });
    }
  });

export type CreateProviderInput = z.infer<typeof CreateProviderInputSchema>;
