import { chromium, type Browser } from 'playwright';
import { Bot, InputFile } from 'grammy';
import {
  type BillCycleRow,
  type BillProviderRow,
  type TypedSupabaseClient,
  createSanitizedLogger,
  createServiceSupabaseClient,
  decryptSecretsMap,
  formatReferenceMonth,
  sanitizeLogText,
} from '@secretaria/shared';
import {
  GoogleDriveService,
  getSendableTelegramChatIds,
  sendCapturedInvoiceNotification,
} from '@secretaria/backend';
import {
  CaptchaManualRequiredError,
  InvoiceNotFoundYetError,
  executeDeclarativeWorkflow,
} from './engine.js';
import { extractMetadataFromInvoicePdf } from './pdf-extractor.js';

const logger = createSanitizedLogger('worker-reconcile');

/**
 * Exponential backoff delays for transient network/timeout failures within an execution:
 * 3 retries: 15s, 45s, 120s
 */
export const INTRA_EXECUTION_BACKOFF_MS = [15_000, 45_000, 120_000] as const;

export function isTransientError(err: unknown): boolean {
  if (
    err instanceof CaptchaManualRequiredError ||
    err instanceof InvoiceNotFoundYetError
  ) {
    return false;
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Non-transient login or broken selector indicator
  if (
    msg.includes('credenciais inválidas') ||
    msg.includes('senha incorreta') ||
    msg.includes('secret')
  ) {
    return false;
  }

  return (
    msg.includes('timeout') ||
    msg.includes('net::') ||
    msg.includes('navigation') ||
    msg.includes('econnreset') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

/**
 * Runs an async operation with up to 3 intra-execution retries (15s, 45s, 120s)
 * on transient network/timeout errors.
 */
export async function runWithExponentialBackoff<T>(
  fn: (attemptIndex: number) => Promise<T>,
  backoffDelaysMs: readonly number[] = INTRA_EXECUTION_BACKOFF_MS,
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffDelaysMs.length; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === backoffDelaysMs.length) {
        throw err;
      }

      const delayMs = backoffDelaysMs[attempt];
      logger.warn(
        {
          attempt: attempt + 1,
          nextRetryInSeconds: delayMs / 1000,
          error: err instanceof Error ? err.message : String(err),
        },
        'Falha transitória detectada; aguardando backoff exponencial antes de tentar novamente'
      );
      await sleepFn(delayMs);
    }
  }

  throw lastError;
}

async function notifyTelegramChats(bot: Bot | null, markdownText: string): Promise<void> {
  if (!bot) return;
  const chats = getSendableTelegramChatIds();
  for (const chatId of chats) {
    try {
      await bot.api.sendMessage(chatId, markdownText, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.warn(
        { chatId, err: err instanceof Error ? err.message : String(err) },
        'Falha não-fatal ao enviar mensagem no Telegram (configure o Chat ID numérico em TELEGRAM_ALLOWED_CHAT_IDS).'
      );
    }
  }
}

export interface ReconcileProviderOptions {
  supabase: TypedSupabaseClient;
  driveService: GoogleDriveService;
  bot: Bot | null;
  browser: Browser;
  provider: BillProviderRow;
  referenceMonth: string;
  backoffDelaysMs?: readonly number[];
}

/**
 * Reconciles a single bill provider for a given referenceMonth.
 */
export async function reconcileSingleProvider(
  opts: ReconcileProviderOptions
): Promise<void> {
  const { supabase, driveService, bot, browser, provider, referenceMonth } = opts;
  const startedAt = new Date().toISOString();

  // 1. Ensure or fetch bill_cycle record
  const { data: existingCycle } = await supabase
    .from('bill_cycles')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('reference_month', referenceMonth)
    .maybeSingle();

  if (
    existingCycle &&
    (existingCycle.status === 'PDF_CAPTURED' ||
      existingCycle.status === 'PAID_RECONCILED')
  ) {
    logger.info(
      { provider: provider.name, referenceMonth, status: existingCycle.status },
      'Ciclo já capturado ou pago; pulando execução.'
    );
    return;
  }

  let cycle: BillCycleRow;
  if (!existingCycle) {
    const dueDayStr = String(provider.due_day_default).padStart(2, '0');
    const { data: inserted, error: insertErr } = await supabase
      .from('bill_cycles')
      .insert({
        provider_id: provider.id,
        reference_month: referenceMonth,
        status: 'RUNNING',
        due_date: `${referenceMonth}-${dueDayStr}`,
        attempt_count: 1,
        last_attempt_at: startedAt,
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      throw new Error(`Falha ao criar ciclo para ${provider.name}`);
    }
    cycle = inserted;
  } else {
    const { data: updated, error: updateErr } = await supabase
      .from('bill_cycles')
      .update({
        status: 'RUNNING',
        attempt_count: existingCycle.attempt_count + 1,
        last_attempt_at: startedAt,
      })
      .eq('id', existingCycle.id)
      .select('*')
      .single();

    if (updateErr || !updated) {
      throw new Error(`Falha ao atualizar ciclo para ${provider.name}`);
    }
    cycle = updated;
  }

  // 2. Handle MANUAL_REMINDER mode (Condomínio, Aluguel)
  if (provider.mode === 'MANUAL_REMINDER') {
    await supabase
      .from('bill_cycles')
      .update({ status: 'MANUAL_REQUIRED' })
      .eq('id', cycle.id);

    await notifyTelegramChats(
      bot,
      [
        `🔔 *Lembrete Mensal de Conta Manual*`,
        `• *Conta:* ${provider.name} (${referenceMonth})`,
        `• *Vencimento Padrão:* Dia ${provider.due_day_default}`,
        '',
        `Por favor, envie o PDF ou foto do boleto aqui no chat para arquivar na pasta \`Faturas\` e registrar o ciclo como \`PDF_CAPTURED\`.`,
      ].join('\n')
    );

    await supabase.from('execution_logs').insert({
      cycle_id: cycle.id,
      provider_id: provider.id,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'MANUAL_REMINDER_SENT',
      step_reached: 'MANUAL_REMINDER',
      sanitized_message: 'Lembrete manual enviado via Telegram com sucesso.',
    });
    return;
  }

  // 3. Decrypt secrets in memory only
  const decryptedSecrets = decryptSecretsMap(provider.encrypted_secrets ?? {});
  const secretValues = Object.values(decryptedSecrets);

  try {
    const result = await runWithExponentialBackoff(
      async () => {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        try {
          return await executeDeclarativeWorkflow(provider.workflow_steps, {
            page,
            cycleId: cycle.id,
            providerName: provider.name,
            portalUrl: provider.portal_url,
            decryptedSecrets,
            supabase,
            onSendCaptchaImage: async ({ providerName, imageBuffer }) => {
              if (!bot) return;
              const chats = getSendableTelegramChatIds();
              for (const chatId of chats) {
                try {
                  await bot.api.sendPhoto(
                    chatId,
                    new InputFile(imageBuffer, 'captcha.png'),
                    {
                      caption: `🧩 *Desafio CAPTCHA — ${providerName}*\nResponda esta mensagem com o texto da imagem em até 5 minutos.`,
                      parse_mode: 'Markdown',
                    }
                  );
                } catch (err) {
                  logger.warn(
                    { chatId, err: err instanceof Error ? err.message : String(err) },
                    'Falha não-fatal ao enviar foto de CAPTCHA no Telegram.'
                  );
                }
              }
            },
            onSendManualLinkRequired: async ({ providerName, portalUrl, reason }) => {
              await notifyTelegramChats(
                bot,
                [
                  `⚠️ *Ação Manual Necessária — ${providerName}*`,
                  `• *Motivo:* ${reason}`,
                  portalUrl ? `• *Link Direto do Portal:* [Acessar Portal](${portalUrl})` : '',
                  '',
                  `Baixe o PDF manualmente e encaminhe aqui no chat do bot.`,
                ]
                  .filter(Boolean)
                  .join('\n')
              );
            },
          });
        } finally {
          await context.close();
        }
      },
      opts.backoffDelaysMs ?? INTRA_EXECUTION_BACKOFF_MS
    );

    if (!result.pdfBuffer) {
      throw new InvoiceNotFoundYetError(
        'Workflow concluído sem buffer PDF capturado.',
        result.lastStepReached
      );
    }

    // Extract fallback metadata from downloaded PDF via pdf-parse
    const pdfMeta = await extractMetadataFromInvoicePdf(result.pdfBuffer);
    const finalAmountCents = result.extractedAmountCents ?? pdfMeta.amountCents;
    const finalDueDate = pdfMeta.dueDate ?? cycle.due_date;

    const uploaded = await driveService.uploadDocument({
      referenceMonth,
      category: provider.category,
      providerName: provider.name,
      kind: 'FATURA',
      extension: 'pdf',
      mimeType: 'application/pdf',
      buffer: result.pdfBuffer,
    });

    await supabase
      .from('bill_cycles')
      .update({
        status: 'PDF_CAPTURED',
        amount_cents: finalAmountCents,
        due_date: finalDueDate,
        barcode_hash: pdfMeta.barcodeHash,
        invoice_drive_file_id: uploaded.fileId,
        invoice_drive_url: uploaded.webViewLink,
      })
      .eq('id', cycle.id);

    await supabase.from('execution_logs').insert({
      cycle_id: cycle.id,
      provider_id: provider.id,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: 'SUCCESS',
      step_reached: result.lastStepReached,
      sanitized_message: `Fatura capturada e salva no Drive (${uploaded.fileName}).`,
    });

    if (bot) {
      await sendCapturedInvoiceNotification({
        bot,
        providerName: provider.name,
        referenceMonth,
        amountCents: finalAmountCents,
        dueDate: finalDueDate,
        driveUrl: uploaded.webViewLink,
        pdfBuffer: result.pdfBuffer,
        fileName: uploaded.fileName,
      });
    }
  } catch (err) {
    const finishedAt = new Date().toISOString();

    // Case 1: Invoice not emitted yet on the portal -> silent NOT_FOUND_YET
    if (err instanceof InvoiceNotFoundYetError) {
      logger.info(
        { provider: provider.name, referenceMonth, step: err.stepReached },
        'Fatura ainda não emitida no portal (NOT_FOUND_YET). Nova tentativa amanhã.'
      );

      await supabase
        .from('bill_cycles')
        .update({ status: 'NOT_FOUND_YET' })
        .eq('id', cycle.id);

      await supabase.from('execution_logs').insert({
        cycle_id: cycle.id,
        provider_id: provider.id,
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'NOT_FOUND_YET',
        step_reached: err.stepReached,
        sanitized_message: sanitizeLogText(err.message, secretValues),
      });
      return;
    }

    // Case 2: CAPTCHA HITL timed out or interactive challenge -> MANUAL_REQUIRED
    if (err instanceof CaptchaManualRequiredError) {
      await supabase
        .from('bill_cycles')
        .update({ status: 'MANUAL_REQUIRED' })
        .eq('id', cycle.id);

      await supabase.from('execution_logs').insert({
        cycle_id: cycle.id,
        provider_id: provider.id,
        started_at: startedAt,
        finished_at: finishedAt,
        status: 'MANUAL_REQUIRED',
        step_reached: err.stepReached,
        sanitized_message: sanitizeLogText(err.message, secretValues),
        error_code: 'CAPTCHA_MANUAL_REQUIRED',
      });
      return;
    }

    // Case 3: Broken selector, login failure, or >= max_retry_days consecutive failures
    const rawMsg = err instanceof Error ? err.message : String(err);
    const sanitizedMsg = sanitizeLogText(rawMsg, secretValues);
    const stepReached =
      (err as { stepReached?: string }).stepReached ?? 'UNKNOWN_STEP';

    const shouldEscalate =
      cycle.attempt_count >= provider.max_retry_days || !isTransientError(err);

    const nextStatus = shouldEscalate ? 'MANUAL_REQUIRED' : 'PROVIDER_DOWN';

    await supabase
      .from('bill_cycles')
      .update({ status: nextStatus })
      .eq('id', cycle.id);

    await supabase.from('execution_logs').insert({
      cycle_id: cycle.id,
      provider_id: provider.id,
      started_at: startedAt,
      finished_at: finishedAt,
      status: 'FAILED',
      step_reached: stepReached,
      sanitized_message: sanitizedMsg,
      error_code: shouldEscalate ? 'ESCALATED_MANUAL_REQUIRED' : 'TRANSIENT_FAILURE',
    });

    if (shouldEscalate) {
      await notifyTelegramChats(
        bot,
        [
          `🚨 *Alerta de Falha na Captura Automática*`,
          `• *Conta:* ${provider.name} (${referenceMonth})`,
          `• *Tentativas Consecutivas:* ${cycle.attempt_count}/${provider.max_retry_days}`,
          `• *Passo Onde Falhou:* \`${stepReached}\``,
          `• *Diagnóstico Sanitizado:* \`${sanitizedMsg}\``,
          provider.portal_url
            ? `• *Link do Portal:* [Acessar Portal](${provider.portal_url})`
            : '',
          '',
          `💡 *Sugestão:* Acesse o link acima, baixe o PDF da fatura e envie diretamente aqui no chat do bot.`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
  }
}

/**
 * Main entrypoint for GitHub Actions daily cron & workflow_dispatch.
 */
export async function runDailyReconciliation(): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const driveService = new GoogleDriveService({ supabaseClient: supabase });
  const bot = process.env.TELEGRAM_BOT_TOKEN
    ? new Bot(process.env.TELEGRAM_BOT_TOKEN)
    : null;

  const targetProviderId = process.env.INPUT_PROVIDER_ID?.trim();
  const targetProviderName = process.env.INPUT_PROVIDER_NAME?.trim();
  const referenceMonth =
    process.env.INPUT_REFERENCE_MONTH?.trim() || formatReferenceMonth();
  const forceRun = process.env.INPUT_FORCE_RUN === 'true';
  const currentDay = new Date().getUTCDate();

  let query = supabase
    .from('bill_providers')
    .select('*')
    .eq('is_active', true);

  if (targetProviderId) {
    query = query.eq('id', targetProviderId);
  } else if (targetProviderName) {
    query = query.ilike('name', `%${targetProviderName}%`);
  } else if (!forceRun) {
    query = query.lte('trigger_day', currentDay);
  }

  const { data: providers, error } = await query;
  if (error) {
    throw new Error(`Erro ao buscar provedores ativos no Supabase: ${error.message}`);
  }

  if (!providers || providers.length === 0) {
    logger.info('Nenhum provedor elegível para execução hoje.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const provider of providers) {
      await reconcileSingleProvider({
        supabase,
        driveService,
        bot,
        browser,
        provider,
        referenceMonth,
      });
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyReconciliation().catch((err) => {
    logger.fatal({ err }, 'Erro fatal no worker de reconciliação');
    process.exit(1);
  });
}
