import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Lock,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import {
  type BillCategory,
  type BillProviderRow,
  CreateProviderInputSchema,
  PROVIDER_TEMPLATES,
  type ProviderMode,
  type WorkflowStep,
} from '@secretaria/shared';

interface ProviderWizardProps {
  onProviderCreated: (newProvider: BillProviderRow) => void;
}

const CATEGORIES: BillCategory[] = [
  'LUZ',
  'AGUA',
  'INTERNET',
  'GAS',
  'CONDOMINIO',
  'ALUGUEL',
  'OUTROS',
];

const MODES: Array<{ value: ProviderMode; label: string; desc: string }> = [
  {
    value: 'WEB_AUTOMATION',
    label: 'Automação Web (Playwright)',
    desc: 'Executa passos declarativos no portal do provedor via GitHub Actions e captura o PDF.',
  },
  {
    value: 'MANUAL_REMINDER',
    label: 'Lembrete Manual (Telegram)',
    desc: 'No dia de gatilho, solicita a fatura no Telegram e arquiva na pasta Faturas do Drive.',
  },
  {
    value: 'EMAIL_WATCH',
    label: 'Monitoramento de E-mail',
    desc: 'Aguarda encaminhamento ou chegada de fatura por e-mail/bot.',
  },
];

export const ProviderWizard: React.FC<ProviderWizardProps> = ({
  onProviderCreated,
}) => {
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BillCategory>('OUTROS');
  const [mode, setMode] = useState<ProviderMode>('WEB_AUTOMATION');
  const [isActive, setIsActive] = useState(true);
  const [triggerDay, setTriggerDay] = useState(5);
  const [dueDayDefault, setDueDayDefault] = useState(15);
  const [portalUrl, setPortalUrl] = useState('');
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([
    {
      action: 'goto',
      url: 'https://exemplo.com.br/login',
      description: 'Acessar portal do provedor',
    },
  ]);
  const [secretsList, setSecretsList] = useState<
    Array<{ key: string; value: string }>
  >([
    { key: 'EMAIL', value: '' },
    { key: 'PASSWORD', value: '' },
  ]);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const applyPresetTemplate = (templateId: string) => {
    const tpl = PROVIDER_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;

    setName(tpl.name);
    setCategory(tpl.category);
    setMode(tpl.mode);
    setIsActive(tpl.is_active);
    setTriggerDay(tpl.trigger_day);
    setDueDayDefault(tpl.due_day_default);
    setPortalUrl(tpl.portal_url ?? '');
    setWorkflowSteps(tpl.workflow_steps);
    setSecretsList(
      tpl.required_secret_keys.map((k) => ({
        key: k,
        value: '',
      }))
    );
    setValidationError(null);
  };

  const addWorkflowStep = (actionType: WorkflowStep['action']) => {
    let newStep: WorkflowStep;
    switch (actionType) {
      case 'goto':
        newStep = {
          action: 'goto',
          url: portalUrl || 'https://portal.exemplo.com.br',
          description: 'Navegar para URL',
        };
        break;
      case 'fill_secret':
        newStep = {
          action: 'fill_secret',
          selector: 'input[name="usuario"]',
          secretKey: 'CPF',
          description: 'Preencher credencial criptografada',
        };
        break;
      case 'click':
        newStep = {
          action: 'click',
          selector: 'button[type="submit"]',
          textFallback: 'Entrar',
          description: 'Clicar em elemento',
        };
        break;
      case 'dismiss_optional_modal':
        newStep = {
          action: 'dismiss_optional_modal',
          selector: 'button:has-text("Agora não")',
          timeoutMs: 4000,
          description: 'Dispensar modal opcional',
        };
        break;
      case 'wait_for':
        newStep = {
          action: 'wait_for',
          selector: '.fatura-container',
          timeoutMs: 15000,
          description: 'Aguardar seletor na tela',
        };
        break;
      case 'captcha_hitl':
        newStep = {
          action: 'captcha_hitl',
          imageSelector: 'img.captcha',
          inputSelector: 'input[name="captcha"]',
          mode: 'IMAGE_OR_MANUAL_LINK',
          description: 'Resolver CAPTCHA via Telegram HITL',
        };
        break;
      case 'extract_value':
        newStep = {
          action: 'extract_value',
          selector: '.valor-fatura',
          regex: 'R\\$\\s*([\\d\\.,]+)',
          description: 'Extrair valor em R$',
        };
        break;
      case 'download_pdf':
        newStep = {
          action: 'download_pdf',
          triggerSelector: 'button:has-text("Baixar PDF")',
          description: 'Baixar PDF da fatura',
        };
        break;
    }

    setWorkflowSteps((prev) => [...prev, newStep]);
  };

  const removeWorkflowStep = (index: number) => {
    setWorkflowSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStepField = (index: number, field: string, value: unknown) => {
    setWorkflowSteps((prev) =>
      prev.map((step, i) =>
        i === index ? ({ ...step, [field]: value } as WorkflowStep) : step
      )
    );
  };

  const handleSaveProvider = () => {
    setValidationError(null);
    setSuccessMessage(null);

    const plainSecrets: Record<string, string> = {};
    for (const item of secretsList) {
      const k = item.key.trim().toUpperCase();
      const v = item.value.trim();
      if (k && v) {
        plainSecrets[k] = v;
      }
    }

    const candidate = {
      name: name.trim(),
      category,
      mode,
      is_active: isActive,
      trigger_day: Number(triggerDay),
      due_day_default: Number(dueDayDefault),
      portal_url: portalUrl.trim() ? portalUrl.trim() : null,
      max_retry_days: 3,
      workflow_steps: mode === 'WEB_AUTOMATION' ? workflowSteps : [],
      fallback_workflow_steps: [],
      plain_secrets: Object.keys(plainSecrets).length > 0 ? plainSecrets : undefined,
    };

    const parsed = CreateProviderInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setValidationError(
        `Erro de validação Zod (${firstIssue.path.join('.')}): ${firstIssue.message}`
      );
      return;
    }

    const createdProvider: BillProviderRow = {
      id: `prov-${Date.now()}`,
      name: parsed.data.name,
      category: parsed.data.category,
      mode: parsed.data.mode,
      is_active: parsed.data.is_active,
      trigger_day: parsed.data.trigger_day,
      due_day_default: parsed.data.due_day_default,
      portal_url: parsed.data.portal_url ?? null,
      workflow_steps: parsed.data.workflow_steps,
      fallback_workflow_steps: parsed.data.fallback_workflow_steps,
      encrypted_secrets: {},
      max_retry_days: parsed.data.max_retry_days,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    onProviderCreated(createdProvider);
    setSuccessMessage(
      `Processo "${createdProvider.name}" validado via Zod e salvo com credenciais protegidas em AES-256-GCM!`
    );
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
      {/* Preset Quick-Load Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Wizard de Novo Processo de Fatura (Construtor Declarativo)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Carregue um template homologado (EDP, NJCI, Comgás, Água, Condomínio, Aluguel) ou
            construa um fluxo web customizado validado por Zod.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Carregar Preset:</span>
          {PROVIDER_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyPresetTemplate(tpl.id)}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              {tpl.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stepper Header */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { step: 1, title: '1. Dados & Agendamento' },
          { step: 2, title: '2. Passos do Workflow (Playwright)' },
          { step: 3, title: '3. Secrets (AES-256-GCM) & Revisão' },
        ].map((item) => (
          <button
            key={item.step}
            type="button"
            onClick={() => setWizardStep(item.step as 1 | 2 | 3)}
            className={`py-2.5 px-4 rounded-lg text-xs font-semibold border text-left transition-colors cursor-pointer ${
              wizardStep === item.step
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400'
            }`}
          >
            {item.title}
          </button>
        ))}
      </div>

      {validationError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 flex items-center gap-2.5 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-4 flex items-center gap-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* STEP 1: Basic Info & Schedule */}
      {wizardStep === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Nome da Conta / Provedor *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Luz - EDP São Paulo"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Categoria *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BillCategory)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  mode === m.value
                    ? 'border-emerald-500 bg-emerald-950/20'
                    : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold text-white">{m.label}</div>
                <p className="text-[11px] text-slate-400 mt-1">{m.desc}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Dia de Gatilho da Captura (1 a 31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={triggerDay}
                onChange={(e) => setTriggerDay(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Dia Padrão de Vencimento (1 a 31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={dueDayDefault}
                onChange={(e) => setDueDayDefault(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                URL do Portal (opcional em modo manual)
              </label>
              <input
                type="url"
                value={portalUrl}
                onChange={(e) => setPortalUrl(e.target.value)}
                placeholder="https://www.edponline.com.br/..."
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setWizardStep(2)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
            >
              Próximo: Configurar Fluxo <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Declarative Playwright Steps */}
      {wizardStep === 2 && (
        <div className="space-y-5">
          {mode !== 'WEB_AUTOMATION' ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center">
              <p className="text-sm text-slate-300">
                Esta conta está configurada no modo <strong>{mode}</strong>. Não são necessários
                passos de automação Playwright.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-400">
                  Adicionar Primitiva:
                </span>
                {(
                  [
                    'goto',
                    'fill_secret',
                    'click',
                    'dismiss_optional_modal',
                    'wait_for',
                    'captcha_hitl',
                    'extract_value',
                    'download_pdf',
                  ] as Array<WorkflowStep['action']>
                ).map((actionType) => (
                  <button
                    key={actionType}
                    type="button"
                    onClick={() => addWorkflowStep(actionType)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> {actionType}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {workflowSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-800 bg-slate-950/80 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-mono font-semibold text-emerald-400">
                        {step.action}
                      </span>
                    </div>

                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full">
                      {'url' in step && (
                        <input
                          type="text"
                          value={step.url}
                          onChange={(e) => updateStepField(idx, 'url', e.target.value)}
                          placeholder="URL destino (https://...)"
                          className="rounded bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs text-white"
                        />
                      )}

                      {'selector' in step && (
                        <input
                          type="text"
                          value={step.selector}
                          onChange={(e) =>
                            updateStepField(idx, 'selector', e.target.value)
                          }
                          placeholder="Seletor CSS/Playwright"
                          className="rounded bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                        />
                      )}

                      {'triggerSelector' in step && (
                        <input
                          type="text"
                          value={step.triggerSelector}
                          onChange={(e) =>
                            updateStepField(idx, 'triggerSelector', e.target.value)
                          }
                          placeholder="Seletor do botão de download PDF"
                          className="rounded bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-mono text-white"
                        />
                      )}

                      {'secretKey' in step && (
                        <input
                          type="text"
                          value={step.secretKey}
                          onChange={(e) =>
                            updateStepField(
                              idx,
                              'secretKey',
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Chave Secret (ex: EMAIL, PASSWORD, CPF)"
                          className="rounded bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-mono text-amber-300"
                        />
                      )}

                      {'textFallback' in step && (
                        <input
                          type="text"
                          value={step.textFallback ?? ''}
                          onChange={(e) =>
                            updateStepField(idx, 'textFallback', e.target.value)
                          }
                          placeholder="Texto fallback ou {{secret:UC_NUMBER}}"
                          className="rounded bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs text-white"
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeWorkflowStep(idx)}
                      className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setWizardStep(1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button
              type="button"
              onClick={() => setWizardStep(3)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
            >
              Próximo: Cofre de Secrets <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Encrypted Secrets & Submit */}
      {wizardStep === 3 && (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 space-y-1">
              <p className="font-semibold text-emerald-300">
                Criptografia Autenticada AES-256-GCM (Zero Plaintext Policy)
              </p>
              <p>
                Os valores preenchidos abaixo são criptografados no Backend com{' '}
                <code>APP_MASTER_KEY</code> gerando <code>{'{ ciphertext, iv, authTag }'}</code>{' '}
                únicos por chave antes de gravar na coluna <code>encrypted_secrets</code>.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {secretsList.map((item, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={item.key}
                  onChange={(e) => {
                    const updated = [...secretsList];
                    updated[idx] = {
                      ...updated[idx],
                      key: e.target.value.toUpperCase(),
                    };
                    setSecretsList(updated);
                  }}
                  placeholder="CHAVE (ex: CPF, EMAIL, UC_NUMBER)"
                  className="rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs font-mono text-amber-300"
                />
                <input
                  type="password"
                  value={item.value}
                  onChange={(e) => {
                    const updated = [...secretsList];
                    updated[idx] = { ...updated[idx], value: e.target.value };
                    setSecretsList(updated);
                  }}
                  placeholder="Valor secreto (será criptografado com AES-256-GCM)"
                  className="md:col-span-2 rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-xs text-white"
                />
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setSecretsList((prev) => [...prev, { key: 'NOVA_CHAVE', value: '' }])
              }
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar outra chave de secret
            </button>
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setWizardStep(2)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>

            <button
              type="button"
              onClick={handleSaveProvider}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" /> Validar com Zod & Salvar Processo
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
