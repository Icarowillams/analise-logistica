# 📐 Documentação Técnica & Arquitetural — Sistema de Gestão Comercial, Logística e Faturamento (Pão & Mel + Omie)

> **Documento mestre de arquitetura.** Cobre absolutamente todos os escopos técnicos do projeto: visão geral, modelo de dados, integração Omie, mecanismos de resiliência, filas assíncronas, fluxos de negócio fim-a-fim, frontend, automações e segurança. Use este arquivo como fonte de verdade arquitetural.

**Stack:** React + Vite + TailwindCSS + shadcn/ui · Base44 BaaS (entidades, funções Deno, automações) · Integração Omie ERP · Conector GitHub.
**Idioma de domínio:** Português (BR) · **Timezone:** America/Fortaleza.

---

## 📑 Índice

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Princípios Arquiteturais](#2-princípios-arquiteturais)
3. [Camadas da Aplicação](#3-camadas-da-aplicação)
4. [Modelo de Dados (Entidades)](#4-modelo-de-dados-entidades)
5. [Integração Omie — A Espinha Dorsal](#5-integração-omie--a-espinha-dorsal)
6. [Mecanismos de Resiliência](#6-mecanismos-de-resiliência)
7. [Camada de Credenciais (Hardening)](#7-camada-de-credenciais-hardening)
8. [Filas Assíncronas](#8-filas-assíncronas)
9. [Fluxos de Negócio Fim-a-Fim](#9-fluxos-de-negócio-fim-a-fim)
10. [Catálogo de Funções Backend](#10-catálogo-de-funções-backend)
11. [Webhooks Omie](#11-webhooks-omie)
12. [Frontend — Páginas e Navegação](#12-frontend--páginas-e-navegação)
13. [Módulo de Cobertura Inteligente](#13-módulo-de-cobertura-inteligente)
14. [Módulo Comercial & Comissionamento](#14-módulo-comercial--comissionamento)
15. [Auditoria, Logs e Rastreabilidade](#15-auditoria-logs-e-rastreabilidade)
16. [Segurança e Permissões](#16-segurança-e-permissões)
17. [Glossário de Etapas Omie](#17-glossário-de-etapas-omie)
18. [Convenções de Código](#18-convenções-de-código)

---

## 1. Visão Geral do Sistema

O sistema é um **ERP operacional de distribuição** que orquestra o ciclo comercial completo de uma distribuidora de bebidas/alimentos, espelhando e comandando o **Omie** (ERP fiscal/financeiro de origem) sem nunca perder a soberania da operação local.

### Domínios funcionais

| Domínio | Responsabilidade |
|---|---|
| **Comercial** | Pedidos de venda, trocas, devoluções, bonificações; tabelas de preço; planos de pagamento; cenários fiscais. |
| **Logística** | Montagem de cargas, roteirização, faturamento em lote, emissão de NF-e, boletos, acerto de caixa, retornos. |
| **Faturamento Fiscal** | Sincronização bidirecional com Omie: envio de pedidos, troca de etapas, emissão de NF, espelho de status. |
| **Cobertura Inteligente** | Agenda de visitas por papel (gerência→coordenador→supervisor→vendedor→promotor), check-in/out GPS, alertas em cascata. |
| **Gestão & Análise** | Metas em cascata hierárquica, comissionamento, scorecard, dashboards comerciais. |
| **Governança** | Log gerencial, auditoria de cancelados, permissões por aba, credenciais Omie. |

### O conceito central: **Espelho (Mirror)**

O Omie é a fonte de verdade **fiscal**, mas a **operação acontece localmente**. Para isso o sistema mantém entidades-espelho (`PedidoLiberadoOmie`, `LogEmissaoNF`, etc.) que refletem o estado real do Omie, reconciliadas continuamente. A operação local nunca espera o Omie de forma síncrona — ela enfileira e reconcilia.

---

## 2. Princípios Arquiteturais

1. **Operação local soberana, Omie como sistema fiscal.** A UI nunca trava esperando o Omie; tudo crítico passa por fila assíncrona + reconciliação.
2. **Idempotência em todo lugar.** Webhooks usam `messageId`; filas usam locks; reprocessamentos são seguros.
3. **Resiliência antes de throughput.** Circuit breaker + portão global + rate limit protegem a cota Omie acima de qualquer pressa.
4. **`Deno.env` é a única fonte de verdade de secrets** (ver §7). Banco só é fallback.
5. **Blindagem fiscal.** Pedidos soltos manualmente nunca são faturados por rotina automática (`solto_manualmente`).
6. **Rastreabilidade total.** `LogGerencial` + `LogIntegracaoOmie` + `LogEmissaoNF` cobrem quem/quando/o quê.
7. **Cascata hierárquica** como padrão de modelagem (metas, cobertura, alertas).

---

## 3. Camadas da Aplicação

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Vite)                                      │
│  pages/ · components/ · lib/ · hooks/                         │
│  - SDK: base44.entities / base44.functions.invoke            │
│  - React Query (cache), shadcn/ui, Tailwind tokens           │
└───────────────────────────┬─────────────────────────────────┘
                            │  base44.functions.invoke(...)
┌───────────────────────────▼─────────────────────────────────┐
│  BACKEND FUNCTIONS (Deno Serve)                              │
│  functions/  — 150+ handlers                                 │
│  - _shared/omieClient   (cliente resiliente)                 │
│  - _shared/portaoOmie   (mutex global)                       │
│  - _shared/constantes   (etapas, mapas)                      │
└───────────────────────────┬─────────────────────────────────┘
              ┌─────────────┴──────────────┐
┌─────────────▼─────────────┐   ┌───────────▼──────────────────┐
│  BASE44 ENTITIES (DB)     │   │  OMIE ERP API (externa)       │
│  ~90 entidades JSON       │   │  produtos/pedido, geral/...   │
│  + entidades-espelho      │   │  REST POST + app_key/secret   │
└───────────────────────────┘   └──────────────────────────────┘
              │
┌─────────────▼─────────────┐
│  AUTOMATIONS (scheduled/   │
│  entity/connector/webhook) │
└────────────────────────────┘
```

---

## 4. Modelo de Dados (Entidades)

> Atributos built-in em toda entidade: `id`, `created_date`, `updated_date`, `created_by_id`.

### 4.1 Núcleo Comercial

| Entidade | Papel | Campos-chave |
|---|---|---|
| **Cliente** | Cadastro central de clientes | `codigo_omie`, `codigo_cliente_omie`, `cnpj_cpf`, `tipo_nota` (55/D1), `bloquear_faturamento`, `pendencia_financeira`, `modalidade_pagamento_id`, `rota_id`, `responsavel_id`, `dias_visita[]`, geo `latitude/longitude` |
| **Produto** | Catálogo (comercial + logística) | `codigo`, `codigo_omie`, `ncm`, `cest`, `fator_caixa`, `multiplo_carga`, `volume_m3`, `peso`, `tipo_embalagem`, `galeia_id`, `retornavel` |
| **Pedido** | Pedido de venda/troca/bonif./devolução | `status`, `status_faturamento`, `status_logistico`, `etapa`, `omie_codigo_pedido`, `chave_nfe`, `omie_id_nf`, `solto_manualmente`, `pendente_emissao`, `carga_faturamento_numero`, geo |
| **PedidoItem** | Itens do pedido | produto, qtd, valor unit/total |
| **TabelaPreco / PrecoProduto** | Preços por tabela | preços, ações promocionais |
| **PlanoPagamento / ModalidadePagamento** | Condições financeiras | parcelas, boleto/pix/dinheiro |
| **CenarioFiscal / CenarioFiscalLocal** | Natureza de operação | código Omie, tipo |

### 4.2 Logística & Faturamento

| Entidade | Papel |
|---|---|
| **Carga** | Agrupa pedidos Omie + internos (D1) + trocas por motorista/veículo. `status_carga` (montagem/faturada/entregue), `processamento_omie_status`, `pedidos_omie[]`, `produtos_resumo[]`, `checkin_saida` GPS |
| **FilaCargaOmie** | Fila assíncrona de fechamento de carga (1 registro/pedido) — troca etapa 50 + previsão. Estados: pendente→processando→concluido/erro/`aguardando_acao_humana` |
| **FilaEnvioPedidoOmie** | Fila de envio de pedidos novos ao Omie |
| **FilaEmissaoNF / FilaBoletoOmie** | Filas de emissão de NF e geração de boletos |
| **LogEmissaoNF** | Histórico persistente de cada emissão de NF-e (status SEFAZ real, `nid_nf`, `chave_nfe`, `bloqueado_cliente`) |
| **LogEmissaoBoleto** | Histórico de boletos |
| **PedidoLiberadoOmie** | **Espelho** dos pedidos no Omie (etapa real, status_label) |
| **Retorno** | Produtos retornados (devolução/troca/recusa/avaria) |
| **AcertoCaixa** | Acerto financeiro pós-entrega |
| **Veiculo / Motorista / Rota** | Recursos de roteirização |

### 4.3 Integração & Controle

| Entidade | Papel |
|---|---|
| **ConfiguracaoOmie** | `app_key` + máscara do secret (secret real vive em `OMIE_APP_SECRET`). Fallback apenas. |
| **LogIntegracaoOmie** | Auditoria de TODA chamada à API Omie (endpoint, call, payloads, duração, `webhook_message_id`) |
| **ControleCircuitBreakerOmie** | Circuit breaker persistente + mutex do portão global (`worker_rodando`, `worker_lock_ate`) |
| **CacheOmieConsulta** | Cache persistente de consultas read-only |
| **RateLimitWebhook** | Throttle de webhooks |
| **JobAuditoriaOmie** | Estado de jobs de auditoria de clientes |

### 4.4 Cobertura Inteligente

| Entidade | Papel |
|---|---|
| **AgendaComercial** | Agenda mensal de visitas por usuário/papel/periodicidade |
| **Visita** | Check-in/out GPS, finalidade (venda/reposição), distância do cadastro |
| **CoberturaStatus** | Status por cliente/papel (falhas consecutivas → em_dia/atenção/atrasado/crítico) |
| **Alerta** | Alertas em cascata (agenda não cumprida, checkout pendente, fora do raio) |
| **ParametroCobertura** | Raio GPS, timeout checkout, periodicidade por papel (registro único) |
| **EstoqueVisitaItem** | Leitura de estoque (venda) ou reposição (promotor) |
| **GeolocalizacaoPedido** | Geo capturada no lançamento de cada pedido |
| **Roteiro / VisitaRoteiro / RotaSupervisor** | Roteiros de campo |

### 4.5 Gestão Comercial

| Entidade | Papel |
|---|---|
| **Meta** | Metas em cascata gerente→supervisor→vendedor (`meta_pai_id`) |
| **MetaComissao / ScorecardApuracao / RegimeExperimental** | Comissionamento e gamificação |
| **Vendedor** | Funcionário central (papéis múltiplos: vendedor/motorista/supervisor/promotor...) |
| **Permissao** | Abas visíveis por funcionário |
| **LogGerencial** | Auditoria de TODA ação relevante (quem/quando/valor antigo→novo) |

---

## 5. Integração Omie — A Espinha Dorsal

### 5.1 Padrão de chamada

Todas as chamadas seguem o contrato REST do Omie:

```js
POST https://app.omie.com.br/api/v1/<recurso>/
{
  "call": "ConsultarPedido",        // método Omie
  "app_key": "<OMIE_APP_KEY>",
  "app_secret": "<OMIE_APP_SECRET>",
  "param": [ { ... } ]
}
```

Recursos usados: `produtos/pedido/`, `geral/clientes/`, `geral/produtos/`, `produtos/nfconsultar/`, `financas/contareceber/`, `geral/etapasfaturamento/`, entre outros.

### 5.2 Cliente centralizado — `_shared/omieClient`

Pipeline completo de cada request:

```
resolver credenciais (env-primeiro)
   → checar circuit breaker (persistente)
   → adquirir slot de rate limit (global + por método)
   → [write crítico] serializar via portão global
   → checar cache (read-only)
   → fetch com timeout + AbortController
   → classificar resposta (faultstring / HTTP 425/429)
   → retry com backoff OU abrir breaker
   → logar em LogIntegracaoOmie (com PII mascarada)
```

### 5.3 Classificação de erros Omie

| Sinal | Significado | Ação |
|---|---|---|
| HTTP **425 / 429** | Rate limit / consumo indevido | Aborta lote, marca `rateLimit=true`, alimenta breaker |
| `faultstring` "Consumo redundante" | Janela de ~60s do Omie | Reagenda item (`proxima_tentativa_em`), não conta como erro definitivo |
| `faultstring` "bloqueado/cota/limite" | Bloqueio de consumo | Abre circuit breaker |
| "não cadastrado/inexistente" | Pedido excluído no Omie | Trata como etapa 80 (cancelado) |
| `cStat 100` | NF autorizada SEFAZ | Grava número/chave |
| `cStat 200+` | NF rejeitada | Log `rejeitada` |

---

## 6. Mecanismos de Resiliência

Quatro camadas independentes protegem a cota Omie e a consistência:

### 6.1 Circuit Breaker (`ControleCircuitBreakerOmie`)

- Persistente no banco (sobrevive a reinício de função).
- `erros_consecutivos` incrementa a cada falha, zera no sucesso.
- Ao atingir `threshold_erros` **e** detectar tempo de bloqueio na mensagem → abre (`bloqueado=true`, `bloqueado_ate`).
- Toda função verifica `checkCircuitBreaker` antes de tocar o Omie; se aberto, **aborta na hora**.
- Auto-release quando `bloqueado_ate` expira.

### 6.2 Portão Global (`_shared/portaoOmie`)

- **Mutex distribuído** (mark-and-verify) com chave `portao_global_omie`.
- Garante que **apenas um worker** toca o Omie por vez em operações sensíveis.
- TTL de 5 min (`worker_lock_ate`) → auto-release contra deadlock.
- Estratégia "mark, then verify owner" resolve corrida entre instâncias concorrentes.

### 6.3 Rate Limit (global + por método)

- Reserva atômica de slots no `omieClient`.
- Write crítico é **serializado** (rejeita concorrência).
- Espaçamento mínimo entre chamadas (ex.: `DELAY_MS = 1500ms`).

### 6.4 Prioridade Operação > Leitura

Rotinas de **leitura/limpeza** (ex.: correção de espelho) checam `temTrabalhoOperacaoPendente` e **cedem a vez** quando há pendências em `FilaEnvioPedidoOmie` ou `FilaCargaOmie`. Operação na frente, limpeza atrás.

---

## 7. Camada de Credenciais (Hardening)

> **Decisão arquitetural crítica.** Auditadas e corrigidas **54 funções** para o padrão "env-primeiro".

### Regra única

```js
async function getOmieCredentials(base44) {
  const envKey    = (Deno.env.get('OMIE_APP_KEY')    || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  // Fallback APENAS se o Secret estiver vazio
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie
    .filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(),
           appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}
```

### O que foi eliminado (anti-padrões "venenosos")

- ❌ `cfg?.app_key || Deno.env...` — priorizava banco potencialmente desatualizado.
- ❌ `_credsCache` (cache em memória com TTL de 30s) — servia credenciais velhas após rotação. **Removido das 54 funções.**

### Por que `Deno.env` primeiro

`Deno.env.get` é atômico, sem TTL, e reflete a rotação de secret imediatamente. O banco (`ConfiguracaoOmie`) pode conter um `app_key` antigo, por isso **nunca tem prioridade** — é só rede de segurança quando o Secret está vazio.

---

## 8. Filas Assíncronas

O sistema usa filas-entidade processadas por workers idempotentes em background.

### 8.1 `FilaCargaOmie` — Fechamento de carga

```
Estados: pendente → processando → concluido
                              ↘ erro
                              ↘ aguardando_acao_humana
```

- 1 registro por pedido da carga.
- Operação: trocar etapa para **50** + alterar previsão de faturamento.
- **Resgate de órfãos** (PASSO 0): itens presos em `processando` além do timeout são detectados via `processando_em` e re-enfileirados.
- **Revalidação:** se o pedido segue em etapa <50 após N revalidações (`tentativas_revalidacao`), sai do loop → `aguardando_acao_humana` (não martela o Omie; só volta por ação humana ou webhook).
- **Consumo redundante:** janela de espera via `proxima_tentativa_em` + `tentativas_redundante` (vira erro só após o limite).

### 8.2 `FilaEnvioPedidoOmie` — Envio de pedidos novos

Worker `processarFilaEnvioPedidoOmie` envia pedidos pendentes ao Omie sequencialmente, respeitando breaker + portão.

### 8.3 `FilaEmissaoNF` / `processarEmissaoNFLote`

Emissão de NF-e em lote com retomada (`retomarEmissaoNFLotePendente`) quando o lote aborta por rate limit; pedidos presos em etapa 50 ficam marcados `pendente_emissao`.

### 8.4 `FilaBoletoOmie` / `processarFilaBoletoOmie`

Geração de boletos pós-faturamento conforme `modalidade_pagamento_id` do cliente.

### 8.5 `processarFilaWebhookOmie`

Consome webhooks recebidos em background com lock (`worker_rodando`).

---

## 9. Fluxos de Negócio Fim-a-Fim

### 9.1 Pedido de Venda → NF Autorizada

```
[Vendedor lança pedido] (app/web, captura geo)
   → Pedido (status=pendente, etapa=comercial)
   → [Liberação] consulta bloqueio financeiro (consultarBloqueioFinanceiroOmie)
        ├─ bloqueado → BloqueioLiberarModal (liberação forçada c/ motivo + log)
        └─ ok → status=liberado
   → [Envio Omie] FilaEnvioPedidoOmie → enviarPedidoOmie → omie_codigo_pedido, etapa 10/20
   → [Montagem de Carga] pedido entra em Carga (status_carga=montagem)
   → [Fechar Carga] FilaCargaOmie → troca etapa 50 + previsão (faturarCargaOmie)
   → [Emissão NF] processarEmissaoNFLote → emitirNfPedidoOmie → etapa 60
        → SEFAZ autoriza (cStat 100) → LogEmissaoNF(autorizada), chave_nfe, nº NF
   → [Boletos] FilaBoletoOmie → gerarBoletosOmie (se modalidade=boleto)
   → [Entrega] roteirização → AcertoCaixa → status_carga=entregue
```

### 9.2 Reconciliação contínua (espelho)

```
Webhook Omie / Scheduled job
   → sincronizarLiberadosOmieRapido (espelho rápido de etapas)
   → reconciliarStatusPedidosOmie / reconciliarEtapasAbertasOmie
   → corrigirEspelho20Falso / corrigirEspelhoDia (divergências)
   → reconciliarNfAguardandoAutorizacao (NF assíncrona SEFAZ)
   → reconciliarNfsCanceladasOmie (cancelamentos)
```

### 9.3 Troca / Devolução

```
Visita → Retorno (produtos devolvidos)
   → devolverPedidoOmie / cancelarNfOmie
   → PedidoTroca (modelo D1, sem NF)
   → reconciliarTrocasCargas
```

### 9.4 Blindagem fiscal — Soltar pedido

```
Operador solta pedido da carga (soltarCarga)
   → Pedido.solto_manualmente = true, volta para Montagem
   → NENHUMA rotina automática fatura/emite NF deste pedido
   → Zerado só quando re-adicionado a carga por ação humana
```

---

## 10. Catálogo de Funções Backend

> ~150 funções Deno. Agrupadas por domínio. Toda função que toca o Omie segue: auth → breaker → portão/rate → credenciais env-primeiro → log.

### 10.1 Pedidos — CRUD Omie
`enviarPedidoOmie` · `editarPedidoOmie` · `importarPedidoOmie` · `cancelarPedidoOmie` · `cortarPedidoOmie` · `devolverPedidoOmie` · `duplicarPedidoOmie` · `liberarPedidoOmie` · `trocarEtapaPedidoOmie` · `consultarPedidoOmie` · `buscarPedidosOmie` · `consultarPedidosDia` · `analisarPedidosOmie` · `diagEstruturaPedido`

### 10.2 Faturamento & NF
`faturarPedidoOmie` · `faturarCargaOmie` · `emitirNfPedidoOmie` · `emitirNfsLoteOmie` · `processarEmissaoNFLote` · `retomarEmissaoNFLotePendente` · `reemitirNfPresasEtapa50` · `cancelarNfOmie` · `cancelarNfAcerto` · `consultarStatusFaturamentoOmie` · `consultarDetalheNotaOmie` · `listarNfsOmie` · `baixarPdfDanfeOmie` · `alterarPrevisaoFaturamentoOmie`

### 10.3 Espelho & Reconciliação
`sincronizarLiberadosOmieRapido` · `atualizarEspelhoPedidosOmie` · `reconciliarStatusPedidosOmie` · `reconciliarEtapasAbertasOmie` · `reconciliarEspelhoCargaCompleto` · `reconciliarNfAguardandoAutorizacao` · `reconciliarNfsCanceladasOmie` · `reconciliarTrocasCargas` · `corrigirEspelho20Falso` · `corrigirEspelhoDia` · `corrigirEspelhoFaturados` · `corrigirEspelhoManual` · `criarEspelhosPedidosSemEspelho` · `preencherEspelhosZerados` · `limparEspelhoCanceladosOmie` · `limparDuplicadosEspelho` · `consultarEtapaPedidosOmie` · `consultarStatusPedidosOmie` · `mapaEtapasOmie` · `listarEtapasOmie`

### 10.4 Cargas
`processarFilaCargaOmie` · `revalidarCargaOmie` · `reenviarItemFilaCarga` · `reenfileirarPedidosOrfaos` · `soltarCarga` · `transferirPedidoCarga` · `enriquecerPedidosCarga` · `repararProdutosCarga` · `sincronizarStatusCargasOmie` · `corrigirStatusCargas` · `prepararNidNfCarga` · `relatorioAnaliticoCarregamento` · `indiceCargasPorPedido` · `investigarDivergenciaMontagem`

### 10.5 Boletos & Financeiro
`gerarBoletosOmie` · `gerarBoletosFaltantesPrazo` · `processarFilaBoletoOmie` · `baixarPdfBoletoOmie` · `salvarBoletosLocais` · `diagnosticoBoletosCarga` · `dadosClienteNfBoletos` · `listarContasReceberOmie` · `consultarBloqueioFinanceiroOmie` · `sincronizarAcertoOmie`

### 10.6 Clientes
`enviarClienteOmie` · `importarClientesOmie` · `importarClientePontalOmie` · `consultarClientesOmie` · `exportarClientesOmie` · `exportarClientesFaltantesLote` · `excluirClienteOmie` · `excluirClientesLote` · `desbloquearFaturamentoClientesOmie` · `workerDesbloquearClientesOmie` · `desbloqueioAutomaticoOmie` · `auditarClientesOmie` · `auditoriaClientesOmieJob` · `auditarReferenciasClientes` · `bulkUpdateClientes` · `atualizarNomesClientesComCodigo` · `sincronizarClientesOmie` · `sincronizarClientesCSV` · `compararCSVComBase44` · `revincularReferenciasCSV` · `atualizarRotasClientesCSV`

### 10.7 Produtos / Vendedores / Tabelas
`enviarProdutoOmie` · `consultarProdutoOmie` · `corrigirProdutoOmie` · `excluirProdutoOmie` · `exportarProdutosOmie` · `enviarVendedorOmieAuto` · `excluirVendedorOmie` · `exportarVendedoresOmie` · `sincronizarTabelasOmie` · `tratarTabelasPreco` · `atualizarPrecosMassaExcel` · `ajustarPrecosOriginaisOmie` · `diagnosticarCorrigirPrecosTabela` · `listarCategoriasOmie` · `importarCenariosFiscaisOmie` · `listarCenariosOmie`

### 10.8 Saneamento & Auditoria
`sanearPedidosTravados` · `auditarItensPedidoVsOmie` · `auditarPedidoLiberadoOmie` · `auditarStatusRealPedidos` · `auditarCancelamentosIndevidos` · `auditarMotivosTroca` · `diagnosticarPedidosCanceladosOmie` · `sincronizarPedidosCancelados` · `recalcularStatusFaturamentoPedidos` · `corrigirStatusPedidosFaturados` · `alterarStatusPedidosFaturado` · `atualizarStatusLogsPendentes` · `reconsultarStatusNFsPendentes` · `preencherDadosNFLogs` · `sincronizarLogEmissaoCarga` · `compararPedidoOmie` · `compararPedidosOmieLocal`

### 10.9 Webhooks & Infra Omie
`receberWebhookOmie` · `processarWebhookOmie` · `processarFilaWebhookOmie` · `limparBacklogWebhooksOmie` · `limparWebhooksNfTravados` · `limparFilaEnvioConcluidos` · `limparCacheExpiradoOmie` · `statusCircuitBreakerOmie` · `testarConexaoOmie` · `salvarCredenciaisOmie` · `getOmieCredentials` · `importarTudoDoOmie` · `espelharBase44Omie` · `enviarRotasCaractOmie` · `processarFilaEnvioPedidoOmie`

### 10.10 Comercial / Cobertura / Roteiros
`agregadosClientesComercial` · `agregadosVendedorComercial` · `exportarPainelComercial` · `exportarIndicadoresComercial` · `exportarFaturamentoDia` · `exportarVendasItemDia` · `calcularScorecard` · `metasTrocaVencido` · `iniciarRegimeExperimental` · `recalcularCobertura` · `gerarAgendaMensal` · `encerrarCheckinsEsquecidos` · `adicionarClientesRoteiroDias` · `vincularClientesRoteiro` · `bulkImportRoteiros` · `reconstruirRoteirosGessica`

### 10.11 GitHub & Misc
`listarCommitsGithub` · `listarArquivosGithub` · `lerArquivoGithub` · `analisarRepositorioGithub` · `registrarLogGerencial` · `getItensPedidosLote` · `liberarPedidosRecriados2606`

---

## 11. Webhooks Omie

```
Omie dispara → receberWebhookOmie (valida OMIE_WEBHOOK_TOKEN)
   → idempotência via webhook_message_id (LogIntegracaoOmie)
   → enfileira → processarFilaWebhookOmie (lock worker_rodando)
   → processarWebhookOmie (roteia por topic)
        ├─ VendaProduto.Faturada → grava NF/chave, etapa 60
        ├─ VendaProduto.Cancelada → cancelado_no_omie
        └─ ... → atualiza espelho
```

Tópicos tratados refletem no `Pedido` e no espelho `PedidoLiberadoOmie`. Backlog é limpo por `limparBacklogWebhooksOmie`.

---

## 12. Frontend — Páginas e Navegação

### 12.1 Roteamento

`App.jsx` combina um **loop `pagesConfig`** (páginas antigas) com **`<Route>` explícitos** (páginas novas). Cada rota é envolvida por `LayoutWrapper` (sidebar + auth). `pages.config.js` **não é mais auto-gerado** — toda página nova exige `<Route>` explícito.

### 12.2 Layout

`components/Layout` (`layout`): sidebar gradiente (Pão & Mel + Omie), menu por permissões (`canViewPage`), `StatusOmieIndicator`, geolocalização, anti-tradução automática, logout. Menus filtrados por `Permissao.abas_visiveis` (admin vê tudo).

### 12.3 Mapa de páginas (por módulo)

| Módulo | Páginas |
|---|---|
| **Cadastros** | `CadastrosHub`, `Clientes`, `Produtos`, `Funcionarios`, `Funcoes`, `Veiculos`, `Motoristas`, `Rotas`, `Redes`, `Segmentos`, `Categorias`, `UnidadesMedida`, `TabelasPreco`, `PlanosPagamento`, `Empresa`, `CenariosFiscais`, `CenariosFiscaisLocais` |
| **Pedidos** | `Pedidos`, `EmissaoPedidos`, `GerenciarPedidosPage`, `EnviarRotasOmie`, `ControlePedidosVenda`, `ControlePedidosTroca` |
| **Logística** | `NotasOmie`, `MontagemCarga`, `Cargas`, `AjustesPedidos`, `BoletosOmie`, `AcertoCaixa`, `MontarRota`, `RelatorioCarregamento` |
| **Análises** | `Comissionamento`, `GestaoMetas`, `Metas`, `AnalisesComercial` (Dashboards Vendedor/Trocas/Vendas/Clientes, Mapa/Análise Visitas) |
| **Roteiros/Visitas** | `MeusRoteiros`, `RotaSupervisores`, `PainelRoteiros`, `RelatoriosVisitas`, `CoberturaInteligente` |
| **Gerenciamento (admin)** | `Permissoes`, `LogGerencial`, `AuditoriaCancelados`, `ConfiguracaoOmie`, `SupervisaoFilaEnvio`, `IntegracaoOmieDashboard`, `CommitsGithub`, `TestesOmie`, `CorrigirEspelho20`, `CorrecaoManual`, `ComparacaoPedidosOmie` |

### 12.4 Padrões de UI

- **React Query** para cache (staleTime alto, sem refetch no foco).
- **shadcn/ui** + Tailwind tokens (`bg-primary`, etc.; cores dinâmicas no `safelist`).
- Componentes focados e pequenos (`components/<modulo>/...`).
- Indicador de saúde Omie sempre visível (`StatusOmieIndicator`).

---

## 13. Módulo de Cobertura Inteligente

### Hierarquia e periodicidade

```
Gerência (mensal) → Coordenador (quinzenal) → Supervisor (semanal)
   → Vendedor (semanal) → Promotor (semanal)
```

### Fluxo

```
gerarAgendaMensal → AgendaComercial (por papel/periodicidade)
   → Visita (check-in GPS) → valida raio (ParametroCobertura.raio_geo_metros)
        ├─ fora do raio → Alerta(geolocalizacao_fora_raio)
        └─ checkout → duracao_minutos
   → encerrarCheckinsEsquecidos (timeout) → Alerta(checkout_pendente)
   → recalcularCobertura → CoberturaStatus (falhas_consecutivas)
        └─ N falhas → Alerta em cascata (atenção→alerta→crítico, escala destinatário)
```

Falhas são contadas por **agendas consecutivas não cumpridas**, não por dias de atraso. Zera quando há visita REALIZADA.

---

## 14. Módulo Comercial & Comissionamento

### Metas em cascata

```
Meta (nivel=gerente, meta_pai_id=null)
   → Meta (supervisor, meta_pai_id=gerente)
      → Meta (vendedor, meta_pai_id=supervisor)
```

`percentual_atingido` calculado de `valor_realizado` vs `valor_meta` / `volume_pacotes`.

### Comissionamento

`calcularScorecard` → `ScorecardApuracao`; `MetaComissao`; `RegimeExperimental` (período de teste); gamificação com ranking de equipe e confetti.

### Dashboards

`agregadosVendedorComercial` / `agregadosClientesComercial` alimentam Dashboards de Vendas, Clientes, Trocas, Visitas e Atingimento Diário.

---

## 15. Auditoria, Logs e Rastreabilidade

| Camada | Entidade | O que registra |
|---|---|---|
| **Negócio** | `LogGerencial` | Toda ação relevante: tipo, entidade, usuário, valor antigo→novo, origem (frontend/backend/automation/webhook) |
| **Integração** | `LogIntegracaoOmie` | Toda chamada Omie: endpoint, call, payloads (truncados, PII mascarada), duração, status, webhook_message_id |
| **Fiscal** | `LogEmissaoNF` | Cada emissão de NF: status SEFAZ real, cStat, chave, faultstring/faultcode |
| **Financeiro** | `LogEmissaoBoleto` | Cada boleto gerado |
| **Cancelamentos** | `auditarCancelamentosIndevidos` + `AuditoriaCancelados` | Detecta cancelamentos indevidos |

Funções dedicadas: `registrarLogGerencial`, e auditorias (`auditar*`).

---

## 16. Segurança e Permissões

- **Auth:** plataforma Base44 (`base44.auth.me()`). Funções admin verificam `user.role === 'admin'` → 403.
- **RLS:** `ControleCircuitBreakerOmie` restrito a admin (CRUD). `Cliente` com RLS aberta de leitura/escrita.
- **Permissões de UI:** `Permissao.abas_visiveis[]` por funcionário; admin vê tudo.
- **Webhooks:** validam `OMIE_WEBHOOK_TOKEN` antes do service-role.
- **Secrets:** `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_TOKEN`, `FATURAMENTO_API_KEY`, `WEBHOOK_INDICADORES_TOKEN` — nunca em texto plano no banco.
- **Conector GitHub:** scopes `repo`, `read:org` (somente leitura de repositório).

---

## 17. Glossário de Etapas Omie

| Etapa | Significado | Status interno Pedido |
|---|---|---|
| **10** | Pedido Pendente | `pendente` |
| **20** | Pedido Liberado | `liberado` |
| **50** | Faturar (pronto p/ NF) | `montagem` |
| **60** | Faturado (NF emitida) | `faturado` |
| **70** | Entregue | `faturado` |
| **80** | Cancelado | `cancelado` |

> Régua oficial em `_shared/constantes` / `lib/etapaOmieStatus.js`. Estados equivalentes: `enviado`~`pendente`, `cancelado_pos_faturamento`~`cancelado`.

---

## 18. Convenções de Código

### Backend (Deno)
- Tudo dentro de `Deno.serve(async (req) => { ... })`; retornar `Response`.
- SDK: `createClientFromRequest(req)`; `await` em toda chamada.
- `base44.entities` (user-scoped) vs `base44.asServiceRole` (admin).
- Sem imports locais entre funções — compartilhar via `_shared/*` (inline) ou `base44.functions.invoke`.
- `npm:`/`jsr:` com versão; SDK `npm:@base44/sdk@0.8.31`.
- Credenciais sempre **env-primeiro** (§7).

### Frontend (React)
- `base44.functions.invoke('fn', payload)` → resposta em `response.data`.
- `<Link to="/path">` com rotas de `App.jsx`.
- Componentes pequenos e focados; um arquivo por componente.
- Tailwind com classes literais (dinâmicas no `safelist`).
- Erros borbulham (sem try/catch desnecessário); exceto fluxos de formulário/auth.

---

> **Fim do documento.** Esta arquitetura prioriza, em ordem: integridade fiscal > consistência do espelho > resiliência da cota Omie > throughput. Toda evolução deve preservar a blindagem fiscal, a idempotência e o padrão de credenciais env-primeiro.