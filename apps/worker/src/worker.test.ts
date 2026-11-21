import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  CaptchaManualRequiredError,
  executeDeclarativeWorkflow,
} from './engine.js';
import {
  INTRA_EXECUTION_BACKOFF_MS,
  runWithExponentialBackoff,
} from './reconcile.js';

describe('Declarative Playwright Workflow Engine', () => {
  it('executes goto, fill_secret, dismiss_optional_modal, click, extract_value, and download_pdf', async () => {
    const gotoMock = vi.fn().mockResolvedValue(undefined);
    const fillMock = vi.fn().mockResolvedValue(undefined);
    const clickMock = vi.fn().mockResolvedValue(undefined);
    const waitForMock = vi.fn().mockResolvedValue(undefined);

    const fakePage = {
      goto: gotoMock,
      locator: vi.fn().mockImplementation((selector: string) => ({
        first: () => ({
          waitFor: waitForMock,
          fill: fillMock,
          click: clickMock,
          isVisible: vi.fn().mockResolvedValue(true),
          textContent: vi
            .fn()
            .mockResolvedValue(
              selector.includes('valor') ? 'Total: R$ 278,40' : 'Botão'
            ),
        }),
      })),
      on: vi.fn().mockImplementation((event: string, cb: (res: unknown) => void) => {
        if (event === 'response') {
          cb({
            headers: () => ({ 'content-type': 'application/pdf' }),
            body: async () => Buffer.from('%PDF-1.4 fake-edp-invoice'),
          });
        }
      }),
      off: vi.fn(),
      waitForEvent: vi.fn().mockResolvedValue(null),
    } as unknown as Page;

    const steps = [
      { action: 'goto', url: 'https://www.edponline.com.br/para-sua-casa/login' },
      { action: 'fill_secret', selector: '#email', secretKey: 'EMAIL' },
      {
        action: 'dismiss_optional_modal',
        selector: 'button:has-text("Agora não")',
        timeoutMs: 1000,
      },
      {
        action: 'click',
        selector: '[data-uc]',
        textFallback: '{{secret:UC_NUMBER}}',
      },
      {
        action: 'extract_value',
        selector: '.valor-fatura',
        regex: 'R\\$\\s*([\\d\\.,]+)',
      },
      { action: 'download_pdf', triggerSelector: 'button:has-text("Baixar")' },
    ];

    const result = await executeDeclarativeWorkflow(steps, {
      page: fakePage,
      cycleId: 'cycle-1',
      providerName: 'Luz - EDP',
      portalUrl: 'https://www.edponline.com.br',
      decryptedSecrets: {
        EMAIL: 'cliente@edp.com.br',
        UC_NUMBER: '99887766',
      },
    });

    expect(gotoMock).toHaveBeenCalledWith(
      'https://www.edponline.com.br/para-sua-casa/login',
      expect.any(Object)
    );
    expect(fillMock).toHaveBeenCalledWith('cliente@edp.com.br');
    expect(result.extractedAmountCents).toBe(27840);
    expect(result.pdfBuffer?.toString()).toContain('%PDF-1.4 fake-edp-invoice');
  });

  it('escalates captcha_hitl to CaptchaManualRequiredError and notifies Telegram when interactive or unavailable', async () => {
    const manualCallback = vi.fn().mockResolvedValue(undefined);
    const fakePage = {
      locator: vi.fn().mockReturnValue({
        first: () => ({
          isVisible: vi.fn().mockResolvedValue(false),
        }),
      }),
    } as unknown as Page;

    const steps = [
      {
        action: 'captcha_hitl',
        imageSelector: '#captcha-img',
        inputSelector: '#captcha-input',
        mode: 'IMAGE_OR_MANUAL_LINK',
      },
    ];

    await expect(
      executeDeclarativeWorkflow(steps, {
        page: fakePage,
        cycleId: 'cycle-njci',
        providerName: 'Internet - NJCI',
        portalUrl: 'https://portal.njci.com.br/auth/login',
        decryptedSecrets: { CPF: '12345678901' },
        onSendManualLinkRequired: manualCallback,
      })
    ).rejects.toThrow(CaptchaManualRequiredError);

    expect(manualCallback).toHaveBeenCalledOnce();
  });
});

describe('Resilience & Exponential Backoff (15s, 45s, 120s)', () => {
  it('defines exact 15s, 45s, and 120s backoff intervals', () => {
    expect(INTRA_EXECUTION_BACKOFF_MS).toEqual([15_000, 45_000, 120_000]);
  });

  it('retries transient timeout failures and succeeds on subsequent attempt', async () => {
    const recordedSleeps: number[] = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Navigation timeout of 30000ms exceeded'))
      .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'))
      .mockResolvedValueOnce('SUCCESS_ON_3RD_TRY');

    const res = await runWithExponentialBackoff(
      fn,
      INTRA_EXECUTION_BACKOFF_MS,
      async (ms) => {
        recordedSleeps.push(ms);
      }
    );

    expect(res).toBe('SUCCESS_ON_3RD_TRY');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(recordedSleeps).toEqual([15_000, 45_000]);
  });
});
