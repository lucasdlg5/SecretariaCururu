import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse';
import {
  extractAmountCentsFromText,
  extractDateFromText,
} from '@secretaria/backend';

export interface InvoicePdfMetadata {
  amountCents: number | null;
  dueDate: string | null;
  barcodeHash: string | null;
}

/**
 * Extracts invoice value (cents), due date (YYYY-MM-DD), and SHA-256 barcode hash
 * directly from a downloaded invoice PDF buffer as a fallback/enrichment step.
 */
export async function extractMetadataFromInvoicePdf(
  pdfBuffer: Buffer
): Promise<InvoicePdfMetadata> {
  try {
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text ?? '';

    const amountCents = extractAmountCentsFromText(text);
    const dueDate = extractDateFromText(text);

    // Detect 44-48 digit barcode / linha digitável and store only its SHA-256 hash (Zero Plaintext)
    const barcodeMatch = text.match(/\b(?:\d[\s.-]*){44,48}\b/);
    let barcodeHash: string | null = null;
    if (barcodeMatch?.[0]) {
      const digitsOnly = barcodeMatch[0].replace(/\D/g, '');
      barcodeHash = createHash('sha256').update(digitsOnly).digest('hex');
    }

    return {
      amountCents,
      dueDate,
      barcodeHash,
    };
  } catch {
    return {
      amountCents: null,
      dueDate: null,
      barcodeHash: null,
    };
  }
}
