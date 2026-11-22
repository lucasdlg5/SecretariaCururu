import React from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  TrendingUp,
  Zap,
  Flame,
  Droplets,
  CalendarClock,
  Receipt,
  AlertTriangle,
  Sparkles,
  Scale,
} from 'lucide-react';
import {
  type BillCycleRow,
  type BillProviderRow,
  formatCentsToBrl,
  predictDueDateFromHistory,
} from '@secretaria/shared';

interface BIAnalyticsViewProps {
  providers: BillProviderRow[];
  allCycles: BillCycleRow[];
}

// ============================================================================
// Structured Real BI Datasets Extracted from "Contas Mensais" (Google Drive)
// ============================================================================
const ELECTRICITY_BI_SERIES = [
  {
    month: 'Mai/26',
    kwh: 95,
    dailyKwh: 4.32,
    amountBrl: 90.25,
    effectiveTariff: 0.95,
    icmsPct: 12,
    taxBrl: 13.97,
    flag: 'Verde/Amarela',
  },
  {
    month: 'Jun/26',
    kwh: 258,
    dailyKwh: 8.32,
    amountBrl: 263.82,
    effectiveTariff: 1.0226,
    icmsPct: 18,
    taxBrl: 55.99,
    flag: 'Amarela',
  },
  {
    month: 'Jul/26',
    kwh: 200,
    dailyKwh: 6.25,
    amountBrl: 193.91,
    effectiveTariff: 0.9696,
    icmsPct: 12,
    taxBrl: 32.8,
    flag: 'Amarela',
  },
  {
    month: 'Ago/26',
    kwh: 199,
    dailyKwh: 7.11,
    amountBrl: 193.63,
    effectiveTariff: 0.973,
    icmsPct: 12,
    taxBrl: 33.32,
    flag: 'Amarela',
  },
];

const GAS_BI_SERIES = [
  {
    month: 'Mai/26',
    m3: 1.955,
    grossSupplyBrl: 27.92,
    billedBrl: 27.92,
    unitTariffBrl: 14.28,
    taxBrl: 6.38,
  },
  {
    month: 'Jun/26',
    m3: 2.93,
    grossSupplyBrl: 41.27,
    billedBrl: 13.35, // R$ 41,27 - R$ 27,92 refund
    unitTariffBrl: 14.09,
    taxBrl: 9.44,
  },
  {
    month: 'Jul/26',
    m3: 0.981,
    grossSupplyBrl: 15.09,
    billedBrl: 15.09,
    unitTariffBrl: 15.39,
    taxBrl: 3.45,
  },
  {
    month: 'Ago/26',
    m3: 3.93,
    grossSupplyBrl: 47.55,
    billedBrl: 47.88,
    unitTariffBrl: 12.1,
    taxBrl: 10.87,
  },
];

const WATER_9M_HISTORY = [
  { month: 'Dez/25', m3: 4, billedBrl: 79.42 },
  { month: 'Jan/26', m3: 7, billedBrl: 79.42 },
  { month: 'Fev/26', m3: 8, billedBrl: 79.42 },
  { month: 'Mar/26', m3: 7, billedBrl: 79.42 },
  { month: 'Abr/26', m3: 2, billedBrl: 79.42 },
  { month: 'Mai/26', m3: 5, billedBrl: 86.64 },
  { month: 'Jun/26', m3: 5, billedBrl: 79.42 },
  { month: 'Jul/26', m3: 6, billedBrl: 79.42 },
  { month: 'Ago/26', m3: 6, billedBrl: 79.42 },
];

const INFLATION_AND_TARIFF_INDEX = [
  {
    month: 'Mai/26 (Base 100)',
    luzTariffIdx: 100.0,
    gasTariffIdx: 100.0,
    aguaRateioIdx: 100.0,
    internetIdx: 100.0,
  },
  {
    month: 'Jun/26',
    luzTariffIdx: 107.6, // Salto de ICMS 12% -> 18% (>200 kWh)
    gasTariffIdx: 98.6,
    aguaRateioIdx: 91.7,
    internetIdx: 96.8,
  },
  {
    month: 'Jul/26',
    luzTariffIdx: 102.1,
    gasTariffIdx: 107.7, // Menor diluição da parcela fixa em 0,981 m³
    aguaRateioIdx: 91.7,
    internetIdx: 96.8,
  },
  {
    month: 'Ago/26',
    luzTariffIdx: 102.4,
    gasTariffIdx: 84.7, // Diluição em 3,930 m³ (R$ 12,10/m³)
    aguaRateioIdx: 91.7,
    internetIdx: 96.8,
  },
];

const BUDGET_COMPOSITION_PIE = [
  { name: 'Aluguel Fixo (R$ 1.300,00)', value: 1300.0, color: '#34d399' },
  { name: 'Condomínio Vista Bela (R$ 225,66)', value: 225.66, color: '#a78bfa' },
  { name: 'Energia EDP (Média R$ 185,40)', value: 185.4, color: '#f59e0b' },
  { name: 'Internet Net Jacareí (R$ 134,90)', value: 134.9, color: '#38bdf8' },
  { name: 'IPTU & Lixo (Média R$ 125,65)', value: 125.65, color: '#f472b6' },
  { name: 'Água SAAE (Média R$ 81,22)', value: 81.22, color: '#60a5fa' },
  { name: 'Gás Comgás (Média R$ 26,06)', value: 26.06, color: '#fb7185' },
];

export const BIAnalyticsView: React.FC<BIAnalyticsViewProps> = ({
  providers,
  allCycles,
}) => {
  // Compute historical due date predictions for all active providers for the next cycle (2026-09 / 2026-10)
  const predictions = providers.map((prov) => {
    const provCycles = allCycles.filter((c) => c.provider_id === prov.id);
    const pred = predictDueDateFromHistory({
      targetReferenceMonth: '2026-09',
      historicalCycles: provCycles,
      defaultDueDay: prov.due_day_default,
    });
    return {
      provider: prov,
      prediction: pred,
    };
  });

  const totalTaxesPaidCents = allCycles.reduce(
    (acc, c) => acc + (c.tax_amount_cents ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Top Executive BI KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Elasticidade Energia (EDP)
            </span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            188,0 kWh <span className="text-xs font-normal text-amber-300">/mês</span>
          </p>
          <p className="mt-1 text-xs text-amber-300/80">
            Limiar Crítico: &gt;200 kWh eleva ICMS de 12% para 18% (+R$ 0,07/kWh em Jun/26)
          </p>
        </div>

        <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">
              Variação Gás (Comgás)
            </span>
            <Flame className="w-4 h-4 text-rose-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            +300,6% <span className="text-xs font-normal text-rose-300">Ago vs Jul</span>
          </p>
          <p className="mt-1 text-xs text-rose-300/80">
            Salto de 0,981 m³ para 3,930 m³; tarifa efetiva caiu de R$ 15,39 para R$ 12,10/m³
          </p>
        </div>

        <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
              Consumo Água (SAAE 9m)
            </span>
            <Droplets className="w-4 h-4 text-sky-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            5,55 m³ <span className="text-xs font-normal text-sky-300">média/mês</span>
          </p>
          <p className="mt-1 text-xs text-sky-300/80">
            Tarifa fixa mínima (R$ 72,20) + Rateio Condominial (reduzido em -50% após Mai/26)
          </p>
        </div>

        <div className="rounded-xl border border-purple-500/25 bg-purple-950/20 p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
              Carga Tributária & Taxas
            </span>
            <Receipt className="w-4 h-4 text-purple-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-white">
            {formatCentsToBrl(totalTaxesPaidCents)}
          </p>
          <p className="mt-1 text-xs text-purple-300/80">
            ICMS + PIS/COFINS + R$ 10,70 evitáveis em taxas de cartão de crédito
          </p>
        </div>
      </div>

      {/* Row 1: Electricity Consumption vs Effective Tariff & Gas Consumption vs Unit Tariff */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Electricity kWh vs R$/kWh & ICMS Bracket */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                1. Energia (EDP): Consumo (kWh) vs. Aumento de Tarifa Efetiva (R$/kWh)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Em Jun/26 (258 kWh), ultrapassar 200 kWh acionou a faixa de 18% de ICMS,
                elevando o custo efetivo de R$ 0,95/kWh para R$ 1,02/kWh.
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ELECTRICITY_BI_SERIES}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis
                  yAxisId="left"
                  stroke="#f59e0b"
                  fontSize={12}
                  label={{
                    value: 'kWh / R$',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#f59e0b',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#38bdf8"
                  domain={[0.85, 1.1]}
                  fontSize={12}
                  label={{
                    value: 'R$/kWh',
                    angle: 90,
                    position: 'insideRight',
                    fill: '#38bdf8',
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    color: '#f8fafc',
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="kwh"
                  fill="#f59e0b"
                  name="Consumo Ativo (kWh)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="left"
                  dataKey="amountBrl"
                  fill="#10b981"
                  name="Fatura Total (R$)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="effectiveTariff"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  name="Tarifa Efetiva c/ Impostos (R$/kWh)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Gas Consumption (m³) vs Unit Tariff Dilution (Comgás) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400" />
                2. Gás (Comgás): Consumo (m³) vs. Tarifa Aplicada (R$/m³)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Efeito da tarifa binômia (Fixo + Variável): em Jul/26 (0,98 m³) o m³ saiu a
                R$ 15,39; em Ago/26 (3,93 m³) caiu para R$ 12,10/m³.
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={GAS_BI_SERIES}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis yAxisId="left" stroke="#fb7185" fontSize={12} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#a78bfa"
                  domain={[0, 18]}
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    color: '#f8fafc',
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="grossSupplyBrl"
                  fill="#fb7185"
                  name="Fornecimento Bruto (R$)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="left"
                  dataKey="billedBrl"
                  fill="#34d399"
                  name="Valor Cobrado no Boleto (R$)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="m3"
                  stroke="#facc15"
                  strokeWidth={2.5}
                  name="Consumo Medido (m³)"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="unitTariffBrl"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  name="Tarifa Unitária c/ ICMS (R$/m³)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: Water 9-Month History & Price Index / Tariff Inflation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 3: Water 9-Month Consumption History (SAAE Jacareí) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Droplets className="w-4 h-4 text-sky-400" />
              3. Água (SAAE Jacareí): Histórico de 9 Meses de Consumo (m³) vs. Fatura (R$)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Série histórica extraída do quadro de leituras das faturas SAAE (Dez/2025 a
              Ago/2026). Consumo varia de 2 m³ a 8 m³ dentro da franquia mínima residencial.
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={WATER_9M_HISTORY}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis yAxisId="left" stroke="#38bdf8" domain={[0, 12]} fontSize={12} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#34d399"
                  domain={[60, 100]}
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    color: '#f8fafc',
                  }}
                />
                <Legend />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="m3"
                  fill="#0284c7"
                  fillOpacity={0.25}
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  name="Consumo de Água (m³)"
                />
                <Line
                  yAxisId="right"
                  type="stepAfter"
                  dataKey="billedBrl"
                  stroke="#34d399"
                  strokeWidth={2.5}
                  name="Valor da Fatura SAAE (R$)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Tariff & Price Evolution Index (Base 100 = Maio/2026) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              4. Índice de Reajuste & Variação de Preço Unitário (Base 100 = Mai/26)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Comparativo normalizado de evolução de preço unitário entre Energia (R$/kWh),
              Gás (R$/m³), Água (custo c/ rateio) e Internet (mensalidade).
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={INFLATION_AND_TARIFF_INDEX}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" domain={[80, 115]} fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    color: '#f8fafc',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="luzTariffIdx"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  name="Índice Tarifa Luz (R$/kWh)"
                />
                <Line
                  type="monotone"
                  dataKey="gasTariffIdx"
                  stroke="#fb7185"
                  strokeWidth={2.5}
                  name="Índice Tarifa Gás (R$/m³)"
                />
                <Line
                  type="monotone"
                  dataKey="aguaRateioIdx"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  name="Índice Água + Rateio"
                />
                <Line
                  type="monotone"
                  dataKey="internetIdx"
                  stroke="#34d399"
                  strokeWidth={2}
                  name="Índice Internet NJCI"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Budget Composition Pie + Predictive Due Date Engine Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chart 5: Fixed vs Variable Cost Structure */}
        <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Scale className="w-4 h-4 text-purple-400" />
              5. Composição do Custo Mensal (86% Fixo vs. 14% Variável)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Média mensal consolidada: R$ 2.078,89 (R$ 1.039,45 por morador na divisão
              50/50 Splitwise).
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={BUDGET_COMPOSITION_PIE}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={3}
                >
                  {BUDGET_COMPOSITION_PIE.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(val: number) =>
                    new Intl.NumberFormat('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    }).format(val)
                  }
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.5rem',
                    color: '#f8fafc',
                  }}
                />
                <Legend verticalAlign="bottom" height={48} iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table 6: Historical Due Date Prediction Engine (Especially for MANUAL_REQUIRED) */}
        <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-emerald-400" />
              6. Motor Preditivo de Vencimentos (Baseado no Histórico Real)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Previsão automática enviada no Telegram para contas com{' '}
              <code className="text-rose-300">MANUAL_REQUIRED</code> (Aluguel, Condomínio,
              IPTU ou portais com CAPTCHA pendente).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase bg-slate-950/60">
                  <th className="py-2.5 px-3">Conta</th>
                  <th className="py-2.5 px-3">Modo</th>
                  <th className="py-2.5 px-3">Venc. Previsto (Próx.)</th>
                  <th className="py-2.5 px-3">Valor Estimado</th>
                  <th className="py-2.5 px-3">Confiança & Base Histórica</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {predictions.map(({ provider, prediction }) => (
                  <tr key={provider.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-medium text-white">
                      {provider.name}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] border ${
                          provider.mode === 'MANUAL_REMINDER'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                        }`}
                      >
                        {provider.mode}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-emerald-300">
                      {prediction.predictedDueDate.split('-').reverse().join('/')}
                    </td>
                    <td className="py-2.5 px-3 text-slate-200 font-medium">
                      {formatCentsToBrl(prediction.predictedAmountCents)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      <span className="text-emerald-400 font-semibold">
                        [{prediction.confidence}]
                      </span>{' '}
                      {prediction.explanation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row 4: Actionable BI Findings & Anomaly Insights Discovered in the Drive PDFs */}
      <div className="rounded-xl border border-emerald-500/25 bg-slate-900/80 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="SecretariaCururu"
            className="w-9 h-9 rounded-lg object-cover border border-emerald-500/40 shrink-0"
          />
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-semibold text-white">
              7. Insights & Anomalias Financeiras Descobertas nas Faturas Reais (Google Drive)
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4 space-y-1.5">
            <div className="font-semibold text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Degrau Tributário ICMS na Luz (200 kWh)
            </div>
            <p className="text-slate-300 leading-relaxed">
              Nas faturas EDP de Mai/26 (95 kWh), Jul/26 (200 kWh) e Ago/26 (199 kWh), a
              alíquota de ICMS foi de <strong>12%</strong>. Em Jun/26 (258 kWh), ao passar
              de 200 kWh, o ICMS saltou para <strong>18%</strong> (R$ 47,49 só de ICMS),
              encarecendo toda a fatura em ~7,6%. Manter o consumo até <strong>200 kWh</strong>{' '}
              economiza ~R$ 16/mês em tributos.
            </p>
          </div>

          <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-4 space-y-1.5">
            <div className="font-semibold text-sky-300 flex items-center gap-1.5">
              <Receipt className="w-4 h-4 shrink-0" />
              Desmembramento do Condomínio & Fim da Taxa de Lixo
            </div>
            <p className="text-slate-300 leading-relaxed">
              Até Ago/26, a imobiliária <em>Cristina Sarturi</em> cobrava o Condomínio (R$
              225,66) junto ao boleto de Aluguel no dia 30. A partir de{' '}
              <strong>Set/2026</strong>, o Condomínio passou a vencer separadamente todo{' '}
              <strong>dia 10</strong>, enquanto o Aluguel (R$ 1.300,00) + IPTU (R$ 92,92,
              parcelas 4/6 a 6/6) permanecem no <strong>dia 30</strong>. Além disso, a Taxa
              de Lixo (R$ 43,64) encerrou sua parcela 3/3 em Julho, reduzindo o custo fixo.
            </p>
          </div>

          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-4 space-y-1.5">
            <div className="font-semibold text-rose-300 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 shrink-0" />
              Custos Financeiros Evitáveis (Cartão/Multa/Duplicidade)
            </div>
            <p className="text-slate-300 leading-relaxed">
              Os comprovantes revelaram: (1) Pagamento da Internet de Jun/26 via cartão no
              Santander gerou <strong>R$ 5,55</strong> de tarifa + IOF (CET 62,22% a.a.); (2)
              Água de Jul/26 paga via cartão no Mercado Pago gerou <strong>R$ 5,15</strong>{' '}
              de taxa; (3) Gás de Mai/26 (R$ 27,92) foi pago em duplicidade com o débito
              automático e ressarcido na fatura de Jun/26. Pagar exclusivamente via{' '}
              <strong>PIX</strong> evita ~R$ 130/ano em taxas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
