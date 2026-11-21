import pdfParse from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { createSanitizedLogger, parseBrlToCents } from '@secretaria/shared';

const logger = createSanitizedLogger('receipt-parser');

export interface ExtractedReceiptData {
  amountCents: number | null;
  paidDate: string | null; // YYYY-MM-DD
  beneficiaryHint: string | null;
  rawSummary: string;
}

/**
 * Extracts monetary values in cents from raw text (PDF or OCR) by looking for
 * keywords like "Valor Pago", "Valor Total", "Valor", or general R$ patterns.
 */
export function extractAmountCentsFromText(text: string): number | null {
  if (!text) return null;

  // Priority 1: Explicit payment amount patterns
  const priorityPatterns = [
    /(?:valor\s*(?:pago|total|do\s*pagamento|cobrado|da\s*transa[cç][aã]o)|total\s*a\s*pagar)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /R\$\s*([\d.]+,\d{2})/gi,
  ];

  const priorityMatch = text.match(priorityPatterns[0]);
  if (priorityMatch?.[1]) {
    const cents = parseBrlToCents(priorityMatch[1]);
    if (cents && cents > 0) return cents;
  }

  // Priority 2: All R$ occurrences - pick the most prominent positive amount
  const allMatches = [...text.matchAll(priorityPatterns[1])];
  const amounts = allMatches
    .map((m) => parseBrlToCents(m[1]))
    .filter((v): v is number => v !== null && v > 0);

  if (amounts.length === 0) return null;
  return amounts[0];
}

/**
 * Extracts a date (DD/MM/YYYY -> YYYY-MM-DD) from receipt text.
 */
export function extractDateFromText(text: string): string | null {
  const match = text.match(/\b(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(20\d{2})\b/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Parses a PDF receipt or invoice buffer using `pdf-parse`.
 */
export async function parsePdfReceipt(buffer: Buffer): Promise<ExtractedReceiptData> {
  const data = await pdfParse(buffer);
  const text = data.text ?? '';
  const amountCents = extractAmountCentsFromText(text);
  const paidDate = extractDateFromText(text);

  return {
    amountCents,
    paidDate,
    beneficiaryHint: null,
    rawSummary: text.slice(0, 400).replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Parses a receipt image (JPEG/PNG/WebP) using `@google/genai` (Gemini 2.5 Flash on Free Tier).
 */
export async function parseImageReceiptWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey?: string
): Promise<ExtractedReceiptData> {
  const key = apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY não configurada para OCR de comprovantes em imagem.');
  }

  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = [
    'Você é um extrator financeiro de comprovantes bancários brasileiros (PIX, boleto, débito).',
    'Analise a imagem do comprovante e retorne APENAS um JSON válido com as chaves:',
    '{"amount_brl": "123,45", "paid_date": "YYYY-MM-DD", "beneficiary": "nome do recebedor ou null"}',
    'Não inclua markdown, explicações ou dados pessoais como CPF.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
  });

  const rawText = (response.text ?? '').trim();
  logger.info('Resposta de OCR Gemini recebida com sucesso');

  try {
    const cleanedJson = rawText
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const parsed = JSON.parse(cleanedJson) as {
      amount_brl?: string | number;
      paid_date?: string | null;
      beneficiary?: string | null;
    };

    const amountCents =
      typeof parsed.amount_brl === 'number'
        ? Math.round(parsed.amount_brl * 100)
        : parsed.amount_brl
          ? parseBrlToCents(String(parsed.amount_brl))
          : null;

    return {
      amountCents,
      paidDate: parsed.paid_date ?? null,
      beneficiaryHint: parsed.beneficiary ?? null,
      rawSummary: `OCR Gemini: beneficiary=${parsed.beneficiary ?? 'N/A'}`,
    };
  } catch {
    // Fallback regex on raw text if model returned non-strict JSON
    return {
      amountCents: extractAmountCentsFromText(rawText),
      paidDate: extractDateFromText(rawText),
      beneficiaryHint: null,
      rawSummary: 'OCR Gemini fallback text extraction',
    };
  }
}
