# Guia de Contribuição (`CONTRIBUTING.md`)

Obrigado pelo interesse em contribuir com o **SecretariaCururu**! Este guia descreve o fluxo de trabalho, padrões de código, criação de novos templates de concessionárias e como abrir Issues ou Pull Requests.

---

## 1. Pré-requisitos do Ambiente

- **Node.js:** `>= 22.0.0`
- **Gerenciador de Pacotes:** `pnpm >= 10.6.5` (via Corepack: `corepack enable`)
- **Git** e opcionalmente **GitHub CLI (`gh`)**

```bash
git clone https://github.com/lucasdlg5/SecretariaCururu.git
cd SecretariaCururu
pnpm install
```

---

## 2. Comandos de Validação Obrigatórios

Antes de abrir um Pull Request, certifique-se de que todos os pacotes compilam, passam na checagem estrita de tipos e na suíte de testes do **Vitest**:

```bash
# 1. Build completo (shared -> backend, worker, frontend)
pnpm build

# 2. Typecheck estrito em todos os 4 pacotes do workspace
pnpm typecheck

# 3. Suíte de testes unitários e de integração (Vitest)
pnpm test
```

> [!IMPORTANT]
> Nosso pipeline de CI (`.github/workflows/ci.yml`) executa esses três comandos automaticamente em todo Push e Pull Request.

---

## 3. Adicionando um Novo Template de Concessionária

Para adicionar suporte a um novo portal de fatura (ex: Enel, Light, Copasa, Sanepar, Vivo Fibra):

1. **Zero Plaintext:** Nunca coloque CPFs, e-mails, números de instalação ou senhas reais no template. Utilize exclusivamente placeholders no formato `{{secret:NOME_DA_CHAVE}}` ou a primitiva `fill_secret`.
2. Adicione o template em [`packages/shared/src/templates.ts`](./packages/shared/src/templates.ts) dentro da constante `PROVIDER_TEMPLATES`.
3. Opcionalmente, adicione o seed correspondente em [`supabase/migrations/0002_seed_providers.sql`](./supabase/migrations/0002_seed_providers.sql).
4. Execute `pnpm --filter @secretaria/shared test` — o teste automatizado valida todos os templates contra `WorkflowStepsArraySchema` e `CreateProviderInputSchema` do **Zod**.

---

## 4. Padrão de Commits e Pull Requests

Seguimos o padrão **Conventional Commits**:
- `feat(worker): add support for iframe selector in download_pdf`
- `fix(backend): handle comma decimal separator in Gemini OCR response`
- `docs(readme): add architecture diagram and troubleshooting matrix`
- `test(shared): add barcode redaction edge-case tests`
- `ci(actions): add continuous integration workflow for PRs`
