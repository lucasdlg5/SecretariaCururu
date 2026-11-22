import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import {
  type BillCategory,
  type DriveFolderLayout,
  type TypedSupabaseClient,
  DriveFolderLayoutSchema,
  createSanitizedLogger,
} from '@secretaria/shared';

const logger = createSanitizedLogger('drive-service');

export type DocumentKind = 'FATURA' | 'COMPROVANTE';

export interface UploadDocumentParams {
  referenceMonth: string; // YYYY-MM
  category: BillCategory;
  providerName: string;
  kind: DocumentKind;
  extension: string; // 'pdf' | 'jpg' | 'png'
  mimeType: string;
  buffer: Buffer;
}

export interface UploadedDriveFile {
  fileId: string;
  webViewLink: string;
  fileName: string;
  folderPath: string[];
  storageProvider?: 'GOOGLE_DRIVE' | 'SUPABASE_STORAGE';
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
   * Uploads an invoice or receipt using Google Drive as the PRIMARY storage location
   * (automatically recognizing the existing `#N-Mês/YYYY` folder pattern in "Contas Mensais"),
   * and uses Supabase Storage (`CururuBucket`) strictly as a SECONDARY fallback if Google Drive fails.
   */
  async uploadDocument(
    params: UploadDocumentParams,
    layout?: DriveFolderLayout
  ): Promise<UploadedDriveFile> {
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
        // First try auto-detecting the existing "Contas Mensais" (#N-Mês/YYYY) pattern if no explicit BY_MONTH/BY_TYPE override was passed
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
      } catch (driveErr) {
        logger.error(
          {
            fileName,
            err: driveErr instanceof Error ? driveErr.message : String(driveErr),
          },
          'Falha ao salvar no Google Drive (Primário); acionando fallback secundário no Supabase Storage'
        );

        if (!this.supabase) {
          throw driveErr;
        }

        return this.uploadToSupabaseStorage(params, fallbackFolderPath, fileName);
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
      return this.uploadToSupabaseStorage(params, fallbackFolderPath, fileName);
    }

    throw new Error(
      'Nenhum provedor de armazenamento disponível (Google Drive falhou e Supabase Storage não configurado).'
    );
  }
}
