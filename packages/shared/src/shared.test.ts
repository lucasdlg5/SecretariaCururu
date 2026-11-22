import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  decryptSecretsMap,
  encryptSecret,
  encryptSecretsMap,
  interpolateSecrets,
  parseMasterKey,
} from './crypto.js';
import { redactObject, sanitizeLogText } from './redactor.js';
import {
  CreateProviderInputSchema,
  PROVIDER_TEMPLATES,
  WorkflowStepsArraySchema,
} from './index.js';
import { formatCentsToBrl, parseBrlToCents } from './supabase.js';

const TEST_HEX_KEY = randomBytes(32).toString('hex');
const TEST_BASE64_KEY = randomBytes(32).toString('base64');

describe('AES-256-GCM Crypto Module (Zero Plaintext)', () => {
  it('validates 32-byte master key in hex and base64 formats', () => {
    expect(parseMasterKey(TEST_HEX_KEY).length).toBe(32);
    expect(parseMasterKey(TEST_BASE64_KEY).length).toBe(32);
    expect(() => parseMasterKey('short_key')).toThrow(/APP_MASTER_KEY inválida/);
    expect(() => parseMasterKey('')).toThrow(/APP_MASTER_KEY ausente/);
  });

  it('encrypts and decrypts a secret with random IV per call', () => {
    const plain = 'MinhaSenhaSuperSecreta#2026!';
    const enc1 = encryptSecret(plain, TEST_HEX_KEY);
    const enc2 = encryptSecret(plain, TEST_HEX_KEY);

    // Different IV and ciphertext on every call
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    expect(decryptSecret(enc1, TEST_HEX_KEY)).toBe(plain);
    expect(decryptSecret(enc2, TEST_HEX_KEY)).toBe(plain);
  });

  it('fails authentication if ciphertext or authTag is tampered with', () => {
    const enc = encryptSecret('12345678901', TEST_HEX_KEY);
    const tampered = {
      ...enc,
      authTag: randomBytes(16).toString('base64'),
    };
    expect(() => decryptSecret(tampered, TEST_HEX_KEY)).toThrow();
  });

  it('encrypts and decrypts a full secrets map and interpolates placeholders', () => {
    const map = encryptSecretsMap(
      {
        EMAIL: 'usuario@exemplo.com.br',
        UC_NUMBER: '0123456789',
      },
      TEST_HEX_KEY
    );

    expect(map.EMAIL.ciphertext).toBeDefined();
    expect(map.EMAIL.ciphertext).not.toContain('usuario');

    const decrypted = decryptSecretsMap(map, TEST_HEX_KEY);
    expect(decrypted.EMAIL).toBe('usuario@exemplo.com.br');

    const selectorText = interpolateSecrets(
      'Unidade {{secret:UC_NUMBER}} - {{secret:EMAIL}}',
      decrypted
    );
    expect(selectorText).toBe('Unidade 0123456789 - usuario@exemplo.com.br');
  });
});

describe('Log Redactor & Sanitizer (Zero Plaintext in Logs)', () => {
  it('redacts formatted and unformatted CPFs, emails, barcodes, and tokens', () => {
    const rawLog =
      'Erro ao logar CPF 123.456.789-01 (ou 98765432100) email cliente@provedor.com.br ' +
      'com Bearer eyJhbGciOiJIUzI1NiJ9.token e linha digitavel 83640000001-1 45900162000-2 00101020261-3 00045210181-0 ' +
      'password=SuperSecret123';

    const sanitized = sanitizeLogText(rawLog);

    expect(sanitized).not.toContain('123.456.789-01');
    expect(sanitized).not.toContain('98765432100');
    expect(sanitized).not.toContain('cliente@provedor.com.br');
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9.token');
    expect(sanitized).not.toContain('83640000001');
    expect(sanitized).not.toContain('SuperSecret123');

    expect(sanitized).toContain('[REDACTED_CPF]');
    expect(sanitized).toContain('[REDACTED_EMAIL]');
    expect(sanitized).toContain('Bearer [REDACTED_TOKEN]');
    expect(sanitized).toContain('[REDACTED_BARCODE]');
  });

  it('redacts dynamic in-memory secrets and nested object keys', () => {
    const obj = {
      provider: 'Luz - EDP',
      cpf: '111.222.333-44',
      nested: {
        password: 'my-secret-password',
        message: 'Falha ao clicar na UC MY_UC_998877 do usuario@teste.com',
      },
    };

    const redacted = redactObject(obj, ['MY_UC_998877']);
    expect(redacted.cpf).toBe('[REDACTED]');
    expect(redacted.nested.password).toBe('[REDACTED]');
    expect(redacted.nested.message).toBe(
      'Falha ao clicar na UC [REDACTED_SECRET] do [REDACTED_EMAIL]'
    );
  });
});

describe('Zod Workflow Schemas & Seed Templates Validation', () => {
  it('validates all built-in provider preset templates against WorkflowStepsArraySchema', () => {
    for (const template of PROVIDER_TEMPLATES) {
      const parsedPrimary = WorkflowStepsArraySchema.safeParse(template.workflow_steps);
      expect(parsedPrimary.success).toBe(true);

      const parsedFallback = WorkflowStepsArraySchema.safeParse(
        template.fallback_workflow_steps
      );
      expect(parsedFallback.success).toBe(true);

      const wizardInput = CreateProviderInputSchema.safeParse({
        name: template.name,
        category: template.category,
        mode: template.mode,
        is_active: template.is_active,
        trigger_day: template.trigger_day,
        due_day_default: template.due_day_default,
        portal_url: template.portal_url,
        workflow_steps: template.workflow_steps,
        fallback_workflow_steps: template.fallback_workflow_steps,
      });
      expect(wizardInput.success).toBe(true);
    }
  });

  it('rejects WEB_AUTOMATION provider without workflow steps', () => {
    const invalid = CreateProviderInputSchema.safeParse({
      name: 'Portal Vazio',
      category: 'OUTROS',
      mode: 'WEB_AUTOMATION',
      trigger_day: 5,
      due_day_default: 10,
      workflow_steps: [],
    });
    expect(invalid.success).toBe(false);
  });

  it('parses and formats BRL currency to integer cents accurately', () => {
    expect(parseBrlToCents('R$ 245,90')).toBe(24590);
    expect(parseBrlToCents('1.450,05')).toBe(145005);
    expect(formatCentsToBrl(24590)).toContain('245,90');
  });

  it('predicts due dates and amounts from historical bill cycles for MANUAL_REQUIRED bills', async () => {
    const { predictDueDateFromHistory } = await import('./supabase.js');

    // Aluguel always due on day 30 of the same reference month (offset 0)
    const rentPrediction = predictDueDateFromHistory({
      targetReferenceMonth: '2026-09',
      historicalCycles: [
        { reference_month: '2026-08', due_date: '2026-08-30', amount_cents: 130000 },
        { reference_month: '2026-07', due_date: '2026-07-30', amount_cents: 130000 },
        { reference_month: '2026-06', due_date: '2026-06-30', amount_cents: 130000 },
      ],
      defaultDueDay: 5,
    });

    expect(rentPrediction.predictedDueDate).toBe('2026-09-30');
    expect(rentPrediction.predictedAmountCents).toBe(130000);
    expect(rentPrediction.confidence).toBe('HIGH');

    // Luz EDP due on day 08 of the NEXT month (offset +1)
    const edpPrediction = predictDueDateFromHistory({
      targetReferenceMonth: '2026-09',
      historicalCycles: [
        { reference_month: '2026-08', due_date: '2026-09-08', amount_cents: 19363 },
        { reference_month: '2026-07', due_date: '2026-08-10', amount_cents: 19391 },
        { reference_month: '2026-06', due_date: '2026-07-08', amount_cents: 26382 },
      ],
      defaultDueDay: 15,
    });

    expect(edpPrediction.predictedDueDate).toBe('2026-10-08');
    expect(edpPrediction.monthOffset).toBe(1);
    expect(edpPrediction.predictedAmountCents).toBe(19363);
  });
});
