# Política de Segurança (`SECURITY.md`)

## 1. Modelo de Segurança & Zero Plaintext Policy

O **SecretariaCururu** lida com credenciais de portais de concessionárias domésticas (energia, gás, água, internet) e documentos financeiros. Por isso, o projeto segue uma política estrita **Zero Plaintext**:

| Camada | Mecanismo Implementado | Especificação |
| :--- | :--- | :--- |
| **Criptografia de Credenciais** | `AES-256-GCM` (`node:crypto`) | Chave mestra `APP_MASTER_KEY` de 256 bits (32 bytes), IV aleatório de 96 bits (12 bytes) por segredo e tag de autenticação MAC de 128 bits (16 bytes). |
| **Proteção de Logs (Pino)** | `createSanitizedLogger` + `sanitizeLogText` | Ofuscação automática em tempo real de CPFs (`000.000.000-00` e 11 dígitos), e-mails, códigos de barras (44–48 dígitos), tokens Bearer e secrets dinâmicos. |
| **Códigos de Barras** | `SHA-256` (`barcode_hash`) | Linhas digitáveis de boletos nunca são salvas em texto puro no banco; apenas seu hash SHA-256 é persistido. |
| **Webhook do Telegram** | Header Secret + Chat Whitelist | Validação estrita do cabeçalho `X-Telegram-Bot-Api-Secret-Token` e bloqueio por `TELEGRAM_ALLOWED_CHAT_IDS`. |
| **Banco de Dados (Supabase)** | Row Level Security (RLS) | Todas as tabelas (`bill_providers`, `bill_cycles`, `execution_logs`, `captcha_challenges`) possuem RLS ativado. |

---

## 2. Versões Suportadas

| Versão | Suportada |
| :--- | :---: |
| `1.0.x` (`main`) | ✅ |

---

## 3. Como Reportar uma Vulnerabilidade

1. **NÃO abra uma Issue pública** caso encontre uma falha de segurança sensível (como bypass de autenticação, vazamento em logs ou falha criptográfica).
2. Utilize a aba [**Security -> Report a vulnerability**](https://github.com/lucasdlg5/SecretariaCururu/security/advisories/new) (GitHub Private Vulnerability Reporting) do repositório.
3. Inclua os passos de reprodução, o pacote afetado (`@secretaria/shared`, `@secretaria/backend`, `@secretaria/worker` ou `@secretaria/frontend`) e o impacto estimado.
