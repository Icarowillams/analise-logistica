# 📦 Documentação Técnica — Módulo de LOGÍSTICA

> **Sistema:** Pão & Mel + Omie (Base44)
> **Escopo:** Documentação página por página do módulo de Logística, com lógica de código e detalhamento da integração com a API Omie de cada uma.
> **Stack:** React + Vite + Tailwind (frontend) · Deno (backend functions Base44) · API Omie v1 (`https://app.omie.com.br/api/v1/`)
> **Destino:** Handoff para Claude Code / time de engenharia.

---

## 0. Visão Geral da Arquitetura

### 0.1 Princípio central: "espelho local primeiro"
O app **não consulta a Omie ao vivo** nas telas operacionais. Em vez disso, mantém **entidades espelho** sincronizadas por webhook + reconciliação, e as telas leem essas entidades (rápido, sem rate limit). A Omie só é tocada em **operações de escrita** (faturar, emitir NF, gerar boleto, trocar etapa) e em **reconciliações pontuais**.

Entidades-espelho principais:
| Entidade | Papel |
|---|---|
| `Carga` | Agrupa pedidos Omie + internos (D1) + trocas; status local binário (`montagem`/`faturada`) |
| `PedidoLiberadoOmie` | Espelho em tempo real do estado de cada pedido Omie (etapa 10/20/50/60, NF) |
| `Pedido` | Pedido local (venda/troca/D1) — fluxo comercial + logístico |
| `FilaCargaOmie` | Fila assíncrona de faturamento (troca de etapa 50) — 1 registro por pedido |
| `FilaEmissaoNF` | Fila assíncrona de emissão de NF-e — 1 registro por lote |
| `LogEmissaoNF` | Histórico por pedido emitido (status SEFAZ real) |
| `LogEmissaoBoleto` | Histórico por boleto gerado (espelho local idempotente) |
| `LogIntegracaoOmie` | Auditoria de TODAS as chamadas Omie + recebimento de webhooks |
| `ControleCircuitBreakerOmie` | Circuit breaker + locks (portão global, slots de rate limit) |

### 0.2 As etapas Omie (modelo mental obrigatório)
O ciclo de vida fiscal de um pedido no Omie é representado por **etapas numéricas**:

| Etapa | Significado | Quem move |
|---|---|---|
| **10** | Pedido incluído / em aberto | Inclusão do pedido |
| **20** | Liberado / aprovado | Liberação comercial |
| **50** | "Faturar" — pronto para emitir NF | **Faturar carga** (troca de etapa) |
| **60** | "Faturado" — NF-e emitida e autorizada | **Emissão de NF** (nunca por troca de etapa) |

> 🚨 **REGRA IMUTÁVEL:** a etapa 60 **só** é atingida emitindo a NF (`FaturarPedidoVenda`). É **impossível** trocar a etapa diretamente para 60 — o Omie recusa com `faultcode "3"` ("Utilize o processo de faturamento"). Por isso "Faturar carga" e "Emitir NF" são **dois passos separados**.

### 0.3 Os dois fluxos de nota
- **NF 55 (NF-e):** clientes `tipo_nota = '55'` → emite NF eletrônica no Omie (etapa 50 → 60).
- **D1 (venda interna):** clientes `tipo_nota = 'D1'` → **NÃO emite NF**, não envia ao Omie. É nota interna impressa pelo app. `modelo_nota = 'd1'`.

### 0.4 Proteções de integração (a razão da "lentidão")
A API Omie é sensível a concorrência e impõe rate limit agressivo. O sistema usa **5 camadas**:

1. **Circuit Breaker** (`ControleCircuitBreakerOmie`, ID fixo `6a1e06a9aa62ceab7b3b6d97`): após N erros consecutivos (`threshold_erros`, default 3) com bloqueio real (HTTP 425 / "consumo indevido"), abre o breaker e bloqueia TODAS as chamadas até `bloqueado_ate`.
2. **Portão Único Global** (`chave='portao_global_omie'`): mutex compartilhado entre TODOS os workers — só 1 worker toca o Omie por vez. TTL 30s + heartbeat de 10s.
3. **Slot de rate limit global** (`chave='rate_limit_global'`): espaça QUALQUER chamada Omie em ≥1,5s.
4. **Slot de faturamento** (`chave='rate_limit_faturamento'`): espaça `FaturarPedidoVenda`/`EmitirNF` em ≥3s (defesa contra "consumo redundante").
5. **Lock de auto-encadeamento** (`chave='worker_carga'`): garante 1 cadeia de processamento de fila por vez.

> Tratamento de erros Omie classificados em `omieCall`:
> - **Bloqueio real** (425 / "consumo indevido" / "bloqueada") → abre circuit breaker.
> - **Consumo redundante** → reagenda janela de ~60s (não é falha).
> - **Destino de etapa inválido** (`faultcode "3"`) → erro definitivo, sem retry.
> - **Já faturado/autorizado** → tratado como **sucesso** (não re-emite).
> - **Cliente bloqueado para faturar** → erro **terminal** (só desbloqueando o cadastro no Omie).
> - **Rate limit suave** (429/cota/aguarde) → retry com backoff.

---

## 1. PÁGINA: Montagem de Carga (`/MontagemCarga`)

**Arquivo:** `src/pages/MontagemCarga.jsx`
**Componentes:** `useDadosMontagem`, `StatsCardsMontagem`, `PedidosPorRota`, `ProdutosConsolidados`, `PainelFecharCarga`, `MontagemHeader`, `MontagemFiltros`, `CargasEmMontagem`.

### 1.1 O que faz
Monta uma nova carga selecionando pedidos liberados (vindos do Omie) + trocas/D1 internas, atribui motorista/veículo/rota e fecha a carga. Tem 2 abas:
- **Cargas em Montagem:** lista cargas já criadas em status `montagem` (leve — só lê `Carga`).
- **Nova Carga:** painel pesado de seleção de pedidos.

### 1.2 Lógica de carregamento (performance)
- A carga pesada (espelho Omie + pedidos + clientes + itens) **só dispara quando a aba "Nova Carga" é aberta** (`useDadosMontagem(abaAtiva === 'nova')`). A aba de montagem carrega só as cargas.
- `getOpcoesMontagem(pedidos)` extrai opções de filtro (rota, cidade, vendedor, tipo).
- `filtrarPedidosMontagem(pedidos, filtros, selecionados)` aplica filtros + "apenas selecionados".
- Os itens dos pedidos são carregados em background (indicador "Carregando itens dos pedidos…").

### 1.3 Integração Omie
- **Leitura:** NÃO consulta Omie ao vivo. Lê de `PedidoLiberadoOmie` (espelho mantido por webhook) + `Pedido` (trocas/D1 locais).
- **Escrita (fechar carga):** ao fechar, `PainelFecharCarga` cria a `Carga` com snapshots de `pedidos_omie[]`, `pedidos_internos[]`, `pedidos_troca[]`. **Nenhuma chamada Omie aqui** — o pedido só vai à Omie quando a carga é faturada (página Cargas).

---

## 2. PÁGINA: Cargas (`/Cargas`) — ⭐ NÚCLEO DO MÓDULO

**Arquivo:** `src/pages/Cargas.jsx`
**Componentes:** `DataTable`, `DocumentosCargaModal`, `StatusProcessamentoOmie`, `SoltarCargaDialog`, `EditarCargaModal`, `TransferirPedidosCargaModal`, `LogFilaCarga`, `ObservacaoCell`.
**Funções backend:** `faturarCargaOmie`, `processarFilaCargaOmie`, `trocarEtapaPedidoOmie`, `alterarPrevisaoFaturamentoOmie`, `sincronizarStatusCargasOmie`.

### 2.1 O que faz
Lista todas as cargas, separadas por abas de status, e centraliza as ações: **Faturar**, reconciliar NFs, alterar previsão, editar, transferir pedidos, soltar carga, excluir, abrir NF/Boletos/Romaneio, e ver o **Log da Fila**.

### 2.2 Status local da carga (binário)
`status_carga` é **LOCAL e binário** — o ciclo fiscal detalhado fica no Omie/espelhos:
- `montagem` = em preparação (não enviada ao Omie) → **faturável**.
- `faturada` = enviada ao Omie.
- (`conferindo`, `entregue`, `cancelada` são estágios pós-faturamento).

### 2.3 Abas com lógica especial: "Faturando…" (visual)
Uma carga `faturada` mas com `processamento_omie_status` ainda `em_andamento`/`nao_iniciado` **com itens de fila pendentes** é exibida na aba **"Faturando…"** em vez de "Faturadas" — elimina a contradição visual "Faturada + Processando 0/1". É **só agrupamento de front** (`faturandoAinda()`), nenhum dado é reescrito.

### 2.4 Carregamento de dados
- `Carga.list('-created_date', 1000)` (`staleTime 60s`).
- **Batch da fila:** carrega TODOS os itens de `FilaCargaOmie` de cargas em `em_andamento`/`parcial`/`erro` em UMA query, monta `filaMap` (carga_id → itens) e faz `refetchInterval` de 30s.
- `cargasTravadas`: detecta cargas com item `processando` há > 10 min → mostra banner de alerta.

### 2.5 AÇÃO: Faturar carga — `faturarCargaOmie` 🔑
> **Esta função é 100% LOCAL — NÃO chama a API Omie.**

`base44.functions.invoke('faturarCargaOmie', { carga_id })`:
1. **Checa circuit breaker** — aborta cedo (425) se a Omie estiver bloqueada.
2. **Enriquecimento best-effort** (paralelo): preenche `cnpj_cpf_cliente`/`nome_cliente` faltantes a partir do cadastro `Cliente` (sem tocar Omie). Avisos vão para `LogIntegracaoOmie` (warning, nunca bloqueia).
3. Pula pedidos `tipo_nota = 'D1'` (não emitem NF).
4. **Marca a carga como `faturada`** localmente + grava `data_faturamento`.
5. Atualiza os `Pedido` locais (venda) → `status: 'montagem'`, `status_faturamento: 'pendente'`, `solto_manualmente: false`. ⚠️ **Não marca `faturado: true`** — isso só acontece após a NF real ser emitida.
6. Pedidos internos (D1/troca) → `status: 'faturado'` (não passam por NF).

> 🔑 **"Faturar carga" apenas libera a carga para a tela "Notas Omie → Emissão".** NÃO troca etapa no Omie, NÃO cria fila, NÃO emite NF. A troca de etapa 50 acontece via `FilaCargaOmie` + `processarFilaCargaOmie` (worker), e a emissão da NF é manual em Notas Omie.

### 2.6 WORKER: `processarFilaCargaOmie` 🔑 (a "fila que demora")
> **Esta é a função responsável pela lentidão percebida da fila.** Processa `FilaCargaOmie` (troca de etapa para 50 no Omie) **sequencialmente** com todas as proteções de rate limit.

**Fluxo completo:**
1. **Circuit breaker** — se bloqueado, aborta toda a execução.
2. **Lock "1 cadeia por vez"** (`worker_carga`, TTL 2min) — se outra cadeia roda, sai sem reagendar.
3. **PASSO 0 — Resgate de órfãos:** itens presos em `processando` há > 90s (campo `processando_em`) são resetados para `pendente` (ou `erro` após 3 tentativas).
4. **PASSO 1 — Status local das cargas** (zero Omie): recalcula status de cargas em estados intermediários (fecha cargas órfãs 100% concluídas presas em `em_andamento`).
5. **Portão Único Global** (`portao_global_omie`, TTL 30s + heartbeat 10s) — se ocupado, aborta sem tocar Omie.
6. **PASSO 2 — Limpeza de órfãos:** itens de cargas deletadas → marcados `erro`.
7. **Processamento SEQUENCIAL** (lote de **8 itens**, delay de **700ms** entre cada):
   - `processarFaturar(item)`: (a) consulta estado — se **já faturado** (etapa ≥60), conclui como sucesso; (b) altera previsão (`AlterarPedidoVenda`); (c) `TrocarEtapaPedido` para 50; (d) **reconsulta a etapa real** — só conclui se etapa ≥ 50.
   - Atualiza `FilaCargaOmie` → `concluido`, `Pedido` → etapa `logistica`, espelho `PedidoLiberadoOmie` → etapa 50.
8. **AUTO-ENCADEAMENTO:** se sobram pendentes e o breaker está liberado, libera portão+lock e **re-invoca a si mesma** (fire-and-forget) — processa a fila em rodadas curtas de ~12s, sem esperar o scheduler de 5 min.

**Por que LOTE = 8 e não 50?** Cada pedido leva ~1,5s (delay + 2 calls Omie + reconsulta). Lote de 50 estourava o timeout do runtime, deixando itens "órfãos". Lote de 8 termina em ~12s, abaixo do limite, e o auto-encadeamento toca o resto.

**Tratamento de erros por item (mapa de decisão):**
| Erro Omie | Ação na fila |
|---|---|
| **Já faturado** (etapa 60) | `concluido` (sucesso), captura NF, sai |
| **Cliente bloqueado** | `erro` terminal — não retenta |
| **Consumo redundante** | reagenda janela ~60s; `erro` só após 5 janelas |
| **Etapa < 50 não avançou** | revalida; após 4× → `aguardando_acao_humana` (sai do loop) |
| **Destino inválido** (`faultcode 3`) | `erro` definitivo, sem retry |
| **Bloqueio Omie** (425) | aborta lote, retoma na próxima rodada |
| Outros | retry até `MAX_TENTATIVAS` (3), depois `erro` |

> **Endpoints Omie usados:** `produtos/pedido/` com `call: ConsultarPedido`, `AlterarPedidoVenda`, `TrocarEtapaPedido`.

### 2.7 AÇÃO: Botão "Processar Fila Agora"
Aparece quando há itens pendentes (`temPendentesNaFila`). Fica **desabilitado** se todos os itens estão em janela de espera (`temItensProntosAgora === false`) → texto "Aguardando Omie liberar". Chama `processarFilaCargaOmie` manualmente.

### 2.8 AÇÃO: Alterar Previsão de Entrega (lote)
`alterarPrevisaoFaturamentoOmie` para pedidos Omie (venda) — converte data `YYYY-MM-DD` → `DD/MM/AAAA` e chama `AlterarPedidoVenda`. D1s internas atualizadas localmente (`Pedido.data_previsao_entrega`). Pedidos já em etapa avançada são "ignorados".

### 2.9 AÇÃO: Reconciliar NFs (`sincronizarStatusCargasOmie`)
Consulta as NFs reais (`ide.nNF`) de uma carga faturada — **só lê, não reemite**. Processa em levas (`max_pedidos_por_chamada: 8`) e itera até concluir (guarda contra loop, máx 30 voltas). Grava progresso parcial — timeout no meio não perde o feito.

### 2.10 AÇÃO: Excluir carga (desfazer)
Reverte tudo: `trocarEtapaPedidoOmie` para etapa **20** dos pedidos Omie, devolve `Pedido` locais para `liberado`/`pendente` (limpa `carga_id`), reverte trocas (`PedidoTroca` → `aprovado`), cancela itens pendentes da fila e por fim `Carga.delete`. **Os pedidos no Omie não são apagados — só voltam de etapa.**

---

## 3. PÁGINA: Notas Fiscais Omie (`/NotasOmie`)

**Arquivo:** `src/pages/NotasOmie.jsx`
**Componentes:** `EmissaoNFTab`, `LogEmissaoNFTab`, `NotasNF55Tab`, `NotasD1Tab`.
**Funções backend:** `processarEmissaoNFLote`, `emitirNfPedidoOmie`, `listarNfsOmie`, `baixarPdfDanfeOmie`, `reconciliarNfAguardandoAutorizacao`.

### 3.1 O que faz — 4 abas
- **Emissão:** emite NF-e (individual ou em lote) para pedidos em etapa 50.
- **Log de Emissão:** histórico real de cada tentativa (`LogEmissaoNF`).
- **Impressão NF 55:** consulta/imprime DANFEs já emitidas.
- **Impressão D1:** consulta/imprime notas internas D1.

Aceita parâmetros de URL: `?carga_id=` (filtra por carga) e `?tab=` (emissao/log_emissao/impressao_nf55/impressao_d1, com aliases legacy nf55/d1).

### 3.2 WORKER: `processarEmissaoNFLote` 🔑 (emissão de NF)
> **Emite NF-e via `FaturarPedidoVenda` (endpoint `produtos/pedidovendafat/`). É a única operação que leva o pedido à etapa 60.**

**Fluxo por pedido (sequencial, dentro de um lote em `FilaEmissaoNF`):**
1. **Slot de faturamento** (`rate_limit_faturamento`, ≥3s entre faturamentos) — defesa na origem contra "consumo redundante".
2. **Validações de blindagem fiscal:**
   - Código de pedido numérico válido.
   - **NUNCA emite** se `pedido.solto_manualmente === true` ou se o pedido **não está em carga ativa** (`!carga_id`).
   - **Idempotência** (`jaPossuiNf`): se já há NF (espelho 60+NF / `Pedido.numero_nota_fiscal` / log autorizado) → pula, não duplica.
3. **`FaturarPedidoVenda`** (`{ nCodPed }`).
4. **Classificação da recusa** (HTTP 200 com `cCodStatus != 0`):
   - "já autorizado/faturado" → **autorizada** (confirma número, não re-emite).
   - "cadastro bloqueado para faturar" → **`bloqueado_cliente`** (erro terminal).
   - demais → **rejeitada**.
5. **Confirmação síncrona** (`ConsultarPedido`, backoff curto 1,5s/2,5s/4s): "sucesso" do faturar ≠ NF emitida. Só resolve com `nNF` / `faturada=S` / etapa ≥60.
   - NF confirmada → **autorizada** + grava `Pedido.numero_nota_fiscal`, espelho etapa 60, `LogEmissaoNF` autorizada.
   - Rejeição SEFAZ (`cStat ≥ 200`) → **rejeitada** com motivo real.
   - Ainda etapa 50 → **pendente honesto** (`nf_aguardando_autorizacao: true`).
6. **Budget de 4 min por invocação:** lotes grandes (ex: 79 pedidos) → ao atingir o budget, devolve a fila para `processando` e **re-invoca a si mesma** para continuar de onde parou.
7. **Rodada final de confirmação em lote** (`varreConfirmacaoFinal`): varre os "pendentes" 2× (4s, 8s) e promove a "autorizada" os que já têm número.

**Erros especiais:**
- **NF já cadastrada** (`Client-107`) → autorizada (a nota existe), captura número.
- **Transitório** (425/429/timeout/redundante/cota) → **pendente** reprocessável, **nunca** erro morto. Mensagem limpa: "Aguardando emissão no Omie".

> ⚠️ **SEM retries automáticos por chamada na emissão** (cada retry consome cota SEFAZ). O circuit breaker protege o lote.

### 3.3 Rede de segurança: `reconciliarNfAguardandoAutorizacao`
Pedidos faturados no Omie cuja NF saiu de forma **assíncrona** (etapa 50→60 depois do lote) ficam com `nf_aguardando_autorizacao: true`. Esta função (geralmente em automação agendada) os encontra, consulta o número real e fecha o `Pedido.numero_nota_fiscal`. Sem ela, ficaria "0 confirmadas / N aguardando".

### 3.4 Impressão (`NotasNF55Tab` / `NotasD1Tab`)
- **NF 55:** `baixarPdfDanfeOmie` busca o PDF da DANFE no Omie (usa `nIdNF` cacheado quando disponível para pular `ConsultarNF`).
- **D1:** gerado localmente pelo app (sem Omie) — `NotaD1Pdf`.

---

## 4. PÁGINA: Boletos Omie (`/BoletosOmie`)

**Arquivo:** `src/pages/BoletosOmie.jsx`
**Componentes:** `EmissaoBoletosConteudo`, `BoletosConsultaTab`, `LogEmissaoBoletoTab`.
**Funções backend:** `gerarBoletosOmie`, `gerarBoletosFaltantesPrazo`, `baixarPdfBoletoOmie`, `processarFilaBoletoOmie`.

### 4.1 O que faz — 3 abas
- **Emissão:** seleciona carga, escolhe títulos e gera boletos no Omie.
- **Histórico:** `LogEmissaoBoleto` (espelho local idempotente).
- **Consulta/Impressão:** 2ª via dos boletos (individual ou agrupado).

Aceita `?carga_id=` e `?tab=` (emissao/historico/impressao).

### 4.2 WORKER: `gerarBoletosOmie` 🔑
> **Endpoints:** `financas/contareceber/` (`ListarContasReceber`) + `financas/contareceberboleto/` (`GerarBoleto`).

**Fluxo:**
1. **Origem `manual`** (tela) exige usuário autenticado; **`auto`** (webhook) usa service role.
2. **Resolução do título:**
   - Se vier `nCodTitulo`, usa direto.
   - Se vier só `codigo_pedido_omie`, busca o título via `listarTitulosDoPedido` (cruza por CNPJ + janela de ±30 dias da data do pedido, com **cache em memória** de 5 min por CNPJ; pagina até 3 páginas de 100). Cruza por `nCodPedido` (prioridade) ou `numero_pedido`.
3. **`GerarBoleto`** (`{ nCodTitulo }`) — **SEQUENCIAL** (delay de **1800ms** entre boletos): o Omie recusa chamadas paralelas com **erro 8020**.
4. **Wrapper anti-8020/CÓDIGO 6** (`omieCallAntiConcorrencia`): se vier erro de concorrência, espera 3s e tenta +1 vez. Rate limit (425/429) → retry com backoff 5s/10s/15s.
5. **Idempotência:** título com boleto já gerado (`boleto.cGerado === 'S'`) → recupera os dados existentes (não regera).
6. **Write-through local** (`gravarLogBoleto`): cada boleto gerado é gravado/atualizado em `LogEmissaoBoleto` (1 linha por `codigo_lancamento`) → próxima abertura da carga vem 100% do local, instantânea.

> 🔑 **Boleto NÃO depende de NF.** É cruzado direto pelo pedido/CNPJ. Pedido sem título no Omie = normal (retorna vazio).

### 4.3 `gerarBoletosFaltantesPrazo`
Gera boletos de cargas faturadas cujos clientes têm `modalidade_pagamento` de boleto e ainda não têm boleto, respeitando o prazo. Usado no botão "Gerar faltantes por prazo".

### 4.4 Impressão (`baixarPdfBoletoOmie`)
Busca o PDF do boleto no Omie pelo `nCodTitulo`/link.

---

## 5. PÁGINA: Ajustes de Pedidos (`/AjustesPedidos`)

**Arquivo:** `src/pages/AjustesPedidos.jsx`
**Componentes:** `CorteTab`, `TransferenciaTab`, `CancelamentoTab`, `DevolucaoTab` + 4 abas de Log.
**Funções backend:** `cortarPedidoOmie`, `transferirPedidoCarga`, `cancelarPedidoOmie`, `devolverPedidoOmie`, `soltarCarga`.

### 5.1 O que faz — 8 abas
4 operações + 4 logs de auditoria correspondentes.

### 5.2 Corte por Carga (`CorteTab` → `cortarPedidoOmie`)
Remove/reduz itens de um pedido já em carga. No Omie, edita o pedido (`AlterarPedidoVenda`) removendo/ajustando quantidades dos itens cortados. Registra em `LogCorte`.

### 5.3 Transferência (`TransferenciaTab` → `transferirPedidoCarga`)
Move pedidos de uma carga para outra. Atualiza os snapshots `pedidos_omie`/`pedidos_internos`/`pedidos_troca` das duas cargas e o `Pedido.carga_id`/`numero_carga`. Registra em `Transferencia`.
> Preserva `carga_faturamento_numero` (imutável) — a NF mantém a carga em que foi faturada.

### 5.4 Cancelamento (`CancelamentoTab` → `cancelarPedidoOmie`)
Cancela pedido no Omie (`CancelarPedido` / cancela NF se já emitida via `cancelarNfOmie`). Marca `Pedido.status: cancelado` ou `cancelado_pos_faturamento` (preserva rastreabilidade financeira se já tinha NF). Registra em `Cancelamento`.

### 5.5 Devolução (`DevolucaoTab` → `devolverPedidoOmie`)
Registra devolução total/parcial de produtos entregues. Cria `Retorno` e ajusta no Omie conforme o cenário fiscal.

### 5.6 Soltar Carga (`soltarCarga`, acionado pela página Cargas)
"Solta" todos os pedidos de uma carga: reverte etapa Omie, devolve pedidos para `liberado`, marca `solto_manualmente: true` (**blindagem fiscal — bloqueia emissão automática de NF** enquanto true).

---

## 6. PÁGINA: Acerto de Caixa (`/AcertoCaixa`)

**Arquivos:** `src/pages/AcertoCaixa.jsx`, `AcertoCaixaEditar.jsx`, `AcertoResumoPDF.jsx`
**Funções backend:** `sincronizarStatusCargasOmie`, `sincronizarAcertoOmie`, `cancelarNfAcerto`.

### 6.1 O que faz
Acerto financeiro de uma carga **após a entrega**: registra o que foi recebido por nota, diferenças, devoluções e não-entregas. Lista cargas elegíveis e acertos finalizados.

### 6.2 Regra de elegibilidade
Só cargas **faturadas** (`status_acerto` em `['faturada','conferindo','em_rota']`) aparecem. A regra é que o **acerto só acontece DEPOIS que a NF foi emitida** (etapa Omie 60). Validação dupla:
- `pedidos_omie[].etapa === '60'` no snapshot, **OU**
- estado de faturamento da carga (`processamento_omie_status === 'concluido'` ou `status_carga` avançado) — porque durante faturamento em massa o webhook pode estar defasado.

### 6.3 Iniciar acerto (lógica de snapshot)
`iniciarAcerto(carga)`:
1. Se já existe acerto → navega para edição.
2. **Preenche NFs faltantes** cruzando `codigo_pedido` → `Pedido.omie_codigo_pedido` → `numero_nota_fiscal` local (sem chamar Omie — em blocos de 100).
3. Cria `AcertoCaixa` com `notas[]` = pedidos Omie + internos (D1) + trocas, cada um com `valor_original`, `valor_recebido`, `diferenca`, `status_entrega`, `forma_pagamento`.

### 6.4 Integração Omie
- **Sincronizar status** (`sincronizarStatusCargasOmie`): consulta NFs reais das cargas (`list_limit: 200, sync_limit: 50`).
- **`sincronizarAcertoOmie`:** baixa títulos/recebimentos no Omie conforme o acerto.
- **`cancelarNfAcerto`:** cancela NF de pedido não entregue durante o acerto.

---

## 7. PÁGINA: Montar Rota (`/MontarRota`)

**Arquivo:** `src/pages/MontarRota.jsx`
**Lib:** `src/lib/otimizarRota.js` · **Componente:** `MapaRotaOtimizada` (react-leaflet).

### 7.1 O que faz
Calcula a **melhor ordem de entrega** a partir da localização GPS do motorista e dos clientes de uma carga. **100% local — ZERO Omie.**

### 7.2 Lógica
1. `clientesDaCarga(carga)`: extrai clientes dos pedidos (omie + internos + trocas), deduplicados.
2. Resolve coordenadas cruzando `cliente_id`/`codigo_omie`/`cnpj_cpf` com o cadastro `Cliente`. Clientes sem coordenada válida (validação Brasil: lat -34..6, lng -75..-32) são listados como "sem coordenada (ignorados)".
3. Captura GPS de saída (`navigator.geolocation`).
4. `otimizarRota(origem, paradas, fecharCiclo)` — heurística de vizinho mais próximo (nearest-neighbor).
5. Gera URL do **Google Maps** com a sequência otimizada (origin + waypoints + destination) e renderiza no mapa Leaflet.

---

## 8. PÁGINA: Relatório Analítico do Carregamento (`/RelatorioCarregamento`)

**Arquivo:** `src/pages/RelatorioCarregamento.jsx`
**Função backend:** `relatorioAnaliticoCarregamento`.

### 8.1 O que faz
Relatório consolidado de cargas por período (peso bruto/líquido, valor, qtd pedidos, motorista, status de acerto), com impressão em formato matricial (monospace).

### 8.2 Integração Omie
**Nenhuma direta.** `relatorioAnaliticoCarregamento` agrega dados **locais** (`Carga` + `AcertoCaixa`) entre `data_inicial` e `data_final`. Retorna `{ linhas[], totais, total_carregamentos }`.

---

## 9. Mapa de Funções Backend de Logística → Endpoints Omie

| Função Base44 | Endpoint Omie | `call` | Operação |
|---|---|---|---|
| `faturarCargaOmie` | — (local) | — | Marca carga faturada localmente |
| `processarFilaCargaOmie` | `produtos/pedido/` | `ConsultarPedido`, `AlterarPedidoVenda`, `TrocarEtapaPedido` | Troca etapa → 50 (worker fila) |
| `processarEmissaoNFLote` | `produtos/pedidovendafat/`, `produtos/pedido/` | `FaturarPedidoVenda`, `ConsultarPedido` | Emite NF-e → etapa 60 |
| `emitirNfPedidoOmie` | `produtos/pedidovendafat/` | `FaturarPedidoVenda` | Emite NF individual |
| `gerarBoletosOmie` | `financas/contareceber/`, `financas/contareceberboleto/` | `ListarContasReceber`, `GerarBoleto` | Gera boletos |
| `baixarPdfDanfeOmie` | (Omie NF) | `ObterNfe` / `ConsultarNF` | PDF da DANFE |
| `baixarPdfBoletoOmie` | (Omie boleto) | — | PDF do boleto |
| `trocarEtapaPedidoOmie` | `produtos/pedido/` | `TrocarEtapaPedido` | Reverter/avançar etapa |
| `alterarPrevisaoFaturamentoOmie` | `produtos/pedido/` | `AlterarPedidoVenda` | Altera data previsão |
| `sincronizarStatusCargasOmie` | `produtos/pedido/` | `ConsultarPedido` | Reconcilia NFs reais |
| `cortarPedidoOmie` | `produtos/pedido/` | `AlterarPedidoVenda` | Corte de itens |
| `cancelarPedidoOmie` / `cancelarNfOmie` | `produtos/pedido/` | `CancelarPedido` / cancela NF | Cancelamento |
| `devolverPedidoOmie` | (cenário fiscal) | — | Devolução |
| `relatorioAnaliticoCarregamento` | — (local) | — | Relatório agregado |

---

## 10. Webhooks Omie → App (sincronização do espelho)

**Função receptora:** `receberWebhookOmie` · **Worker:** `processarFilaWebhookOmie` / `processarWebhookOmie`.

**URL cadastrada no Omie:**
`https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>`

### 10.1 Fluxo
1. `receberWebhookOmie` (ultra leve, < 200ms): valida token + `app_key`, sanitiza payload (Content-Type JSON, máx 50KB), **idempotência por `messageId`** (checa `LogIntegracaoOmie.webhook_message_id`), enfileira como log `pendente` e **cutuca o worker** (fire-and-forget). Tópicos irrelevantes (`Financas.`, `Produto.`, etc.) entram como `ignorado`.
2. `processarFilaWebhookOmie` (sequencial, 1 por vez, com portão global + throttle): consome a fila, atualiza os espelhos (`PedidoLiberadoOmie`, `Pedido`, `Carga`) conforme o tópico (ex: `VendaProduto.Faturada`, `VendaProduto.EtapaAlterada`).

> 🔑 Por isso as telas operacionais não precisam consultar Omie ao vivo: o webhook mantém os espelhos atualizados em tempo (quase) real, e a reconciliação periódica é a rede de segurança.

---

## 11. Glossário de problemas comuns (debug)

| Sintoma | Causa provável | Onde investigar |
|---|---|---|
| Fila "Processando 0/N" parada | Circuit breaker aberto / portão zumbi / itens órfãos | `Cargas → Log da Fila`, `ControleCircuitBreakerOmie` |
| "Aguardando Omie liberar" | Itens em janela de espera (consumo redundante) | `FilaCargaOmie.proxima_tentativa_em` |
| Carga "Faturando…" sem fim | Item preso `processando` > 90s | PASSO 0 do worker resgata em 90s |
| NF "0 confirmadas / N aguardando" | NF saiu assíncrona, número não capturado | `reconciliarNfAguardandoAutorizacao` |
| Boleto erro 8020 | Chamadas `GerarBoleto` paralelas | Já tratado (sequencial + anti-8020) |
| "Cliente bloqueado para faturar" | Cadastro bloqueado no Omie (terminal) | Desbloquear o cliente no próprio Omie |
| "Utilize o processo de faturamento" | Tentou trocar etapa direto para 60 | Esperado — emitir NF é passo separado |

---

*Documento gerado a partir da leitura direta do código-fonte (páginas + backend functions). Mantenha-o atualizado ao alterar os workers de fila, os slots de rate limit ou as etapas Omie.*