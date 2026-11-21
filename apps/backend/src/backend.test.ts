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
});
