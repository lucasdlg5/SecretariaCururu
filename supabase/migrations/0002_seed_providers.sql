-- ==============================================================================
-- MIGRATION: 0002_seed_providers.sql
-- Seed de Provedores Domésticos (APENAS PLACEHOLDERS DE SECRETS — ZERO PLAINTEXT)
-- ==============================================================================

INSERT INTO public.bill_providers (
    name,
    category,
    mode,
    is_active,
    trigger_day,
    due_day_default,
    portal_url,
    max_retry_days,
    workflow_steps,
    fallback_workflow_steps,
    encrypted_secrets
) VALUES
-- 1. Luz (EDP)
(
    'Luz - EDP',
    'LUZ',
    'WEB_AUTOMATION',
    true,
    5,
    15,
    'https://www.edponline.com.br/para-sua-casa/login',
    3,
    '[
        {"action": "goto", "url": "https://www.edponline.com.br/para-sua-casa/login", "description": "Acessar portal EDP Online"},
        {"action": "fill_secret", "selector": "input[type=\"email\"], input[name=\"email\"], #email", "secretKey": "EMAIL", "description": "Preencher e-mail de login"},
        {"action": "fill_secret", "selector": "input[type=\"password\"], input[name=\"password\"], #password", "secretKey": "PASSWORD", "description": "Preencher senha"},
        {"action": "click", "selector": "button[type=\"submit\"]", "textFallback": "Entrar", "description": "Confirmar login"},
        {"action": "click", "selector": "[data-uc], .instalacao-card", "textFallback": "{{secret:UC_NUMBER}}", "description": "Selecionar Unidade Consumidora"},
        {"action": "dismiss_optional_modal", "selector": "button:has-text(\"Mais tarde\")", "timeoutMs": 4000, "description": "Fechar modal opcional de atualização cadastral"},
        {"action": "dismiss_optional_modal", "selector": "button:has-text(\"Agora não\")", "timeoutMs": 4000, "description": "Fechar modal opcional de PIX Automático"},
        {"action": "click", "selector": "button:has-text(\"Abrir essa conta\"), a:has-text(\"Abrir essa conta\")", "textFallback": "Abrir essa conta", "description": "Abrir fatura em aberto"},
        {"action": "click", "selector": "button:has-text(\"Visualizar fatura\")", "textFallback": "Visualizar fatura", "description": "Abrir modal de visualização da fatura"},
        {"action": "wait_for", "selector": "button:has-text(\"Baixar\"), a:has-text(\"Baixar\")", "timeoutMs": 15000, "description": "Aguardar carregamento do modal da fatura"},
        {"action": "extract_value", "selector": ".valor-fatura, .fatura-detalhe", "regex": "R\\$\\s*([\\d\\.,]+)", "description": "Extrair valor da fatura na tela"},
        {"action": "download_pdf", "triggerSelector": "button:has-text(\"Baixar\"), a:has-text(\"Baixar\")", "description": "Baixar PDF da fatura EDP"}
    ]'::jsonb,
    '[
        {"action": "goto", "url": "https://www.edponline.com.br/servicos/segunda-via", "description": "Acessar Segunda Via Simplificada EDP"},
        {"action": "click", "selector": "button:has-text(\"São Paulo\"), [data-uf=\"SP\"]", "textFallback": "São Paulo", "description": "Selecionar estado de São Paulo"},
        {"action": "fill_secret", "selector": "input[name=\"documento\"], #cpf", "secretKey": "CPF", "description": "Preencher CPF do titular"},
        {"action": "fill_secret", "selector": "input[name=\"instalacao\"], #uc", "secretKey": "UC_NUMBER", "description": "Preencher número da instalação (UC)"},
        {"action": "click", "selector": "button[type=\"submit\"]", "textFallback": "Continuar", "description": "Avançar na busca de segunda via"},
        {"action": "dismiss_optional_modal", "selector": "button:has-text(\"Não enviar\")", "timeoutMs": 4000, "description": "Dispensar envio de protocolo"},
        {"action": "click", "selector": "button:has-text(\"Enviar por e-mail\"), input[value=\"email\"]", "textFallback": "Enviar", "description": "Solicitar envio por e-mail"}
    ]'::jsonb,
    '{"EMAIL": {"ciphertext": "olvcPBQiCkMryu5zYKqPJEf5iY7ia5dMcnCloel0", "iv": "QMgfF7KhaHcJjVPk", "authTag": "D92HatDlbN9mfPjfGCRaSg=="}, "PASSWORD": {"ciphertext": "NRBvGLD1tn/e7nU=", "iv": "XIfJQZZ+xjjejvKx", "authTag": "yXOsGpqmRyRxNyqVdQsWVA=="}, "CPF": {"ciphertext": "976yOgk5i3XnxLPRClE=", "iv": "ucdIxOANZ4jZuRm5", "authTag": "BYjAfRBiuqfV5Hrzk7zf9g=="}, "UC_NUMBER": {"ciphertext": "hpO84Jb/nvn6hgCej+Wr", "iv": "xdLBTC2YGfhNjLz2", "authTag": "yuYWDuIr8VpBCCuCELbKIQ=="}}'::jsonb
),
-- 2. Internet (NJCI)
(
    'Internet - NJCI',
    'INTERNET',
    'WEB_AUTOMATION',
    true,
    8,
    20,
    'https://portal.njci.com.br/auth/login',
    3,
    '[
        {"action": "goto", "url": "https://portal.njci.com.br/auth/login", "description": "Acessar portal NJCI"},
        {"action": "click", "selector": "a:has-text(\"Facilita\"), button:has-text(\"Facilita\"), .facilita-icon", "textFallback": "Facilita", "description": "Clicar no ícone Facilita"},
        {"action": "fill_secret", "selector": "input[name=\"cpf\"], input[placeholder*=\"CPF\"]", "secretKey": "CPF", "description": "Preencher CPF do titular"},
        {"action": "captcha_hitl", "imageSelector": "img.captcha-image, #captcha-img", "inputSelector": "input[name=\"captcha\"]", "mode": "IMAGE_OR_MANUAL_LINK", "description": "Resolver CAPTCHA via Telegram HITL"},
        {"action": "click", "selector": "button:has-text(\"Próximo\"), button[type=\"submit\"]", "textFallback": "Próximo", "description": "Avançar para listagem de faturas"},
        {"action": "wait_for", "selector": "table, .faturas-lista", "timeoutMs": 15000, "description": "Aguardar tabela de faturas"},
        {"action": "extract_value", "selector": "table tbody tr:first-child", "regex": "R\\$\\s*([\\d\\.,]+)", "description": "Extrair valor da fatura de vencimento mais próximo"},
        {"action": "click", "selector": "table tbody tr:first-child .fa-print, table tbody tr:first-child button[title*=\"Imprimir\"]", "textFallback": "Imprimir", "description": "Clicar no ícone da impressora na coluna Ações"},
        {"action": "download_pdf", "triggerSelector": "button:has-text(\"Imprimir\"), a:has-text(\"Imprimir\")", "description": "Baixar PDF da fatura NJCI"}
    ]'::jsonb,
    '[]'::jsonb,
    '{"CPF": {"ciphertext": "s2A5knPmZZjriDqZYzY=", "iv": "V6zf9aNPgY6QNXYU", "authTag": "bw4dSl4Cb5TAASVVl9lalQ=="}}'::jsonb
),
-- 3. Gás (Comgás)
(
    'Gás - Comgás',
    'GAS',
    'WEB_AUTOMATION',
    true,
    10,
    22,
    'https://virtual.comgas.com.br/login',
    3,
    '[
        {"action": "goto", "url": "https://virtual.comgas.com.br/", "description": "Acessar portal Comgás Virtual"},
        {"action": "click", "selector": "a:has-text(\"Login\"), button:has-text(\"Login\")", "textFallback": "Login", "description": "Clicar em Login"},
        {"action": "click", "selector": "button:has-text(\"Residencial/Comercial\"), [data-segment=\"residencial\"]", "textFallback": "Residencial/Comercial", "description": "Selecionar perfil Residencial/Comercial"},
        {"action": "fill_secret", "selector": "input[type=\"email\"], input[name=\"username\"]", "secretKey": "EMAIL", "description": "Preencher e-mail Comgás"},
        {"action": "fill_secret", "selector": "input[type=\"password\"], input[name=\"password\"]", "secretKey": "PASSWORD", "description": "Preencher senha Comgás"},
        {"action": "click", "selector": "button.btn-submit, button[type=\"submit\"], .arrow-right", "textFallback": "Entrar", "description": "Clicar na seta para a direita para autenticar"},
        {"action": "dismiss_optional_modal", "selector": ".modal-atualizar-dados button.close, button[aria-label=\"Fechar\"]", "timeoutMs": 4000, "description": "Fechar modal opcional de atualizar dados (X)"},
        {"action": "dismiss_optional_modal", "selector": ".modal-bem-vindo button.close, button[aria-label=\"Close\"]", "timeoutMs": 4000, "description": "Fechar modal opcional de bem-vindo (X)"},
        {"action": "wait_for", "selector": "button:has-text(\"Segunda via PDF\"), a:has-text(\"Segunda via PDF\")", "timeoutMs": 15000, "description": "Aguardar botão de Segunda via PDF"},
        {"action": "extract_value", "selector": ".fatura-card, .valor-conta", "regex": "R\\$\\s*([\\d\\.,]+)", "description": "Extrair valor da fatura Comgás"},
        {"action": "download_pdf", "triggerSelector": "button:has-text(\"Segunda via PDF\"), a:has-text(\"Segunda via PDF\")", "description": "Baixar Segunda via PDF Comgás"}
    ]'::jsonb,
    '[]'::jsonb,
    '{"EMAIL": {"ciphertext": "3AQ7JlygzP4HjYJkCASc8e7Yvr2PTwPOpdCpeY3Q", "iv": "4DgYPTAQUqo3YcR5", "authTag": "1DB7F1vd4LEJWzXuW/7lUQ=="}, "PASSWORD": {"ciphertext": "3K1VTvdGNRXtny8=", "iv": "5NNvzGR6TYO795B9", "authTag": "0epvURfYwb/eBrhI1Hm9gg=="}, "CPF": {"ciphertext": "F/7dty9xnEJ3upLtBNc=", "iv": "0peXoxvwurTQjhPp", "authTag": "GXyOg0rL76V1iRl+Tbamqg=="}}'::jsonb
),
-- 4. Água (Sabesp / Provedor de Água - Inativo por padrão, pronto para reativação)
(
    'Água - Sabesp',
    'AGUA',
    'WEB_AUTOMATION',
    false,
    6,
    18,
    'https://agenciavirtual.sabesp.com.br/',
    3,
    '[
        {"action": "goto", "url": "https://agenciavirtual.sabesp.com.br/", "description": "Acessar Agência Virtual de Água"},
        {"action": "fill_secret", "selector": "input[name=\"cpf\"]", "secretKey": "CPF", "description": "Preencher CPF"},
        {"action": "fill_secret", "selector": "input[name=\"password\"]", "secretKey": "PASSWORD", "description": "Preencher senha"},
        {"action": "click", "selector": "button[type=\"submit\"]", "textFallback": "Entrar", "description": "Entrar no portal"},
        {"action": "download_pdf", "triggerSelector": "button:has-text(\"Segunda Via\")", "description": "Baixar PDF da conta de água"}
    ]'::jsonb,
    '[]'::jsonb,
    '{"CPF": {"ciphertext": "A/Y8nfL6ZjV3wDwHEQw=", "iv": "5c+TlR2sCXaOp8JK", "authTag": "Z4Br103/g2n7uPM0T4FWbg=="}, "PASSWORD": {"ciphertext": "My6pVbMVWt4tmog=", "iv": "WuVkodNztwhLHmw9", "authTag": "LrgBol+3yioJ6AJICcdvGQ=="}}'::jsonb
),
-- 5. Condomínio (Lembrete Manual via Telegram)
(
    'Condomínio Residencial',
    'CONDOMINIO',
    'MANUAL_REMINDER',
    true,
    1,
    10,
    NULL,
    3,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb
),
-- 6. Aluguel (Lembrete Manual via Telegram)
(
    'Aluguel Mensal',
    'ALUGUEL',
    'MANUAL_REMINDER',
    true,
    1,
    5,
    NULL,
    3,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
    encrypted_secrets = EXCLUDED.encrypted_secrets,
    workflow_steps = EXCLUDED.workflow_steps,
    fallback_workflow_steps = EXCLUDED.fallback_workflow_steps,
    portal_url = EXCLUDED.portal_url,
    updated_at = now();
