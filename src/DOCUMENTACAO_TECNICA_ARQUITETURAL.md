# 📐 Documentação Técnica & Arquitetural — Sistema Pão & Mel + Omie

> **Documento mestre (Technical Paper)** de toda a arquitetura, lógica e escopos técnicos do projeto.
> Plataforma: **Base44** (BaaS) · Stack: **React + Vite + Tailwind + shadcn/ui** · Backend: **Deno (Edge Functions)** · ERP integrado: **Omie**
> Última revisão arquitetural: 2026-06

---

## 📑 Índice

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Arquitetura em Camadas](#2-arquitetura-em-camadas)
3. [Domínios Funcionais (Módulos)](#3-domínios-funcionais-módulos)
4. [Modelo de Dados (Entidades)](#4-modelo-de-dados-entidades)
5. [Integração Omie — O Coração Crítico](#5-integração-omie--o-coração-crítico)
6. [Padrões de Resiliência (Circuit Breaker, Portão, Rate Limit)](#6-padrões-de-resiliência)
7. [Filas Assíncronas & Workers](#7-filas-assíncronas--workers)
8. [Webhooks Omie](#8-webhooks-omie)
9. [Ciclo de Vida do Pedido (Máquina de Estados)](#9-ciclo-de-vida-do-pedido)
10. [Frontend — Roteamento, Layout, Permissões](#10-frontend)
11. [Segurança, Auth & LGPD](#11-segurança-auth--lgpd)
12. [Catálogo de Backend Functions](#12-catálogo-de-backend-functions)
13. [Convenções & Lições Aprendidas](#13-convenções--lições-aprendidas)

---

## 1. Visão Geral do Sistema

Sistema de **gestão comercial, logística e fiscal** para uma distribuidora (Pão & Mel), totalmente integrado ao ERP **Omie**. O sistema cobre o fluxo ponta-a-ponta:

```
Vendedor/App → Pedido → Liberação → Montagem de Carga → Faturamento (NF-e) → Boletos → Entrega → Acerto de Caixa
                                            ↕
                              SINCRONIZAÇÃO BIDIRECIONAL OMIE
                                            ↕
                       Cobertura Inteligente · Roteiros · Metas · Comissionamento
```

### Princípios Arquiteturais Fundamentais

| Princípio | Descrição |
|-----------|-----------|
| **Omie é a fonte de verdade fiscal** | NF-e, etapas fiscais e faturamento vivem no Omie. O Base44 mantém **espelhos** (`PedidoLiberadoOmie`) sincronizados. |
| **Status local binário** | Entidades locais (ex: `Carga.status_carga`) refletem só o fluxo local simples (montagem/faturada). O detalhe fiscal fica no Omie. |
| **Tudo que toca o Omie é assíncrono e enfileirado** | Nenhuma operação pesada de Omie roda síncrona no request do usuário — vai para filas processadas por workers com auto-encadeamento. |
| **Resiliência a rate limit acima de tudo** | O Omie bloqueia agressivamente (240 req/min, "consumo redundante"). Toda a arquitetura gira em torno de **não estourar esse limite**. |
| **Idempotência** | Toda operação Omie reconsulta o estado real antes de agir — nunca fatura/emite duas vezes. |

---

## 2. Arquitetura em Camadas

```
┌─────────────────────────────────────────────────────────────────┐
│  CAMADA DE APRESENTAÇÃO (Frontend React/Vite)                    │
│  pages/ · components/ · layout · App.jsx (router)                │
│  - shadcn/ui + Tailwind (design tokens em index.css)             │
│  - @tanstack/react-query (cache/estado servidor)                 │
│  - AuthContext + Permissões por aba                              │
└────────────────────────┬────────────────────────────────────────┘
                         │ base44.entities.* / base44.functions.invoke()
┌────────────────────────▼────────────────────────────────────────┐
│  CAMADA SDK BASE44 (api/base44Client.js)                         │
│  - Entities (CRUD + RLS) · Integrations (Core) · Auth · Functions│
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  CAMADA DE BACKEND (Deno Edge Functions — functions/)            │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│  │ _shared/         │ │ Workers de Fila  │ │ Operações Omie   │ │
│  │ omieClient       │ │ processarFila*   │ │ faturar/emitir/  │ │
│  │ portaoOmie       │ │ (auto-encadeados)│ │ cancelar/enviar  │ │
│  │ constantes       │ │                  │ │                  │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS (app_key/app_secret via Secrets)
┌────────────────────────▼────────────────────────────────────────┐
│  ERP OMIE (app.omie.com.br/api/v1/)                              │
│  Clientes · Pedidos · NF-e · Boletos · Etapas · Webhooks         │
└─────────────────────────────────────────────────────────────────┘
```

### Persistência (Base44 DB)
Banco documental — entidades são **JSON Schemas**. Built-ins em todo registro: `id`, `created_date`, `updated_date`, `created_by_id`.

---

## 3. Domínios Funcionais (Módulos)

### 3.1 Comercial
- **Cadastros** (`CadastrosHub`): Clientes, Produtos, Vendedores/Funcionários, Tabelas de Preço, Planos de Pagamento, Redes, Segmentos, Rotas, Cenários Fiscais.
- **Pedidos** (`EmissaoPedidos`, `GerenciarPedidosPage`, `ControlePedidosVenda/Troca`): emissão, digitação, liberação, gestão.
- **Análises Comercial** (`AnalisesComercial`): dashboards de vendedor, vendas, clientes, trocas, metas, mapa de visitas.
- **Comissionamento & Gamificação** (`Comissionamento`): scorecards, ranking, regime experimental.
- **Gestão de Metas em Cascata** (`GestaoMetas`): Gerente → Supervisor → Vendedor.

### 3.2 Cobertura Inteligente
- **Roteiros de Campo** (`MeusRoteiros`, `RotaSupervisores`, `GestaoRoteiros`): check-in/check-out GPS, visitas.
- **Cobertura** (`CoberturaInteligente`): agenda mensal por papel, alertas em cascata, status de cobertura, parâmetros de geolocalização.
- **Relatórios de Visitas** (`RelatoriosVisitas`): estoque, trocas, rotina de supervisores.

### 3.3 Logística & Fiscal
- **Notas Fiscais Omie** (`NotasOmie`): emissão NF-55, NFC-e, D1, impressão DANFE.
- **Montagem de Carga** (`MontagemCarga`) e **Cargas** (`Cargas`): agrupa pedidos por motorista/veículo/rota.
- **Boletos Omie** (`BoletosOmie`): emissão e consulta de boletos.
- **Acerto de Caixa** (`AcertoCaixa`): fechamento financeiro pós-entrega.
- **Ajustes de Pedidos** (`AjustesPedidos`): corte, cancelamento, transferência, devolução.

### 3.4 Gerenciamento (admin)
- Permissões, Log Gerencial (auditoria completa), Auditoria de Cancelados, Credenciais Omie, Sincronização CSV/Omie, Supervisão da Fila de Envio, Integração Omie Dashboard, Commits GitHub.

---

## 4. Modelo de Dados (Entidades)

### 4.1 Entidades-Núcleo

| Entidade | Papel | Campos-chave |
|----------|-------|--------------|
| **Cliente** | Cadastro comercial + fiscal | `codigo_omie`, `cnpj_cpf`, `tipo_nota` (55/D1), `bloquear_faturamento`, `pendencia_financeira`, geolocalização, `dias_visita` |
| **Produto** | Catálogo (comercial + logística) | `codigo_omie`, `ncm`, `cest`, `fator_caixa`, `volume_m3`, `tipo_embalagem`, retornável/galeia |
| **Pedido** | Pedido de venda/troca | `status`, `status_faturamento`, `status_logistico`, `etapa`, `omie_codigo_pedido`, `chave_nfe`, `carga_id`, `solto_manualmente` (blindagem fiscal) |
| **Carga** | Agrupamento de entrega | `numero_carga`, `pedidos_omie[]`, `pedidos_internos[]`, `pedidos_troca[]`, `status_carga`, `processamento_omie_status` |
| **Vendedor** | Funcionário multi-papel | `papeis[]` (vendedor/motorista/supervisor/promotor…), CNH, supervisor_ids |

### 4.2 Entidades de Espelho & Sincronização Omie

| Entidade | Papel |
|----------|-------|
| **PedidoLiberadoOmie** | **Espelho do estado do pedido no Omie** (etapa real). Fonte de verdade do *Status* na tela "Gerenciar Pedidos". |
| **LogEmissaoNF** | Histórico persistente de cada emissão de NF-e (status SEFAZ real, `nid_nf`, `chave_nfe`, `faultstring`). |
| **LogEmissaoBoleto** | Histórico de emissão de boletos. |
| **LogIntegracaoOmie** | **Auditoria de TODAS as chamadas à API Omie** (payload, resposta, duração, tentativas, webhook idempotência). |
| **CacheOmieConsulta** | Cache persistente de consultas (leitura) com TTL. |

### 4.3 Entidades de Controle de Infraestrutura

| Entidade | Papel CRÍTICO |
|----------|---------------|
| **ControleCircuitBreakerOmie** | **Multiuso**: (1) circuit breaker `chave=principal` / ID fixo `6a1e06a9aa62ceab7b3b6d97`; (2) rate limiter global `chave=rate_limit_global`; (3) portão global `chave=portao_global_omie`; (4) lock de worker `chave=worker_carga`. RLS admin-only. |
| **FilaCargaOmie** | Fila assíncrona de faturamento de carga (1 registro/pedido). Estados: pendente→processando→concluido/erro/aguardando_acao_humana. |
| **FilaEnvioPedidoOmie** | Fila de envio de pedidos novos ao Omie. |
| **FilaEmissaoNF** / **FilaBoletoOmie** | Filas de emissão de NF e boletos. |

### 4.4 Entidades de Cobertura
`AgendaComercial`, `Visita`, `CoberturaStatus`, `Alerta`, `ParametroCobertura`, `EstoqueVisitaItem`, `GeolocalizacaoPedido`, `Roteiro`, `VisitaRoteiro`.

### 4.5 Entidades Comerciais Analíticas
`Meta`, `MetaComissao`, `ScorecardApuracao`, `RegimeExperimental`, `PrecoMedioItem`, `MotivoTrocaMapeamento`.

### 4.6 Auditoria & Logs
`LogGerencial` (quem/quando/o quê/valor antigo→novo), `LogCorte`, `Cancelamento`, `Transferencia`, `LogClienteNaoCadastrado`, `AuditoriaClienteFaltante`, `JobAuditoriaOmie`.

---

## 5. Integração Omie — O Coração Crítico

### 5.1 Cliente Centralizado (`functions/_shared/omieClient`)

Toda chamada ao Omie passa (idealmente) pelo `omieCall()`, que orquestra:

```
omieCall(base44, endpoint, param, { call, timeoutMs, cacheTtlMs, ... })
   │
   ├─ 1. getOmieCredentials()      → Secrets PRIMEIRO (OMIE_APP_KEY/SECRET), banco como fallback
   ├─ 2. checkCircuitBreaker()     → se bloqueado, throw imediato
   ├─ 3. Cache (só leitura)        → memória (30s) + persistente (CacheOmieConsulta)
   ├─ 4. SEQUENTIAL_METHODS?       → fila sequencial (1 por vez) p/ escritas críticas
   ├─ 5. throttleByMethod()        → ~3 req/s por método (334ms)
   ├─ 6. throttleGlobal()          → reserva ATÔMICA de slot (1,5s entre chamadas globais)
   ├─ 7. fetch() + retry exponencial [1s, 2s, 4s]
   └─ 8. Classificação de erro + log + reset/abertura do breaker
```

### 5.2 Resolução de Credenciais (Padrão "Environment-First")

> **Lição crítica:** credenciais NUNCA priorizam o banco. O `Deno.env` é atômico e sem TTL; o banco (`ConfiguracaoOmie`) pode conter `app_key` antigo. Por isso:

```js
const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
// só cai no banco se o Secret estiver ausente
```

O `app_secret` **nunca** é armazenado em texto plano no banco — apenas uma máscara (`app_secret_mascara`).

### 5.3 Classificação de Erros Omie

| Erro | Tipo | Tratamento |
|------|------|-----------|
| `MISUSE_API_PROCESS` / "consumo indevido" | Bloqueio severo | Circuit breaker 30min, **sem retry** |
| "Consumo redundante" (cód. 6) | Temporário | Aguarda os segundos exatos informados, re-agenda janela (~60s) |
| "Chave de acesso inválida" | Anti-flood | Retry com espera + breaker (NÃO é credencial errada) |
| HTTP 425/429/403 | Rate limit | Breaker + retry |
| "Já faturado/autorizado" | **Sucesso disfarçado** | Conclui sem retry (não re-fatura) |
| "Cliente bloqueado para faturar" | **Terminal** | Sai da fila, só volta por ação humana |
| "Utilize o processo de faturamento" (cód. 3) | Regra de negócio | Erro definitivo, **sem retry** |

---

## 6. Padrões de Resiliência

### 6.1 Circuit Breaker (`ControleCircuitBreakerOmie` ID fixo)
- **Registro único** ID `6a1e06a9aa62ceab7b3b6d97` — buscado sempre por ID, nunca por filter genérico (evita duplicados).
- Abre após `threshold_erros` (default 3) erros consecutivos COM tempo de bloqueio informado.
- Auto-desbloqueia quando `bloqueado_ate <= agora`.
- Reset de `erros_consecutivos` a cada sucesso.

### 6.2 Rate Limiter Global Atômico (reserva de slot)
> **Problema resolvido:** N instâncias liam o mesmo timestamp e disparavam juntas.
> **Solução:** `atualizado_em` guarda o **próximo slot reservado** (timestamp futuro). Cada instância:
> 1. Adquire mutex curto (`worker_lock_ate`).
> 2. `slot = max(agora, próximo_slot)`; grava `próximo_slot = slot + 1,5s`; libera lock.
> 3. Dorme até **seu** slot → instâncias pegam slots distintos (agora+1,5s, +3,0s…).

### 6.3 Portão Único Global (`functions/_shared/portaoOmie`)
Mutex distribuído `chave=portao_global_omie` (TTL 5min) — **só um worker toca o Omie por vez**. Estratégia *mark-and-verify* (escreve dono, relê para confirmar). Workers de leitura **cedem prioridade** se houver trabalho de operação pendente (Fila Envio/Carga).

### 6.4 Lock de Auto-Encadeamento (`chave=worker_carga`)
Garante **1 cadeia por vez** com TTL curto (2min) — auto-release se a função morrer. Reagenda retomada se a cadeia dona morrer sem encadear.

---

## 7. Filas Assíncronas & Workers

### 7.1 Anatomia de um Worker de Fila (`processarFilaCargaOmie`)

```
Deno.serve →
  PASSO 0: Resgate de órfãos    (itens travados em "processando" > 90s → reset)
  Lock de encadeamento          (1 cadeia por vez)
  PASSO 1: Status LOCAL          (recalcula cargas — ZERO Omie, roda mesmo se portão ocupado)
  Portão Global                  (a partir daqui, toca Omie)
  PASSO 2: Limpeza de órfãos     (cargas deletadas → itens cancelados)
  LOOP SEQUENCIAL (LOTE=8):
     - marca "processando" (com processando_em)
     - idempotência: jaEstaNaEtapa()
     - processarFaturar(): AlterarPedidoVenda → TrocarEtapaPedido(50) → RECONSULTA obrigatória
     - classifica resultado (concluído / redundante / etapa<50 / bloqueio / terminal)
     - delay 700ms entre pedidos
  PASSO FINAL: atualizarStatusCarga()
  AUTO-ENCADEAMENTO: se há pendentes + breaker ok + não interrompido → re-invoca
  finally: libera portão + lock
```

> ⚠️ **Lote pequeno proposital (8):** cada pedido leva ~1,5s. Com lote 50, uma rodada passava de 1min e a plataforma **matava** a função no meio (órfãos). Lote 8 → rodada ~12s, bem abaixo do timeout; o auto-encadeamento toca o resto em rodadas curtas.

### 7.2 Estados da Fila de Carga (`FilaCargaOmie.status`)

```
pendente ──► processando ──► concluido
    ▲             │
    │             ├──► erro (terminal: cliente bloqueado / redundante persistente / max tentativas)
    │             │
    └─────────────┴──► aguardando_acao_humana (etapa < 50 após N revalidações — NÃO é erro vermelho)
```

| Contador | Significado |
|----------|-------------|
| `tentativas` | Tentativas fatais (vira erro após `MAX_TENTATIVAS=3`) |
| `tentativas_redundante` | Janelas de espera por "consumo redundante" (erro após 5) |
| `tentativas_revalidacao` | Revalidações em etapa < 50 (sai do loop após 4 → aguardando_acao_humana) |
| `processando_em` | Timestamp de entrada em "processando" (detecta órfãos sem depender de updated_date) |
| `proxima_tentativa_em` | Respeita janela de 60s do Omie — worker pula itens com valor futuro |

### 7.3 Demais Filas
- **`FilaEnvioPedidoOmie`** → `processarFilaEnvioPedidoOmie` (envio de pedidos novos)
- **`FilaEmissaoNF`** → `processarEmissaoNFLote` / `emitirNfsLoteOmie`
- **`FilaBoletoOmie`** → `processarFilaBoletoOmie`
- **`LogIntegracaoOmie` (webhooks pendentes)** → `processarFilaWebhookOmie`

---

## 8. Webhooks Omie

### 8.1 Receiver Blindado (`receberWebhookOmie`)
Endpoint público (< 200ms) que **só valida e enfileira**:

```
URL: .../functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>

1. Valida token (query param) + app_key
2. Sanitiza: Content-Type JSON, tamanho ≤ 50KB, estrutura
3. Ping de validação (sem topic) → responde 200
4. Idempotência por messageId (consulta LogIntegracaoOmie)
5. Tópicos irrelevantes (Financas./Produto./...) → grava 'ignorado'
6. Enfileira log 'pendente' + dispara processarFilaWebhookOmie (fire-and-forget)
7. Responde 200 SEMPRE (erro genérico p/ fora)
```

> **Por que enfileira em vez de processar?** Webhooks chegam em rajadas (Faturada + EtapaAlterada simultâneos). Processar direto = N `ConsultarPedido` paralelos = rate limit estourado. O worker sequencial consome 1 por vez.

### 8.2 Worker de Webhook (`processarFilaWebhookOmie` → `processarWebhookOmie`)
Consome a fila de logs pendentes com throttle global e lock de instância única, atualizando espelhos (`PedidoLiberadoOmie`), `Pedido` e `LogEmissaoNF`.

---

## 9. Ciclo de Vida do Pedido (Máquina de Estados)

### 9.1 Etapas Omie (CONFIRMADO — fonte: `lib/etapaOmieStatus.js`)

| Etapa Omie | Status interno | Significado |
|:----------:|:--------------:|-------------|
| 10 | pendente | Pedido Pendente |
| 20 | liberado | Pedido Liberado |
| 50 | faturar | Pronto para Faturar (montagem) |
| 60 | faturado | NF emitida |
| 70 | faturado | Entregue |
| 80 | cancelado | Cancelado |

> ⚠️ **99 NÃO é etapa oficial** — é dado defasado no espelho. Não mapear como cancelado; deixa cair no status local (a reconciliar).

### 9.2 Fluxo Completo

```
[comercial]                [faturamento]              [logística]         [pós-entrega]
pendente ──liberar──► liberado ──montar carga──► montagem ──faturar──► faturado ──► entregue
   │ (etapa 10)         (etapa 20)               (etapa 50)   │ (etapa 60)  (etapa 70)
   │                                                          ├─► emite NF-e
   │                                                          ├─► gera boletos
   └──────────────────────── cancelar (etapa 80) ────────────┘
```

### 9.3 Blindagem Fiscal
- **`solto_manualmente`**: pedido solto de carga por operador → NENHUMA rotina pode faturar automaticamente enquanto `true`.
- **`pendente_emissao`**: faturado na carga mas NF não concluiu (preso em etapa 50) → alerta na aba Emissão.
- **`cancelado_pos_faturamento`**: pedido que já tinha NF e foi cancelado no Omie — preserva rastreabilidade financeira.

### 9.4 Reconciliação (mantém espelho ≅ Omie)
`reconciliarStatusPedidosOmie`, `reconciliarEtapasAbertasOmie`, `reconciliarEspelhoCargaCompleto`, `reconciliarNfsCanceladasOmie`, `reconciliarNfAguardandoAutorizacao`, `corrigirEspelho20Falso`, `corrigirEspelhoDia/Faturados/Manual`, `sincronizarLiberadosOmieRapido`.

---

## 10. Frontend

### 10.1 Roteamento (`App.jsx`)
> ⚠️ **`pages.config.js` NÃO é mais auto-gerado.** Há um loop `pagesConfig` para páginas antigas + **`<Route>` explícitas** para cada página nova. Toda página nova precisa de `<Route>` próprio com `LayoutWrapper`.

Estrutura:
- `<AuthProvider>` → `<QueryClientProvider>` → `<Router>` → `<AuthenticatedApp>`
- `AuthenticatedApp` trata loading, `authError` (user_not_registered / auth_required → redirect login).
- `LayoutWrapper` injeta o `Layout` (sidebar) em torno de cada página.

### 10.2 Layout & Navegação (`layout`)
- Sidebar com gradiente, menu por domínio, filtrado por **permissões** (`Permissao.abas_visiveis`).
- Admin vê tudo; demais veem só abas permitidas.
- `StatusOmieIndicator` no topo (saúde da integração).
- Anti-tradução automática do navegador (lang pt-BR, notranslate).

### 10.3 Estado & Dados
- **@tanstack/react-query** para cache de servidor (`staleTime` longo em listas de apoio: permissões, vendedores).
- Subscriptions em tempo real via `base44.entities.X.subscribe()` quando necessário.

### 10.4 Design System (Tokens)
- Valores em `index.css` (`:root` + `.dark`), mapeados em `tailwind.config.js`.
- Paleta primária ciano (`--primary: 185 88% 45%`).
- `safelist` no Tailwind para classes de cor dinâmicas (kanban, badges de status, suítes de teste).

---

## 11. Segurança, Auth & LGPD

| Área | Implementação |
|------|---------------|
| **Auth** | Plataforma Base44 (tokens/sessões). Frontend usa `base44.auth.me()`. Backend valida com `base44.auth.me()` + `user.role === 'admin'`. |
| **Funções admin-only** | Retornam 403 se `role !== 'admin'` (rotinas de manutenção, dashboards admin). |
| **Webhooks** | Token na query + validação de `app_key`; service role; resposta genérica para fora. |
| **Secrets** | `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_TOKEN`, `FATURAMENTO_API_KEY`, `WEBHOOK_INDICADORES_TOKEN`. Nunca em código/banco. |
| **LGPD** | `mascararPII()` mascara CPF/CNPJ em todos os logs (mantém 3 primeiros + 2 últimos dígitos). |
| **RLS** | `ControleCircuitBreakerOmie` admin-only. User entity com segurança built-in (só admin lista/edita outros). |
| **Auditoria** | `LogGerencial` registra toda ação relevante (envio, exclusão, edição, faturamento, liberação forçada, etc.). |

---

## 12. Catálogo de Backend Functions

### 12.1 Infraestrutura Compartilhada
| Função | Papel |
|--------|-------|
| `_shared/omieClient` | Cliente Omie centralizado (throttle, breaker, cache, retry) |
| `_shared/portaoOmie` | Mutex global distribuído |
| `_shared/constantes` | Constantes compartilhadas |
| `getOmieCredentials` | Resolução de credenciais (env-first) |

### 12.2 Operações de Pedido (escrita Omie)
`enviarPedidoOmie`, `editarPedidoOmie`, `faturarPedidoOmie`, `faturarCargaOmie`, `emitirNfPedidoOmie`, `emitirNfsLoteOmie`, `cancelarPedidoOmie`, `cancelarNfOmie`, `cancelarNfAcerto`, `cortarPedidoOmie`, `devolverPedidoOmie`, `duplicarPedidoOmie`, `liberarPedidoOmie`, `trocarEtapaPedidoOmie`, `alterarPrevisaoFaturamentoOmie`, `alterarStatusPedidosFaturado`.

### 12.3 Consultas Omie (leitura, cacheada)
`consultarPedidoOmie`, `consultarPedidosDia`, `consultarProdutoOmie`, `consultarClientesOmie`, `consultarBloqueioFinanceiroOmie`, `consultarStatusFaturamentoOmie`, `consultarStatusPedidosOmie`, `consultarEtapaPedidosOmie`, `consultarDetalheNotaOmie`, `buscarPedidosOmie`, `listarNfsOmie`, `listarEtapasOmie`, `listarCenariosOmie`, `listarCategoriasOmie`, `listarContasReceberOmie`, `mapaEtapasOmie`.

### 12.4 Workers de Fila (auto-encadeados)
`processarFilaCargaOmie`, `processarFilaEnvioPedidoOmie`, `processarEmissaoNFLote`, `processarFilaBoletoOmie`, `processarFilaWebhookOmie`, `processarWebhookOmie`, `reenviarItemFilaCarga`, `reenfileirarPedidosOrfaos`, `retomarEmissaoNFLotePendente`, `reemitirNfPresasEtapa50`.

### 12.5 Reconciliação & Correção
`reconciliarStatusPedidosOmie`, `reconciliarEtapasAbertasOmie`, `reconciliarEspelhoCargaCompleto`, `reconciliarNfsCanceladasOmie`, `reconciliarNfAguardandoAutorizacao`, `reconciliarTrocasCargas`, `corrigirEspelho20Falso`, `corrigirEspelhoDia`, `corrigirEspelhoFaturados`, `corrigirEspelhoManual`, `corrigirStatusCargas`, `corrigirStatusPedidosFaturados`, `recalcularStatusFaturamentoPedidos`, `sincronizarLiberadosOmieRapido`, `sincronizarStatusCargasOmie`, `sincronizarStatusPedidosOmie`, `sincronizarPedidosCancelados`, `atualizarEspelhoPedidosOmie`, `criarEspelhosPedidosSemEspelho`, `preencherEspelhosZerados`.

### 12.6 Webhook & Receiver
`receberWebhookOmie` (público), `processarWebhookOmie`, `processarFilaWebhookOmie`, `limparBacklogWebhooksOmie`, `limparWebhooksNfTravados`.

### 12.7 Clientes / Produtos / Tabelas (sincronização Omie)
`enviarClienteOmie`, `importarClientesOmie`, `importarClientePontalOmie`, `exportarClientesOmie`, `exportarClientesFaltantesLote`, `excluirClienteOmie`, `excluirClientesLote`, `auditarClientesOmie`, `auditoriaClientesOmieJob`, `desbloquearFaturamentoClientesOmie`, `workerDesbloquearClientesOmie`, `enviarProdutoOmie`, `exportarProdutosOmie`, `corrigirProdutoOmie`, `excluirProdutoOmie`, `enviarVendedorOmieAuto`, `exportarVendedoresOmie`, `excluirVendedorOmie`, `sincronizarTabelasOmie`, `tratarTabelasPreco`, `importarCenariosFiscaisOmie`, `importarTudoDoOmie`.

### 12.8 Boletos
`gerarBoletosOmie`, `gerarBoletosFaltantesPrazo`, `processarFilaBoletoOmie`, `baixarPdfBoletoOmie`, `salvarBoletosLocais`, `diagnosticoBoletosCarga`, `dadosClienteNfBoletos`.

### 12.9 Carga & Logística
`soltarCarga`, `transferirPedidoCarga`, `enriquecerPedidosCarga`, `repararProdutosCarga`, `prepararNidNfCarga`, `revalidarCargaOmie`, `indiceCargasPorPedido`, `relatorioAnaliticoCarregamento`, `investigarDivergenciaMontagem`, `sincronizarAcertoOmie`.

### 12.10 Diagnóstico & Auditoria
`diagnosticarPedidosCanceladosOmie`, `diagEstruturaPedido`, `auditarItensPedidoVsOmie`, `auditarPedidoLiberadoOmie`, `auditarStatusRealPedidos`, `auditarReferenciasClientes`, `auditarCancelamentosIndevidos`, `auditarMotivosTroca`, `analisarPedidosOmie`, `compararPedidoOmie`, `compararPedidosOmieLocal`, `sanearPedidosTravados`.

### 12.11 Comercial / Cobertura / Metas
`agregadosVendedorComercial`, `agregadosClientesComercial`, `exportarPainelComercial`, `exportarIndicadoresComercial`, `exportarFaturamentoDia`, `exportarVendasItemDia`, `calcularScorecard`, `metasTrocaVencido`, `iniciarRegimeExperimental`, `gerarAgendaMensal`, `recalcularCobertura`, `encerrarCheckinsEsquecidos`, `bulkImportRoteiros`, `adicionarClientesRoteiroDias`, `vincularClientesRoteiro`.

### 12.12 Controle / Status / Utilidades
`statusCircuitBreakerOmie`, `desbloqueioAutomaticoOmie`, `testarConexaoOmie`, `salvarCredenciaisOmie`, `limparCacheExpiradoOmie`, `limparFilaEnvioConcluidos`, `limparDuplicadosEspelho`, `limparEspelhoCanceladosOmie`, `registrarLogGerencial`, `getItensPedidosLote`.

### 12.13 GitHub (connector autorizado: `repo`, `read:org`)
`listarCommitsGithub`, `listarArquivosGithub`, `lerArquivoGithub`, `analisarRepositorioGithub`.

---

## 13. Convenções & Lições Aprendidas

### 13.1 Estrutura de Backend Function
```js
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // ... lógica ...
    return Response.json({ ... });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```
- **Tudo dentro do handler** (init no topo = boot error).
- `await` em toda chamada SDK.
- `base44.asServiceRole` só quando necessário (admin/webhook).

### 13.2 Regras de Ouro da Integração Omie
1. **Nunca priorizar o banco para credenciais** — sempre `Deno.env` primeiro.
2. **Sem cache em memória de credenciais venenoso** — env é atômico.
3. **Toda operação reconsulta o estado real** antes de agir (idempotência).
4. **Lote pequeno + auto-encadeamento** > lote grande (evita timeout/órfãos).
5. **Respeitar o circuit breaker** — se bloqueado, abortar, nunca martelar.
6. **Portão global** — um worker por vez no Omie.
7. **"Já faturado" = sucesso**, não erro. **"Cliente bloqueado" = terminal**, não retry.
8. **Auto-encadeamento com intervalo seguro** — encadear rápido demais reabre o rate limit; respeitar janelas.

### 13.3 Frontend
- Páginas novas → `<Route>` explícito em `App.jsx` + `LayoutWrapper`.
- Componentes focados (< 50 linhas idealmente), arquivos próprios.
- Classes Tailwind como strings literais (purge) — dinâmicas via `safelist`.
- Tokens de design, nunca cores hardcoded.

### 13.4 Documentos de Apoio no Repositório
- `BLUEPRINT_MICROAPP_FATURAMENTO.md` — blueprint do faturamento.
- `LICOES_APRENDIDAS_OMIE.md` — histórico de incidentes e correções.
- `SDD_CARGA_214_NOTAS.md`, `SDD_METAS.md` — specs de domínio.

---

> **Resumo executivo:** este é um sistema de gestão comercial-logística-fiscal de missão crítica cuja complexidade central é a **integração resiliente com o Omie sob rate limit agressivo**. A arquitetura prioriza assincronicidade (filas + workers auto-encadeados), idempotência (reconsulta sempre), e proteção em camadas (circuit breaker + portão global + rate limiter atômico + locks). O frontend é um painel multi-domínio com permissões granulares por aba, espelhando em tempo real o estado fiscal mantido no Omie.