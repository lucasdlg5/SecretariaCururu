import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Flame,
  Droplets,
  Wifi,
  Home,
  Building2,
  Receipt,
  Sparkles,
  HardDrive,
  Play,
} from 'lucide-react';
import {
  type BillCategory,
  type BillCycleRow,
  type BillProviderRow,
  type CycleStatus,
  formatCentsToBrl,
  predictDueDateFromHistory,
} from '@secretaria/shared';

export interface MonthlyIndividualBreakdownSectionProps {
  providers: BillProviderRow[];
  allCycles: BillCycleRow[];
  selectedMonth?: string;
  onSelectMonth?: (month: string) => void;
  onTriggerProvider?: (provider: BillProviderRow) => void;
  triggeringId?: string | null;
}

const MONTH_LABELS: Record<string, string> = {
  '2026-05': 'Maio/2026 (#2-Maio)',
  '2026-06': 'Junho/2026 (#3-Junho)',
  '2026-07': 'Julho/2026 (#4-Julho)',
  '2026-08': 'Agosto/2026 (#5-Agosto)',
  '2026-09': 'Setembro/2026 (#6-Setembro)',
  '2026-10': 'Outubro/2026 (#7-Outubro)',
  '2026-11': 'Novembro/2026 (#8-Novembro)',
};

const SHORT_MONTH_LABELS: Record<string, string> = {
  '2026-05': 'Mai/2026',
  '2026-06': 'Jun/2026',
  '2026-07': 'Jul/2026',
  '2026-08': 'Ago/2026',
  '2026-09': 'Set/2026',
  '2026-10': 'Out/2026',
  '2026-11': 'Nov/2026',
};

const CATEGORY_CONFIG: Record<
  BillCategory,
  {
    label: string;
    colorClass: string;
    barColor: string;
    icon: React.ReactNode;
  }
> = {
  LUZ: {
    label: 'Energia Elétrica',
    colorClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    barColor: 'bg-amber-400',
    icon: <Zap className="w-4 h-4 text-amber-400" />,
  },
  GAS: {
    label: 'Gás Encanado',
    colorClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    barColor: 'bg-rose-400',
    icon: <Flame className="w-4 h-4 text-rose-400" />,
  },
  AGUA: {
    label: 'Água & Esgoto',
    colorClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    barColor: 'bg-blue-400',
    icon: <Droplets className="w-4 h-4 text-blue-400" />,
  },
  INTERNET: {
    label: 'Internet Fibra',
    colorClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    barColor: 'bg-sky-400',
    icon: <Wifi className="w-4 h-4 text-sky-400" />,
  },
  ALUGUEL: {
    label: 'Aluguel Imóvel',
    colorClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    barColor: 'bg-emerald-400',
    icon: <Home className="w-4 h-4 text-emerald-400" />,
  },
  CONDOMINIO: {
    label: 'Condomínio',
    colorClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    barColor: 'bg-purple-400',
    icon: <Building2 className="w-4 h-4 text-purple-400" />,
  },
  OUTROS: {
    label: 'IPTU & Taxas',
    colorClass: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
    barColor: 'bg-pink-400',
    icon: <Receipt className="w-4 h-4 text-pink-400" />,
  },
};

const STATUS_BADGE: Record<
  CycleStatus,
  { label: string; classes: string; icon: React.ReactNode }
> = {
  PAID_RECONCILED: {
    label: 'Pago & Conciliado',
    classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  PDF_CAPTURED: {
    label: 'Fatura Capturada (Aberto)',
    classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    icon: <FileText className="w-3.5 h-3.5" />,
  },
  WAITING_CAPTCHA: {
    label: 'Aguardando CAPTCHA',
    classes: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  RUNNING: {
    label: 'Executando Worker...',
    classes: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: <Clock className="w-3.5 h-3.5 animate-spin" />,
  },
  NOT_FOUND_YET: {
    label: 'Ainda Não Emitida',
    classes: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  MANUAL_REQUIRED: {
    label: 'Manual / Previsto',
    classes: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  PROVIDER_DOWN: {
    label: 'Portal Indisponível',
    classes: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  PENDING: {
    label: 'Aguardando Gatilho',
    classes: 'bg-slate-800 text-slate-400 border-slate-700',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

function formatDateBr(isoDate?: string | null): string {
  if (!isoDate) return '—';
  const clean = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return isoDate;
  return clean.split('-').reverse().join('/');
}

function getPreviousMonthKey(referenceMonth: string): string {
  const [yStr, mStr] = referenceMonth.split('-');
  const y = Number.parseInt(yStr, 10);
  const m = Number.parseInt(mStr, 10);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function formatMetadataTags(meta?: Record<string, unknown> | null): string[] {
  if (!meta) return [];
  const tags: string[] = [];

  if (typeof meta.icms_pct === 'number') {
    tags.push(`ICMS: ${meta.icms_pct}%`);
  }
  if (typeof meta.daily_avg_kwh === 'number') {
    tags.push(`Média Diária: ${meta.daily_avg_kwh} kWh/dia`);
  }
  if (typeof meta.tusd_rate === 'number' && typeof meta.te_rate === 'number') {
    tags.push(`TUSD: R$ ${meta.tusd_rate.toFixed(4)} | TE: R$ ${meta.te_rate.toFixed(4)}`);
  }
  if (typeof meta.refund_duplicate_cents === 'number') {
    tags.push(
      `Estorno Duplicidade: -${formatCentsToBrl(meta.refund_duplicate_cents)}`
    );
  }
  if (typeof meta.gross_supply_cents === 'number') {
    tags.push(`Fornecimento Bruto: ${formatCentsToBrl(meta.gross_supply_cents)}`);
  }
  if (typeof meta.late_fee_cents === 'number') {
    tags.push(`Encargos Atraso: ${formatCentsToBrl(meta.late_fee_cents)}`);
  }
  if (typeof meta.agua_cents === 'number' && typeof meta.esgoto_cents === 'number') {
    tags.push(
      `Água: ${formatCentsToBrl(meta.agua_cents)} | Esgoto: ${formatCentsToBrl(meta.esgoto_cents)}`
    );
  }
  if (
    typeof meta.rateio_agua_cents === 'number' &&
    typeof meta.rateio_esgoto_cents === 'number'
  ) {
    tags.push(
      `Rateio Cond.: ${formatCentsToBrl(
        meta.rateio_agua_cents + meta.rateio_esgoto_cents
      )}`
    );
  }
  if (typeof meta.installment === 'string') {
    tags.push(`Parcelamento: ${meta.installment}`);
  }
  if (typeof meta.iptu_cents === 'number') {
    tags.push(`IPTU: ${formatCentsToBrl(meta.iptu_cents)}`);
  }
  if (typeof meta.lixo_cents === 'number') {
    tags.push(`Taxa Lixo: ${formatCentsToBrl(meta.lixo_cents)}`);
  }
  if (meta.bundled_with_rent === true) {
    tags.push('Unificado no Boleto do Aluguel (Dia 30)');
  }
  if (meta.unbundled_from_rent === true) {
    tags.push('Boleto Próprio Desmembrado (Venc. Dia 10)');
  }
  if (typeof meta.splitwise_half_cents === 'number') {
    tags.push(
      `Divisão 50/50 (Splitwise): ${formatCentsToBrl(meta.splitwise_half_cents)}`
    );
  }

  return tags;
}

export const MonthlyIndividualBreakdownSection: React.FC<
  MonthlyIndividualBreakdownSectionProps
> = ({
  providers,
  allCycles,
  selectedMonth,
  onSelectMonth,
  onTriggerProvider,
  triggeringId,
}) => {
  const availableMonths = useMemo(() => {
    const set = new Set<string>([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-11',
    ]);
    for (const c of allCycles) {
      if (c.reference_month) set.add(c.reference_month);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allCycles]);

  const [filterMonth, setFilterMonth] = useState<string>(
    selectedMonth && availableMonths.includes(selectedMonth)
      ? selectedMonth
      : availableMonths[0] ?? '2026-08'
  );
  const [filterCategory, setFilterCategory] = useState<BillCategory | 'ALL'>('ALL');

  useEffect(() => {
    if (selectedMonth) {
      setFilterMonth(selectedMonth);
    }
  }, [selectedMonth]);

  const handleMonthChange = (newMonth: string) => {
    setFilterMonth(newMonth);
    if (onSelectMonth) {
      onSelectMonth(newMonth);
    }
  };

  const prevMonthKey = getPreviousMonthKey(filterMonth);

  // Build individual bill items for the filtered month
  const individualItems = useMemo(() => {
    const monthCycles = allCycles.filter((c) => c.reference_month === filterMonth);
    const prevMonthCycles = allCycles.filter((c) => c.reference_month === prevMonthKey);

    const cycleByProvider = new Map(monthCycles.map((c) => [c.provider_id, c]));
    const prevCycleByProvider = new Map(
      prevMonthCycles.map((c) => [c.provider_id, c])
    );

    return providers
      .filter((p) => filterCategory === 'ALL' || p.category === filterCategory)
      .map((provider) => {
        const cycle = cycleByProvider.get(provider.id) ?? null;
        const prevCycle = prevCycleByProvider.get(provider.id) ?? null;

        const providerHistory = allCycles
          .filter(
            (c) => c.provider_id === provider.id && c.reference_month < filterMonth
          )
          .map((c) => ({
            reference_month: c.reference_month,
            due_date: c.due_date,
            paid_at: c.paid_at,
            amount_cents: c.amount_cents,
          }));

        const prediction = predictDueDateFromHistory({
          targetReferenceMonth: filterMonth,
          historicalCycles: providerHistory,
          defaultDueDay: provider.due_day_default,
        });

        const effectiveAmountCents =
          cycle?.amount_cents ?? prediction.predictedAmountCents ?? 0;
        const isAmountPredicted =
          (cycle?.amount_cents === null || cycle?.amount_cents === undefined) &&
          prediction.predictedAmountCents !== null;

        const effectiveDueDate =
          cycle?.due_date ??
          cycle?.predicted_due_date ??
          prediction.predictedDueDate;
        const isDueDatePredicted =
          !cycle?.due_date || cycle?.status === 'MANUAL_REQUIRED';

        const prevAmountCents = prevCycle?.amount_cents ?? null;
        const diffCents =
          prevAmountCents !== null ? effectiveAmountCents - prevAmountCents : null;
        const diffPct =
          prevAmountCents && prevAmountCents > 0 && diffCents !== null
            ? (diffCents / prevAmountCents) * 100
            : null;

        const isStoredInBucket =
          Boolean(
            cycle?.invoice_drive_url?.includes('/storage/v1/') ||
              cycle?.invoice_drive_file_id?.includes('/')
          ) ||
          Boolean(
            cycle?.receipt_drive_url?.includes('/storage/v1/') ||
              cycle?.receipt_drive_file_id?.includes('/')
          );

        return {
          provider,
          cycle,
          prevCycle,
          prediction,
          effectiveAmountCents,
          isAmountPredicted,
          effectiveDueDate,
          isDueDatePredicted,
          prevAmountCents,
          diffCents,
          diffPct,
          isStoredInBucket,
          metadataTags: formatMetadataTags(cycle?.bi_metadata),
        };
      });
  }, [providers, allCycles, filterMonth, prevMonthKey, filterCategory]);

  // Compute monthly totals for the Total do Mês Card
  const monthTotals = useMemo(() => {
    const totalCents = individualItems.reduce(
      (sum, item) => sum + item.effectiveAmountCents,
      0
    );
    const paidCents = individualItems
      .filter((item) => item.cycle?.status === 'PAID_RECONCILED')
      .reduce((sum, item) => sum + (item.cycle?.amount_cents ?? 0), 0);
    const openOrPredictedCents = Math.max(0, totalCents - paidCents);

    const paidCount = individualItems.filter(
      (item) => item.cycle?.status === 'PAID_RECONCILED'
    ).length;
    const totalTaxesCents = individualItems.reduce(
      (sum, item) => sum + (item.cycle?.tax_amount_cents ?? 0),
      0
    );

    const prevMonthTotalCents = individualItems.reduce(
      (sum, item) => sum + (item.prevAmountCents ?? 0),
      0
    );
    const hasPrevMonthData = individualItems.some(
      (item) => item.prevAmountCents !== null && item.prevAmountCents > 0
    );
    const monthDiffCents = hasPrevMonthData
      ? totalCents - prevMonthTotalCents
      : null;
    const monthDiffPct =
      hasPrevMonthData && prevMonthTotalCents > 0 && monthDiffCents !== null
        ? (monthDiffCents / prevMonthTotalCents) * 100
        : null;

    const kwhTotal = individualItems
      .filter((i) => i.provider.category === 'LUZ')
      .reduce((s, i) => s + (i.cycle?.consumption_value ?? 0), 0);
    const gasM3Total = individualItems
      .filter((i) => i.provider.category === 'GAS')
      .reduce((s, i) => s + (i.cycle?.consumption_value ?? 0), 0);
    const aguaM3Total = individualItems
      .filter((i) => i.provider.category === 'AGUA')
      .reduce((s, i) => s + (i.cycle?.consumption_value ?? 0), 0);

    return {
      totalCents,
      paidCents,
      openOrPredictedCents,
      paidCount,
      totalBillsCount: individualItems.length,
      totalTaxesCents,
      prevMonthTotalCents,
      monthDiffCents,
      monthDiffPct,
      kwhTotal,
      gasM3Total,
      aguaM3Total,
    };
  }, [individualItems]);

  return (
    <section className="space-y-6 rounded-2xl border border-emerald-500/25 bg-slate-900/75 p-6 shadow-xl shadow-slate-950/60">
      {/* Section Header + Month & Category Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-start gap-3.5">
          <img
            src="/logo.png"
            alt="SecretariaCururu"
            className="w-11 h-11 rounded-xl object-cover border border-emerald-500/40 shrink-0"
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <Filter className="w-3 h-3" />
                Visão Detalhada por Mês
              </span>
              <h2 className="text-lg font-bold text-white">
                Detalhamento Individual de Contas & Card Total do Mês
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Selecione qualquer mês abaixo para inspecionar o card consolidado com o total do mês e os dados individuais completos de cada conta (consumo, tarifas, impostos, vencimentos e links do Google Drive).
            </p>
          </div>
        </div>

        {/* Dropdown Select for Month */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-slate-950 border border-emerald-500/40 rounded-xl px-3.5 py-2 text-xs">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400 font-medium">Filtrar Mês:</span>
            <select
              value={filterMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              aria-label="Filtrar contas por mês"
              className="bg-transparent font-bold text-white focus:outline-none cursor-pointer"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m} className="bg-slate-900 text-white">
                  {MONTH_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick Month Filter Pills + Category Filter Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 mr-1 font-medium">Meses:</span>
          {availableMonths.map((monthKey) => {
            const isSelected = monthKey === filterMonth;
            return (
              <button
                key={monthKey}
                type="button"
                onClick={() => handleMonthChange(monthKey)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'bg-slate-950/80 text-slate-300 border border-slate-800 hover:border-slate-700 hover:text-white'
                }`}
              >
                {SHORT_MONTH_LABELS[monthKey] ?? monthKey}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-400 mr-1 font-medium">Categoria:</span>
          {(
            [
              'ALL',
              'LUZ',
              'GAS',
              'AGUA',
              'INTERNET',
              'ALUGUEL',
              'CONDOMINIO',
              'OUTROS',
            ] as const
          ).map((cat) => {
            const isSelected = filterCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'bg-slate-950/60 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {cat === 'ALL' ? 'Todas' : cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* CARD COM TOTAL DO MÊS (Destaque Principal do Mês Filtrado)           */}
      {/* ==================================================================== */}
      <div className="rounded-2xl border-2 border-emerald-500/35 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/25 p-6 shadow-lg">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Main Monthly Total Column */}
          <div className="lg:col-span-4 space-y-2 border-b lg:border-b-0 lg:border-r border-slate-800 pb-4 lg:pb-0 lg:pr-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                Card Total do Mês • {MONTH_LABELS[filterMonth] ?? filterMonth}
              </span>
            </div>

            <div className="flex items-baseline gap-3">
              <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                {formatCentsToBrl(monthTotals.totalCents)}
              </p>
            </div>

            {monthTotals.monthDiffCents !== null &&
              monthTotals.monthDiffPct !== null && (
                <div className="flex items-center gap-1.5 text-xs">
                  {monthTotals.monthDiffCents > 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 font-medium">
                      <TrendingUp className="w-3.5 h-3.5" />+
                      {formatCentsToBrl(monthTotals.monthDiffCents)} (+
                      {monthTotals.monthDiffPct.toFixed(1)}%) vs{' '}
                      {SHORT_MONTH_LABELS[prevMonthKey] ?? prevMonthKey}
                    </span>
                  ) : monthTotals.monthDiffCents < 0 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
                      <TrendingDown className="w-3.5 h-3.5" />
                      {formatCentsToBrl(monthTotals.monthDiffCents)} (
                      {monthTotals.monthDiffPct.toFixed(1)}%) vs{' '}
                      {SHORT_MONTH_LABELS[prevMonthKey] ?? prevMonthKey}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-medium">
                      <Minus className="w-3.5 h-3.5" />
                      Estável vs {SHORT_MONTH_LABELS[prevMonthKey] ?? prevMonthKey}
                    </span>
                  )}
                </div>
              )}

            <p className="text-xs text-slate-400">
              Consolidado de{' '}
              <strong className="text-slate-200">
                {monthTotals.totalBillsCount} contas
              </strong>{' '}
              no ciclo {filterMonth}
            </p>
          </div>

          {/* Sub-KPIs inside Total do Mês Card */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-950/75 border border-emerald-500/25 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                Total Pago & Conciliado
              </p>
              <p className="text-xl font-bold text-emerald-300 mt-1">
                {formatCentsToBrl(monthTotals.paidCents)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {monthTotals.paidCount} de {monthTotals.totalBillsCount} contas quitadas
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/75 border border-amber-500/25 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                Pendente / Previsto no Mês
              </p>
              <p className="text-xl font-bold text-amber-300 mt-1">
                {formatCentsToBrl(monthTotals.openOrPredictedCents)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {monthTotals.totalBillsCount - monthTotals.paidCount} conta(s) em aberto ou prevista(s)
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/75 border border-sky-500/25 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                Consumo & Tributos ({SHORT_MONTH_LABELS[filterMonth] ?? filterMonth})
              </p>
              <p className="text-sm font-bold text-white mt-1.5">
                ⚡ {monthTotals.kwhTotal} kWh • 🔥 {monthTotals.gasM3Total.toFixed(2)} m³ • 💧{' '}
                {monthTotals.aguaM3Total} m³
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Impostos destacados: {formatCentsToBrl(monthTotals.totalTaxesCents)}
              </p>
            </div>
          </div>
        </div>

        {/* Proportional Share Bar of the Month */}
        {monthTotals.totalCents > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Composição Proporcional das Contas no Total do Mês ({filterMonth}):</span>
              <span className="font-mono text-slate-300">100% = {formatCentsToBrl(monthTotals.totalCents)}</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-950 overflow-hidden flex border border-slate-800">
              {individualItems.map((item) => {
                const sharePct =
                  monthTotals.totalCents > 0
                    ? (item.effectiveAmountCents / monthTotals.totalCents) * 100
                    : 0;
                if (sharePct <= 0) return null;
                const catCfg = CATEGORY_CONFIG[item.provider.category];
                return (
                  <div
                    key={item.provider.id}
                    style={{ width: `${sharePct}%` }}
                    title={`${item.provider.name}: ${formatCentsToBrl(
                      item.effectiveAmountCents
                    )} (${sharePct.toFixed(1)}%)`}
                    className={`${catCfg.barColor} h-full border-r border-slate-950/60 transition-all`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {individualItems.map((item) => {
                const sharePct =
                  monthTotals.totalCents > 0
                    ? (item.effectiveAmountCents / monthTotals.totalCents) * 100
                    : 0;
                const catCfg = CATEGORY_CONFIG[item.provider.category];
                return (
                  <div
                    key={item.provider.id}
                    className="inline-flex items-center gap-1.5 text-[11px] text-slate-300"
                  >
                    <span className={`w-2.5 h-2.5 rounded-sm ${catCfg.barColor}`} />
                    <span className="font-medium">{item.provider.name}:</span>
                    <span className="font-mono text-slate-400">
                      {sharePct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* CARDS INDIVIDUAIS DE CADA CONTA DO MÊS SELECIONADO                   */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {individualItems.map((item) => {
          const {
            provider,
            cycle,
            effectiveAmountCents,
            isAmountPredicted,
            effectiveDueDate,
            isDueDatePredicted,
            diffCents,
            diffPct,
            isStoredInBucket,
            metadataTags,
          } = item;

          const status: CycleStatus = cycle?.status ?? 'PENDING';
          const statusBadge = STATUS_BADGE[status];
          const catCfg = CATEGORY_CONFIG[provider.category];
          const shareOfMonthPct =
            monthTotals.totalCents > 0
              ? (effectiveAmountCents / monthTotals.totalCents) * 100
              : 0;

          return (
            <div
              key={`${provider.id}-${filterMonth}`}
              className="rounded-xl border border-slate-800 bg-slate-950/85 hover:border-slate-700 transition-all flex flex-col justify-between overflow-hidden shadow-md"
            >
              {/* Card Top Header */}
              <div>
                <div className="p-5 border-b border-slate-800/80 flex items-start justify-between gap-3 bg-slate-900/50">
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2.5 rounded-xl border ${catCfg.colorClass} shrink-0`}
                    >
                      {catCfg.icon}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-bold text-white">
                          {provider.name}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {catCfg.label} • Ciclo{' '}
                        <span className="font-mono text-slate-300">
                          {filterMonth}
                        </span>
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border shrink-0 ${statusBadge.classes}`}
                  >
                    {statusBadge.icon}
                    {statusBadge.label}
                  </span>
                </div>

                {/* Individual Amount & Month Share Block */}
                <div className="p-5 border-b border-slate-800/60 bg-slate-900/20 space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                        {isAmountPredicted
                          ? 'Valor Estimado (Histórico)'
                          : 'Valor da Conta no Mês'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xl font-extrabold text-white">
                          {formatCentsToBrl(effectiveAmountCents)}
                        </span>
                        {isAmountPredicted && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            <Sparkles className="w-3 h-3" />
                            Previsto
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-mono font-semibold text-slate-300">
                        {shareOfMonthPct.toFixed(1)}% do mês
                      </span>
                      {diffCents !== null && diffPct !== null && (
                        <div className="mt-1">
                          {diffCents > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-rose-400 font-medium">
                              <TrendingUp className="w-3 h-3" />+
                              {formatCentsToBrl(diffCents)} (+{diffPct.toFixed(1)}%)
                            </span>
                          ) : diffCents < 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400 font-medium">
                              <TrendingDown className="w-3 h-3" />
                              {formatCentsToBrl(diffCents)} ({diffPct.toFixed(1)}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                              <Minus className="w-3 h-3" /> 0,0% vs mês ant.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Share Progress Bar */}
                  <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full ${catCfg.barColor}`}
                      style={{ width: `${Math.min(100, shareOfMonthPct)}%` }}
                    />
                  </div>
                </div>

                {/* Detailed Individual Data Grid */}
                <div className="p-5 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Data de Vencimento
                      </p>
                      <p className="font-semibold text-white mt-0.5 flex items-center gap-1">
                        {formatDateBr(effectiveDueDate)}
                        {isDueDatePredicted && (
                          <span
                            title={item.prediction.explanation}
                            className="text-[10px] text-purple-300 font-normal"
                          >
                            (🔮 Previsto)
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Data de Pagamento
                      </p>
                      <p className="font-semibold text-emerald-300 mt-0.5">
                        {cycle?.paid_at ? formatDateBr(cycle.paid_at) : 'Em aberto'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Consumo Físico
                      </p>
                      <p className="font-semibold text-white mt-0.5">
                        {cycle?.consumption_value !== null &&
                        cycle?.consumption_value !== undefined
                          ? `${cycle.consumption_value} ${cycle.consumption_unit ?? ''}`
                          : 'Tarifa Fixa / Mensal'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Tarifa Unitária Efetiva
                      </p>
                      <p className="font-semibold text-sky-300 mt-0.5">
                        {cycle?.unit_tariff_brl !== null &&
                        cycle?.unit_tariff_brl !== undefined
                          ? `R$ ${cycle.unit_tariff_brl.toFixed(4)} / ${
                              cycle.consumption_unit ?? 'un'
                            }`
                          : '—'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Tributos / Impostos
                      </p>
                      <p className="font-semibold text-amber-300 mt-0.5">
                        {cycle?.tax_amount_cents !== null &&
                        cycle?.tax_amount_cents !== undefined
                          ? formatCentsToBrl(cycle.tax_amount_cents)
                          : 'Isento / Incluso'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-slate-900/70 border border-slate-800/80 p-2.5">
                      <p className="text-[10px] uppercase text-slate-400">
                        Bandeira / Regime
                      </p>
                      <p className="font-semibold text-slate-200 mt-0.5 truncate">
                        {cycle?.tariff_flag ?? provider.mode}
                        {cycle?.billing_days ? ` (${cycle.billing_days}d)` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Storage Location Indicator */}
                  <div className="flex items-center justify-between text-[11px] px-3 py-2 rounded-lg bg-slate-900/50 border border-slate-800/70">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                      Storage:
                    </span>
                    {cycle?.invoice_drive_url || cycle?.receipt_drive_url ? (
                      isStoredInBucket ? (
                        <span className="font-mono text-amber-300">
                          Supabase Bucket (Sync 6h → Drive)
                        </span>
                      ) : (
                        <span className="font-mono text-emerald-300">
                          Google Drive (Contas Mensais)
                        </span>
                      )
                    ) : (
                      <span className="text-slate-500">Aguardando captura</span>
                    )}
                  </div>

                  {/* Rich Metadata Tags (ICMS, Rateio, Parcelas, Splitwise, etc.) */}
                  {metadataTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {metadataTags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 border border-slate-800"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer: Document Links & Action Button */}
              <div className="px-5 py-3.5 border-t border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {cycle?.invoice_drive_url ? (
                    <a
                      href={cycle.invoice_drive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Ver Fatura
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">Sem PDF fatura</span>
                  )}

                  {cycle?.receipt_drive_url && (
                    <a
                      href={cycle.receipt_drive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Comprovante
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {onTriggerProvider && (
                  <button
                    type="button"
                    onClick={() => onTriggerProvider(provider)}
                    disabled={triggeringId === provider.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    {triggeringId === provider.id ? 'Executando...' : 'Capturar'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
