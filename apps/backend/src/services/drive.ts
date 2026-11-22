import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import {
  type BillCategory,
  type DriveFolderLayout,
  type TypedSupabaseClient,
  DriveFolderLayoutSchema,
  createSanitizedLogger,
  sanitizeLogText,
} from '@secretaria/shared';

const logger = createSanitizedLogger('drive-service');

/**
 * Interval for periodic Supabase Storage Bucket -> Google Drive reconciliation:
 * Every 6 hours (21,600,000 ms).
 */
export const BUCKET_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type DocumentKind = 'FATURA' | 'COMPROVANTE';

export interface UploadDocumentParams {
  referenceMonth: string; // YYYY-MM
  category: BillCategory;
  providerName: string;
  kind: DocumentKind;
  extension: string; // 'pdf' | 'jpg' | 'png'
  mimeType: string;
  buffer: Buffer;
  cycleId?: string | null;
  providerId?: string | null;
}

export interface UploadedDriveFile {
  fileId: string;
  webViewLink: string;
  fileName: string;
  folderPath: string[];
  storageProvider?: 'GOOGLE_DRIVE' | 'SUPABASE_STORAGE';
}

export interface BucketToDriveReconcileItemResult {
  cycleId: string;
  providerId: string;
  providerName: string;
  referenceMonth: string;
  kind: DocumentKind;
  storagePath: string;
  status: 'MIGRATED_AND_REMOVED' | 'RETRY_FAILED';
  driveFileId?: string;
  driveWebViewLink?: string;
  removedFromBucket: boolean;
  errorMessage?: string;
}

export interface BucketToDriveReconcileSummary {
  checkedItems: number;
  migratedCount: number;
  failedCount: number;
  removedFromBucketCount: number;
  results: BucketToDriveReconcileItemResult[];
  ranAt: string;
}

const PT_BR_MONTH_NAMES: Record<string, string> = {
  '01': 'Janeiro',
  '02': 'Fevereiro',
  '03': 'Março',
  '04': 'Abril',
  '05': 'Maio',
  '06': 'Junho',
  '07': 'Julho',
  '08': 'Agosto',
  '09': 'Setembro',
  '10': 'Outubro',
  '11': 'Novembro',
  '12': 'Dezembro',
};

/**
 * Strips accents and normalizes a string to lowercase alphanumeric for fuzzy folder matching.
 * e.g., "#12-Março/2027" -> "12marco2027"
 */
export function normalizePtBrText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Normalizes provider name for standardized filenames:
 * e.g., "Luz - EDP" -> "LUZ_EDP"
 */
export function sanitizeFileNameSegment(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Builds the standardized filename:
 * `{YYYY-MM}_{CATEGORIA}_{NOME_PROVEDOR}_{TIPO}.{ext}`
 */
export function buildStandardDriveFileName(params: {
  referenceMonth: string;
  category: BillCategory;
  providerName: string;
  kind: DocumentKind;
  extension: string;
}): string {
  const cleanProvider = sanitizeFileNameSegment(params.providerName);
  const cleanExt = params.extension.replace(/^\./, '').toLowerCase();
  return `${params.referenceMonth}_${params.category}_${cleanProvider}_${params.kind}.${cleanExt}`;
}

/**
 * Computes the standard `#N-Mês/YYYY` folder name for the "Contas Mensais" pattern
 * where `#1-Abril/2026` is index 1 (2026-04).
 */
export function buildContasMensaisMonthFolderName(referenceMonth: string): string {
  const [yearStr, monthStr] = referenceMonth.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const monthName = PT_BR_MONTH_NAMES[monthStr] ?? monthStr;

  // In "Contas Mensais", #1 is Abril/2026 (2026-04)
  const indexFromApril2026 = (year - 2026) * 12 + (month - 4) + 1;
  if (indexFromApril2026 >= 1) {
    return `#${indexFromApril2026}-${monthName}/${year}`;
  }
  return `${monthName}/${year}`;
}

/**
 * Checks if an existing Google Drive folder name matches a target `referenceMonth` (`YYYY-MM`)
 * in the "Contas Mensais" naming convention (e.g., `#8-Novembro/2026`, `#10Janeiro-/2027`, `#12-Março/2027`).
 */
export function matchesContasMensaisFolderName(
  folderName: string,
  referenceMonth: string
): boolean {
  const [yearStr, monthStr] = referenceMonth.split('-');
  const monthName = PT_BR_MONTH_NAMES[monthStr];
  if (!monthName) return false;

  const normFolder = normalizePtBrText(folderName);
  const normMonth = normalizePtBrText(monthName);

  return normFolder.includes(normMonth) && normFolder.includes(yearStr);
}

/**
 * Computes the folder hierarchy relative to Root Folder ("Contas_Casa" or "Contas Mensais")
 * based on DRIVE_FOLDER_LAYOUT:
 * - CONTAS_MENSAIS: ["#N-Mês/YYYY", "Contas" | "Comprovantes"]
 * - BY_MONTH (default): [YYYY, YYYY-MM, "Faturas" | "Comprovantes"]
 * - BY_TYPE: [CATEGORIA, YYYY-MM, "Faturas" | "Comprovantes"]
 */
export function buildDriveFolderHierarchy(params: {
  referenceMonth: string;
  category: BillCategory;
  kind: DocumentKind;
  layout?: DriveFolderLayout;
}): string[] {
  const layout =
    params.layout ??
    DriveFolderLayoutSchema.catch('BY_MONTH').parse(process.env.DRIVE_FOLDER_LAYOUT);

  if (layout === 'CONTAS_MENSAIS') {
    const monthFolder = buildContasMensaisMonthFolderName(params.referenceMonth);
    const subFolder = params.kind === 'FATURA' ? 'Contas' : 'Comprovantes';
    return [monthFolder, subFolder];
  }

  const year = params.referenceMonth.slice(0, 4);
  const subFolder = params.kind === 'FATURA' ? 'Faturas' : 'Comprovantes';

  if (layout === 'BY_TYPE') {
    return [params.category, params.referenceMonth, subFolder];
  }

  return [year, params.referenceMonth, subFolder];
}

export class GoogleDriveService {
  private drive?: drive_v3.Drive;
  private rootFolderId: string;
  private supabase?: TypedSupabaseClient;
  private supabaseBucket: string;
  private folderCache = new Map<string, string>();

  constructor(options?: {
    driveClient?: drive_v3.Drive;
    rootFolderId?: string;
    serviceAccountJson?: string;
    supabaseClient?: TypedSupabaseClient;
    supabaseBucket?: string;
  }) {
    this.rootFolderId =
      options?.rootFolderId ??
      process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ??
      '1Xe9NditnlI8eLQl-kMZgPVoCUlvgVZ73';
    this.supabase = options?.supabaseClient;
    this.supabaseBucket =
      options?.supabaseBucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? 'CururuBucket';

    if (options?.driveClient) {
      this.drive = options.driveClient;
      return;
    }

    const rawJson =
      options?.serviceAccountJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
    if (!rawJson || rawJson.includes('"..."')) {
      if (this.supabase) {
        logger.warn(
          'GOOGLE_SERVICE_ACCOUNT_JSON ausente ou placeholder: operando com fallback secundário no Supabase Storage.'
        );
        return;
      }
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado.');
    }

    const decodedJson = rawJson.trim().startsWith('{')
      ? rawJson
      : Buffer.from(rawJson, 'base64').toString('utf8');

    const credentials = JSON.parse(decodedJson) as {
      client_email: string;
      private_key: string;
    };

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  /**
   * Lists all direct child folders of `parentId` to detect existing patterns
   * such as `#8-Novembro/2026`, `Comprovantes `, `Contas`, etc.
   */
  private async listChildFolders(
    parentId: string
  ): Promise<Array<{ id: string; name: string }>> {
    if (!this.drive) return [];
    const query = [
      `'${parentId}' in parents`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`,
    ].join(' and ');

    const res = await this.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (res.data.files ?? []).filter(
      (f): f is { id: string; name: string } => Boolean(f.id && f.name)
    );
  }

  /**
   * Automatically resolves an existing month folder in "Contas Mensais"
   * (e.g., `#8-Novembro/2026`, `#10Janeiro-/2027`) or subfolder (`Contas`, `Comprovantes ` with trailing space)
   * if present inside `parentId`.
   */
  async resolveExistingContasMensaisPath(
    referenceMonth: string,
    kind: DocumentKind
  ): Promise<{ folderId: string; folderPath: string[] } | null> {
    if (!this.drive || !this.rootFolderId) return null;

    const rootChildren = await this.listChildFolders(this.rootFolderId);
    if (rootChildren.length === 0) return null;

    // Detect if root folder uses the `#N-Mês/YYYY` pattern
    const hasContasMensaisPattern = rootChildren.some((f) =>
      /^#\d+/.test(f.name.trim())
    );
    const matchingMonthFolder = rootChildren.find((f) =>
      matchesContasMensaisFolderName(f.name, referenceMonth)
    );

    if (!hasContasMensaisPattern && !matchingMonthFolder) {
      return null;
    }

    let monthFolderId: string;
    let monthFolderName: string;

    if (matchingMonthFolder) {
      monthFolderId = matchingMonthFolder.id;
      monthFolderName = matchingMonthFolder.name;
    } else {
      monthFolderName = buildContasMensaisMonthFolderName(referenceMonth);
      monthFolderId = await this.ensureFolder(monthFolderName, this.rootFolderId);
    }

    // Check existing subfolders inside the month folder (e.g., "Contas", "Faturas", "Comprovantes", "Comprovantes ", "Recibo Contas")
    const subFolders = await this.listChildFolders(monthFolderId);
    const desiredCandidates =
      kind === 'FATURA'
        ? ['contas', 'faturas']
        : ['comprovantes', 'recibo contas', 'recibos casa'];

    const matchedSub = subFolders.find((sf) =>
      desiredCandidates.includes(normalizePtBrText(sf.name.trim()))
    );

    if (matchedSub) {
      return {
        folderId: matchedSub.id,
        folderPath: [monthFolderName, matchedSub.name.trim()],
      };
    }

    const defaultSubName = kind === 'FATURA' ? 'Contas' : 'Comprovantes';
    const createdSubId = await this.ensureFolder(defaultSubName, monthFolderId);
    return {
      folderId: createdSubId,
      folderPath: [monthFolderName, defaultSubName],
    };
  }

  /**
   * Idempotently finds or creates a subfolder inside `parentId`.
   */
  async ensureFolder(name: string, parentId: string): Promise<string> {
    if (!this.drive) {
      throw new Error('Cliente Google Drive não inicializado.');
    }
    const cacheKey = `${parentId}/${name.trim()}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached) return cached;

    const escapedName = name.replace(/'/g, "\\'");
    const query = [
      `name = '${escapedName}'`,
      `'${parentId}' in parents`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`,
    ].join(' and ');

    const existing = await this.drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const foundId = existing.data.files?.[0]?.id;
    if (foundId) {
      this.folderCache.set(cacheKey, foundId);
      return foundId;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    const newId = created.data.id;
    if (!newId) {
      throw new Error(`Falha ao criar pasta '${name}' no Google Drive.`);
    }

    this.folderCache.set(cacheKey, newId);
    return newId;
  }

  /**
   * Resolves a full folder path array idempotently starting from rootFolderId.
   */
  async ensureFolderPath(segments: string[]): Promise<string> {
    if (!this.rootFolderId) {
      throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID não configurado.');
    }

    let currentParentId = this.rootFolderId;
    for (const segment of segments) {
      currentParentId = await this.ensureFolder(segment, currentParentId);
    }
    return currentParentId;
  }

  /**
   * Determines whether a stored file reference points to the temporary Supabase Storage fallback bucket
   * rather than a permanent Google Drive file ID.
   */
  static isStoredInSupabaseBucket(
    fileId?: string | null,
    url?: string | null,
    bucketName: string = 'CururuBucket'
  ): boolean {
    if (!fileId && !url) return false;
    if (
      url &&
      (url.includes('/storage/v1/') ||
        url.includes('supabase.co/storage') ||
        url.includes(`/${bucketName}/`))
    ) {
      return true;
    }
    if (fileId && fileId.includes('/')) {
      return true;
    }
    return false;
  }

  /**
   * Extracts the internal object path inside the Supabase Storage bucket from `fileId` or `url`.
   */
  static extractSupabaseStoragePath(
    fileId?: string | null,
    url?: string | null,
    bucketName: string = 'CururuBucket'
  ): string | null {
    if (fileId && fileId.includes('/')) {
      return fileId;
    }
    if (url) {
      const marker = `/${bucketName}/`;
      const idx = url.indexOf(marker);
      if (idx !== -1) {
        return decodeURIComponent(url.slice(idx + marker.length));
      }
    }
    return fileId ?? null;
  }

  /**
   * Infers file extension and MIME type from a storage path or filename.
   */
  static inferExtensionAndMimeType(storagePath: string): {
    extension: string;
    mimeType: string;
  } {
    const ext = (storagePath.split('.').pop() ?? 'pdf').toLowerCase();
    if (ext === 'png') {
      return { extension: 'png', mimeType: 'image/png' };
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    }
    return { extension: 'pdf', mimeType: 'application/pdf' };
  }

  /**
   * Records a storage fallback or Bucket -> Google Drive reconciliation attempt
   * in the `execution_logs` database table for full auditability.
   */
  private async recordStorageAuditLog(params: {
    cycleId?: string | null;
    providerId?: string | null;
    providerName?: string;
    status: string;
    stepReached: string;
    sanitizedMessage: string;
    errorCode?: string | null;
    startedAt?: string;
  }): Promise<void> {
    if (
      !this.supabase ||
      typeof (this.supabase as { from?: unknown }).from !== 'function'
    ) {
      return;
    }

    try {
      let resolvedProviderId = params.providerId ?? null;

      if (!resolvedProviderId && params.cycleId) {
        const { data: cycleRow } = await this.supabase
          .from('bill_cycles')
          .select('provider_id')
          .eq('id', params.cycleId)
          .maybeSingle();
        resolvedProviderId = cycleRow?.provider_id ?? null;
      }

      if (!resolvedProviderId && params.providerName) {
        const { data: provRow } = await this.supabase
          .from('bill_providers')
          .select('id')
          .ilike('name', `%${params.providerName}%`)
          .limit(1)
          .maybeSingle();
        resolvedProviderId = provRow?.id ?? null;
      }

      if (!resolvedProviderId) {
        const { data: firstProv } = await this.supabase
          .from('bill_providers')
          .select('id')
          .limit(1)
          .maybeSingle();
        resolvedProviderId = firstProv?.id ?? null;
      }

      if (!resolvedProviderId) return;

      const nowIso = new Date().toISOString();
      await this.supabase.from('execution_logs').insert({
        cycle_id: params.cycleId ?? null,
        provider_id: resolvedProviderId,
        started_at: params.startedAt ?? nowIso,
        finished_at: nowIso,
        status: params.status,
        step_reached: params.stepReached,
        sanitized_message: sanitizeLogText(params.sanitizedMessage),
        error_code: params.errorCode ?? null,
      });
    } catch (logErr) {
      logger.warn(
        { err: logErr instanceof Error ? logErr.message : String(logErr) },
        'Falha não-fatal ao gravar log de auditoria de storage no Supabase.'
      );
    }
  }

  /**
   * Uploads an invoice or receipt to the Supabase Storage secondary fallback bucket (`CururuBucket`).
   */
  async uploadToSupabaseStorage(
    params: UploadDocumentParams,
    folderPath: string[],
    fileName: string
  ): Promise<UploadedDriveFile> {
    if (!this.supabase) {
      throw new Error('Cliente Supabase não configurado para upload no Storage.');
    }

    const storagePath = [...folderPath, fileName].join('/');
    const { error } = await this.supabase.storage
      .from(this.supabaseBucket)
      .upload(storagePath, params.buffer, {
        contentType: params.mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(
        `Falha ao enviar para Supabase Storage (${this.supabaseBucket}): ${error.message}`
      );
    }

    const { data: publicUrlData } = this.supabase.storage
      .from(this.supabaseBucket)
      .getPublicUrl(storagePath);

    return {
      fileId: storagePath,
      webViewLink: publicUrlData.publicUrl,
      fileName,
      folderPath,
      storageProvider: 'SUPABASE_STORAGE',
    };
  }

  /**
   * Uploads a document strictly to Google Drive (Primary Storage) without falling back to Supabase.
   * Used both as the primary attempt in `uploadDocument` and during the 6-hour Bucket -> Drive reconciliation.
   */
  async uploadDirectlyToGoogleDrive(
    params: UploadDocumentParams,
    layout?: DriveFolderLayout
  ): Promise<UploadedDriveFile> {
    if (!this.drive) {
      throw new Error('Cliente Google Drive não configurado.');
    }

    const fileName = buildStandardDriveFileName(params);
    const fallbackFolderPath = buildDriveFolderHierarchy({
      referenceMonth: params.referenceMonth,
      category: params.category,
      kind: params.kind,
      layout,
    });

    let targetFolderId: string;
    let folderPath: string[];

    const autoDetected =
      !layout || layout === 'CONTAS_MENSAIS'
        ? await this.resolveExistingContasMensaisPath(
            params.referenceMonth,
            params.kind
          ).catch(() => null)
        : null;

    if (autoDetected) {
      targetFolderId = autoDetected.folderId;
      folderPath = autoDetected.folderPath;
    } else {
      folderPath = fallbackFolderPath;
      targetFolderId = await this.ensureFolderPath(folderPath);
    }

    logger.info(
      {
        fileName,
        folderPath: folderPath.join('/'),
        kind: params.kind,
        storageProvider: 'GOOGLE_DRIVE',
      },
      'Enviando documento para o Google Drive (Storage Primário)'
    );

    const response = await this.drive.files.create({
      requestBody: {
        name: fileName,
        parents: [targetFolderId],
      },
      media: {
        mimeType: params.mimeType,
        body: Readable.from(params.buffer),
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    });

    const fileId = response.data.id;
    if (!fileId) {
      throw new Error('Google Drive não retornou o ID do arquivo enviado.');
    }

    const webViewLink =
      response.data.webViewLink ??
      `https://drive.google.com/file/d/${fileId}/view`;

    return {
      fileId,
      webViewLink,
      fileName,
      folderPath,
      storageProvider: 'GOOGLE_DRIVE',
    };
  }

  /**
   * Uploads an invoice or receipt using Google Drive as the PRIMARY storage location
   * (automatically recognizing the existing `#N-Mês/YYYY` folder pattern in "Contas Mensais"),
   * and uses Supabase Storage (`CururuBucket`) strictly as a SECONDARY fallback if Google Drive fails.
   * When falling back to Supabase Storage, records an audit log in `execution_logs` and queues for 6-hour reconciliation.
   */
  async uploadDocument(
    params: UploadDocumentParams,
    layout?: DriveFolderLayout
  ): Promise<UploadedDriveFile> {
    const startedAt = new Date().toISOString();
    const fileName = buildStandardDriveFileName(params);
    const fallbackFolderPath = buildDriveFolderHierarchy({
      referenceMonth: params.referenceMonth,
      category: params.category,
      kind: params.kind,
      layout,
    });

    // 1. PRIMARY STORAGE: Google Drive
    if (this.drive) {
      try {
        return await this.uploadDirectlyToGoogleDrive(params, layout);
      } catch (driveErr) {
        const errMsg =
          driveErr instanceof Error ? driveErr.message : String(driveErr);
        logger.error(
          {
            fileName,
            err: errMsg,
          },
          'Falha ao salvar no Google Drive (Primário); acionando fallback secundário no Supabase Storage'
        );

        if (!this.supabase) {
          throw driveErr;
        }

        const fallbackFile = await this.uploadToSupabaseStorage(
          params,
          fallbackFolderPath,
          fileName
        );

        await this.recordStorageAuditLog({
          cycleId: params.cycleId,
          providerId: params.providerId,
          providerName: params.providerName,
          startedAt,
          status: 'DRIVE_FALLBACK_BUCKET',
          stepReached: 'GOOGLE_DRIVE_UPLOAD_FALLBACK',
          errorCode: 'GOOGLE_DRIVE_UPLOAD_ERROR',
          sanitizedMessage: `Erro ao salvar no Google Drive (${errMsg}). Arquivo ${fileName} salvo temporariamente no Supabase Bucket (${this.supabaseBucket}/${fallbackFile.fileId}) e agendado para conciliação de 6 em 6 horas.`,
        });

        return fallbackFile;
      }
    }

    // 2. SECONDARY FALLBACK STORAGE: Supabase Storage (`CururuBucket`) when Google Drive is not configured
    if (this.supabase) {
      logger.warn(
        {
          fileName,
          bucket: this.supabaseBucket,
          folderPath: fallbackFolderPath.join('/'),
        },
        'Google Drive indisponível: salvando no Supabase Storage (Fallback Secundário)'
      );
      const fallbackFile = await this.uploadToSupabaseStorage(
        params,
        fallbackFolderPath,
        fileName
      );

      await this.recordStorageAuditLog({
        cycleId: params.cycleId,
        providerId: params.providerId,
        providerName: params.providerName,
        startedAt,
        status: 'DRIVE_FALLBACK_BUCKET',
        stepReached: 'GOOGLE_DRIVE_UPLOAD_FALLBACK',
        errorCode: 'GOOGLE_DRIVE_NOT_CONFIGURED',
        sanitizedMessage: `Cliente Google Drive não configurado. Arquivo ${fileName} salvo temporariamente no Supabase Bucket (${this.supabaseBucket}/${fallbackFile.fileId}) e agendado para conciliação de 6 em 6 horas.`,
      });

      return fallbackFile;
    }

    throw new Error(
      'Nenhum provedor de armazenamento disponível (Google Drive falhou e Supabase Storage não configurado).'
    );
  }

  /**
   * Periodic 6-Hour Storage Reconciliation (`Supabase Bucket -> Google Drive`):
   * - Scans all `bill_cycles` that have `invoice_drive_file_id` or `receipt_drive_file_id` stored in Supabase Storage (`CururuBucket`).
   * - Downloads each pending file from the Supabase Bucket and attempts to upload it to Google Drive (Primary Storage).
   * - On SUCCESS: updates `bill_cycles` with the permanent Google Drive ID/URL, REMOVES the file from the Supabase Bucket
   *   so it does not occupy limited Free Tier space, and logs `DRIVE_SYNC_SUCCESS` in `execution_logs`.
   * - On FAILURE: keeps the file in the Supabase Bucket for the next 6-hour retry and logs `DRIVE_SYNC_RETRY_FAILED` in `execution_logs`.
   */
  async reconcileBucketToGoogleDrive(options?: {
    referenceMonth?: string;
    layout?: DriveFolderLayout;
  }): Promise<BucketToDriveReconcileSummary> {
    const ranAt = new Date().toISOString();
    const summary: BucketToDriveReconcileSummary = {
      checkedItems: 0,
      migratedCount: 0,
      failedCount: 0,
      removedFromBucketCount: 0,
      results: [],
      ranAt,
    };

    if (
      !this.supabase ||
      typeof (this.supabase as { from?: unknown }).from !== 'function'
    ) {
      return summary;
    }

    let query = this.supabase
      .from('bill_cycles')
      .select('*, bill_providers(id, name, category)')
      .order('reference_month', { ascending: false });

    if (options?.referenceMonth) {
      query = query.eq('reference_month', options.referenceMonth);
    }

    const { data: cycles, error } = await query;
    if (error || !cycles) {
      logger.error(
        { err: error?.message },
        'Falha ao consultar ciclos para conciliação Supabase Bucket -> Google Drive'
      );
      return summary;
    }

    for (const cycle of cycles) {
      const prov = (
        cycle as unknown as {
          bill_providers?: { id: string; name: string; category: BillCategory };
        }
      ).bill_providers;

      const providerName = prov?.name ?? 'Provedor';
      const providerCategory: BillCategory = prov?.category ?? 'OUTROS';

      const pendingDocs: Array<{
        kind: DocumentKind;
        fileId: string | null;
        url: string | null;
      }> = [];

      if (
        GoogleDriveService.isStoredInSupabaseBucket(
          cycle.invoice_drive_file_id,
          cycle.invoice_drive_url,
          this.supabaseBucket
        )
      ) {
        pendingDocs.push({
          kind: 'FATURA',
          fileId: cycle.invoice_drive_file_id,
          url: cycle.invoice_drive_url,
        });
      }

      if (
        GoogleDriveService.isStoredInSupabaseBucket(
          cycle.receipt_drive_file_id,
          cycle.receipt_drive_url,
          this.supabaseBucket
        )
      ) {
        pendingDocs.push({
          kind: 'COMPROVANTE',
          fileId: cycle.receipt_drive_file_id,
          url: cycle.receipt_drive_url,
        });
      }

      for (const doc of pendingDocs) {
        const storagePath = GoogleDriveService.extractSupabaseStoragePath(
          doc.fileId,
          doc.url,
          this.supabaseBucket
        );
        if (!storagePath) continue;

        summary.checkedItems++;
        const attemptStartedAt = new Date().toISOString();
        const { extension, mimeType } =
          GoogleDriveService.inferExtensionAndMimeType(storagePath);

        try {
          // 1. Download file binary from Supabase Bucket
          const { data: downloadedBlob, error: downloadErr } =
            await this.supabase.storage
              .from(this.supabaseBucket)
              .download(storagePath);

          if (downloadErr || !downloadedBlob) {
            throw new Error(
              `Falha ao baixar arquivo do Supabase Bucket (${storagePath}): ${
                downloadErr?.message ?? 'Blob vazio'
              }`
            );
          }

          const buffer = Buffer.isBuffer(downloadedBlob)
            ? downloadedBlob
            : Buffer.from(await (downloadedBlob as Blob).arrayBuffer());

          // 2. Attempt direct upload to Google Drive (Primary Storage)
          const driveFile = await this.uploadDirectlyToGoogleDrive(
            {
              referenceMonth: cycle.reference_month,
              category: providerCategory,
              providerName,
              kind: doc.kind,
              extension,
              mimeType,
              buffer,
              cycleId: cycle.id,
              providerId: cycle.provider_id,
            },
            options?.layout
          );

          // 3. Update bill_cycles record with permanent Google Drive ID & link
          const cycleUpdate =
            doc.kind === 'FATURA'
              ? {
                  invoice_drive_file_id: driveFile.fileId,
                  invoice_drive_url: driveFile.webViewLink,
                }
              : {
                  receipt_drive_file_id: driveFile.fileId,
                  receipt_drive_url: driveFile.webViewLink,
                };

          const { error: updateErr } = await this.supabase
            .from('bill_cycles')
            .update(cycleUpdate)
            .eq('id', cycle.id);

          if (updateErr) {
            throw new Error(
              `Arquivo salvo no Google Drive (${driveFile.fileId}), mas falhou ao atualizar bill_cycles: ${updateErr.message}`
            );
          }

          // 4. Remove the temporary file from Supabase Storage Bucket to save limited Free Tier space
          const { error: removeErr } = await this.supabase.storage
            .from(this.supabaseBucket)
            .remove([storagePath]);

          const removedFromBucket = !removeErr;
          if (removedFromBucket) {
            summary.removedFromBucketCount++;
          } else {
            logger.warn(
              { storagePath, err: removeErr?.message },
              'Arquivo migrado para o Google Drive, mas houve aviso ao remover do Supabase Bucket.'
            );
          }

          summary.migratedCount++;
          summary.results.push({
            cycleId: cycle.id,
            providerId: cycle.provider_id,
            providerName,
            referenceMonth: cycle.reference_month,
            kind: doc.kind,
            storagePath,
            status: 'MIGRATED_AND_REMOVED',
            driveFileId: driveFile.fileId,
            driveWebViewLink: driveFile.webViewLink,
            removedFromBucket,
          });

          // 5. Record audit log of successful migration & bucket cleanup in execution_logs
          await this.recordStorageAuditLog({
            cycleId: cycle.id,
            providerId: cycle.provider_id,
            providerName,
            startedAt: attemptStartedAt,
            status: 'DRIVE_SYNC_SUCCESS',
            stepReached: 'BUCKET_TO_DRIVE_RECONCILE',
            errorCode: null,
            sanitizedMessage: `Conciliação 6h (Bucket -> Google Drive): ${doc.kind} (${driveFile.fileName}) migrado com sucesso para o Google Drive (ID: ${driveFile.fileId}) e removido do Supabase Bucket (${this.supabaseBucket}/${storagePath}) para liberar espaço.`,
          });
        } catch (syncErr) {
          const errMsg =
            syncErr instanceof Error ? syncErr.message : String(syncErr);
          summary.failedCount++;
          summary.results.push({
            cycleId: cycle.id,
            providerId: cycle.provider_id,
            providerName,
            referenceMonth: cycle.reference_month,
            kind: doc.kind,
            storagePath,
            status: 'RETRY_FAILED',
            removedFromBucket: false,
            errorMessage: errMsg,
          });

          logger.warn(
            {
              providerName,
              referenceMonth: cycle.reference_month,
              kind: doc.kind,
              storagePath,
              err: errMsg,
            },
            'Tentativa de conciliação 6h (Bucket -> Google Drive) falhou; arquivo mantido no bucket para próxima tentativa'
          );

          // Record audit log of failed attempt in execution_logs
          await this.recordStorageAuditLog({
            cycleId: cycle.id,
            providerId: cycle.provider_id,
            providerName,
            startedAt: attemptStartedAt,
            status: 'DRIVE_SYNC_RETRY_FAILED',
            stepReached: 'BUCKET_TO_DRIVE_RECONCILE',
            errorCode: 'GOOGLE_DRIVE_SYNC_ERROR',
            sanitizedMessage: `Tentativa de conciliação 6h (Bucket -> Google Drive) falhou ao migrar ${doc.kind} (${storagePath}): ${errMsg}. Arquivo mantido no Supabase Bucket (${this.supabaseBucket}) para próxima tentativa em 6 horas.`,
          });
        }
      }
    }

    return summary;
  }
}
