import {
  createSanitizedLogger,
  createServiceSupabaseClient,
} from '@secretaria/shared';
import {
  BUCKET_RECONCILE_INTERVAL_MS,
  GoogleDriveService,
} from './services/drive.js';
import { GitHubActionsTriggerService } from './services/github-trigger.js';
import { createTelegramBot } from './bot/telegram.js';
import { buildFastifyServer } from './server.js';

const logger = createSanitizedLogger('backend-main');

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  const supabase = createServiceSupabaseClient();
  const githubTrigger = new GitHubActionsTriggerService();
  const driveService = new GoogleDriveService({ supabaseClient: supabase });

  let telegramBot;
  if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = createTelegramBot({
      supabase,
      driveService,
      githubTrigger,
    });
  } else {
    logger.warn(
      'TELEGRAM_BOT_TOKEN ausente: iniciando API sem instância ativa do bot.'
    );
  }

  const server = await buildFastifyServer({
    supabase,
    githubTrigger,
    driveService,
    telegramBot,
  });

  await server.listen({ port, host });
  logger.info({ port, host }, 'Servidor Fastify SecretariaCururu iniciado com sucesso');

  // Schedule periodic 6-hour Supabase Bucket -> Google Drive reconciliation
  const reconcileTimer = setInterval(() => {
    driveService
      .reconcileBucketToGoogleDrive()
      .then((summary) => {
        if (summary.checkedItems > 0) {
          logger.info(
            {
              checkedItems: summary.checkedItems,
              migratedCount: summary.migratedCount,
              removedFromBucketCount: summary.removedFromBucketCount,
              failedCount: summary.failedCount,
            },
            'Ciclo automático (6h) de conciliação Supabase Bucket -> Google Drive executado.'
          );
        }
      })
      .catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Erro no ciclo automático (6h) de conciliação Supabase Bucket -> Google Drive.'
        );
      });
  }, BUCKET_RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    logger.fatal({ err }, 'Falha crítica ao iniciar o servidor Backend');
    process.exit(1);
  });
}

export * from './server.js';
export * from './services/drive.js';
export * from './services/receipt-parser.js';
export * from './services/reconciliation.js';
export * from './services/github-trigger.js';
export * from './bot/telegram.js';
