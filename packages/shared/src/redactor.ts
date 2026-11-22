import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Regex patterns for sensitive domestic bill & credential data:
 * - CPF (formatted 000.000.000-00 or 11 contiguous digits when preceded by cpf/doc context or standalone 11 digits)
 * - CNPJ (00.000.000/0000-00)
 * - E-mail addresses
 * - Bearer tokens & Telegram bot tokens
 * - Boleto / Concessionária barcodes (44 to 48 digits with optional spaces/dots/hyphens)
 * - Explicit password/secret key-value pairs in strings
 */
const CPF_FORMATTED_REGEX = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CPF_RAW_11_REGEX = /\b\d{11}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const TELEGRAM_TOKEN_REGEX = /\b\d{8,11}:[A-Za-z0-9_-]{30,}\b/g;
const BARCODE_REGEX = /\b(?:\d[\s.-]*){44,48}\b/g;
const SECRET_KV_REGEX =
  /((?:password|senha|secret|token|api_key|apikey|cpf|ciphertext|app_master_key)\s*[:=]\s*["']?)([^"'\s,;}{]+)(["']?)/gi;

const SENSITIVE_OBJECT_KEYS = new Set([
  'password',
  'senha',
  'secret',
  'secrets',
  'plain_secrets',
  'encrypted_secrets',
  'cpf',
  'email',
  'token',
  'authorization',
  'app_master_key',
  'ciphertext',
  'iv',
  'authtag',
  'barcode',
  'linhadigitavel',
]);

/**
 * Sanitizes any string by masking CPFs, e-mails, barcodes, Bearer tokens,
 * Telegram bot tokens, and key-value password pairs.
 * Also masks custom dynamic secrets if a list of known secret values is passed.
 */
export function sanitizeLogText(text: string, dynamicSecrets: string[] = []): string {
  if (!text) return text;

  let sanitized = text;

  // 1. Replace any dynamic secret values known in memory first
  for (const secretVal of dynamicSecrets) {
    if (secretVal && secretVal.length >= 3) {
      sanitized = sanitized.split(secretVal).join('[REDACTED_SECRET]');
    }
  }

  // 2. Replace Boleto / Concessionária Barcodes (44-48 digits) before 11-digit CPF rule
  sanitized = sanitized.replace(BARCODE_REGEX, '[REDACTED_BARCODE]');

  // 3. Replace formatted CPFs (000.000.000-00) and raw 11-digit numbers
  sanitized = sanitized.replace(CPF_FORMATTED_REGEX, '[REDACTED_CPF]');
  sanitized = sanitized.replace(CPF_RAW_11_REGEX, '[REDACTED_CPF]');

  // 4. Replace e-mail addresses
  sanitized = sanitized.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');

  // 5. Replace Bearer tokens & Telegram bot tokens
  sanitized = sanitized.replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]');
  sanitized = sanitized.replace(TELEGRAM_TOKEN_REGEX, '[REDACTED_BOT_TOKEN]');

  // 6. Replace key=value or key: value patterns for sensitive fields
  sanitized = sanitized.replace(SECRET_KV_REGEX, '$1[REDACTED]$3');

  return sanitized;
}

/**
 * Deeply clones and redacts an arbitrary object or error before logging or database storage.
 * Uses a WeakSet and depth limit to safely handle circular references (e.g., Fastify Server / Req / Res objects).
 */
export function redactObject<T>(
  input: T,
  dynamicSecrets: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return sanitizeLogText(input, dynamicSecrets) as unknown as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (input instanceof Error) {
    const redactedError = new Error(sanitizeLogText(input.message, dynamicSecrets));
    redactedError.name = input.name;
    if (input.stack) {
      redactedError.stack = sanitizeLogText(input.stack, dynamicSecrets);
    }
    return redactedError as unknown as T;
  }

  if (seen.has(input as object) || depth > 6) {
    return '[Circular]' as unknown as T;
  }
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.map((item) =>
      redactObject(item, dynamicSecrets, seen, depth + 1)
    ) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (
      SENSITIVE_OBJECT_KEYS.has(key.toLowerCase()) ||
      SENSITIVE_OBJECT_KEYS.has(normalizedKey)
    ) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactObject(value, dynamicSecrets, seen, depth + 1);
    }
  }

  return output as T;
}

/**
 * Creates a structured Pino logger instance with built-in path redaction and custom hook sanitization.
 */
export function createSanitizedLogger(name: string, extraOptions?: LoggerOptions): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'password',
        'senha',
        'cpf',
        'email',
        'token',
        'authorization',
        'req.headers.authorization',
        'req.headers["x-telegram-bot-api-secret-token"]',
        '*.password',
        '*.cpf',
        '*.email',
        '*.token',
        '*.encrypted_secrets',
        '*.plain_secrets',
      ],
      censor: '[REDACTED]',
    },
    hooks: {
      logMethod(inputArgs, method) {
        const sanitizedArgs = inputArgs.map((arg) => redactObject(arg));
        return method.apply(this, sanitizedArgs as Parameters<typeof method>);
      },
    },
    ...extraOptions,
  });
}
