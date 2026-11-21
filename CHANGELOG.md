# Changelog (`CHANGELOG.md`)

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.
O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [1.0.0] — 2026-11-21

### ✨ Adicionado (Added)
- **Monorepo `pnpm` Workspaces:** Estrutura completa com `@secretaria/shared`, `@secretaria/backend`, `@secretaria/worker` e `@secretaria/frontend`.
- **Segurança Zero Plaintext (`@secretaria/shared`):**
  - Criptografia autenticada **AES-256-GCM** (`node:crypto`) com `APP_MASTER_KEY` de 32 bytes e IV aleatório de 12 bytes por secret.
  - Middleware de **Log Redaction (Pino)** e sanitizador de strings (`sanitizeLogText`) para CPFs, e-mails, senhas, códigos de barras (44–48 dígitos) e tokens Bearer.
  - Schemas **Zod** discriminados para as 8 primitivas declarativas do Playwright.
- **Modelagem PostgreSQL & RLS (`supabase/migrations`):**
  - Tabelas `bill_providers`, `bill_cycles`, `execution_logs` e `captcha_challenges` com políticas RLS para `authenticated`.
  - Seed SQL e templates para **Luz (EDP)** (fluxo principal + fallback de 2ª via), **Internet (NJCI)**, **Gás (Comgás)**, **Água (Sabesp)**, **Condomínio** e **Aluguel**.
- **Backend Fastify, Google Drive API v3 & Bot Telegram (`@secretaria/backend`):**
  - Criação idempotente de pastas no Google Drive nos layouts `BY_MONTH` e `BY_TYPE` com nomenclatura `{YYYY-MM}_{CATEGORIA}_{NOME_PROVEDOR}_{TIPO}.{ext}`.
  - Parser de comprovantes via `pdf-parse` (PDF) e `@google/genai` (`gemini-2.5-flash` Vision no Free Tier para fotos).
  - Motor de conciliação com match único exato (tolerância de `±R$ 0,05`) e fallback interativo com `InlineKeyboard` no Telegram.
  - Comandos `/status`, `/pendentes`, `/rodar <conta>` (disparo via Octokit `workflow_dispatch`) e resolução de CAPTCHA HITL.
- **Worker Declarativo Playwright (`@secretaria/worker`):**
  - Interpretador genérico de `workflow_steps` JSONB sem lógica hardcoded de provedores.
  - Backoff exponencial intra-execução (`15s`, `45s`, `120s`), registro silencioso de `NOT_FOUND_YET` e alerta estruturado no Telegram após `>= 3` falhas consecutivas.
- **Dashboard Web (`@secretaria/frontend`):**
  - Visão Geral Mensal com KPIs, status por conta e gráfico empilhado no `Recharts`.
  - Aba de Auditoria & Logs Sanitizados com botão **"Executar Agora"**.
  - Wizard passo a passo de Novo Processo de Fatura com presets e validação Zod.

### 🐛 CorrigidoDurante o Desenvolvimento (Fixed)
- **Bug #1 (`@secretaria/shared`):** Corrigida inferência de tipos `never` no `@supabase/supabase-js` v2.49+ convertendo definições de tabelas `Database` e `Row` de `interface` para `type` aliases e adicionando `Relationships`, `Views`, `Functions` e `Enums` ([Issue #1](https://github.com/lucasdlg5/SecretariaCururu/issues/1)).
- **Bug #2 (`@secretaria/backend`):** Corrigida incompatibilidade de assinatura entre `pino.Logger` e `FastifyBaseLogger` no Fastify v5 ao instanciar `buildFastifyServer` ([Issue #2](https://github.com/lucasdlg5/SecretariaCururu/issues/2)).
- **Bug #3 (`@secretaria/shared` / `@secretaria/frontend`):** Corrigido erro de build do Rollup/Vite (`"randomBytes" is not exported by "__vite-browser-external"`) criando entrypoint condicional `"browser": "./dist/browser.js"` que isola `node:crypto` do bundle frontend ([Issue #3](https://github.com/lucasdlg5/SecretariaCururu/issues/3)).
- **Bug #4 (`@secretaria/shared`):** Ajustada ordem de precedência no `sanitizeLogText` para que códigos de barras de boletos (44–48 dígitos) sejam sanitizados antes da regra de CPF de 11 dígitos, evitando truncamento parcial de linhas digitáveis ([Issue #4](https://github.com/lucasdlg5/SecretariaCururu/issues/4)).
