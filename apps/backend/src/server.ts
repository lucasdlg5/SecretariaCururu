import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import {
  CreateProviderInputSchema,
  type TypedSupabaseClient,
  createSanitizedLogger,
  encryptSecretsMap,
  formatReferenceMonth,
  redactObject,
} from '@secretaria/shared';
import type { GitHubActionsTriggerService } from './services/github-trigger.js';

const logger = createSanitizedLogger('fastify-server');

export interface ServerDependencies {
  supabase: TypedSupabaseClient;
  githubTrigger: GitHubActionsTriggerService;
  telegramBot?: Bot;
  webhookSecret?: string;
}

export async function buildFastifyServer(
  deps: ServerDependencies
): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // --------------------------------------------------------------------------
  // 1. Healthcheck Endpoint (Render Free Tier keep-alive / readiness check)
  // --------------------------------------------------------------------------
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'secretaria-cururu-backend',
      timestamp: new Date().toISOString(),
    };
  });

  // --------------------------------------------------------------------------
  // 2. Telegram Webhook Endpoint protected by X-Telegram-Bot-Api-Secret-Token
  // --------------------------------------------------------------------------
  const expectedSecret =
    deps.webhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

  if (deps.telegramBot) {
    const handleUpdate = webhookCallback(deps.telegramBot, 'fastify');

    app.post('/webhooks/telegram', async (request, reply) => {
      const headerToken = request.headers['x-telegram-bot-api-secret-token'];
      if (!expectedSecret || headerToken !== expectedSecret) {
        logger.warn('Tentativa de acesso ao webhook Telegram com secret token inválido');
        return reply.status(401).send({ error: 'Unauthorized Telegram Webhook Secret' });
      }

      return handleUpdate(request, reply);
    });
  } else {
    app.post('/webhooks/telegram', async (request, reply) => {
      const headerToken = request.headers['x-telegram-bot-api-secret-token'];
      if (!expectedSecret || headerToken !== expectedSecret) {
        return reply.status(401).send({ error: 'Unauthorized Telegram Webhook Secret' });
      }
      return reply.status(200).send({ ok: true });
    });
  }

  // --------------------------------------------------------------------------
  // 2.5. Dashboard API: Get Live State (Providers, Cycles, Execution Logs)
  // --------------------------------------------------------------------------
  app.get<{ Querystring: { reference_month?: string } }>(
    '/api/dashboard/state',
    async (request, reply) => {
      const refMonth = request.query.reference_month ?? formatReferenceMonth();

      const [providersRes, cyclesRes, logsRes] = await Promise.all([
        deps.supabase
          .from('bill_providers')
          .select(
            'id, name, category, mode, is_active, trigger_day, due_day_default, portal_url, max_retry_days, workflow_steps, fallback_workflow_steps, created_at, updated_at'
          )
          .order('name'),
        deps.supabase
          .from('bill_cycles')
          .select('*')
          .eq('reference_month', refMonth),
        deps.supabase
          .from('execution_logs')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(50),
      ]);

      return reply.status(200).send({
        providers: (providersRes.data ?? []).map((p) => ({
          ...p,
          encrypted_secrets: {},
        })),
        cycles: cyclesRes.data ?? [],
        logs: logsRes.data ?? [],
      });
    }
  );

  // --------------------------------------------------------------------------
  // 3. Dashboard API: Create / Update Bill Provider (Encrypts Secrets with AES-256-GCM)
  // --------------------------------------------------------------------------
  app.post('/api/providers', async (request, reply) => {
    const parsed = CreateProviderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: parsed.error.issues,
      });
    }

    const input = parsed.data;
    const encryptedSecrets = input.plain_secrets
      ? encryptSecretsMap(input.plain_secrets)
      : {};

    const { data, error } = await deps.supabase
      .from('bill_providers')
      .insert({
        name: input.name,
        category: input.category,
        mode: input.mode,
        is_active: input.is_active,
        trigger_day: input.trigger_day,
        due_day_default: input.due_day_default,
        portal_url: input.portal_url ?? null,
        max_retry_days: input.max_retry_days,
        workflow_steps: input.workflow_steps,
        fallback_workflow_steps: input.fallback_workflow_steps,
        encrypted_secrets: encryptedSecrets,
      })
      .select(
        'id, name, category, mode, is_active, trigger_day, due_day_default, portal_url, max_retry_days, workflow_steps, fallback_workflow_steps, created_at'
      )
      .single();

    if (error) {
      logger.error({ err: redactObject(error) }, 'Erro ao salvar provedor no Supabase');
      return reply.status(500).send({ error: 'Falha ao cadastrar provedor' });
    }

    return reply.status(201).send({ provider: data });
  });

  // --------------------------------------------------------------------------
  // 4. Dashboard API: Trigger GitHub Actions Worker ("Executar Agora")
  // --------------------------------------------------------------------------
  app.post<{
    Body: { provider_id?: string; provider_name?: string; reference_month?: string };
  }>('/api/workflows/trigger', async (request, reply) => {
    const body = request.body ?? {};
    const referenceMonth = body.reference_month ?? formatReferenceMonth();

    try {
      const result = await deps.githubTrigger.dispatchReconcileWorkflow({
        providerId: body.provider_id,
        providerName: body.provider_name,
        referenceMonth,
        forceRun: true,
      });

      return reply.status(202).send({
        message: 'Workflow acionado com sucesso no GitHub Actions',
        ...result,
      });
    } catch (err) {
      logger.error({ err: redactObject(err) }, 'Erro ao acionar GitHub Actions');
      return reply.status(500).send({
        error: 'Não foi possível acionar o workflow no GitHub Actions.',
      });
    }
  });

  return app;
}
