import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Play,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import {
  type BillCycleRow,
  type BillProviderRow,
  type CycleStatus,
  formatCentsToBrl,
} from '@secretaria/shared';
import { DEMO_MONTHLY_HISTORY } from '../lib/supabase.js';

interface MonthlyOverviewProps {
  referenceMonth: string;
  providers: BillProviderRow[];
  cycles: BillCycleRow[];
  onTriggerProvider: (provider: BillProviderRow) => void;
  triggeringId: string | null;
}

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
    label: 'Aguardando CAPTCHA (Telegram)',
    classes: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  RUNNING: {
    label: 'Executando Worker...',
    classes: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    icon: <Clock className="w-3.5 h-3.5 animate-spin" />,
  },
  NOT_FOUND_YET: {
    label: 'Fatura Ainda Não Emitida',
    classes: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  MANUAL_REQUIRED: {
    label: 'Ação Manual Solicitada',
    classes: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  PROVIDER_DOWN: {
    label: 'Portal Indisponível (Backoff)',
    classes: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  PENDING: {
    label: 'Aguardando Dia de Gatilho',
    classes: 'bg-slate-800 text-slate-400 border-slate-700',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

export const MonthlyOverview: React.FC<MonthlyOverviewProps> = ({
  referenceMonth,
  providers,
  cycles,
  onTriggerProvider,
  triggeringId,
}) => {
  const cycleByProvider = new Map(cycles.map((c) => [c.provider_id, c]));

  const totalCents = cycles.reduce((acc, c) => acc + (c.amount_cents ?? 0), 0);
  const paidCents = cycles
    .filter((c) => c.status === 'PAID_RECONCILED')
    .reduce((acc, c) => acc + (c.amount_cents ?? 0), 0);
  const openCents = totalCents - paidCents;

  const activeProvidersCount = providers.filter((p) => p.is_active).length;
  const reconciledCount = cycles.filter((c) => c.status === 'PAID_RECONCILED').length;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Total do Ciclo ({referenceMonth})
          </p>
          <p className="mt-2 text-2xl font-bold text-white">
            {formatCentsToBrl(totalCents)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {cycles.length} faturas registradas no mês
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
            Conciliado & Pago
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-300">
            {formatCentsToBrl(paidCents)}
          </p>
          <p className="mt-1 text-xs text-emerald-400/80">
            {reconciledCount} de {activeProvidersCount} contas ativas quitadas
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-400">
            Aberto para Pagamento
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-300">
            {formatCentsToBrl(openCents)}
          </p>
          <p className="mt-1 text-xs text-amber-400/80">
            Envie o comprovante no Bot Telegram
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Segurança & Cofre
            </p>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-lg font-bold text-slate-100">AES-256-GCM</p>
          <p className="mt-1 text-xs text-slate-400">
            Zero Plaintext + Log Redactor Ativo
          </p>
        </div>
      </div>

      {/* Provider Status Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="SecretariaCururu"
              className="w-9 h-9 rounded-lg object-cover border border-emerald-500/40 shrink-0"
            />
            <div>
              <h2 className="text-base font-semibold text-white">
                Status de Contas Domésticas ({referenceMonth})
              </h2>
              <p className="text-xs text-slate-400">
                Acompanhamento em tempo real da captura via Playwright, Drive e conciliação no Telegram
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 bg-slate-900/90">
                <th className="py-3.5 px-6">Conta / Provedor</th>
                <th className="py-3.5 px-4">Modo</th>
                <th className="py-3.5 px-4">Gatilho / Venc.</th>
                <th className="py-3.5 px-4">Status Atual</th>
                <th className="py-3.5 px-4">Valor</th>
                <th className="py-3.5 px-4">Google Drive</th>
                <th className="py-3.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-sm">
              {providers.map((provider) => {
                const cycle = cycleByProvider.get(provider.id);
                const status: CycleStatus = cycle?.status ?? 'PENDING';
                const badge = STATUS_BADGE[status];

                return (
                  <tr
                    key={provider.id}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      !provider.is_active ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="py-4 px-6">
                      <div className="font-medium text-white flex items-center gap-2">
                        {provider.name}
                        {!provider.is_active && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            Inativo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Categoria: <span className="text-slate-300">{provider.category}</span>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                        {provider.mode}
                      </span>
                    </td>

                    <td className="py-4 px-4 text-xs text-slate-300">
                      <div>Captura: Dia {provider.trigger_day}</div>
                      <div className="text-slate-400">
                        Venc: {cycle?.due_date ?? `Dia ${provider.due_day_default}`}
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge.classes}`}
                      >
                        {badge.icon}
                        {badge.label}
                      </span>
                    </td>

                    <td className="py-4 px-4 font-semibold text-white">
                      {formatCentsToBrl(cycle?.amount_cents)}
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        {cycle?.invoice_drive_url ? (
                          <a
                            href={cycle.invoice_drive_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20"
                          >
                            Fatura <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500">Sem fatura</span>
                        )}

                        {cycle?.receipt_drive_url && (
                          <a
                            href={cycle.receipt_drive_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20"
                          >
                            Comprovante <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => onTriggerProvider(provider)}
                        disabled={triggeringId === provider.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {triggeringId === provider.id ? 'Disparando...' : 'Executar Agora'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Evolution Chart by Category */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">
            Evolução Mensal de Despesas Domésticas por Categoria (R$)
          </h3>
          <p className="text-xs text-slate-400">
            Histórico consolidado dos últimos 6 meses por categoria de despesa
          </p>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={DEMO_MONTHLY_HISTORY}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  color: '#f8fafc',
                }}
              />
              <Legend />
              <Bar dataKey="LUZ" stackId="a" fill="#f59e0b" name="Luz (EDP)" />
              <Bar dataKey="AGUA" stackId="a" fill="#60a5fa" name="Água (SAAE)" />
              <Bar dataKey="INTERNET" stackId="a" fill="#38bdf8" name="Internet (NJCI)" />
              <Bar dataKey="GAS" stackId="a" fill="#fb7185" name="Gás (Comgás)" />
              <Bar dataKey="CONDOMINIO" stackId="a" fill="#a78bfa" name="Condomínio" />
              <Bar dataKey="ALUGUEL" stackId="a" fill="#34d399" name="Aluguel" />
              <Bar dataKey="OUTROS" stackId="a" fill="#f472b6" name="IPTU & Lixo" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
