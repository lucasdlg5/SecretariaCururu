import React from 'react';
import {
  Play,
  ShieldAlert,
  Terminal,
  CheckCircle,
  Clock,
  RefreshCw,
  HardDriveUpload,
} from 'lucide-react';
import type { BillProviderRow, ExecutionLogRow } from '@secretaria/shared';

interface AuditLogsViewProps {
  logs: ExecutionLogRow[];
  providers: BillProviderRow[];
  onTriggerAll: () => void;
  onTriggerProvider: (provider: BillProviderRow) => void;
  onReconcileStorage?: () => void;
  isTriggering: boolean;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({
  logs,
  providers,
  onTriggerAll,
  onTriggerProvider,
  onReconcileStorage,
  isTriggering,
}) => {
  const providerById = new Map(providers.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <img
            src="/logo.png"
            alt="SecretariaCururu"
            className="w-10 h-10 rounded-xl object-cover border border-emerald-500/40 shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <h2 className="text-base font-semibold text-white">
                Auditoria de Execuções, Conciliação 6h (Bucket → Drive) & Logs Sanitizados
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Registra capturas Playwright, fallbacks no Supabase Bucket e tentativas de
              conciliação de 6 em 6 horas para o Google Drive (com remoção automática do bucket após sucesso).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onReconcileStorage && (
            <button
              type="button"
              onClick={onReconcileStorage}
              disabled={isTriggering}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Conciliar Bucket → Google Drive (6h)
            </button>
          )}

          <button
            type="button"
            onClick={onTriggerAll}
            disabled={isTriggering}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4" />
            {isTriggering
              ? 'Acionando GitHub Actions...'
              : 'Executar Todas as Contas Agora (GitHub Actions)'}
          </button>
        </div>
      </div>

      {/* Logs List */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <div className="divide-y divide-slate-800">
          {logs.map((log) => {
            const provider = providerById.get(log.provider_id);
            const isSuccess =
              log.status === 'SUCCESS' || log.status === 'DRIVE_SYNC_SUCCESS';
            const isNotFound = log.status === 'NOT_FOUND_YET';
            const isStorageFallback =
              log.status === 'DRIVE_FALLBACK_BUCKET' ||
              log.status === 'DRIVE_SYNC_RETRY_FAILED';

            return (
              <div
                key={log.id}
                className="p-5 hover:bg-slate-800/30 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {isSuccess ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle className="w-3.5 h-3.5" />
                        {log.status}
                      </span>
                    ) : isNotFound ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-300 border border-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        NOT_FOUND_YET
                      </span>
                    ) : isStorageFallback ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <HardDriveUpload className="w-3.5 h-3.5" />
                        {log.status}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {log.status}
                      </span>
                    )}

                    <span className="font-semibold text-sm text-white">
                      {provider?.name ?? log.provider_id}
                    </span>

                    {log.step_reached && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                        Passo: {log.step_reached}
                      </span>
                    )}

                    <span className="text-xs text-slate-400">
                      {new Date(log.started_at).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-slate-300 bg-slate-950/80 border border-slate-800/80 rounded-lg px-3.5 py-2.5">
                    {log.sanitized_message}
                  </p>
                </div>

                {provider && (
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => onTriggerProvider(provider)}
                      disabled={isTriggering}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      Reexecutar Conta
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
