# 🏗️ Documentação Técnica & Arquitetural — ERP Pão & Mel + Omie

> **Documento mestre de arquitetura (Technical Paper).**
> Descreve o funcionamento completo, a lógica e **todos os escopos técnicos** do projeto: integração Omie, filas assíncronas, controle de concorrência, entidades, funções de backend, automações, páginas e invariantes fiscais.
> Mantenha este arquivo atualizado a cada mudança estrutural. Em caso de conflito, a régua de etapas Omie (§3) e as Invariantes (§13) prevalecem.

---

## 📑 Índice

1. [Visão geral do produto](#1-visão-geral-do-produto)
2. [Stack & topologia](#2-stack--topologia)
3. [Régua de etapas Omie (espinha dorsal)](#3-régua-de-etapas-omie-espinha-dorsal)
4. [Integração Omie — cliente central & resiliência](#4-integração-omie--cliente-central--resiliência)
5. [Controle de concorrência — breaker, rate limit & portão único](#5-controle-de-concorrência--breaker-rate-limit--portão-único)
6. [Credenciais & Secrets](#6-credenciais--secrets)
7. [Modelo de dados (entidades)](#7-modelo-de-dados-entidades)
8. [Filas assíncronas (workers)](#8-filas-assíncronas-workers)
9. [Webhooks Omie](#9-webhooks-omie)
10. [Funções de backend (catálogo)](#10-funções-de-backend-catálogo)
11. [Automações (scheduled / entity)](#11-automações-scheduled--entity)
12. [Frontend — páginas, layout & roteamento](#12-frontend--páginas-layout--roteamento)
13. [Invariantes & regras que não podem quebrar](#13-invariantes--regras-que-não-podem-quebrar)
14. [Fluxo end-to-end](#14-fluxo-end-to-end)
15. [Lições aprendidas (produção)](#15-lições-aprendidas-produção)
16. [Glossário](#16-glossário)

---

## 1. Visão geral do produto

ERP operacional da **Pão & Mel** integrado 100% ao **Omie ERP (API v1)**. Cobre o ciclo comercial e logístico de ponta a ponta:

- **Comercial:** cadastro de clientes/produtos/tabelas, criação e liberação de pedidos, metas, comissionamento, cobertura inteligente de visitas.
- **Logística / Faturamento:** montagem de cargas, faturamento, emissão de NF-e, boletos, romaneios, acerto de caixa (prestação de contas).
- **Integração:** sincronização bidirecional com o Omie (clientes, produtos, pedidos, NF-e, contas a receber/boletos) com forte controle de rate limit.

**Princípio mestre:** *faturar é um fluxo de estados assíncrono, nunca um clique atômico.* Tudo o que toca o Omie passa por **filas**, **circuit breaker** e um **portão único (mutex global)** para não estourar o limite da API.

---

## 2. Stack & topologia

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite, Tailwind CSS, shadcn/ui, lucide-react |
| Estado/dados | @tanstack/react-query, SDK Base44 (`@/api/base44Client`) |
| Backend (functions) | Deno (Base44 functions), `createClientFromRequest(req)` |
| Banco | Entidades Base44 (JSON Schema) — **compartilhado** entre módulos |
| Integração externa | Omie ERP API v1 (`https://app.omie.com.br/api/v1/`) via App Key/Secret |
| Auth | Plataforma Base44 (sem login custom); papéis `admin` / `user` + entidade `Permissao` |
| Roteamento | `react-router-dom` em `App.jsx` (loop `pagesConfig` + rotas explícitas) |

**Topologia de execução:**

```
[Browser/UI React] ──SDK──> [Functions Deno] ──omieCall──> [Omie API v1]
        │                          │  ▲                          │
        │                          │  └── ControleCircuitBreakerOmie (breaker/rate/portão)
        │                          │
        └── entidades Base44 <─────┘ (leitura/escrita direta + filas)
                                   ▲
[Omie] ──webhook──> receberWebhookOmie ── enfileira ──> processarFilaWebhookOmie
```

---

## 3. Régua de etapas Omie (espinha dorsal)

Confirmada pelo suporte Omie em **19/06**. Definida em `functions/_shared/constantes`:

| Etapa | Significado | Quem move |
|-------|-------------|-----------|
| `10` | Pedido de Venda | Comercial (criação) |
| `20` | Pedidos Liberados | Liberação / envio ao Omie |
| `50` | Faturar (A Faturar) | Faturar carga (`FilaCargaOmie`) |
| `60` | Faturado | Emissão de NF-e |
| `70` | Entrega / Entregue | Acerto de Caixa |
| `80` | Cancelado | Cancelamento / exclusão |

Constantes-chave: `ETAPA_FATURADO = '60'`, `ETAPA_ENTREGUE = '70'`, `CONTA_CORRENTE_PADRAO = 11464371392`, `STATUS_ABERTOS_BOLETOS = ['ABERTO','ABERTA','A_RECEBER']`, `DELAY_PADRAO_RETRY = 2500`.

**Regras de ouro:**
- "Faturar carga" **NÃO emite NF** e **NÃO troca etapa no Omie** num primeiro momento — marca o pedido como pronto para emissão. A troca para etapa 50 + previsão é feita pela `FilaCargaOmie`.
- Etapa **60** só ao emitir NF (`pedidovendafat` → `FaturarPedidoVenda`).
- Etapa **70** só pelo Acerto de Caixa.
- `modelo_nota='d1'` / `tipo_nota='D1'` = venda interna / troca **SEM NF** — nunca vai ao Omie para emissão.

---

## 4. Integração Omie — cliente central & resiliência

> **`functions/_shared/omieClient.ts`** — toda chamada ao Omie DEVE passar por `omieCall(base44, endpoint, param, { call })`. Nunca chamar `fetch` direto ao Omie fora dele.

### 4.1. Endpoints usados

Base: `https://app.omie.com.br/api/v1/`

| Domínio | Endpoint | Métodos (`call`) |
|---------|----------|------------------|
| Pedido | `produtos/pedido/` | `ConsultarPedido`, `IncluirPedido`, `AlterarPedidoVenda`, `TrocarEtapaPedido`, `ExcluirPedido` |
| Faturamento | `produtos/pedidovendafat/` | `FaturarPedidoVenda`, `ValidarPedidoVenda` |
| NF-e | `produtos/nfconsultar/` | `ConsultarNF`, `ObterNfe` (DANFE PDF), `ListarNF` |
| Contas a receber | `financas/contareceber/` | `ListarContasReceber` |
| Boleto | `financas/contareceberboleto/` | `GerarBoleto` |
| Clientes | `geral/clientes/` | `UpsertCliente`, `IncluirCliente`, `AlterarCliente`, `ExcluirCliente`, `ListarClientes` |
| Produtos | `geral/produtos/` | `UpsertProduto`, `ExcluirProduto` |

Payload padrão:
```json
{ "call": "ConsultarPedido", "app_key": "...", "app_secret": "...", "param": [ { /* ... */ } ] }
```

### 4.2. O que o `omieCall` implementa

1. **Resolução de credenciais** (Secret → fallback banco), cache de 30s por isolate.
2. **Circuit breaker** persistente (entidade `ControleCircuitBreakerOmie`, registro fixo `6a1e06a9aa62ceab7b3b6d97`) — aborta cedo se bloqueado.
3. **Throttle global atômico** (reserva de slot, ~1 chamada / 1,5s para TODO o app).
4. **Throttle por método** (~3 req/s, `THROTTLE_MIN_INTERVAL_MS = 334`) — margem da regra Omie de 240 req/min.
5. **Fila sequencial** para métodos críticos de escrita (`FaturarPedidoVenda`, `IncluirPedido`, `EmitirNF/NFS`, `CancelarNF`, `CancelarPedido(Venda)`, `UpsertCliente`) — Omie rejeita paralelismo.
6. **Retry exponencial** (1s/2s/4s) para HTTP 429.
7. **Tratamento de erros específicos do Omie:**
   - **CÓDIGO 6** — "Consumo redundante, aguarde X s": retry com o tempo exato informado, até 4 tentativas.
   - **MISUSE_API_PROCESS** / "consumo indevido" / HTTP 425 → bloqueio imediato de 30 min, sem retry.
   - **Chave de acesso inválida/bloqueada** (anti-flood severo): retry com espera até 3 vezes → breaker.
   - Genéricos (cota, limite, suspenso, 403, 425) → abre breaker.
8. **Cache** (memória + entidade `CacheOmieConsulta`) **só para leitura** — escrita nunca é cacheada.
9. **Log automático** em `LogIntegracaoOmie` com **mascaramento de CPF/CNPJ (LGPD)**.

> ⚠️ **Status HTTP antes de `res.json()`**: em 5xx/429/425 o corpo geralmente NÃO é JSON. Sempre checar `res.status` antes de parsear.

---

## 5. Controle de concorrência — breaker, rate limit & portão único

A entidade `ControleCircuitBreakerOmie` cumpre **3 papéis distintos** (por `chave`):

### 5.1. Circuit breaker (`chave='principal'`, ID fixo `6a1e06a9aa62ceab7b3b6d97`)
Campos: `bloqueado`, `bloqueado_ate`, `erros_consecutivos`, `threshold_erros` (default 3). Abre após N erros 425/MISUSE; **auto-desbloqueia** quando `bloqueado_ate` expira. Tempo extraído da própria mensagem Omie ("aguarde X segundos", cap 30 min).

### 5.2. Rate limit global (`chave='rate_limit_global'`)
Reserva de slot **atômica** por marca-e-confirma: `atualizado_em` guarda o *próximo slot reservado* (timestamp futuro). Cada instância adquire mutex curto (`worker_lock_ate`, TTL 4s), reserva `slot = max(agora, próximo_slot)`, grava `próximo_slot + 1,5s` e dorme até o seu slot. Garante que 2 instâncias **não disparem juntas**.

### 5.3. Portão único / mutex global (`chave='portao_global_omie'`) — `functions/_shared/portaoOmie`
- `adquirirPortao(base44, nome)` → mutex **marca-e-confirma** (grava `donoId` em `ultimo_erro`, relê, só assume se persistiu). TTL 5 min auto-release.
- `liberarPortao(base44, donoId)` → só libera se ainda for o dono.
- `temTrabalhoOperacaoPendente(base44)` → rotinas de **leitura/limpeza cedem a vez** quando há `FilaEnvioPedidoOmie` ou `FilaCargaOmie` pendente.

**Ordem de prioridade ao tocar o Omie:**
1. Verifica **circuit breaker** → se bloqueado, aborta cedo (sem tocar Omie).
2. **Operação** (Fila Envio, Fila Carga) adquire o portão direto.
3. **Leitura/limpeza** (reconciliações, correção de espelho) cede a vez se houver operação pendente.

> **Por que existe o portão:** antes, cada worker tinha seu próprio lock; os três podiam acordar no mesmo minuto (quando o breaker liberava) e bater no Omie **em paralelo** → rajada → re-bloqueio. O portão é um lock único que **todos** compartilham — só uma operação por vez toca o Omie.

---

## 6. Credenciais & Secrets

| Secret | Uso |
|--------|-----|
| `OMIE_APP_KEY` | App Key da Omie (fonte de verdade). |
| `OMIE_APP_SECRET` | App Secret da Omie. **Nunca** lido do banco em texto plano. |
| `OMIE_WEBHOOK_TOKEN` | Token na query string do webhook (`?token=...`). Valida origem. |
| `FATURAMENTO_API_KEY` | Chave de endpoints internos de faturamento. |
| `WEBHOOK_INDICADORES_TOKEN` | Token de webhooks de indicadores comerciais. |

### Política de resolução de credenciais (padronizada em TODAS as funções)
**Environment-First, sem cache venenoso:**
```js
const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
// fallback: entidade ConfiguracaoOmie SÓ se o Secret estiver vazio
```
- `Deno.env` é lido **atomicamente** a cada chamada → nunca serve uma chave velha.
- A entidade `ConfiguracaoOmie` é **apenas fallback** (pode conter app_key/secret antigos — por isso nunca tem prioridade).
- Removido o antigo `_credsCache` de 30s do banco, que causava key mismatch e re-bloqueio durante jobs de alta frequência.

> O `omieClient.ts` central mantém um cache de 30s **somente do Secret de ambiente** (atômico e seguro). As demais funções diretas leem env a cada chamada.

---

## 7. Modelo de dados (entidades)

Built-in em toda entidade (não declarar): `id`, `created_date`, `updated_date`, `created_by_id`.

### 7.1. Núcleo logístico/fiscal

| Entidade | Papel | Campos-chave |
|----------|-------|--------------|
| **Carga** | Container da expedição | `numero_carga`, `data_carga`, `pedidos_omie[]`, `pedidos_internos[]`, `pedidos_troca[]`, `status_carga` (`montagem\|faturada\|entregue`), `processamento_omie_status`, `checkin_saida`, `pdf_romaneio_url` |
| **Pedido** | Documento mestre | `status`, `status_faturamento`, `etapa`, `modelo_nota` (`55\|nfce\|d1`), `omie_codigo_pedido`, `numero_nota_fiscal`, `chave_nfe`, `omie_id_nf`, `nf_aguardando_autorizacao`, `solto_manualmente`, `pendente_emissao`, `carga_faturamento_numero` (imutável) |
| **PedidoItem** | Itens do pedido | produtos, quantidades, valores |
| **PedidoLiberadoOmie** | Espelho local das etapas Omie | `codigo_pedido`, `etapa`, `status_label`, `sincronizado_em`, `origem_sync` |
| **Retorno** | Devolução/troca/recusa pós-entrega | `tipo_retorno`, `produtos[]`, `valor_total_retorno`, `status` |
| **AcertoCaixa** | Prestação de contas pós-entrega | valores entregues/devolvidos/recebidos, divergências |

### 7.2. Filas (todas com `status`, `tentativas`, `erro_log`)

| Entidade | Fila de | Detalhe |
|----------|---------|---------|
| **FilaEnvioPedidoOmie** | Envio de pedido local → Omie (`IncluirPedido`) | Operação **prioritária** no portão. Dispara worker on-create. |
| **FilaCargaOmie** | Faturamento de carga (troca etapa 50 + previsão) | `operacao` (`faturar\|emitir_nf\|ambos`), `tentativas_redundante`, `tentativas_revalidacao`, `status=aguardando_acao_humana` |
| **FilaEmissaoNF** | Emissão de NF em lote | `lote_id`, retomada por watchdog |
| **FilaBoletoOmie** | Geração de boletos | baixa prioridade, espaçada |

> `aguardando_acao_humana` (FilaCargaOmie) = pedido em etapa < 50 que não avançou após N revalidações → **sai do loop automático** (não martela o Omie); volta só por ação humana ou webhook. **Não é erro vermelho.**

### 7.3. Auditoria & cache

| Entidade | Papel |
|----------|-------|
| **LogIntegracaoOmie** | Auditoria de TODA chamada Omie + **fila de webhooks** (`status='pendente'`). Campos de webhook: `webhook_topic`, `webhook_message_id`, `webhook_processado_em`. |
| **LogEmissaoNF** | 1 linha por emissão de NF: `status` (`autorizada\|rejeitada\|pendente\|erro\|bloqueado_cliente`), `codigo_sefaz` (cStat), `nid_nf`, `chave_nfe`, `faultstring/faultcode`. |
| **LogEmissaoBoleto** | 1 linha por `codigo_lancamento` (write-through, cache de boletos). |
| **CacheOmieConsulta** | Cache persistente de leituras (`chave`, `valor`, `expira_em`). |
| **ControleCircuitBreakerOmie** | Concorrência (breaker + rate limit + portão). **RLS: admin only.** |
| **ConfiguracaoOmie** | Config / fallback de credenciais (`app_key`, `app_secret_mascara`, `secret_em_secrets`). |
| **LogGerencial** | Auditoria de ações sensíveis (envio, exclusão, faturamento, liberação forçada...). |
| **RateLimitWebhook** | Controle de flood de webhooks. |

### 7.4. Comercial / cobertura (resumo)
`Cliente`, `Produto`, `Vendedor`, `Veiculo`, `Motorista`, `Rota`, `TabelaPreco`, `PrecoProduto`, `PlanoPagamento`, `ModalidadePagamento`, `Meta`, `MetaComissao`, `ScorecardApuracao`, `Visita`, `AgendaComercial`, `CoberturaStatus`, `Alerta`, `ParametroCobertura`, `EstoqueVisitaItem`, `GeolocalizacaoPedido`, `Roteiro`, `Permissao`, `Cargo`, `Funcao`, `Departamento`, `Segmento`, `Rede`, `CenarioFiscal`, `CenarioFiscalLocal`, `MotivoTroca`, `MotivoCorte`.

### 7.5. Entidade `User` (built-in)
Read-only: `id`, `full_name`, `email`. Editável: `role` (`admin`/`user`). Permissões granulares de UI via entidade `Permissao` (`vendedor_id`, `abas_visiveis[]`). Admin vê tudo; demais veem só as abas liberadas.

---

## 8. Filas assíncronas (workers)

Padrão de todo worker: **verifica breaker → adquire portão → processa N itens espaçados → libera portão**. Itens órfãos (execução morreu no meio) são resgatados por `processando_em` + timeout.

| Worker | Fila | Disparo | Lógica |
|--------|------|---------|--------|
| `processarFilaEnvioPedidoOmie` | FilaEnvioPedidoOmie | on-create + scheduled 10min | Envia até 10 pedidos, 500ms entre eles, `IncluirPedido` → etapa 20. |
| `processarFilaCargaOmie` | FilaCargaOmie | scheduled 10min | `TrocarEtapaPedido` 50 + previsão; anti-órfão, auto-encadeamento; respeita revalidações. |
| `processarEmissaoNFLote` | FilaEmissaoNF | on-create | Emite 1 NF por vez, delay 3s, `lote_id`; watchdog `retomarEmissaoNFLotePendente`. |
| `processarFilaBoletoOmie` | FilaBoletoOmie | scheduled 5min | Gera boletos espaçados, baixa prioridade (cede a webhooks/NF). |
| `processarFilaWebhookOmie` | LogIntegracaoOmie (pendente) | scheduled 10min | Consome webhooks **sequencial**, delay 2,5s, dedup por `messageId`. |

---

## 9. Webhooks Omie

### 9.1. Receiver — `functions/receberWebhookOmie`
URL cadastrada no painel Omie:
```
https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>
```
- **Ultra leve (<200ms):** valida token + app_key, sanitiza payload (JSON, ≤50KB), responde 200 rápido.
- **Ping de validação:** payload sem `topic` → `{ ping: 'success' }` (Omie exige no cadastro).
- **Idempotência:** dedup por `messageId` (consulta `LogIntegracaoOmie.webhook_message_id`).
- **Só enfileira:** grava log `pendente` e dispara `processarFilaWebhookOmie` (fire-and-forget). Tópicos irrelevantes entram já como `ignorado`.

### 9.2. Tópicos tratados — `functions/processarWebhookOmie`

| Tópico | Ação |
|--------|------|
| `VendaProduto.EtapaAlterada` | Atualiza etapa do espelho/pedido local |
| `VendaProduto.Faturada` | Marca faturado, grava nº NF / chave |
| `VendaProduto.Cancelada` | Marca cancelado (`cancelado` / `_pos_faturamento`) |
| `NFe.NotaAutorizada` | Grava número/chave quando autorização é assíncrona |
| `NFe.NotaDenegada/Rejeitada` | Marca rejeição |

> **Blindagem fiscal:** o worker nunca sobrescreve status verificado nem apaga `numero_nf`.

---

## 10. Funções de backend (catálogo)

### 10.1. Compartilhadas (`_shared/`)
`omieClient.ts` (cliente Omie central), `portaoOmie` (mutex global + prioridade), `constantes` (etapas, conta corrente, delays).

### 10.2. Faturamento & emissão de NF
`faturarCargaOmie`, `faturarPedidoOmie`, `emitirNfPedidoOmie`, `emitirNfsLoteOmie`, `processarEmissaoNFLote`, `retomarEmissaoNFLotePendente`, `reemitirNfPresasEtapa50`, `trocarEtapaPedidoOmie`, `alterarPrevisaoFaturamentoOmie`, `liberarPedidoOmie`, `enviarPedidoOmie`.

### 10.3. Boletos
`gerarBoletosOmie`, `gerarBoletosFaltantesPrazo`, `processarFilaBoletoOmie`, `baixarPdfBoletoOmie`, `listarContasReceberOmie`, `dadosClienteNfBoletos`, `salvarBoletosLocais`, `diagnosticoBoletosCarga`.

### 10.4. NF — consulta / PDF / reconciliação
`consultarDetalheNotaOmie`, `listarNfsOmie`, `baixarPdfDanfeOmie`, `reconsultarStatusNFsPendentes`, `reconciliarNfAguardandoAutorizacao`, `reconciliarNfsCanceladasOmie`, `preencherDadosNFLogs`, `prepararNidNfCarga`, `cancelarNfOmie`, `cancelarNfAcerto`, `consultarStatusFaturamentoOmie`.

### 10.5. Pedidos — ajustes / exceção
`soltarCarga`, `transferirPedidoCarga`, `cortarPedidoOmie`, `devolverPedidoOmie`, `cancelarPedidoOmie`, `editarPedidoOmie`, `duplicarPedidoOmie`, `consultarPedidoOmie`, `buscarPedidosOmie`, `importarPedidoOmie`.

### 10.6. Cargas — reconciliação / reparo
`revalidarCargaOmie`, `reconciliarEspelhoCargaCompleto`, `enriquecerPedidosCarga`, `repararProdutosCarga`, `indiceCargasPorPedido`, `sincronizarStatusCargasOmie`, `corrigirStatusCargas`, `prepararNidNfCarga`.

### 10.7. Espelho / reconciliação de status (rede de segurança)
`sincronizarLiberadosOmieRapido`, `reconciliarEtapasAbertasOmie`, `reconciliarStatusPedidosOmie`, `sincronizarStatusPedidosOmie`, `corrigirEspelho20Falso`, `corrigirEspelhoDia`, `corrigirEspelhoManual`, `corrigirEspelhoFaturados`, `criarEspelhosPedidosSemEspelho`, `limparEspelhoCanceladosOmie`, `limparDuplicadosEspelho`, `preencherEspelhosZerados`, `atualizarEspelhoPedidosOmie`.

### 10.8. Clientes / produtos / vendedores (sincronização Omie)
`enviarClienteOmie`, `enviarProdutoOmie`, `enviarVendedorOmieAuto`, `excluirClienteOmie`, `excluirProdutoOmie`, `excluirVendedorOmie`, `consultarClientesOmie`, `importarClientesOmie`, `importarClientePontalOmie`, `auditoriaClientesOmieJob`, `auditarClientesOmie`, `desbloquearFaturamentoClientesOmie`, `workerDesbloquearClientesOmie`, `consultarBloqueioFinanceiroOmie`, `consultarProdutoOmie`, `exportarProdutosOmie`, `exportarVendedoresOmie`.

### 10.9. Saúde / infraestrutura / webhook
`receberWebhookOmie`, `processarWebhookOmie`, `processarFilaWebhookOmie`, `limparBacklogWebhooksOmie`, `limparWebhooksNfTravados`, `desbloqueioAutomaticoOmie`, `limparCacheExpiradoOmie`, `statusCircuitBreakerOmie`, `testarConexaoOmie`, `salvarCredenciaisOmie`, `getOmieCredentials`.

### 10.10. Relatórios / exportações / comercial
`relatorioAnaliticoCarregamento`, `exportarFaturamentoDia`, `exportarVendasItemDia`, `sincronizarAcertoOmie`, `agregadosVendedorComercial`, `agregadosClientesComercial`, `calcularScorecard`, `metasTrocaVencido`, `recalcularCobertura`, `gerarAgendaMensal`, `encerrarCheckinsEsquecidos`.

> ⚠️ **Toda função que chama o Omie segue a política Environment-First de credenciais (§6) e usa breaker/portão.** Funções admin-only validam `user.role === 'admin'` e retornam 403 caso contrário.

---

## 11. Automações (scheduled / entity)

### 11.1. Workers de fila & infraestrutura (ATIVAS)

| Automação | Tipo | Frequência | Função |
|-----------|------|-----------|--------|
| Processar Fila Carga Omie | scheduled | 10 min | `processarFilaCargaOmie` |
| Processar Fila Envio Pedidos Omie | scheduled | 10 min | `processarFilaEnvioPedidoOmie` |
| Disparar Envio ao Enfileirar Pedido | entity (create) | — | `processarFilaEnvioPedidoOmie` |
| Processar Fila Webhooks Omie | scheduled | 10 min | `processarFilaWebhookOmie` |
| Worker Fila de Boletos Omie | scheduled | 5 min | `processarFilaBoletoOmie` |
| ProcessarEmissaoNFLote | entity (create) | — | `processarEmissaoNFLote` |
| Retomar Emissão NF Lote Travado | scheduled | 5 min | `retomarEmissaoNFLotePendente` |
| Desbloqueio Automático Omie (preciso) | scheduled | 5 min | `desbloqueioAutomaticoOmie` |
| Desbloqueio Faturamento Clientes (worker) | scheduled | 10 min | `workerDesbloquearClientesOmie` |
| Limpeza Cache e Logs Omie | scheduled | 1 h | `limparCacheExpiradoOmie` |
| Limpar Backlog Webhooks Omie | scheduled | 1 h | `limparBacklogWebhooksOmie` |
| Limpeza Fila Envio Concluídos | scheduled | 6 h | `limparFilaEnvioConcluidos` |
| Limpar espelho de pedidos cancelados | scheduled | 30 min | `limparEspelhoCanceladosOmie` |
| Criar Espelhos Faltantes (rede segurança) | scheduled | 30 min | `criarEspelhosPedidosSemEspelho` |
| Reconciliar NF aguardando autorização | scheduled | 15 min | `reconciliarNfAguardandoAutorizacao` |
| Preencher Nº NF nos Logs Autorizados | scheduled | 10 min | `preencherDadosNFLogs` |

### 11.2. Sincronização Omie (entity create/update/delete)

| Automação | Entidade / Evento | Função |
|-----------|-------------------|--------|
| Enviar Cliente ao Omie | Cliente / create+update | `enviarClienteOmie` (ignora `tipo_nota=D1`) |
| Enviar Produto ao Omie | Produto / create+update | `enviarProdutoOmie` (ignora `bonificacao`) |
| Excluir Cliente do Omie | Cliente / delete | `excluirClienteOmie` |
| Excluir Produto do Omie | Produto / delete | `excluirProdutoOmie` |

### 11.3. Comercial / cobertura

| Automação | Frequência | Função |
|-----------|-----------|--------|
| Recalcular Cobertura | diário 06:00 | `recalcularCobertura` |
| Encerrar check-ins esquecidos | diário 06:30 | `encerrarCheckinsEsquecidos` |

### 11.4. Redes de segurança em standby (arquivadas/inativas)
`reconciliarEtapasAbertasOmie`, `sincronizarLiberadosOmieRapido`, `reconciliarEspelhoCargaCompleto`, `reconciliarStatusPedidosOmie`, `sincronizarStatusCargasOmie`, `sincronizarStatusPedidosOmie`, `reconciliarNfsCanceladasOmie`, `atualizarStatusLogsPendentes`, `processarWebhookOmie` (entity), `reemitirNfPresasEtapa50`.

> Várias destas foram **pausadas por falhas consecutivas** (rate limit Omie). Reativar só com o breaker estável e validando que respeitam o portão único — senão geram rajadas e re-bloqueio.

---

## 12. Frontend — páginas, layout & roteamento

### 12.1. Roteamento
`App.jsx` renderiza um loop sobre `pagesConfig.Pages` **+ rotas explícitas** (atalhos, aliases case-insensitive e redirecionamentos). Página inicial: `Home` (`/`). Cada página é envolvida por `LayoutWrapper`.

> ⚠️ **`pages.config.js` NÃO é mais auto-gerado.** Toda página nova precisa de `<Route>` explícito em `App.jsx`, aplicando o mesmo `LayoutWrapper`.

### 12.2. Layout (`Layout.jsx`)
Sidebar com permissões por papel (admin vê tudo; demais via entidade `Permissao.abas_visiveis`). Indicador global `StatusOmieIndicator` (breaker bloqueado/livre + fila pendente). Grupos de menu:

- **Cadastros** (Hub) · **Pedidos** · **Análises Comercial** · **Relatórios Visitas** · **Roteiros de Campo** · **Cobertura Inteligente** · **Logística** · **Gerenciamento** (admin) · **Integração Omie** (admin) · **Commits GitHub** (admin).

### 12.3. Páginas por domínio

| Domínio | Páginas |
|---------|---------|
| **Logística/Faturamento** | `MontagemCarga`, `Cargas`, `NotasOmie`, `BoletosOmie`, `EmissaoBoletos`, `AcertoCaixa` (+`AcertoCaixaEditar`,`AcertoResumoPDF`), `RelatorioCarregamento`, `Operacao` |
| **Pedidos** | `Pedidos`, `EmissaoPedidos`, `GerenciarPedidosPage`, `AjustesPedidos` (corte/cancelamento/transferência/devolução), `ControlePedidosVenda`, `ControlePedidosTroca`, `EnviarRotasOmie` |
| **Comercial / análises** | `AnalisesComercial`, `Metas`, `GestaoMetas`, `Comissionamento`, `Dashboard` |
| **Roteiros / cobertura** | `MeusRoteiros`, `RotaSupervisores`, `GestaoRoteiros`, `Roteiros`, `CoberturaInteligente`, `RelatoriosVisitas` |
| **Cadastros** | `CadastrosHub`, `Clientes`, `Produtos`, `Vendedores`, `Funcionarios`, `Funcoes`, `Veiculos`, `Motoristas`, `Rotas`, `Redes`, `Segmentos`, `TabelasPreco`, `PlanosPagamento`, `Categorias`, `UnidadesMedida`, `Empresa`, `MotivosTroca`, `CenariosFiscais`, `CenariosFiscaisLocais` |
| **Integração / admin** | `IntegracaoOmieDashboard`, `ConfiguracaoOmie`, `LogGerencial`, `AuditoriaCancelados`, `Permissoes`, `SincronizarClienteOmie`, `SincronizarClientesCSVPage`, `SupervisaoFilaEnvio`, `CommitsGithub`, `TestesOmie`, `CorrigirEspelho20`, `CorrigirPlanosPlanilha`, `ComparacaoPedidosOmie`, `CorrecaoManual` |

### 12.4. Componentes de documento (PDF)
`components/cargas/documentos/`: `DocumentosCargaModal`, `RomaneioEntregaPdf`, `ListaCarregamentoPdf`, `NotaD1Pdf`, `printHelper`. Impressão NF/boleto: `NfsImpressaoDialog`, `NfCompletaDialog`, `BoletosImpressaoDialog`. Bibliotecas: `jspdf`, `pdf-lib`, `html2canvas`.

### 12.5. Sistema de testes interno (`TestesOmie`)
Suítes em `components/testes/suites/` (entidades, lógica pura, fluxos de usuário, integração Omie, paridade de montagem, cargas/transferência, ajustes/acerto, permissões/UI, E2E). Orquestradas por `lib/testRunner.js`.

---

## 13. Invariantes & regras que não podem quebrar

1. `numero_nf` preenchido **NUNCA** é apagado.
2. `carga_faturamento_numero` é **imutável** após gravado (preserva a carga que gerou a NF mesmo após transferência).
3. `solto_manualmente=true` → nenhuma rotina automática fatura/emite aquele pedido.
4. D1 (`modelo_nota='d1'`/`tipo_nota='D1'`) → nunca emite NF no Omie.
5. Reemissão bloqueada se o pedido já tem `numero_nota_fiscal` / `faturado` / `status_faturamento='faturado'`.
6. **Toda** chamada Omie passa por `omieCall` ou helper com breaker/throttle/log. Nunca `fetch` direto fora dele.
7. Erros de escrita Omie nunca são `try/catch` silenciosos — sempre logam em `LogIntegracaoOmie` / `LogEmissaoNF`.
8. **Idempotência:** por `omie_codigo_pedido` (pedido), `messageId` (webhook), `codigo_lancamento` (boleto), `nid_nf` (NF).
9. **Credenciais Environment-First** (§6) — sem cache de banco que sirva chave velha.
10. **Concorrência:** só uma operação por vez toca o Omie (portão único); leitura cede a vez para operação.
11. `bloqueado_cliente` (LogEmissaoNF) é erro **terminal** — não retentar até desbloquear o cadastro no Omie.
12. Funções admin-only validam `user.role === 'admin'` (403 caso contrário).

---

## 14. Fluxo end-to-end

```
[Comercial cria pedido] → etapa 10
        ↓ liberação / envio
[FilaEnvioPedidoOmie] → IncluirPedido → etapa 20 (Liberado)   ← espelho PedidoLiberadoOmie
        ↓ MONTAGEM DE CARGA
[Carga: montagem] → pedidos_omie / internos / troca
        ↓ FATURAR CARGA (faturarCargaOmie — local)
status_carga=faturada; Pedido.status=montagem, status_faturamento=pendente
[FilaCargaOmie] (worker) → TrocarEtapaPedido 50 + previsão → etapa 50
        ↓ EMISSÃO NF (NotasOmie → emitirNfPedidoOmie)
FaturarPedidoVenda → etapa 60 (Faturado) + nNF/chave/nIdNF → LogEmissaoNF=autorizada
   (autorização assíncrona? nf_aguardando_autorizacao=true → webhook NFe.NotaAutorizada grava nº)
        ↓ BOLETOS (gerarBoletosOmie)
ListarContasReceber → GerarBoleto → LogEmissaoBoleto (write-through)
        ↓ ROMANEIO / LISTA DE CARREGAMENTO (PDFs)
        ↓ ENTREGA + ACERTO DE CAIXA
Acerto → etapa 70 (Entregue); Retorno[] para devoluções/trocas/recusas
```

**Webhooks** atualizam etapas/NF em paralelo a tudo isso (rede de segurança + tempo real). As automações de reconciliação são a **segunda rede** caso um webhook se perca.

---

## 15. Lições aprendidas (produção)

1. **`ListarNF` NÃO filtra por pedido** — só aceita `nNF`, faixa de datas (`dEmiInicial/dEmiFinal`), `cRazao`, `cCPFCNPJDest`, paginação. Para achar NFs de uma carga: buscar por faixa de datas e **cruzar client-side por `nf.compl.nIdPedido`**. Quando a carga já tem `numero_nf`, buscar direto por `nNF` em lotes de ~6.
2. **`ListarNF` não ordena cronologicamente** — sempre restringir por faixa de datas, nunca "ir para a última página".
3. **Payload pesado estoura serialização (500)** — na listagem retornar só resumo (`qtd_itens`); detalhe de uma nota sob demanda (`consultarDetalheNotaOmie`).
4. **Latência espelho local vs Omie** — uma carga pode estar "faturada" localmente com pedidos ainda em etapa 20 no espelho, já estando em 60 no Omie. Confirmar na Omie em decisões fiscais.
5. **Status HTTP antes de `res.json()`** — 5xx/429/425 não retornam JSON. 425 = consumo redundante → não retentar imediatamente.
6. **Cache de credenciais do banco era veneno** — servia app_key velho durante jobs de alta frequência → key mismatch → re-bloqueio. Solução: Environment-First sem cache de banco.
7. **Locks dedicados por worker causavam rajadas** — três workers acordavam juntos ao liberar o breaker. Solução: **portão único** compartilhado.

---

## 16. Glossário

| Termo | Significado |
|-------|-------------|
| **Etapa** | Estágio do pedido no Omie (10/20/50/60/70/80). |
| **Espelho** | `PedidoLiberadoOmie` — cópia local da etapa Omie para consulta rápida. |
| **Breaker** | Circuit breaker persistente que bloqueia chamadas após erros de rate limit. |
| **Portão** | Mutex global; só uma operação por vez toca o Omie. |
| **Slot** | Janela de tempo reservada atomicamente pelo rate limiter global (~1,5s). |
| **CÓDIGO 6** | Erro Omie "consumo redundante, aguarde X s". |
| **MISUSE_API_PROCESS** | Erro Omie "consumo indevido" (425) → bloqueio 30 min. |
| **nCodPed** | Código do pedido no Omie (`omie_codigo_pedido`). |
| **nIdNF** | ID interno da NF no Omie (`omie_id_nf` / `nid_nf`). |
| **cStat** | Código de status SEFAZ (100 = autorizada). |
| **D1** | Venda interna / troca SEM nota fiscal (nunca emite no Omie). |
| **Write-through** | Gravar no local ao escrever no Omie, para leitura futura sem consultar a API. |
| **aguardando_acao_humana** | Item de fila que saiu do retry automático e só volta por ação humana/webhook. |

---

> **Resumo em uma frase:** ERP comercial + logístico totalmente integrado ao Omie, onde *faturar é um fluxo de estados assíncrono* — pedidos passam por filas (envio → carga → NF → boleto → acerto), serializados por um **portão único** com **circuit breaker** e **rate limit global**, com webhooks e automações de reconciliação como redes de segurança, e invariantes fiscais que blindam número de NF, cargas de faturamento e pedidos soltos manualmente.