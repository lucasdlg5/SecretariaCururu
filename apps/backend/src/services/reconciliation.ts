import type { BillCategory, BillCycleRow } from '@secretaria/shared';

export const EXACT_MATCH_TOLERANCE_CENTS = 5; // R$ 0,05 tolerance

export interface OpenCycleCandidate extends BillCycleRow {
  provider_name: string;
  provider_category: BillCategory;
}

export type ReconciliationResult =
  | {
      kind: 'EXACT_UNIQUE_MATCH';
      matchedCycle: OpenCycleCandidate;
      diffCents: number;
    }
  | {
      kind: 'AMBIGUOUS_OR_DIVERGENT';
      reason: 'MULTIPLE_MATCHES' | 'VALUE_DIVERGENCE' | 'AMOUNT_NOT_DETECTED';
      candidates: OpenCycleCandidate[];
    }
  | {
      kind: 'NO_OPEN_CYCLES';
      candidates: [];
    };

/**
 * Evaluates extracted receipt amount against all open cycles (`PDF_CAPTURED`)
 * from the current and previous reference month:
 * - Unique match within ±5 cents (R$ 0,05): automatic reconciliation (`EXACT_UNIQUE_MATCH`)
 * - Multiple matches within ±5 cents OR divergent amount (interest/discount) OR null amount:
 *   returns `AMBIGUOUS_OR_DIVERGENT` so the Telegram bot sends an InlineKeyboard for 1-click confirmation.
 */
export function evaluateReceiptReconciliation(
  extractedAmountCents: number | null,
  openCycles: OpenCycleCandidate[],
  toleranceCents: number = EXACT_MATCH_TOLERANCE_CENTS
): ReconciliationResult {
  if (openCycles.length === 0) {
    return {
      kind: 'NO_OPEN_CYCLES',
      candidates: [],
    };
  }

  if (extractedAmountCents === null || extractedAmountCents <= 0) {
    return {
      kind: 'AMBIGUOUS_OR_DIVERGENT',
      reason: 'AMOUNT_NOT_DETECTED',
      candidates: openCycles,
    };
  }

  const exactMatches: Array<{ cycle: OpenCycleCandidate; diffCents: number }> = [];

  for (const cycle of openCycles) {
    if (cycle.amount_cents !== null && cycle.amount_cents !== undefined) {
      const diff = Math.abs(cycle.amount_cents - extractedAmountCents);
      if (diff <= toleranceCents) {
        exactMatches.push({ cycle, diffCents: diff });
      }
    }
  }

  if (exactMatches.length === 1) {
    return {
      kind: 'EXACT_UNIQUE_MATCH',
      matchedCycle: exactMatches[0].cycle,
      diffCents: exactMatches[0].diffCents,
    };
  }

  if (exactMatches.length > 1) {
    return {
      kind: 'AMBIGUOUS_OR_DIVERGENT',
      reason: 'MULTIPLE_MATCHES',
      candidates: exactMatches.map((m) => m.cycle),
    };
  }

  // Sort open cycles by closest value to the extracted receipt amount for user convenience
  const sortedByProximity = [...openCycles].sort((a, b) => {
    const diffA =
      a.amount_cents !== null ? Math.abs(a.amount_cents - extractedAmountCents) : Number.MAX_SAFE_INTEGER;
    const diffB =
      b.amount_cents !== null ? Math.abs(b.amount_cents - extractedAmountCents) : Number.MAX_SAFE_INTEGER;
    return diffA - diffB;
  });

  return {
    kind: 'AMBIGUOUS_OR_DIVERGENT',
    reason: 'VALUE_DIVERGENCE',
    candidates: sortedByProximity,
  };
}

/**
 * Returns the current and previous reference months (`YYYY-MM`) for querying open bill cycles.
 */
export function getCurrentAndPreviousReferenceMonths(now: Date = new Date()): [string, string] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  const current = `${year}-${String(month).padStart(2, '0')}`;

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const previous = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  return [current, previous];
}
