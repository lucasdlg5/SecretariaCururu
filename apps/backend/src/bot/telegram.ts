import { Bot, InlineKeyboard, InputFile } from 'grammy';
import {
  type BillCategory,
  type TypedSupabaseClient,
  createSanitizedLogger,
  formatCentsToBrl,
  formatReferenceMonth,
} from '@secretaria/shared';
import type { GoogleDriveService } from '../services/drive.js';
import {
  parseImageReceiptWithGemini,
  parsePdfReceipt,
} from '../services/receipt-parser.js';
import {
  type OpenCycleCandidate,
  evaluateReceiptReconciliation,
  getCurrentAndPreviousReferenceMonths,
} from '../services/reconciliation.js';
import type { GitHubActionsTriggerService } from '../services/github-trigger.js';

const logger = createSanitizedLogger('telegram-bot');

interface PendingFileAttachment {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  extractedAmountCents: number | null;
  createdAt: number;
}

/**
 * In-memory short-lived cache for pending ambiguous receipts / manual invoices
 * awaiting a 1-click InlineKeyboard confirmation from the user.
 */
const pendingAttachmentsCache = new Map<string, PendingFileAttachment>();

function cleanupExpiredAttachments(): void {
  const now = Date.now();
  for (const [key, item] of pendingAttachmentsCache.entries()) {
    if (now - item.createdAt > 15 * 60 * 1000) {
      pendingAttachmentsCache.delete(key);
    }
  }
}

/**
 * Parses `TELEGRAM_ALLOWED_CHAT_IDS` comma-separated string into a Set of normalized string IDs or @usernames (lowercase, without leading @).
 */
export function parseAllowedChatIds(raw?: string): Set<string> {
  const source = raw ?? process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '';
  const ids = source
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  return new Set(ids);
}

/**
 * Checks if a chat ID or username matches the configured `TELEGRAM_ALLOWED_CHAT_IDS` whitelist.
 */
export function isTelegramUserAllowed(
  chatId?: string | number | null,
  username?: string | null,
  rawAllowed?: string
): boolean {
  const allowed = parseAllowedChatIds(rawAllowed);
  if (allowed.size === 0) return false;
  if (chatId !== undefined && chatId !== null && allowed.has(String(chatId).toLowerCase())) {
    return true;
  }
  if (username && allowed.has(username.replace(/^@/, '').toLowerCase())) {
    return true;
  }
  return false;
}

export interface TelegramBotDependencies {
  botToken?: string;
  supabase: TypedSupabaseClient;
  driveService: GoogleDriveService;
  githubTrigger: GitHubActionsTriggerService;
}

export function createTelegramBot(deps: TelegramBotDependencies): Bot {
  const token = deps.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado.');
  }

  const bot = new Bot(token);

  // --------------------------------------------------------------------------
  // 1. Whitelist Middleware (TELEGRAM_ALLOWED_CHAT_IDS: numeric IDs or @usernames)
  // --------------------------------------------------------------------------
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id ? String(ctx.chat.id) : null;
    const username = ctx.from?.username ?? (ctx.chat as { username?: string } | undefined)?.username ?? null;

    if (!isTelegramUserAllowed(chatId, username)) {
      logger.warn({ chatId, username }, 'Acesso bloqueado: Chat ID / Username fora da whitelist do Telegram');
      return;
    }

    await next();
  });

  // --------------------------------------------------------------------------
  // 2. Commands: /status, /pendentes, /rodar <conta>
  // --------------------------------------------------------------------------
  bot.command('status', async (ctx) => {
    const refMonth = formatReferenceMonth();
    const { data: providers } = await deps.supabase
      .from('bill_providers')
      .select('id, name, category, is_active')
      .eq('is_active', true)
      .order('name');

    const { data: cycles } = await deps.supabase
      .from('bill_cycles')
      .select('*')
      .eq('reference_month', refMonth);

    const cycleByProvider = new Map(cycles?.map((c) => [c.provider_id, c]) ?? []);

    const lines: string[] = [`📊 *Status de Contas — ${refMonth}*`, ''];
    for (const p of providers ?? []) {
      const cycle = cycleByProvider.get(p.id);
      const status = cycle?.status ?? 'PENDING';
      const val = formatCentsToBrl(cycle?.amount_cents);
      const emoji =
        status === 'PAID_RECONCILED'
          ? '✅'
          : status === 'PDF_CAPTURED'
            ? '📄'
            : status === 'MANUAL_REQUIRED' || status === 'PROVIDER_DOWN'
              ? '⚠️'
              : '⏳';
      lines.push(`${emoji} *${p.name}* (${p.category}): \`${status}\` — ${val}`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('pendentes', async (ctx) => {
    const [currentMonth, prevMonth] = getCurrentAndPreviousReferenceMonths();
    const { data: cycles } = await deps.supabase
      .from('bill_cycles')
      .select('*, bill_providers(name, category)')
      .in('reference_month', [currentMonth, prevMonth])
      .neq('status', 'PAID_RECONCILED')
      .order('reference_month', { ascending: false });

    if (!cycles || cycles.length === 0) {
      await ctx.reply('🎉 Nenhuma conta pendente nos ciclos atuais!');
      return;
    }

    const lines: string[] = ['⏳ *Contas Pendentes de Pagamento ou Captura:*', ''];
    for (const c of cycles) {
      const prov = (c as unknown as { bill_providers?: { name: string } }).bill_providers;
      const name = prov?.name ?? c.provider_id;
      const amount = formatCentsToBrl(c.amount_cents);
      const due = c.due_date ? ` (Venc: ${c.due_date})` : '';
      lines.push(`• *${name}* [${c.reference_month}]: \`${c.status}\` — ${amount}${due}`);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('rodar', async (ctx) => {
    const query = (ctx.match ?? '').trim();
    const refMonth = formatReferenceMonth();

    let providerId: string | undefined;
    let providerName: string | undefined;

    if (query) {
      const { data: matched } = await deps.supabase
        .from('bill_providers')
        .select('id, name')
        .ilike('name', `%${query}%`)
        .limit(1)
        .maybeSingle();

      if (!matched) {
        await ctx.reply(`❌ Nenhum provedor encontrado para: "${query}".`);
        return;
      }
      providerId = matched.id;
      providerName = matched.name;
    }

    try {
      await deps.githubTrigger.dispatchReconcileWorkflow({
        providerId,
        providerName,
        referenceMonth: refMonth,
        forceRun: true,
      });

      const targetLabel = providerName ? `*${providerName}*` : '*Todas as contas ativas*';
      await ctx.reply(
        `🚀 Execução disparada no GitHub Actions para ${targetLabel} (${refMonth}). Você será notificado aqui assim que finalizar!`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err }, 'Falha ao disparar workflow no GitHub Actions via /rodar');
      await ctx.reply('⚠️ Falha ao acionar o GitHub Actions. Verifique o GITHUB_PAT.');
    }
  });

  // --------------------------------------------------------------------------
  // 3. Text Messages -> HITL CAPTCHA Challenge Response
  // --------------------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const nowIso = new Date().toISOString();
    const { data: challenge } = await deps.supabase
      .from('captcha_challenges')
      .select('*')
      .eq('status', 'PENDING')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!challenge) {
      await ctx.reply(
        '🤖 Envie uma *foto ou PDF de comprovante* para conciliar automaticamente, ou use `/status`, `/pendentes` e `/rodar <conta>`.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await deps.supabase
      .from('captcha_challenges')
      .update({
        status: 'SOLVED',
        solution_text: text,
      })
      .eq('id', challenge.id);

    await ctx.reply(
      `✅ Código CAPTCHA \`${text}\` recebido e enviado para o Worker prosseguir!`,
      { parse_mode: 'Markdown' }
    );
  });

  // --------------------------------------------------------------------------
  // 4. Photo & Document Handler (Receipts & Manual Invoice Upload)
  // --------------------------------------------------------------------------
  bot.on(['message:photo', 'message:document'], async (ctx) => {
    cleanupExpiredAttachments();

    try {
      let fileId: string;
      let mimeType = 'image/jpeg';
      let extension = 'jpg';

      if (ctx.message.photo && ctx.message.photo.length > 0) {
        const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = largestPhoto.file_id;
      } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        mimeType = ctx.message.document.mime_type ?? 'application/pdf';
        extension = mimeType.includes('pdf')
          ? 'pdf'
          : mimeType.includes('png')
            ? 'png'
            : 'jpg';
      } else {
        return;
      }

      const fileInfo = await ctx.api.getFile(fileId);
      if (!fileInfo.file_path) {
        await ctx.reply('❌ Não foi possível obter o arquivo enviado pelo Telegram.');
        return;
      }

      const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Erro HTTP ${response.status} ao baixar arquivo do Telegram`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());

      // Extract value via pdf-parse (if PDF) or Gemini Vision (if Image)
      const extracted = mimeType.includes('pdf')
        ? await parsePdfReceipt(buffer)
        : await parseImageReceiptWithGemini(buffer, mimeType);

      // Query all open bill_cycles in current and previous month
      const [currentMonth, prevMonth] = getCurrentAndPreviousReferenceMonths();
      const { data: rawCycles } = await deps.supabase
        .from('bill_cycles')
        .select('*, bill_providers(name, category)')
        .in('reference_month', [currentMonth, prevMonth])
        .in('status', ['PDF_CAPTURED', 'MANUAL_REQUIRED', 'PENDING']);

      const candidates: OpenCycleCandidate[] = (rawCycles ?? []).map((row) => {
        const prov = (
          row as unknown as {
            bill_providers?: { name: string; category: BillCategory };
          }
        ).bill_providers;
        return {
          ...row,
          provider_name: prov?.name ?? 'Provedor',
          provider_category: prov?.category ?? 'OUTROS',
        };
      });

      const pdfCapturedCycles = candidates.filter((c) => c.status === 'PDF_CAPTURED');
      const evaluation = evaluateReceiptReconciliation(
        extracted.amountCents,
        pdfCapturedCycles
      );

      // Case A: Exact unique match (±R$ 0,05) -> auto-archive and reconcile
      if (evaluation.kind === 'EXACT_UNIQUE_MATCH') {
        const matched = evaluation.matchedCycle;
        const uploaded = await deps.driveService.uploadDocument({
          referenceMonth: matched.reference_month,
          category: matched.provider_category,
          providerName: matched.provider_name,
          kind: 'COMPROVANTE',
          extension,
          mimeType,
          buffer,
        });

        await deps.supabase
          .from('bill_cycles')
          .update({
            status: 'PAID_RECONCILED',
            receipt_drive_file_id: uploaded.fileId,
            receipt_drive_url: uploaded.webViewLink,
            paid_at: new Date().toISOString(),
          })
          .eq('id', matched.id);

        await ctx.reply(
          [
            `✅ *Comprovante Conciliado Automaticamente!*`,
            `• *Conta:* ${matched.provider_name} (${matched.reference_month})`,
            `• *Valor Extraído:* ${formatCentsToBrl(extracted.amountCents)}`,
            `• *Arquivo no Drive:* [${uploaded.fileName}](${uploaded.webViewLink})`,
          ].join('\n'),
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Case B: Ambiguous, divergent value, or manual invoice reminder awaiting selection
      if (candidates.length === 0) {
        await ctx.reply(
          `⚠️ Valor extraído: *${formatCentsToBrl(extracted.amountCents)}*, mas não há nenhuma conta em aberto nos meses ${currentMonth} ou ${prevMonth}.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const cacheId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      pendingAttachmentsCache.set(cacheId, {
        buffer,
        mimeType,
        extension,
        extractedAmountCents: extracted.amountCents,
        createdAt: Date.now(),
      });

      const keyboard = new InlineKeyboard();
      for (const candidate of candidates.slice(0, 8)) {
        const isManualInvoicePending =
          candidate.status === 'MANUAL_REQUIRED' || candidate.status === 'PENDING';
        const actionPrefix = isManualInvoicePending ? 'fatura' : 'comprovante';
        const actionLabel = isManualInvoicePending ? '📄 Salvar Fatura' : '🧾 Conciliar Pago';

        keyboard
          .text(
            `${actionLabel}: ${candidate.provider_name} (${candidate.reference_month} - ${formatCentsToBrl(candidate.amount_cents)})`,
            `reconcile:${actionPrefix}:${cacheId}:${candidate.id}`
          )
          .row();
      }
      keyboard.text('❌ Cancelar', `reconcile:cancel:${cacheId}:none`);

      await ctx.reply(
        [
          `🔎 *Confirmação de Conciliação Necessária*`,
          `• *Valor Identificado:* ${formatCentsToBrl(extracted.amountCents)}`,
          `Selecione abaixo a qual conta este documento pertence:`,
        ].join('\n'),
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );
    } catch (err) {
      logger.error({ err }, 'Erro ao processar arquivo recebido no Telegram');
      await ctx.reply('❌ Ocorreu um erro ao processar seu arquivo. Tente novamente.');
    }
  });

  // --------------------------------------------------------------------------
  // 5. InlineKeyboard Callback Query Handler (1-Click Confirmation)
  // --------------------------------------------------------------------------
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith('reconcile:')) return;

    const [, mode, cacheId, cycleId] = data.split(':');
    if (mode === 'cancel') {
      pendingAttachmentsCache.delete(cacheId);
      await ctx.editMessageText('🚫 Operação de conciliação cancelada.');
      await ctx.answerCallbackQuery();
      return;
    }

    const attachment = pendingAttachmentsCache.get(cacheId);
    if (!attachment) {
      await ctx.answerCallbackQuery({
        text: 'Este anexo expirou. Por favor, reenvie o arquivo.',
        show_alert: true,
      });
      return;
    }

    const { data: cycleRow } = await deps.supabase
      .from('bill_cycles')
      .select('*, bill_providers(name, category)')
      .eq('id', cycleId)
      .maybeSingle();

    if (!cycleRow) {
      await ctx.answerCallbackQuery({
        text: 'Ciclo de fatura não encontrado.',
        show_alert: true,
      });
      return;
    }

    const prov = (
      cycleRow as unknown as {
        bill_providers?: { name: string; category: BillCategory };
      }
    ).bill_providers;
    const providerName = prov?.name ?? 'Provedor';
    const providerCategory = prov?.category ?? 'OUTROS';

    const docKind = mode === 'fatura' ? 'FATURA' : 'COMPROVANTE';
    const uploaded = await deps.driveService.uploadDocument({
      referenceMonth: cycleRow.reference_month,
      category: providerCategory,
      providerName,
      kind: docKind,
      extension: attachment.extension,
      mimeType: attachment.mimeType,
      buffer: attachment.buffer,
    });

    if (docKind === 'FATURA') {
      await deps.supabase
        .from('bill_cycles')
        .update({
          status: 'PDF_CAPTURED',
          amount_cents: attachment.extractedAmountCents ?? cycleRow.amount_cents,
          invoice_drive_file_id: uploaded.fileId,
          invoice_drive_url: uploaded.webViewLink,
        })
        .eq('id', cycleRow.id);
    } else {
      await deps.supabase
        .from('bill_cycles')
        .update({
          status: 'PAID_RECONCILED',
          amount_cents: cycleRow.amount_cents ?? attachment.extractedAmountCents,
          receipt_drive_file_id: uploaded.fileId,
          receipt_drive_url: uploaded.webViewLink,
          paid_at: new Date().toISOString(),
        })
        .eq('id', cycleRow.id);
    }

    pendingAttachmentsCache.delete(cacheId);
    await ctx.answerCallbackQuery({ text: 'Documento arquivado com sucesso!' });
    await ctx.editMessageText(
      [
        `✅ *${docKind === 'FATURA' ? 'Fatura Arquivada' : 'Comprovante Conciliado'} com Sucesso!*`,
        `• *Conta:* ${providerName} (${cycleRow.reference_month})`,
        `• *Valor:* ${formatCentsToBrl(attachment.extractedAmountCents ?? cycleRow.amount_cents)}`,
        `• *Google Drive:* [${uploaded.fileName}](${uploaded.webViewLink})`,
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

  return bot;
}

/**
 * Helper used by the Worker / Backend to send a captured invoice notification
 * with the PDF attached directly to all allowed Telegram chats.
 */
export async function sendCapturedInvoiceNotification(params: {
  bot: Bot;
  providerName: string;
  referenceMonth: string;
  amountCents: number | null;
  dueDate: string | null;
  driveUrl: string;
  pdfBuffer: Buffer;
  fileName: string;
}): Promise<void> {
  const allowedChats = parseAllowedChatIds();
  const caption = [
    `📄 *Nova Fatura Capturada!*`,
    `• *Conta:* ${params.providerName} (${params.referenceMonth})`,
    `• *Valor:* ${formatCentsToBrl(params.amountCents)}`,
    `• *Vencimento:* ${params.dueDate ?? 'Não identificado'}`,
    `• *Google Drive:* [Abrir no Drive](${params.driveUrl})`,
    '',
    `_Envie a foto ou PDF do comprovante aqui no chat após pagar para conciliar automaticamente._`,
  ].join('\n');

  for (const chatId of allowedChats) {
    await params.bot.api.sendDocument(
      chatId,
      new InputFile(params.pdfBuffer, params.fileName),
      {
        caption,
        parse_mode: 'Markdown',
      }
    );
  }
}
