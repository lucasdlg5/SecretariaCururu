import type {
  BillCategory,
  ProviderMode,
  WorkflowStep,
} from './schemas.js';

export interface ProviderPresetTemplate {
  id: string;
  name: string;
  category: BillCategory;
  mode: ProviderMode;
  is_active: boolean;
  trigger_day: number;
  due_day_default: number;
  portal_url: string | null;
  required_secret_keys: string[];
  workflow_steps: WorkflowStep[];
  fallback_workflow_steps: WorkflowStep[];
}

export const PROVIDER_TEMPLATES: ProviderPresetTemplate[] = [
  {
    id: 'edp-luz',
    name: 'Luz - EDP',
    category: 'LUZ',
    mode: 'WEB_AUTOMATION',
    is_active: true,
    trigger_day: 5,
    due_day_default: 15,
    portal_url: 'https://www.edponline.com.br/para-sua-casa/login',
    required_secret_keys: ['EMAIL', 'PASSWORD', 'CPF', 'UC_NUMBER'],
    workflow_steps: [
      {
        action: 'goto',
        url: 'https://www.edponline.com.br/para-sua-casa/login',
        description: 'Acessar portal EDP Online',
      },
      {
        action: 'fill_secret',
        selector: 'input[type="email"], input[name="email"], #email',
        secretKey: 'EMAIL',
        description: 'Preencher e-mail de login ({{secret:EMAIL}})',
      },
      {
        action: 'fill_secret',
        selector: 'input[type="password"], input[name="password"], #password',
        secretKey: 'PASSWORD',
        description: 'Preencher senha ({{secret:PASSWORD}})',
      },
      {
        action: 'click',
        selector: 'button[type="submit"]',
        textFallback: 'Entrar',
        description: 'Confirmar login',
      },
      {
        action: 'click',
        selector: '[data-uc], .instalacao-card',
        textFallback: '{{secret:UC_NUMBER}}',
        description: 'Selecionar Unidade Consumidora ({{secret:UC_NUMBER}})',
      },
      {
        action: 'dismiss_optional_modal',
        selector: 'button:has-text("Mais tarde")',
        timeoutMs: 4000,
        description: 'Fechar modal opcional de atualização cadastral',
      },
      {
        action: 'dismiss_optional_modal',
        selector: 'button:has-text("Agora não")',
        timeoutMs: 4000,
        description: 'Fechar modal opcional de PIX Automático',
      },
      {
        action: 'click',
        selector: 'button:has-text("Abrir essa conta"), a:has-text("Abrir essa conta")',
        textFallback: 'Abrir essa conta',
        description: 'Clicar em Abrir essa conta',
      },
      {
        action: 'click',
        selector: 'button:has-text("Visualizar fatura")',
        textFallback: 'Visualizar fatura',
        description: 'Clicar em Visualizar fatura',
      },
      {
        action: 'wait_for',
        selector: 'button:has-text("Baixar"), a:has-text("Baixar")',
        timeoutMs: 15000,
        description: 'Aguardar modal da fatura carregar',
      },
      {
        action: 'extract_value',
        selector: '.valor-fatura, .fatura-detalhe',
        regex: 'R\\$\\s*([\\d\\.,]+)',
        description: 'Extrair valor da fatura',
      },
      {
        action: 'download_pdf',
        triggerSelector: 'button:has-text("Baixar"), a:has-text("Baixar")',
        description: 'Clicar em Baixar para capturar o PDF',
      },
    ],
    fallback_workflow_steps: [
      {
        action: 'goto',
        url: 'https://www.edponline.com.br/servicos/segunda-via',
        description: 'Acessar Segunda Via Simplificada EDP',
      },
      {
        action: 'click',
        selector: 'button:has-text("São Paulo"), [data-uf="SP"]',
        textFallback: 'São Paulo',
        description: 'Selecionar estado de São Paulo',
      },
      {
        action: 'fill_secret',
        selector: 'input[name="documento"], #cpf',
        secretKey: 'CPF',
        description: 'Preencher CPF ({{secret:CPF}})',
      },
      {
        action: 'fill_secret',
        selector: 'input[name="instalacao"], #uc',
        secretKey: 'UC_NUMBER',
        description: 'Preencher UC ({{secret:UC_NUMBER}})',
      },
      {
        action: 'click',
        selector: 'button[type="submit"]',
        textFallback: 'Continuar',
        description: 'Avançar na busca de segunda via',
      },
      {
        action: 'dismiss_optional_modal',
        selector: 'button:has-text("Não enviar")',
        timeoutMs: 4000,
        description: 'Clicar em Não enviar no modal de protocolo',
      },
      {
        action: 'click',
        selector: 'button:has-text("Enviar por e-mail"), input[value="email"]',
        textFallback: 'Enviar',
        description: 'Selecionar e-mail e enviar',
      },
    ],
  },
  {
    id: 'njci-internet',
    name: 'Internet - NJCI',
    category: 'INTERNET',
    mode: 'WEB_AUTOMATION',
    is_active: true,
    trigger_day: 8,
    due_day_default: 20,
    portal_url: 'https://portal.njci.com.br/auth/login',
    required_secret_keys: ['CPF'],
    workflow_steps: [
      {
        action: 'goto',
        url: 'https://portal.njci.com.br/auth/login',
        description: 'Acessar portal NJCI',
      },
      {
        action: 'click',
        selector: 'a:has-text("Facilita"), button:has-text("Facilita"), .facilita-icon',
        textFallback: 'Facilita',
        description: 'Clicar no ícone Facilita',
      },
      {
        action: 'fill_secret',
        selector: 'input[name="cpf"], input[placeholder*="CPF"]',
        secretKey: 'CPF',
        description: 'Preencher CPF ({{secret:CPF}})',
      },
      {
        action: 'captcha_hitl',
        imageSelector: 'img.captcha-image, #captcha-img',
        inputSelector: 'input[name="captcha"]',
        mode: 'IMAGE_OR_MANUAL_LINK',
        description: 'Resolver CAPTCHA via Telegram HITL',
      },
      {
        action: 'click',
        selector: 'button:has-text("Próximo"), button[type="submit"]',
        textFallback: 'Próximo',
        description: 'Clicar em Próximo',
      },
      {
        action: 'wait_for',
        selector: 'table, .faturas-lista',
        timeoutMs: 15000,
        description: 'Aguardar listagem de faturas',
      },
      {
        action: 'extract_value',
        selector: 'table tbody tr:first-child',
        regex: 'R\\$\\s*([\\d\\.,]+)',
        description: 'Extrair valor da fatura de vencimento mais próximo',
      },
      {
        action: 'click',
        selector:
          'table tbody tr:first-child .fa-print, table tbody tr:first-child button[title*="Imprimir"]',
        textFallback: 'Imprimir',
        description: 'Clicar no ícone da impressora na coluna Ações',
      },
      {
        action: 'download_pdf',
        triggerSelector: 'button:has-text("Imprimir"), a:has-text("Imprimir")',
        description: 'Clicar em Imprimir para baixar o PDF',
      },
    ],
    fallback_workflow_steps: [],
  },
  {
    id: 'comgas-gas',
    name: 'Gás - Comgás',
    category: 'GAS',
    mode: 'WEB_AUTOMATION',
    is_active: true,
    trigger_day: 10,
    due_day_default: 22,
    portal_url: 'https://virtual.comgas.com.br/',
    required_secret_keys: ['EMAIL', 'PASSWORD'],
    workflow_steps: [
      {
        action: 'goto',
        url: 'https://virtual.comgas.com.br/',
        description: 'Acessar portal Comgás',
      },
      {
        action: 'click',
        selector: 'a:has-text("Login"), button:has-text("Login")',
        textFallback: 'Login',
        description: 'Clicar em Login',
      },
      {
        action: 'click',
        selector: 'button:has-text("Residencial/Comercial"), [data-segment="residencial"]',
        textFallback: 'Residencial/Comercial',
        description: 'Selecionar Residencial/Comercial',
      },
      {
        action: 'fill_secret',
        selector: 'input[type="email"], input[name="username"]',
        secretKey: 'EMAIL',
        description: 'Preencher e-mail ({{secret:EMAIL}})',
      },
      {
        action: 'fill_secret',
        selector: 'input[type="password"], input[name="password"]',
        secretKey: 'PASSWORD',
        description: 'Preencher senha ({{secret:PASSWORD}})',
      },
      {
        action: 'click',
        selector: 'button.btn-submit, button[type="submit"], .arrow-right',
        textFallback: 'Entrar',
        description: 'Clicar na seta para a direita',
      },
      {
        action: 'dismiss_optional_modal',
        selector: '.modal-atualizar-dados button.close, button[aria-label="Fechar"]',
        timeoutMs: 4000,
        description: 'Fechar modal de atualizar dados (X)',
      },
      {
        action: 'dismiss_optional_modal',
        selector: '.modal-bem-vindo button.close, button[aria-label="Close"]',
        timeoutMs: 4000,
        description: 'Fechar modal de bem-vindo (X)',
      },
      {
        action: 'wait_for',
        selector: 'button:has-text("Segunda via PDF"), a:has-text("Segunda via PDF")',
        timeoutMs: 15000,
        description: 'Aguardar botão Segunda via PDF',
      },
      {
        action: 'extract_value',
        selector: '.fatura-card, .valor-conta',
        regex: 'R\\$\\s*([\\d\\.,]+)',
        description: 'Extrair valor da fatura Comgás',
      },
      {
        action: 'download_pdf',
        triggerSelector: 'button:has-text("Segunda via PDF"), a:has-text("Segunda via PDF")',
        description: 'Clicar em Segunda via PDF',
      },
    ],
    fallback_workflow_steps: [],
  },
  {
    id: 'agua-sabesp',
    name: 'Água - Sabesp',
    category: 'AGUA',
    mode: 'WEB_AUTOMATION',
    is_active: false,
    trigger_day: 6,
    due_day_default: 18,
    portal_url: 'https://agenciavirtual.sabesp.com.br/',
    required_secret_keys: ['CPF', 'PASSWORD'],
    workflow_steps: [
      {
        action: 'goto',
        url: 'https://agenciavirtual.sabesp.com.br/',
        description: 'Acessar Agência Virtual de Água',
      },
      {
        action: 'fill_secret',
        selector: 'input[name="cpf"]',
        secretKey: 'CPF',
        description: 'Preencher CPF ({{secret:CPF}})',
      },
      {
        action: 'fill_secret',
        selector: 'input[name="password"]',
        secretKey: 'PASSWORD',
        description: 'Preencher senha ({{secret:PASSWORD}})',
      },
      {
        action: 'click',
        selector: 'button[type="submit"]',
        textFallback: 'Entrar',
        description: 'Confirmar login',
      },
      {
        action: 'download_pdf',
        triggerSelector: 'button:has-text("Segunda Via")',
        description: 'Baixar PDF da fatura de água',
      },
    ],
    fallback_workflow_steps: [],
  },
  {
    id: 'condominio-manual',
    name: 'Condomínio Residencial',
    category: 'CONDOMINIO',
    mode: 'MANUAL_REMINDER',
    is_active: true,
    trigger_day: 1,
    due_day_default: 10,
    portal_url: null,
    required_secret_keys: [],
    workflow_steps: [],
    fallback_workflow_steps: [],
  },
  {
    id: 'aluguel-manual',
    name: 'Aluguel Mensal',
    category: 'ALUGUEL',
    mode: 'MANUAL_REMINDER',
    is_active: true,
    trigger_day: 1,
    due_day_default: 5,
    portal_url: null,
    required_secret_keys: [],
    workflow_steps: [],
    fallback_workflow_steps: [],
  },
];
