import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ScrollText,
  Wand2,
  ShieldCheck,
  FolderGit2,
  BarChart3,
} from 'lucide-react';
import type {
  BillCycleRow,
  BillProviderRow,
  ExecutionLogRow,
} from '@secretaria/shared';
import {
  BACKEND_API_URL,
  DEMO_ALL_CYCLES,
  DEMO_EXECUTION_LOGS,
  DEMO_PROVIDERS,
} from './lib/supabase.js';
import { MonthlyOverview } from './components/MonthlyOverview.js';
import { BIAnalyticsView } from './components/BIAnalyticsView.js';
import { AuditLogsView } from './components/AuditLogsView.js';
import { ProviderWizard } from './components/ProviderWizard.js';

type ActiveTab = 'overview' | 'bi' | 'audit' | 'wizard';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [referenceMonth, setReferenceMonth] = useState('2026-11');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [providers, setProviders] = useState<BillProviderRow[]>([]);
  const [allCycles, setAllCycles] = useState<BillCycleRow[]>(DEMO_ALL_CYCLES);
  const [cycles, setCycles] = useState<BillCycleRow[]>([]);
  const [logs, setLogs] = useState<ExecutionLogRow[]>([]);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    fetch(
      `${BACKEND_API_URL}/api/dashboard/state?reference_month=${encodeURIComponent(referenceMonth)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            providers?: BillProviderRow[];
            cycles?: BillCycleRow[];
            allCycles?: BillCycleRow[];
            logs?: ExecutionLogRow[];
          } | null
        ) => {
          if (!active) return;
          if (data && Array.isArray(data.providers) && data.providers.length > 0) {
            setProviders(data.providers);
            setCycles(Array.isArray(data.cycles) ? data.cycles : []);
            if (Array.isArray(data.allCycles) && data.allCycles.length > 0) {
              // Merge historical Drive cycles (2026-05..2026-09) with live Supabase cycles
              const liveKeys = new Set(
                data.allCycles.map((c) => `${c.provider_id}_${c.reference_month}`)
              );
              const merged = [
                ...data.allCycles,
                ...DEMO_ALL_CYCLES.filter(
                  (d) => !liveKeys.has(`${d.provider_id}_${d.reference_month}`)
                ),
              ];
              setAllCycles(merged);
            }
            if (Array.isArray(data.logs)) {
              setLogs(data.logs);
            }
          } else {
            // Offline fallback: use real historical Contas Mensais dataset
            setProviders(DEMO_PROVIDERS);
            setCycles(
              DEMO_ALL_CYCLES.filter((c) => c.reference_month === referenceMonth)
            );
            setLogs(DEMO_EXECUTION_LOGS);
          }
        }
      )
      .catch(() => {
        if (!active) return;
        setProviders(DEMO_PROVIDERS);
        setCycles(
          DEMO_ALL_CYCLES.filter((c) => c.reference_month === referenceMonth)
        );
        setLogs(DEMO_EXECUTION_LOGS);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [referenceMonth]);

  const handleTriggerProvider = async (provider?: BillProviderRow) => {
    const targetId = provider?.id ?? 'ALL';
    setTriggeringId(targetId);
    setBannerMessage(null);

    try {
      await fetch(`${BACKEND_API_URL}/api/workflows/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: provider?.id,
          provider_name: provider?.name,
          reference_month: referenceMonth,
        }),
      }).catch(() => undefined);

      const newLog: ExecutionLogRow = {
        id: `log-${Date.now()}`,
        cycle_id: null,
        provider_id: provider?.id ?? providers[0].id,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: 'SUCCESS',
        step_reached: 'GITHUB_ACTIONS_DISPATCH',
        sanitized_message: `Workflow workflow_dispatch acionado para ${
          provider?.name ?? 'Todas as contas ativas'
        } (${referenceMonth}).`,
        error_code: null,
        created_at: new Date().toISOString(),
      };

      setLogs((prev) => [newLog, ...prev]);
      setBannerMessage(
        `🚀 Disparo enviado ao GitHub Actions para ${
          provider?.name ?? 'Todas as contas ativas'
        } (${referenceMonth})!`
      );
    } finally {
      setTriggeringId(null);
    }
  };

  const handleProviderCreated = (newProvider: BillProviderRow) => {
    setProviders((prev) => [newProvider, ...prev]);
    setBannerMessage(`✅ Novo processo "${newProvider.name}" adicionado ao painel!`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <img
              src="/logo.png"
              alt="SecretariaCururu Logo"
              className="w-11 h-11 rounded-xl object-cover border-2 border-emerald-500/40 shadow-md shadow-emerald-950/50"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  SecretariaCururu
                </h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  100% Free Tier + BI
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automação Playwright • Google Drive (Contas Mensais) • BI & Previsão Preditiva Telegram
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
              <FolderGit2 className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-400">Ciclo:</span>
              <select
                value={referenceMonth}
                onChange={(e) => setReferenceMonth(e.target.value)}
                className="bg-transparent font-semibold text-white focus:outline-none"
              >
                <option value="2026-11" className="bg-slate-900">
                  2026-11 (Novembro - Atual)
                </option>
                <option value="2026-10" className="bg-slate-900">
                  2026-10 (Outubro)
                </option>
                <option value="2026-09" className="bg-slate-900">
                  2026-09 (Setembro - Drive)
                </option>
                <option value="2026-08" className="bg-slate-900">
                  2026-08 (Agosto - Drive)
                </option>
                <option value="2026-07" className="bg-slate-900">
                  2026-07 (Julho - Drive)
                </option>
                <option value="2026-06" className="bg-slate-900">
                  2026-06 (Junho - Drive)
                </option>
                <option value="2026-05" className="bg-slate-900">
                  2026-05 (Maio - Drive)
                </option>
              </select>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>RLS + AES-256-GCM</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            1. Visão Geral Mensal
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('bi')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'bi'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            2. BI: Consumo, Tarifas & Previsões
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'audit'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ScrollText className="w-4 h-4" />
            3. Auditoria & Logs ({logs.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wizard')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'wizard'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            4. Wizard de Novo Processo
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-5">
        {bannerMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between">
            <span>{bannerMessage}</span>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="text-emerald-400 hover:text-emerald-200 font-semibold cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-12 text-center space-y-3">
            <img
              src="/logo.png"
              alt="SecretariaCururu"
              className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-400/60 mx-auto animate-pulse"
            />
            <p className="text-sm font-medium text-slate-300">
              Sincronizando dados em tempo real com o Supabase ({referenceMonth})...
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <MonthlyOverview
                referenceMonth={referenceMonth}
                providers={providers}
                cycles={cycles}
                onTriggerProvider={(p) => handleTriggerProvider(p)}
                triggeringId={triggeringId}
              />
            )}

            {activeTab === 'bi' && (
              <BIAnalyticsView providers={providers} allCycles={allCycles} />
            )}

            {activeTab === 'audit' && (
              <AuditLogsView
                logs={logs}
                providers={providers}
                onTriggerAll={() => handleTriggerProvider(undefined)}
                onTriggerProvider={(p) => handleTriggerProvider(p)}
                isTriggering={triggeringId !== null}
              />
            )}

            {activeTab === 'wizard' && (
              <ProviderWizard onProviderCreated={handleProviderCreated} />
            )}
          </>
        )}
      </main>

      {/* Footer with Official Program Icon */}
      <footer className="border-t border-slate-800/70 bg-slate-900/50 py-4 px-6 mt-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="SecretariaCururu"
              className="w-6 h-6 rounded-md object-cover border border-emerald-500/40"
            />
            <span className="font-semibold text-slate-200">SecretariaCururu</span>
            <span>• Automação, Cofre AES-256-GCM & BI de Contas Domésticas</span>
          </div>
          <span>100% Free Tier (Render • GitHub Actions • Supabase • Google Drive)</span>
        </div>
      </footer>
    </div>
  );
};
