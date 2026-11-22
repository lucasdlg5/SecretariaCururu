import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import {
  type TypedSupabaseClient,
  type WorkflowStep,
  WorkflowStepsArraySchema,
  createSanitizedLogger,
  interpolateSecrets,
  parseBrlToCents,
  sanitizeLogText,
} from '@secretaria/shared';

const logger = createSanitizedLogger('playwright-engine');

export class CaptchaManualRequiredError extends Error {
  public readonly stepReached: string;
  constructor(message: string, stepReached: string) {
    super(message);
    this.name = 'CaptchaManualRequiredError';
    this.stepReached = stepReached;
  }
}

export class InvoiceNotFoundYetError extends Error {
  public readonly stepReached: string;
  constructor(message: string, stepReached: string) {
    super(message);
    this.name = 'InvoiceNotFoundYetError';
    this.stepReached = stepReached;
  }
}

export interface WorkflowExecutionContext {
  page: Page;
  cycleId: string;
  providerName: string;
  portalUrl: string | null;
  decryptedSecrets: Record<string, string>;
  supabase?: TypedSupabaseClient;
  onSendCaptchaImage?: (params: {
    cycleId: string;
    providerName: string;
    imageBuffer: Buffer;
  }) => Promise<void>;
  onSendManualLinkRequired?: (params: {
    cycleId: string;
    providerName: string;
    portalUrl: string | null;
    reason: string;
  }) => Promise<void>;
  captchaPollIntervalMs?: number;
  captchaTimeoutMs?: number;
}

export interface WorkflowExecutionResult {
  pdfBuffer: Buffer | null;
  extractedAmountCents: number | null;
  lastStepReached: string;
}

/**
 * Resolves the first visible locator among `primarySelector` and optional `fallbackSelectors`.
 */
async function resolveResilientLocator(
  page: Page,
  primarySelector: string,
  fallbackSelectors: string[] = [],
  decryptedSecrets: Record<string, string> = {},
  timeoutMs = 10000
) {
  const candidates = [primarySelector, ...fallbackSelectors].map((sel) =>
    interpolateSecrets(sel, decryptedSecrets)
  );
  const perCandidateTimeout = Math.max(2000, Math.floor(timeoutMs / candidates.length));

  for (const candidate of candidates) {
    const locator = page.locator(candidate).first();
    const visible = await locator
      .waitFor({ state: 'visible', timeout: perCandidateTimeout })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      return locator;
    }
  }

  return page.locator(candidates[0]).first();
}

/**
 * Generic Declarative Playwright Workflow Interpreter.
 * Executes JSONB `workflow_steps` validated via Zod without any hardcoded provider logic.
 */
export async function executeDeclarativeWorkflow(
  rawSteps: unknown,
  ctx: WorkflowExecutionContext
): Promise<WorkflowExecutionResult> {
  const steps: WorkflowStep[] = WorkflowStepsArraySchema.parse(rawSteps);
  const secretValues = Object.values(ctx.decryptedSecrets);

  let pdfBuffer: Buffer | null = null;
  let extractedAmountCents: number | null = null;
  let lastStepReached = 'INIT';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    lastStepReached = `STEP_${i + 1}_${step.action}`;

    logger.info(
      {
        provider: ctx.providerName,
        step: lastStepReached,
        description: step.description,
      },
      'Executando passo declarativo do workflow'
    );

    try {
      switch (step.action) {
        case 'goto': {
          await ctx.page.goto(step.url, {
            waitUntil: 'domcontentloaded',
            timeout: step.timeoutMs ?? 30000,
          });
          break;
        }

        case 'fill_secret': {
          const secretValue = ctx.decryptedSecrets[step.secretKey];
          if (!secretValue) {
            throw new Error(
              `Secret '${step.secretKey}' não encontrado em encrypted_secrets do provedor.`
            );
          }
          const locator = await resolveResilientLocator(
            ctx.page,
            step.selector,
            step.fallbackSelectors,
            ctx.decryptedSecrets,
            step.timeoutMs ?? 15000
          );
          await locator.waitFor({ state: 'visible', timeout: step.timeoutMs ?? 15000 });
          await locator.fill(secretValue);
          break;
        }

        case 'click': {
          const locator = await resolveResilientLocator(
            ctx.page,
            step.selector,
            step.fallbackSelectors,
            ctx.decryptedSecrets,
            step.timeoutMs ?? 10000
          );
          const isLocatorVisible = await locator
            .isVisible({ timeout: 3000 })
            .catch(() => false);

          if (isLocatorVisible) {
            await locator.click({ timeout: step.timeoutMs ?? 10000 });
          } else if (step.textFallback) {
            const resolvedText = interpolateSecrets(
              step.textFallback,
              ctx.decryptedSecrets
            );
            const fallbackLocator = ctx.page.getByText(resolvedText).first();
            await fallbackLocator.click({ timeout: step.timeoutMs ?? 10000 });
          } else {
            await locator.click({ timeout: step.timeoutMs ?? 10000 });
          }
          break;
        }

        case 'dismiss_optional_modal': {
          // Never throws if the optional modal is absent
          try {
            const modalButton = await resolveResilientLocator(
              ctx.page,
              step.selector,
              step.fallbackSelectors,
              ctx.decryptedSecrets,
              step.timeoutMs
            );
            const appeared = await modalButton
              .waitFor({ state: 'visible', timeout: step.timeoutMs })
              .then(() => true)
              .catch(() => false);

            if (appeared) {
              await modalButton.click({ timeout: 3000 }).catch(() => undefined);
            }
          } catch {
            // Silently ignore optional modal
          }
          break;
        }

        case 'wait_for': {
          const locator = await resolveResilientLocator(
            ctx.page,
            step.selector,
            step.fallbackSelectors,
            ctx.decryptedSecrets,
            step.timeoutMs
          );
          await locator.waitFor({ state: 'visible', timeout: step.timeoutMs });
          break;
        }

        case 'extract_value': {
          try {
            const locator = await resolveResilientLocator(
              ctx.page,
              step.selector,
              step.fallbackSelectors,
              ctx.decryptedSecrets,
              step.timeoutMs ?? 8000
            );
            const textContent = await locator
              .textContent({ timeout: step.timeoutMs ?? 8000 })
              .catch(() => null);

            if (textContent) {
              const regex = new RegExp(step.regex, 'i');
              const match = textContent.match(regex);
              if (match?.[1]) {
                extractedAmountCents = parseBrlToCents(match[1]);
              }
            }
          } catch {
            // Will fallback to pdf-parse on downloaded PDF
          }
          break;
        }

        case 'captcha_hitl': {
          const imgLocator = ctx.page.locator(step.imageSelector).first();
          const imgVisible = await imgLocator
            .isVisible({ timeout: 5000 })
            .catch(() => false);

          if (!imgVisible || !ctx.supabase) {
            if (ctx.onSendManualLinkRequired) {
              await ctx.onSendManualLinkRequired({
                cycleId: ctx.cycleId,
                providerName: ctx.providerName,
                portalUrl: ctx.portalUrl,
                reason:
                  'Desafio CAPTCHA interativo bloqueante ou imagem não disponível para captura.',
              });
            }
            throw new CaptchaManualRequiredError(
              'CAPTCHA requer intervenção manual pelo link do portal.',
              lastStepReached
            );
          }

          const screenshotBuffer = await imgLocator.screenshot({ type: 'png' });
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

          const { data: challenge, error: challengeErr } = await ctx.supabase
            .from('captcha_challenges')
            .insert({
              cycle_id: ctx.cycleId,
              status: 'PENDING',
              expires_at: expiresAt,
            })
            .select('*')
            .single();

          if (challengeErr || !challenge) {
            throw new CaptchaManualRequiredError(
              'Falha ao criar registro em captcha_challenges.',
              lastStepReached
            );
          }

          await ctx.supabase
            .from('bill_cycles')
            .update({ status: 'WAITING_CAPTCHA' })
            .eq('id', ctx.cycleId);

          if (ctx.onSendCaptchaImage) {
            await ctx.onSendCaptchaImage({
              cycleId: ctx.cycleId,
              providerName: ctx.providerName,
              imageBuffer: screenshotBuffer,
            });
          }

          // Poll Supabase for up to 5 minutes waiting for user reply via Telegram
          const pollInterval = ctx.captchaPollIntervalMs ?? 4000;
          const maxWait = ctx.captchaTimeoutMs ?? 5 * 60 * 1000;
          const deadline = Date.now() + maxWait;
          let solvedText: string | null = null;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, pollInterval));
            const { data: polled } = await ctx.supabase
              .from('captcha_challenges')
              .select('status, solution_text')
              .eq('id', challenge.id)
              .maybeSingle();

            if (polled?.status === 'SOLVED' && polled.solution_text) {
              solvedText = polled.solution_text;
              break;
            }
          }

          if (!solvedText) {
            await ctx.supabase
              .from('captcha_challenges')
              .update({ status: 'EXPIRED' })
              .eq('id', challenge.id);

            if (ctx.onSendManualLinkRequired) {
              await ctx.onSendManualLinkRequired({
                cycleId: ctx.cycleId,
                providerName: ctx.providerName,
                portalUrl: ctx.portalUrl,
                reason: 'Tempo limite (5 minutos) expirado aguardando resposta do CAPTCHA.',
              });
            }

            throw new CaptchaManualRequiredError(
              'Timeout aguardando resposta de CAPTCHA HITL no Telegram.',
              lastStepReached
            );
          }

          const inputLocator = ctx.page.locator(step.inputSelector).first();
          await inputLocator.fill(solvedText);
          break;
        }

        case 'download_pdf': {
          const trigger = await resolveResilientLocator(
            ctx.page,
            step.triggerSelector,
            step.fallbackSelectors,
            ctx.decryptedSecrets,
            step.timeoutMs ?? 10000
          );
          const triggerVisible = await trigger
            .isVisible({ timeout: 6000 })
            .catch(() => false);

          if (!triggerVisible) {
            throw new InvoiceNotFoundYetError(
              'Botão de download da fatura ainda não disponível para o ciclo atual.',
              lastStepReached
            );
          }

          let interceptedPdfBuffer: Buffer | null = null;
          const responseHandler = async (response: {
            headers: () => Record<string, string>;
            body: () => Promise<Buffer>;
          }) => {
            try {
              const contentType = response.headers()['content-type'] ?? '';
              if (contentType.includes('application/pdf')) {
                interceptedPdfBuffer = await response.body();
              }
            } catch {
              // Ignore body read error on non-PDF responses
            }
          };

          const browserContext = ctx.page.context();
          browserContext.on('response', responseHandler);

          try {
            const downloadPromise = ctx.page
              .waitForEvent('download', { timeout: step.timeoutMs ?? 20000 })
              .catch(() => null);
            const popupPromise = browserContext
              .waitForEvent('page', { timeout: step.timeoutMs ?? 15000 })
              .catch(() => null);

            await trigger.click({ timeout: 10000 });
            const [download, popupPage] = await Promise.all([
              downloadPromise,
              popupPromise,
            ]);

            if (download) {
              const filePath = await download.path();
              if (filePath) {
                pdfBuffer = await readFile(filePath);
              }
            } else if (interceptedPdfBuffer) {
              pdfBuffer = interceptedPdfBuffer;
            } else if (popupPage) {
              await popupPage.waitForLoadState('domcontentloaded').catch(() => undefined);
              const popupUrl = popupPage.url();
              if (popupUrl && popupUrl.startsWith('http')) {
                const apiResp = await browserContext.request.get(popupUrl);
                if (apiResp.ok()) {
                  pdfBuffer = await apiResp.body();
                }
              }
              await popupPage.close().catch(() => undefined);
            }
          } finally {
            browserContext.off('response', responseHandler);
          }

          if (!pdfBuffer) {
            throw new Error(
              'Não foi possível capturar o arquivo PDF após acionar download_pdf.'
            );
          }
          break;
        }
      }
    } catch (err) {
      if (
        err instanceof CaptchaManualRequiredError ||
        err instanceof InvoiceNotFoundYetError
      ) {
        throw err;
      }

      const rawMessage = err instanceof Error ? err.message : String(err);
      const sanitizedMsg = sanitizeLogText(rawMessage, secretValues);
      const wrapped = new Error(`[${lastStepReached}] ${sanitizedMsg}`);
      (wrapped as Error & { stepReached?: string }).stepReached = lastStepReached;
      throw wrapped;
    }
  }

  return {
    pdfBuffer,
    extractedAmountCents,
    lastStepReached,
  };
}
