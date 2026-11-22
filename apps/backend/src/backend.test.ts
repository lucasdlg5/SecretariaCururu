import { describe, expect, it, vi } from 'vitest';
import {
  buildDriveFolderHierarchy,
  buildStandardDriveFileName,
  GoogleDriveService,
} from './services/drive.js';
import {
  extractAmountCentsFromText,
  extractDateFromText,
} from './services/receipt-parser.js';
import {
  type OpenCycleCandidate,
  evaluateReceiptReconciliation,
} from './services/reconciliation.js';
import { buildFastifyServer } from './server.js';
import {
  checkAndRecordBotInteraction,
  INACTIVITY_THRESHOLD_MS,
  setLastBotInteractionAt,
} from './bot/telegram.js';
import type { TypedSupabaseClient } from '@secretaria/shared';
import type { GitHubActionsTriggerService } from './services/github-trigger.js';

describe('Google Drive Folder Layout & Standard File Naming', () => {
  it('generates standardized file names {YYYY-MM}_{CATEGORIA}_{NOME_PROVEDOR}_{TIPO}.{ext}', () => {
    const fileName = buildStandardDriveFileName({
      referenceMonth: '2026-11',
      category: 'LUZ',
      providerName: 'Luz - EDP São Paulo',
      kind: 'FATURA',
      extension: '.PDF',
    });

    expect(fileName).toBe('2026-11_LUZ_LUZ_EDP_SAO_PAULO_FATURA.pdf');
  });

  it('builds BY_MONTH (default) and BY_TYPE folder hierarchies accurately', () => {
    const byMonth = buildDriveFolderHierarchy({
      referenceMonth: '2026-11',
      category: 'GAS',
      kind: 'COMPROVANTE',
      layout: 'BY_MONTH',
    });
    expect(byMonth).toEqual(['2026', '2026-11', 'Comprovantes']);

    const byType = buildDriveFolderHierarchy({
      referenceMonth: '2026-11',
      category: 'INTERNET',
      kind: 'FATURA',
      layout: 'BY_TYPE',
    });
    expect(byType).toEqual(['INTERNET', '2026-11', 'Faturas']);
  });

  it('creates folders idempotently using Google Drive API client mock', async () => {
    const listMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-2026' }] } })
      .mockResolvedValueOnce({ data: { files: [] } })
      .mockResolvedValueOnce({ data: { files: [] } });

    const createMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: 'folder-2026-11' } })
      .mockResolvedValueOnce({ data: { id: 'folder-faturas' } })
      .mockResolvedValueOnce({
        data: {
          id: 'file-123',
          webViewLink: 'https://drive.google.com/file/d/file-123/view',
        },
      });

    const driveService = new GoogleDriveService({
      rootFolderId: 'root-contas-casa',
      driveClient: {
        files: {
          list: listMock,
          create: createMock,
        },
      } as unknown as NonNullable<
        ConstructorParameters<typeof GoogleDriveService>[0]
      >['driveClient'],
    });

    const uploaded = await driveService.uploadDocument(
      {
        referenceMonth: '2026-11',
        category: 'LUZ',
        providerName: 'Luz - EDP',
        kind: 'FATURA',
        extension: 'pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 dummy'),
      },
      'BY_MONTH'
    );

    expect(uploaded.fileId).toBe('file-123');
    expect(uploaded.fileName).toBe('2026-11_LUZ_LUZ_EDP_FATURA.pdf');
    expect(uploaded.folderPath).toEqual(['2026', '2026-11', 'Faturas']);
    expect(uploaded.storageProvider).toBe('GOOGLE_DRIVE');
  });

  it('automatically recognizes existing #N-Mês/YYYY folders in Contas Mensais and uses Google Drive as primary', async () => {
    const {
      buildContasMensaisMonthFolderName,
      matchesContasMensaisFolderName,
    } = await import('./services/drive.js');

    expect(buildContasMensaisMonthFolderName('2026-04')).toBe('#1-Abril/2026');
    expect(buildContasMensaisMonthFolderName('2026-11')).toBe('#8-Novembro/2026');
    expect(matchesContasMensaisFolderName('#8-Novembro/2026', '2026-11')).toBe(true);
    expect(matchesContasMensaisFolderName('#10Janeiro-/2027', '2027-01')).toBe(true);
    expect(matchesContasMensaisFolderName('#12-Março/2027', '2027-03')).toBe(true);

    const listMock = vi
      .fn()
      // 1st call: list root children -> finds #8-Novembro/2026
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'folder-out-2026', name: '#7-Outubro/2026' },
            { id: 'folder-nov-2026', name: '#8-Novembro/2026' },
          ],
        },
      })
      // 2nd call: list children of #8-Novembro/2026 -> finds existing "Contas"
      .mockResolvedValueOnce({
        data: {
          files: [{ id: 'folder-nov-contas', name: 'Contas' }],
        },
      });

    const createMock = vi.fn().mockResolvedValueOnce({
      data: {
        id: 'drive-file-nov-1',
        webViewLink: 'https://drive.google.com/file/d/drive-file-nov-1/view',
      },
    });

    const supabaseUploadMock = vi.fn();

    const driveService = new GoogleDriveService({
      rootFolderId: '1Xe9NditnlI8eLQl-kMZgPVoCUlvgVZ73',
      driveClient: {
        files: {
          list: listMock,
          create: createMock,
        },
      } as unknown as NonNullable<
        ConstructorParameters<typeof GoogleDriveService>[0]
      >['driveClient'],
      supabaseClient: {
        storage: {
          from: () => ({
            upload: supabaseUploadMock,
          }),
        },
      } as unknown as TypedSupabaseClient,
    });

    const uploaded = await driveService.uploadDocument({
      referenceMonth: '2026-11',
      category: 'LUZ',
      providerName: 'Luz - EDP',
      kind: 'FATURA',
      extension: 'pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 nov'),
    });

    expect(uploaded.storageProvider).toBe('GOOGLE_DRIVE');
    expect(uploaded.fileId).toBe('drive-file-nov-1');
    expect(uploaded.folderPath).toEqual(['#8-Novembro/2026', 'Contas']);
    // Supabase Storage MUST NOT be called when primary Google Drive succeeds
    expect(supabaseUploadMock).not.toHaveBeenCalled();
  });

  it('falls back to Supabase Storage ONLY when primary Google Drive throws an error', async () => {
    const listMock = vi
      .fn()
      .mockRejectedValue(new Error('Google Drive API quota or permission error'));
    const createMock = vi
      .fn()
      .mockRejectedValue(new Error('Google Drive API quota or permission error'));

    const supabaseUploadMock = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrlMock = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://supabase.co/storage/v1/object/public/CururuBucket/doc.pdf' },
    });

    const driveService = new GoogleDriveService({
      rootFolderId: '1Xe9NditnlI8eLQl-kMZgPVoCUlvgVZ73',
      driveClient: {
        files: {
          list: listMock,
          create: createMock,
        },
      } as unknown as NonNullable<
        ConstructorParameters<typeof GoogleDriveService>[0]
      >['driveClient'],
      supabaseClient: {
        storage: {
          from: () => ({
            upload: supabaseUploadMock,
            getPublicUrl: getPublicUrlMock,
          }),
        },
      } as unknown as TypedSupabaseClient,
    });

    const uploaded = await driveService.uploadDocument(
      {
        referenceMonth: '2026-11',
        category: 'LUZ',
        providerName: 'Luz - EDP',
        kind: 'FATURA',
        extension: 'pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 fallback'),
      },
      'CONTAS_MENSAIS'
    );

    expect(uploaded.storageProvider).toBe('SUPABASE_STORAGE');
    expect(uploaded.folderPath).toEqual(['#8-Novembro/2026', 'Contas']);
    expect(supabaseUploadMock).toHaveBeenCalledOnce();
  });

  it('reconciles Supabase Bucket files to Google Drive every 6h, removes migrated files from the bucket, and logs all attempts in execution_logs', async () => {
    const auditLogsInserted: Array<Record<string, unknown>> = [];
    const cycleUpdates: Array<Record<string, unknown>> = [];
    const bucketRemovedPaths: string[][] = [];

    const listMock = vi
      .fn()
      // 1st file (EDP): succeeds on Google Drive
      .mockResolvedValueOnce({
        data: { files: [{ id: 'folder-nov-2026', name: '#8-Novembro/2026' }] },
      })
      .mockResolvedValueOnce({
        data: { files: [{ id: 'folder-nov-contas', name: 'Contas' }] },
      })
      // 2nd file (Comgás): fails on Google Drive
      .mockRejectedValueOnce(new Error('Google Drive temporary 503 error'))
      .mockRejectedValueOnce(new Error('Google Drive temporary 503 error'));

    const createMock = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'drive-migrated-edp-123',
          webViewLink: 'https://drive.google.com/file/d/drive-migrated-edp-123/view',
        },
      })
      .mockRejectedValueOnce(new Error('Google Drive temporary 503 error'));

    const downloadMock = vi.fn().mockResolvedValue({
      data: new Blob([Buffer.from('%PDF-1.4 stored-in-bucket')]),
      error: null,
    });

    const removeMock = vi.fn().mockImplementation(async (paths: string[]) => {
      bucketRemovedPaths.push(paths);
      return { data: paths, error: null };
    });

    const fakeCyclesInBucket = [
      {
        id: 'cycle-edp-nov',
        provider_id: 'prov-edp',
        reference_month: '2026-11',
        status: 'PDF_CAPTURED',
        invoice_drive_file_id:
          '#8-Novembro/2026/Contas/2026-11_LUZ_LUZ_EDP_FATURA.pdf',
        invoice_drive_url:
          'https://supabase.co/storage/v1/object/public/CururuBucket/%238-Novembro/2026/Contas/2026-11_LUZ_LUZ_EDP_FATURA.pdf',
        receipt_drive_file_id: null,
        receipt_drive_url: null,
        bill_providers: {
          id: 'prov-edp',
          name: 'Luz - EDP',
          category: 'LUZ',
        },
      },
      {
        id: 'cycle-comgas-nov',
        provider_id: 'prov-comgas',
        reference_month: '2026-11',
        status: 'PDF_CAPTURED',
        invoice_drive_file_id:
          '#8-Novembro/2026/Contas/2026-11_GAS_GAS_COMGAS_FATURA.pdf',
        invoice_drive_url:
          'https://supabase.co/storage/v1/object/public/CururuBucket/%238-Novembro/2026/Contas/2026-11_GAS_GAS_COMGAS_FATURA.pdf',
        receipt_drive_file_id: null,
        receipt_drive_url: null,
        bill_providers: {
          id: 'prov-comgas',
          name: 'Gás - Comgás',
          category: 'GAS',
        },
      },
    ];

    const supabaseMock = {
      storage: {
        from: () => ({
          download: downloadMock,
          remove: removeMock,
        }),
      },
      from: (table: string) => {
        if (table === 'bill_cycles') {
          return {
            select: () => ({
              order: () => Promise.resolve({ data: fakeCyclesInBucket, error: null }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: (col: string, val: string) => {
                cycleUpdates.push({ col, val, payload });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === 'execution_logs') {
          return {
            insert: (row: Record<string, unknown>) => {
              auditLogsInserted.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        return {};
      },
    } as unknown as TypedSupabaseClient;

    const driveService = new GoogleDriveService({
      rootFolderId: '1Xe9NditnlI8eLQl-kMZgPVoCUlvgVZ73',
      driveClient: {
        files: {
          list: listMock,
          create: createMock,
        },
      } as unknown as NonNullable<
        ConstructorParameters<typeof GoogleDriveService>[0]
      >['driveClient'],
      supabaseClient: supabaseMock,
    });

    const summary = await driveService.reconcileBucketToGoogleDrive();

    expect(summary.checkedItems).toBe(2);
    expect(summary.migratedCount).toBe(1);
    expect(summary.removedFromBucketCount).toBe(1);
    expect(summary.failedCount).toBe(1);

    // 1. EDP migrated to Google Drive and was removed from Supabase Bucket
    expect(cycleUpdates).toHaveLength(1);
    expect(cycleUpdates[0]).toEqual({
      col: 'id',
      val: 'cycle-edp-nov',
      payload: {
        invoice_drive_file_id: 'drive-migrated-edp-123',
        invoice_drive_url: 'https://drive.google.com/file/d/drive-migrated-edp-123/view',
      },
    });
    expect(bucketRemovedPaths).toEqual([
      ['#8-Novembro/2026/Contas/2026-11_LUZ_LUZ_EDP_FATURA.pdf'],
    ]);

    // 2. Both attempts (1 success + 1 failure) were recorded in execution_logs for audit
    expect(auditLogsInserted).toHaveLength(2);
    expect(auditLogsInserted[0].status).toBe('DRIVE_SYNC_SUCCESS');
    expect(auditLogsInserted[0].step_reached).toBe('BUCKET_TO_DRIVE_RECONCILE');
    expect(String(auditLogsInserted[0].sanitized_message)).toContain(
      'removido do Supabase Bucket'
    );

    expect(auditLogsInserted[1].status).toBe('DRIVE_SYNC_RETRY_FAILED');
    expect(auditLogsInserted[1].step_reached).toBe('BUCKET_TO_DRIVE_RECONCILE');
    expect(String(auditLogsInserted[1].sanitized_message)).toContain(
      'Arquivo mantido no Supabase Bucket'
    );
  });
});

describe('Receipt Text Extraction & Reconciliation Tolerance (±R$ 0,05)', () => {
  const sampleCandidates: OpenCycleCandidate[] = [
    {
      id: 'cycle-edp',
      provider_id: 'prov-edp',
      provider_name: 'Luz - EDP',
      provider_category: 'LUZ',
      reference_month: '2026-11',
      status: 'PDF_CAPTURED',
      amount_cents: 18450, // R$ 184,50
      due_date: '2026-11-15',
      barcode_hash: null,
      invoice_drive_file_id: 'f1',
      invoice_drive_url: 'https://drive/f1',
      receipt_drive_file_id: null,
      receipt_drive_url: null,
      attempt_count: 1,
      last_attempt_at: null,
      paid_at: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'cycle-comgas',
      provider_id: 'prov-comgas',
      provider_name: 'Gás - Comgás',
      provider_category: 'GAS',
      reference_month: '2026-11',
      status: 'PDF_CAPTURED',
      amount_cents: 9230, // R$ 92,30
      due_date: '2026-11-22',
      barcode_hash: null,
      invoice_drive_file_id: 'f2',
      invoice_drive_url: 'https://drive/f2',
      receipt_drive_file_id: null,
      receipt_drive_url: null,
      attempt_count: 1,
      last_attempt_at: null,
      paid_at: null,
      created_at: '',
      updated_at: '',
    },
  ];

  it('extracts BRL amount in cents and date from receipt text', () => {
    const sampleReceipt =
      'COMPROVANTE DE PAGAMENTO PIX\nData: 15/11/2026\nValor Pago: R$ 184,53\nRecebedor: EDP SAO PAULO';
    expect(extractAmountCentsFromText(sampleReceipt)).toBe(18453);
    expect(extractDateFromText(sampleReceipt)).toBe('2026-11-15');
  });

  it('matches uniquely when difference is within ±5 cents (R$ 0,05)', () => {
    const res = evaluateReceiptReconciliation(18454, sampleCandidates);
    expect(res.kind).toBe('EXACT_UNIQUE_MATCH');
    if (res.kind === 'EXACT_UNIQUE_MATCH') {
      expect(res.matchedCycle.id).toBe('cycle-edp');
      expect(res.diffCents).toBe(4);
    }
  });

  it('flags AMBIGUOUS_OR_DIVERGENT when value diverges by more than R$ 0,05 (interest/discount)', () => {
    const res = evaluateReceiptReconciliation(18990, sampleCandidates);
    expect(res.kind).toBe('AMBIGUOUS_OR_DIVERGENT');
    if (res.kind === 'AMBIGUOUS_OR_DIVERGENT') {
      expect(res.reason).toBe('VALUE_DIVERGENCE');
      // Sorted by closest value first
      expect(res.candidates[0].id).toBe('cycle-edp');
    }
  });
});

describe('Fastify Webhook Security (X-Telegram-Bot-Api-Secret-Token)', () => {
  it('rejects requests without valid X-Telegram-Bot-Api-Secret-Token header', async () => {
    const server = await buildFastifyServer({
      supabase: {} as TypedSupabaseClient,
      githubTrigger: {} as GitHubActionsTriggerService,
      webhookSecret: 'super_secret_webhook_token',
    });

    const unauthorizedResponse = await server.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      payload: { update_id: 1 },
    });
    expect(unauthorizedResponse.statusCode).toBe(401);

    const authorizedResponse = await server.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: {
        'x-telegram-bot-api-secret-token': 'super_secret_webhook_token',
      },
      payload: { update_id: 1 },
    });
    expect(authorizedResponse.statusCode).toBe(200);
  });

  it('triggers dashboard link after 1 hour of bot inactivity', () => {
    setLastBotInteractionAt(null);
    const t0 = 1_000_000_000;

    // First interaction after cold start -> sends dashboard link
    expect(checkAndRecordBotInteraction(t0)).toBe(true);

    // Interaction 30 minutes later -> does NOT send dashboard link
    expect(checkAndRecordBotInteraction(t0 + 30 * 60 * 1000)).toBe(false);

    // Interaction 1 hour after the 30-min interaction -> sends dashboard link again
    expect(
      checkAndRecordBotInteraction(t0 + 30 * 60 * 1000 + INACTIVITY_THRESHOLD_MS)
    ).toBe(true);
  });

  it('normalizes sendable Telegram chat IDs prioritizing numeric IDs and preserving @ prefix for usernames', async () => {
    const { getSendableTelegramChatIds } = await import('./bot/telegram.js');
    expect(getSendableTelegramChatIds('123456789, @lucasdlg5')).toEqual(['123456789']);
    expect(getSendableTelegramChatIds('lucasdlg5')).toEqual(['@lucasdlg5']);
  });

  it('builds the two inactivity messages: (1) bot capabilities and (2) due dates of analyzed unpaid bills', async () => {
    const {
      buildBotCapabilitiesWelcomeMessage,
      buildUnpaidAnalyzedBillsMessage,
    } = await import('./bot/telegram.js');

    const msg1 = buildBotCapabilitiesWelcomeMessage('https://painel.exemplo.com');
    expect(msg1).toContain('Aqui está o que eu posso fazer por você');
    expect(msg1).toContain('/status');
    expect(msg1).toContain('/pendentes');
    expect(msg1).toContain('/rodar <conta>');
    expect(msg1).toContain('https://painel.exemplo.com');

    const msg2 = buildUnpaidAnalyzedBillsMessage([
      {
        providerName: 'Gás - Comgás',
        referenceMonth: '2026-11',
        status: 'PDF_CAPTURED',
        amountCents: 8740,
        dueDate: '2026-11-22',
        invoiceDriveUrl: 'https://drive.google.com/file/d/comgas/view',
      },
      {
        providerName: 'Luz - EDP',
        referenceMonth: '2026-11',
        status: 'PDF_CAPTURED',
        amountCents: 24890,
        dueDate: '2026-11-15',
        invoiceDriveUrl: 'https://drive.google.com/file/d/edp/view',
      },
    ]);

    expect(msg2).toContain('Datas de Vencimento — Contas Analisadas e Não Pagas');
    // Ordered chronologically by due date (15/11/2026 before 22/11/2026)
    expect(msg2.indexOf('15/11/2026')).toBeLessThan(msg2.indexOf('22/11/2026'));
    expect(msg2).toContain('Luz - EDP');
    expect(msg2).toContain('248,90');
    expect(msg2).toContain('Gás - Comgás');
    expect(msg2).toContain('87,40');
  });
});
