import { describe, expect, it } from 'vitest';
import { CreateProviderInputSchema, PROVIDER_TEMPLATES } from '@secretaria/shared';
import {
  DEMO_ALL_CYCLES,
  DEMO_CYCLES,
  DEMO_EXECUTION_LOGS,
  DEMO_PROVIDERS,
} from './lib/supabase.js';

describe('Frontend Dashboard & Wizard State Integrity', () => {
  it('loads all 7 real providers mapped from Contas Mensais (EDP, NJCI, Comgás, Água SAAE, Condomínio, Aluguel, IPTU & Lixo)', () => {
    expect(DEMO_PROVIDERS.length).toBe(7);
    const names = DEMO_PROVIDERS.map((p) => p.name);
    expect(names).toContain('Luz - EDP');
    expect(names).toContain('Internet - NJCI');
    expect(names).toContain('Gás - Comgás');
    expect(names).toContain('Água - SAAE Jacareí');
    expect(names).toContain('Condomínio Residencial');
    expect(names).toContain('Aluguel Mensal');
    expect(names).toContain('IPTU & Taxa de Lixo');
  });

  it('ensures all demo execution logs are properly sanitized without plaintext secrets', () => {
    for (const log of DEMO_EXECUTION_LOGS) {
      expect(log.sanitized_message).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
    }
    expect(DEMO_CYCLES.length).toBeGreaterThan(0);
  });

  it('validates custom wizard provider creation payload with Zod schema', () => {
    const edpPreset = PROVIDER_TEMPLATES.find((t) => t.id === 'edp-luz')!;
    const result = CreateProviderInputSchema.safeParse({
      name: 'Luz - EDP Casa 2',
      category: 'LUZ',
      mode: 'WEB_AUTOMATION',
      is_active: true,
      trigger_day: 7,
      due_day_default: 15,
      portal_url: edpPreset.portal_url,
      workflow_steps: edpPreset.workflow_steps,
      plain_secrets: {
        EMAIL: 'teste@exemplo.com',
        PASSWORD: '123',
      },
    });
    expect(result.success).toBe(true);
  });

  it('filters individual bills by month and computes accurate monthly totals for the Total do Mês card', () => {
    const julyCycles = DEMO_ALL_CYCLES.filter((c) => c.reference_month === '2026-07');
    expect(julyCycles.length).toBe(7);
    const julyTotalCents = julyCycles.reduce((acc, c) => acc + (c.amount_cents ?? 0), 0);
    // Julho/2026: EDP (19391) + Comgás (1509) + Água (7942) + NJCI (13490) + Aluguel (130000) + Condomínio (22566) + IPTU/Lixo (13656) = 208554 cents (R$ 2.085,54)
    expect(julyTotalCents).toBe(208554);

    const augustCycles = DEMO_ALL_CYCLES.filter((c) => c.reference_month === '2026-08');
    expect(augustCycles.length).toBe(7);
    const augustTotalCents = augustCycles.reduce(
      (acc, c) => acc + (c.amount_cents ?? 0),
      0
    );
    // Agosto/2026: EDP (19363) + Comgás (4788) + Água (7942) + NJCI (13490) + Aluguel (130000) + Condomínio (22566) + IPTU (9292) = 207441 cents (R$ 2.074,41)
    expect(augustTotalCents).toBe(207441);
  });
});
