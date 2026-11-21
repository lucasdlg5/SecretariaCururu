import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import {
  type BillCategory,
  type DriveFolderLayout,
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
 * Computes the folder hierarchy relative to Root Folder ("Contas_Casa")
 * based on DRIVE_FOLDER_LAYOUT:
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

  const year = params.referenceMonth.slice(0, 4);
  const subFolder = params.kind === 'FATURA' ? 'Faturas' : 'Comprovantes';

  if (layout === 'BY_TYPE') {
    return [params.category, params.referenceMonth, subFolder];
  }

  return [year, params.referenceMonth, subFolder];
}

export class GoogleDriveService {
  private drive: drive_v3.Drive;
  private rootFolderId: string;
  private folderCache = new Map<string, string>();

  constructor(options?: {
    driveClient?: drive_v3.Drive;
    rootFolderId?: string;
    serviceAccountJson?: string;
  }) {
    this.rootFolderId =
      options?.rootFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '';

    if (options?.driveClient) {
      this.drive = options.driveClient;
      return;
    }

    const rawJson =
      options?.serviceAccountJson ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
    if (!rawJson) {
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
   * Idempotently finds or creates a subfolder inside `parentId`.
   */
  async ensureFolder(name: string, parentId: string): Promise<string> {
    const cacheKey = `${parentId}/${name}`;
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
   * Uploads an invoice or receipt to the organized Google Drive folder structure.
   */
  async uploadDocument(
    params: UploadDocumentParams,
    layout?: DriveFolderLayout
  ): Promise<UploadedDriveFile> {
    const folderPath = buildDriveFolderHierarchy({
      referenceMonth: params.referenceMonth,
      category: params.category,
      kind: params.kind,
      layout,
    });

    const targetFolderId = await this.ensureFolderPath(folderPath);
    const fileName = buildStandardDriveFileName(params);

    logger.info(
      {
        fileName,
        folderPath: folderPath.join('/'),
        kind: params.kind,
      },
      'Enviando documento para o Google Drive'
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
      response.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

    return {
      fileId,
      webViewLink,
      fileName,
      folderPath,
    };
  }
}
