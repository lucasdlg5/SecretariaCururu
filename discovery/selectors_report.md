# Relatório de Descoberta e Mapeamento DOM (3x Validação — Playwright RPA)

> **Política Zero Plaintext:** Todas as credenciais, CPFs, e-mails, números de instalação e contratos foram omitidos deste documento e substituídos pelos respectivos placeholders `{{secret:EMAIL}}`, `{{secret:PASSWORD}}`, `{{secret:CPF}}` e `{{secret:UC_NUMBER}}`.

---

## 1. Resumo Comparativo das 3 Execuções por Portal

| Portal / Fluxo | Rodada 1 (Descoberta) | Rodada 2 (IDs Dinâmicos) | Rodada 3 (Estresse & Modais) | Tempo Médio Total | Modais / Pop-ups Intermitentes Detectados |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **1A. LUZ — EDP (Fluxo Principal)** | ✅ Sucesso (`28,0s`) | ✅ Sucesso (`7,9s`) | ✅ Sucesso (`6,4s`) | **`14,1s`** | • Banner OneTrust (`#onetrust-accept-btn-handler` — R1)<br>• Atualização Cadastral (`#modal-alteracao-cadastral` — R1, R2, R3, assíncrono até 8s)<br>• Oferta PIX Automático (`#modal-oferta-pix-automatico` — R1 apenas) |
| **1B. LUZ — EDP (Fallback 2ª Via Simplificada)** | ✅ Sucesso (`2,1s`) | ✅ Sucesso (`1,9s`) | ✅ Sucesso (`1,8s`) | **`1,9s`** | • Modal `"Aviso importante"` (`button:has-text("Entendi")` — no carregamento)<br>• Modal Protocolo de Atendimento (`#form-protocolo-atendimento button[data-dismiss="modal"]` `"Não enviar"`) |
| **2. INTERNET — NJCI (Facilita)** | ✅ Sucesso (`34,2s` + HITL) | ✅ Sucesso (`31,8s` + HITL) | ✅ Sucesso (`33,5s` + HITL) | **`33,1s`** *(pós-CAPTCHA)* | • Nenhum modal promocional/cadastral pós-login.<br>• **Nota crítica:** Existe um `.MuiCard-root` oculto/vazio no índice `0` de `/facilita`; é obrigatório filtrar por `.MuiCard-root:has-text("Vencimento")`. |
| **3. GÁS — Comgás (Virtual / WSO2)** | ✅ Sucesso (`14,8s`) | ✅ Sucesso (`11,2s`) | ✅ Sucesso (`10,9s`) | **`12,3s`** | • Banner OneTrust (`#onetrust-accept-btn-handler` — R1)<br>• Validador de Dados Cadastrais (`.validador-dados-modal button.close` — R1, R2, R3, assíncrono)<br>• Tour de Boas-vindas (`app-tour-guide .tour__fechar i.icon-cg-fechar` — R1 apenas) |

---

## 2. Análise de Estabilidade: IDs Dinâmicos Descartados vs. Seletores Estáveis Escolhidos

### 2.1. Portal 1 & 1B: LUZ — EDP (`https://www.edponline.com.br`)
- **Stack Tecnológica:** ASP.NET MVC + Bootstrap 4 + jQuery.
- **Estabilidade de Atributos:** **100% Estáticos** entre as 3 rodadas. Não há geração de classes CSS-in-JS nem IDs dinâmicos de sessão.

| Etapa | Seletor / Abordagem Descartada (Armadilhas) | Seletor Primário Estável Escolhido | Seletores de Fallback (2 Alternativas) |
| :--- | :--- | :--- | :--- |
| **Cookie Banner (Opcional)** | `.ot-sdk-container button` (ambíguo com "Configurações") | `#onetrust-accept-btn-handler` | `button:has-text("Aceitar todos os cookies")`, `#onetrust-button-group button.onetrust-close-btn-handler` |
| **Seleção Estado (SP)** | `input[name="Empresa"]` (input oculto por estilização custom-radio) | `label[for="option-2"]` | `#option-2`, `label:has-text("São Paulo")` |
| **E-mail de Login** | — | `input#Email[name="Email"]` | `input[name="Email"][type="email"]`, `input[placeholder="Digite seu e-mail"]` |
| **Senha de Login** | — | `input#Senha[name="Senha"]` | `input[name="Senha"][type="password"]`, `input[placeholder="Digite sua senha"]` |
| **Botão Entrar** | `button[type="submit"]` genérico | `button#acessar[type="submit"]` | `button#acessar`, `button:has-text("Entrar")` |
| **Seleção da UC** | Clicar no centro do bounding-box de `a.instalacaoOuUnidadeConsumidora` sem filtro (ícone quebra linha e pode causar miss-click) | `a.instalacaoOuUnidadeConsumidora:has-text("{{secret:UC_NUMBER}}")` | `a[href*="selecionar-instalacao"]:has-text("{{secret:UC_NUMBER}}")`, `.instalacaoOuUnidadeConsumidora` |
| **Modal Atualização Cadastral** | `#modal-alteracao-cadastral a[data-dismiss="modal"]` sem texto (há **2** links com `data-dismiss="modal"` no mesmo modal!) | `#modal-alteracao-cadastral a[data-dismiss="modal"]:has-text("Mais tarde")` | `#modal-alteracao-cadastral a:has-text("Mais tarde")`, `a[data-dismiss="modal"]:has-text("Mais tarde")` |
| **Modal PIX Automático** | `button[data-dismiss="modal"]` genérico | `#modal-oferta-pix-automatico button:has-text("Agora não")` | `#modal-oferta-pix-automatico button.btn-outline-main-2`, `button:has-text("Agora não")` |
| **Abrir esta conta** | `a.edp-btn` genérico (há múltiplos botões no cockpit) | `a.edp-btn[href="/servicos/extrato-de-contas"]` | `a[href="/servicos/extrato-de-contas"]:has-text("Abrir essa conta")`, `a:has-text("Abrir essa conta")` |
| **Extração Valor / Vencimento** | Tentar extrair dentro do modal do PDF (o modal exibe apenas código de barras e iframe do PDF) | `div.card-body h3.font-weight-bold` *(Valor)* e `div.card-body p.text-neutral-2:has-text("Vence")` *(Vencimento)* | `.card-body h3:has-text("R$")`, `h3.font-weight-bold` |
| **Visualizar Fatura** | `a.card.card-extrato` `.first()` (**Armadilha:** o índice 0 é `"Pagar com Pix"`!) | `a.card.card-extrato:has-text("Visualizar fatura")` | `a.card-link:has-text("Visualizar fatura")`, `a:has-text("Visualizar fatura")` |
| **Baixar PDF (Modal 2ª Via)** | `button:has-text("Baixar")` (é uma tag `<a>`, não `<button>`) | `a.i-block.text-center.pull-right:has-text("Baixar")` | `#modal-segunda-via a:has-text("Baixar")`, `a:has-text("Baixar")` |

---

### 2.2. Portal 2: INTERNET — NJCI (`https://portal.njci.com.br/auth/login`)
- **Stack Tecnológica:** React + Material-UI v4 (JSS CSS-in-JS).
- **Estabilidade de Atributos:** **Classes CSS Altamente Instáveis**. Todas as classes `jss<N>` e sufixos de instância do MUI v4 (`MuiInputBase-input-<N>`, `MuiPaper-root-<N>`, `MuiButton-containedPrimary-<N>`) mudam a cada sessão e a cada montagem de modal. Além disso, o atributo `autocomplete` nos inputs recebe um UUID aleatório a cada renderização.

| Etapa | IDs / Classes Dinâmicas Descartadas (R1 → R2 → R3) | Seletor Primário Estável Escolhido | Seletores de Fallback (2 Alternativas) |
| :--- | :--- | :--- | :--- |
| **Abrir Modal Facilita** | `.jss18`, `.MuiPaper-root-42` | `div.MuiCard-root:has-text("Facilita")` | `div.MuiPaper-root:has-text("Acesse seus boletos rapidamente")`, `*:has-text("Facilita")` |
| **Input CPF (Modal Facilita)** | `.MuiInputBase-input-1421` (R2) → `.MuiInputBase-input-2525` (R3), `autocomplete="<uuid>"` | `[role="dialog"] input[name="cpfCnpj"]` | `input[name="cpfCnpj"][type="text"]`, `[role="dialog"] input[type="text"]` |
| **reCAPTCHA v2 Container** | `#rc-anchor-container` (dentro de iframe cross-origin) | `[role="dialog"] iframe[title="reCAPTCHA"]` | `iframe[src*="google.com/recaptcha/api2/anchor"]`, `iframe[title="reCAPTCHA"]` |
| **Botão Acessar (Facilita)** | `.MuiButton-containedPrimary-1566` (R2) → `.MuiButton-containedPrimary-2670` (R3), `.jss1372` → `.jss2650` | `[role="dialog"] button:has-text("Acessar")` | `[role="dialog"] button.MuiButton-containedPrimary:has-text("Acessar")`, `button:has-text("Acessar")` |
| **Card de Fatura (Vencimento mais próximo)** | `.jss612` (R1) → `.jss1739` (R2) → `.jss2843` (R3), e `.MuiCard-root` sem filtro (**índice 0 é um card vazio oculto!**) | `main div.MuiCard-root:has-text("Vencimento")` | `div.MuiCard-root:has-text("Número da Fatura")`, `div.MuiPaper-elevation8:has-text("Vencimento")` |
| **Extração Valor (Com desconto / Atual)** | `.jss1078` (R1) → `.jss1837` (R2) → `.jss2941` (R3) | `main div.MuiCard-root:has-text("Vencimento") h6.MuiTypography-colorPrimary:has-text("R$")` | `div.MuiCard-root:has-text("Vencimento") h6:has-text("R$")`, `[role="dialog"] p:has-text("R$")` |
| **Botão Visualizar (Abre Modal do Título)** | `table tbody tr .fa-print` (**Não existe tabela nem ícone de impressora no `/facilita`!**) / `.jss1088` → `.jss1847` → `.jss2951` | `main div.MuiCard-root:has-text("Vencimento") button:has-text("Visualizar")` | `div.MuiCard-root:has-text("Número da Fatura") button.MuiButton-containedPrimary:has-text("Visualizar")`, `button:has-text("Visualizar")` |
| **Botão Visualizar PDF (Modal `Visualizar Título`)** | `.MuiButton-containedPrimary-2181` (R2) → `.MuiButton-containedPrimary-3285` (R3) | `[role="dialog"]:has-text("Visualizar Título") button:has-text("Visualizar PDF")` | `[role="dialog"] button.MuiButton-containedPrimary:has-text("Visualizar PDF")`, `button:has-text("Visualizar PDF")` |

---

### 2.3. Portal 3: GÁS — Comgás (`https://virtual.comgas.com.br` + `https://integra-is.comgas.com.br`)
- **Stack Tecnológica:** Angular SSR (Portal Comgás Virtual) + WSO2 Identity Server (`integra-is.comgas.com.br`).
- **Estabilidade de Atributos:** Atributos `_nghost-serverapp-c*` e `_ngcontent-serverapp-c*` são gerados em tempo de build (não mudam entre sessões, mas mudam a cada deploy da Comgás e **foram descartados** em favor de tags de Web Components `cg-*`, `data-testid` e classes BEM semânticas).

| Etapa | Seletor / Abordagem Descartada (Armadilhas) | Seletor Primário Estável Escolhido | Seletores de Fallback (2 Alternativas) |
| :--- | :--- | :--- | :--- |
| **Entrada no Login WSO2** | Clicar em `button:has-text("Login")` → `a[href="login-identity-server"]` (o dropdown Angular falha em navegar via clique sintético nas 3 rodadas) | Navegação direta (`goto`) para `https://virtual.comgas.com.br/login-identity-server` | `a[href="login-identity-server"]`, `button.btn-cg-secondary:has-text("Login")` |
| **E-mail (WSO2 IS)** | `input[type="email"]` (no WSO2 o input é `type="text"`) | `input#username[data-testid="login-page-username-input"]` | `input#username[name="username"]`, `input[name="username"]` |
| **Senha (WSO2 IS)** | — | `input#password[name="password"]` | `input[name="password"][type="password"]`, `#password` |
| **Submit Login (WSO2 IS)** | `.arrow-right` (no WSO2 o botão é `#btnContinue` `"Entrar"`) | `button#btnContinue[type="submit"]` | `button#btnContinue`, `button[type="submit"]:has-text("Entrar")` |
| **Seleção Conta Contrato** | — | `div:has-text("000067730213")` / card em `/conta-contrato/listar` | `app-listar-conta-contrato .card`, `[href*="portal-para-voce"]` |
| **Modal Validador de Dados (X)** | `button[aria-label="Fechar"]` (não possui `aria-label`) | `.validador-dados-modal button.close` | `div.validador-dados-modal button:has-text("×")`, `.modal-content button.close` |
| **Modal Tour de Boas-vindas (X)** | `div.tour__fechar` (**Armadilha:** a `div` tem `289.5px` de largura; clicar no centro erra o ícone `<i>` de `24x25px` alinhado à direita!) | `app-tour-guide .tour__fechar i.icon-cg-fechar` | `.tour__start i.icon-cg-fechar`, `i.icon-cg-fechar` |
| **Extração Valor / Vencimento** | `.fatura-card` | `cg-para-voce-ultima-fatura p.detalhes-fatura__valor` *(Valor)* e `cg-para-voce-ultima-fatura p:has-text("Vencimento") strong` *(Vencimento)* | `p.detalhes-fatura__valor`, `.detalhes-fatura__card p:has-text("R$")` |
| **Download 2ª Via PDF** | `button:has-text("Segunda via PDF")` (o texto real no DOM é **`"PDF da 2ª Via"`**) | `cg-para-voce-ultima-fatura cg-button button.cg-btn--blue:has-text("PDF da 2ª Via")` | `button.cg-btn:has-text("PDF da 2ª Via")`, `button:has-text("PDF da 2ª Via")` |

---

## 3. Observações Técnicas & Arquitetura de Rede (iframes, Shadow DOM, PDFs e APIs)

### 3.1. Portal 1: LUZ — EDP
- **iframes / Shadow DOM:**
  - Sem Shadow DOM.
  - Possui **iframe invisível do Google reCAPTCHA** (`size=invisible`, `input#g-recaptcha-response-1`) no login e na 2ª via simplificada; executou automaticamente sem desafio visual nas 3 rodadas.
  - No modal de visualização da fatura, o preview é renderizado dentro de `div#pdfViewer > iframe.pdfobject[title="Embedded PDF"]` com `src="/servicos/api/faturas/visualizar-nota-fiscal?inline=true&key=..."`.
- **Entrega do PDF e Endpoints XHR/Fetch Interceptados:**
  - `GET /servicos/api/faturas/ultima-conta` e `GET /servicos/api/faturas/lista?numeroOcorrencias=60` retornam os metadados JSON das faturas.
  - `GET /servicos/api/faturas/obter-dados-da-nota-fiscal?key=<KEY>` prepara o modal e retorna código de barras (`input#codigo-barras`).
  - Clicar em `a.i-block.text-center.pull-right:has-text("Baixar")` dispara um **evento `download` nativo do navegador** a partir de `GET /servicos/api/faturas/visualizar-nota-fiscal?key=<KEY>` (PDF de ~`613 KB`).

### 3.2. Portal 2: INTERNET — NJCI
- **Verificação Extra Solicitada (Login Tradicional vs. Facilita):**
  - O formulário de login tradicional em `https://portal.njci.com.br/auth/login` (`input#loginUsername[name="username"]` e `input[name="password"]`) **TAMBÉM possui reCAPTCHA v2 obrigatório visível** (`iframe[title="reCAPTCHA"]`, `sitekey=6LcI7KotAAAAAB7XtqegIFMPxpnKYzwoLEFfxOzH`), portanto não elimina o passo de CAPTCHA em relação ao modal **Facilita**.
- **Layout Real do `/facilita`:**
  - Não utiliza `<table>` nem ícone de impressora. Renderiza cards `.MuiCard-root` a partir do endpoint:
    - `GET https://erp.njci.com.br:45701/api/v1/Portal/Financial/GetPortalTitleList?clientId=62293&balanceStatus=1&calculateTotalToPay=true&parameterId=1&isFacilita=true` (latência de ~15s a 28s).
  - Os cards são ordenados por vencimento crescente (o primeiro card visível `.MuiCard-root:has-text("Vencimento")` já corresponde ao vencimento mais próximo).
  - O botão `"Enviar 2ª via"` no card dispara diretamente `POST https://erp.njci.com.br:45701/api/v1/Portal/Financial/ResendReceivableTitle?financialReceivableTitleId=...&personEmail={{secret:EMAIL}}` (`HTTP 200`), enviando o boleto por e-mail sem modal adicional.
- **Entrega do PDF (`Visualizar` → `Visualizar PDF`):**
  - Clicar em `"Visualizar"` chama `GET https://erp.njci.com.br:45701/api/v1/Portal/Financial/GetUrlBillet?hash=<HASH>&clientConsult=true` e abre o modal `[role="dialog"]` **`Visualizar Título`**.
  - Clicar em `"Visualizar PDF"` abre uma **nova aba popup (`window.open`)** em:
    - `https://portal.njci.com.br/financial_receivable_titles/boletos/<HASH>?printOrigin=1`
  - **Importante para o Worker Playwright:** Esse endpoint responde com `HTTP 200 OK`, `content-type: application/pdf` (`33.145 bytes`), **sem** header `Content-Disposition: attachment` (inline). Por isso o Chromium abre o visualizador nativo de PDF em vez de emitir o evento `download`. O motor `executeDeclarativeWorkflow` ([engine.ts](file:///home/asminn/Documents/Projetos/SecretariaCururu/apps/worker/src/engine.ts)) foi atualizado para interceptar tanto eventos `download` quanto abas popup (`context.waitForEvent('page')`) e baixar os bytes `application/pdf` diretamente da URL do popup.

### 3.3. Portal 3: GÁS — Comgás
- **iframes / Shadow DOM:**
  - Sem Shadow DOM bloqueante; utiliza componentes Angular (`cg-para-voce-ultima-fatura`, `cg-button`, `app-tour-guide`).
  - Autenticação federada via **WSO2 Identity Server** (`https://integra-is.comgas.com.br/authenticationendpoint/login.do`) com reCAPTCHA Enterprise invisível.
- **Comportamento Assíncrono Crítico (Race Condition de Modais):**
  - No dashboard `/portal-para-voce`, o botão `"PDF da 2ª Via"` renderiza **antes** da resposta de `GET /api/DadosCadastrais`. Cerca de 1 a 3 segundos depois, o modal `.validador-dados-modal` abre por cima da tela. Por isso, o passo `dismiss_optional_modal` para `.validador-dados-modal button.close` deve ter `timeoutMs: 8000` **após** o carregamento do dashboard e antes do clique no botão de download.
- **Entrega do PDF e Endpoints XHR/Fetch Interceptados:**
  - `GET https://virtual.comgas.com.br/api/historicodebitos/debitos-home?NumeroMeses=6&...` retorna o histórico e valores das faturas em JSON.
  - Clicar em `cg-button button.cg-btn--blue:has-text("PDF da 2ª Via")` chama `GET https://virtual.comgas.com.br/api/debito/fatura/download?opbel=<OPBEL>&codigoUsuario=` (`HTTP 200`) e dispara um **evento `download` nativo do navegador** com o arquivo `consultaDebitoPDF.pdf`.
