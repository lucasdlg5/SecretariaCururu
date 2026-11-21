## 📋 Resumo da Mudança

Descreva brevemente o problema resolvido ou a funcionalidade adicionada.

- **Issue Relacionada:** Closes #

---

## 📦 Pacotes Afetados

- [ ] `@secretaria/shared` (Schemas Zod, AES-256-GCM, Pino Redactor, Supabase Types)
- [ ] `@secretaria/backend` (Fastify, Bot Telegram grammY, Google Drive, Gemini OCR)
- [ ] `@secretaria/worker` (Playwright Engine, PDF Extractor, Reconcile Backoff)
- [ ] `@secretaria/frontend` (Dashboard React, Recharts, Provider Wizard)
- [ ] `supabase/migrations` (SQL Schema, RLS, Seeds)
- [ ] `.github/workflows` / Documentação

---

## 🛡️ Checklist de Segurança & Qualidade (Zero Plaintext)

- [ ] **Zero Plaintext:** Nenhum CPF, e-mail real, senha, número de instalação (`UC_NUMBER`), código de barras ou token foi incluído no código, testes ou migrations.
- [ ] **Validação Zod:** Novos passos ou templates de workflow passam em `WorkflowStepsArraySchema` e `CreateProviderInputSchema`.
- [ ] **Build & Tipagem:** `pnpm build` e `pnpm typecheck` executam sem erros em todos os pacotes.
- [ ] **Testes Vitest:** `pnpm test` passa com 100% de sucesso (e novos testes foram adicionados se aplicável).
