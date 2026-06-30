# MÓDULO LOGÍSTICA — PLANO TÉCNICO COMPLETO

> **Data:** 2026-06-30  
> **Escopo:** Todas as telas, fluxos, entidades, funções backend e integrações do módulo Logístico.  
> Baseado em leitura direta do código-fonte (páginas, hooks, funções Deno, entidades).

---

## 1. VISÃO GERAL DO MÓDULO

O módulo de Logística cobre **todo o ciclo de vida de uma carga**, desde a seleção de pedidos a serem entregues até o acerto financeiro pós-entrega. É fortemente integrado ao **ERP Omie** (para trocar etapas dos pedidos, emitir NF-e e boletos) e armazena seu estado no **banco Base44**.

### Telas principais

| Tela | Rota | Função |
|---|---|---|
| Montagem de Carga | `/MontagemCarga` | Selecionar pedidos e "fechar" a carga |
| Cargas | `/Cargas` | Gerenciar cargas criadas: faturar, soltar, transferir, documentos |
| Notas Omie (NFs) | `/NotasOmie` | Emitir NF-e / acompanhar status das notas |
| Ajustes de Pedidos | `/AjustesPedidos` | Corte, transferência, cancelamento, devolução |
| Boletos Omie | `/BoletosOmie` | Emissão e consulta de boletos |
| Acerto de Caixa | `/AcertoCaixa` | Registrar recebimento/devoluções pós-entrega |
| Relatório Carregamento | `/RelatorioCarregamento` | PDF analítico das cargas |
| Operação | `/Operacao` | Kanban de status logístico em tempo real |
| Montar Rota | `/MontarRota` | Roteirização e ordenação de entregas |

---

## 2. ENTIDADES (BANCO LOCAL BASE44)

### 2.1 Entidades centrais do módulo

#### `Carga`
Entidade principal. Snapshot completo de uma carga.

| Campo | Tipo | Descrição |
|---|---|---|
| `numero_carga` | string | Sequencial 3 dígitos (001, 002…) — gerado por `ContadorCarga` |
| `data_carga` | date | Data prevista de saída |
| `motorista_id` / `motorista_nome` | string | Motorista responsável |
| `veiculo_id` / `veiculo_placa` | string | Veículo alocado |
| `ajudante_id` / `ajudante_nome` | string | Ajudante (opcional) |
| `status_carga` | enum | `montagem` → `faturada` → `entregue` |
| `processamento_omie_status` | enum | `nao_iniciado` / `em_andamento` / `concluido` / `parcial` / `erro` |
| `processamento_omie_total` | number | Total de pedidos enfileirados para o Omie |
| `pedidos_omie` | array | Snapshot de pedidos Omie (NF55) |
| `pedidos_internos` | array | Snapshot de pedidos D1 (internos, sem NF) |
| `pedidos_troca` | array | Snapshot de trocas aprovadas |
| `notas_fiscais` | array | Lista de números de NF consolidados |
| `produtos_resumo` | array | Consolidado de produtos da carga |
| `quantidade_pedidos` | number | Total de pedidos |
| `quantidade_clientes` | number | Clientes únicos |
| `quantidade_total_pacotes` | number | Pacotes totais |
| `valor_total` / `valor_total_carga` | number | Valor total |
| `observacao` / `observacoes` | string | Instruções da carga |
| `pdf_resumo_url` / `pdf_romaneio_url` | string | URLs dos PDFs gerados |
| `checkin_saida` | object | GPS do motorista ao sair (`latitude`, `longitude`, `capturado_em`) |

**Sub-objetos em `pedidos_omie[]`:**
```
codigo_pedido, codigo_pedido_integracao, numero_pedido,
numero_nf, codigo_cliente, cnpj_cpf_cliente, nome_cliente,
nome_fantasia, cidade, etapa, tipo_nota, valor_total_pedido,
quantidade_itens, tags_cliente, rota_cliente, produtos[]
```

**Sub-objetos em `pedidos_internos[]`:**
```
pedido_id, numero_pedido, modelo_nota (d1), cenario_fiscal_nome,
cliente_id, nome_cliente, nome_fantasia, cidade, rota_cliente,
vendedor_nome, valor_total_pedido, quantidade_itens, produtos[]
```

**Sub-objetos em `pedidos_troca[]`:**
```
pedido_troca_id, pedido_id, numero_pedido, cliente_id,
nome_cliente, nome_fantasia, cidade, rota_cliente,
valor_total_pedido, quantidade_itens, produtos[]
```

---

#### `PedidoLiberadoOmie` (Espelho)
Espelho **local em tempo real** dos pedidos do Omie. Mantido por webhook + reconciliação. **É a fonte de dados da tela Montagem de Carga** (evita consultas ao vivo no Omie).

| Campo | Tipo | Descrição |
|---|---|---|
| `codigo_pedido` | string | `nCodPed` do Omie (chave primária do espelho) |
| `etapa` | string | Etapa atual: `10`, `20`, `50`, `60` |
| `status_real` | string | Status fiscal: `emitida`, `rejeitada`, `cancelada`, `aguardando_nf` |
| `numero_nf` | string | Número da NF emitida (etapa 60) |
| `cliente_id` | string | ID do Cliente local (resolvido no upsert) |
| `pedido_id` | string | ID do Pedido local (quando vinculado) |
| `rota_id` / `rota_nome` | string | Rota do pedido |
| `vendedor_id` / `vendedor_nome` | string | Vendedor do pedido |
| `produtos` | array | Itens do pedido (código, descrição, qtd, valor) |
| `origem_sync` | enum | `webhook` / `bootstrap` / `reconciliacao` |
| `sincronizado_em` | datetime | Última atualização |

---

#### `FilaCargaOmie`
Fila assíncrona de processamento Omie. 1 registro por pedido. Processa em background pela função `processarFilaCargaOmie`.

| Campo | Tipo | Descrição |
|---|---|---|
| `carga_id` | string | ID da Carga |
| `codigo_pedido_omie` | string | `nCodPed` do Omie |
| `operacao` | enum | `faturar` / `emitir_nf` / `ambos` |
| `etapa_destino` | string | Sempre `50` (faturar) — nunca 60 diretamente |
| `status` | enum | `pendente` → `processando` → `concluido` / `erro` / `aguardando_acao_humana` |
| `tentativas` | number | Tentativas realizadas |
| `tentativas_redundante` | number | Janelas de consumo redundante aguardadas |
| `tentativas_revalidacao` | number | Revalidações de etapa < 50 |
| `proxima_tentativa_em` | datetime | Respeita janela de 60s do Omie (consumo redundante) |
| `processando_em` | datetime | Timestamp de início do processamento (anti-órfão) |
| `erro_log` | string | Último erro |

---

#### `Pedido`
Pedido de venda/troca/bonificação local.

Campos relevantes para Logística:

| Campo | Tipo | Descrição |
|---|---|---|
| `tipo` | enum | `venda` / `troca` / `bonificacao` / `devolucao` |
| `modelo_nota` | enum | `55` (NF-e Omie) / `nfce` / `d1` (venda interna) |
| `status` | enum | `pendente` → `enviado` → `liberado` → `montagem` → `faturado` → `cancelado` |
| `status_faturamento` | enum | `pendente` / `processando` / `faturado` / `rejeitado` / `erro` |
| `status_logistico` | enum | `aguardando` / `em_carga` / `em_rota` / `entregue` / `parcial` / `nao_entregue` / `devolvido` |
| `etapa` | enum | `comercial` / `faturamento` / `logistica` / `pos_entrega` / `encerrado` / `montagem` |
| `carga_id` / `numero_carga` | string | Vínculo com a Carga |
| `carga_faturamento_numero` | string | Carga em que foi faturado (imutável após emissão) |
| `omie_codigo_pedido` | string | `nCodPed` do Omie |
| `numero_nota_fiscal` | string | Número da NF emitida |
| `faturado` | boolean | Pedido tem NF emitida |
| `solto_manualmente` | boolean | BLINDAGEM FISCAL: pedido solto manualmente — não pode ser faturado automaticamente |
| `pendente_emissao` | boolean | Pedido faturado mas NF não concluiu |
| `nf_aguardando_autorizacao` | boolean | NF emitida mas aguardando SEFAZ |

---

#### `PedidoTroca`
Trocas registradas pelo app do vendedor em campo. Status `aprovado` = disponível para montagem de carga.

---

#### `PedidoItem`
Itens de cada Pedido (produtos, quantidades, preços). Usado para calcular pacotes na Montagem.

---

#### `AcertoCaixa`
Registro de acerto financeiro pós-entrega por carga.

| Campo | Tipo | Descrição |
|---|---|---|
| `carga_id` / `numero_carga` | string | Carga do acerto |
| `data_acerto` | date | Data do acerto |
| `status_acerto` | enum | `em_andamento` / `finalizado` |
| `notas` | array | Snapshot de cada nota (ver abaixo) |
| `valor_total_original` | number | Valor total esperado |
| `valor_total_recebido` | number | Valor efetivamente recebido |
| `valor_total_diferenca` | number | Diferença (positivo = sobra, negativo = falta) |

**Sub-objetos em `notas[]`:**
```
codigo_pedido, numero_pedido, numero_nfe, nome_cliente, razao_social,
codigo_cliente, valor_original, valor_recebido, diferenca,
status_entrega (pendente/entregue/parcial/nao_entregue/devolvido),
forma_pagamento, data_recebimento, motivo_cancelamento, observacao
```

---

#### `LogEmissaoNF`
Histórico de cada tentativa de emissão de NF via Omie.

| Campo chave | Descrição |
|---|---|
| `codigo_pedido` | nCodPed do Omie |
| `nid_nf` | ID interno da NF no Omie (para impressão rápida — pula ConsultarNF) |
| `status` | `autorizada` / `rejeitada` / `pendente` / `erro` / `bloqueado_cliente` |
| `carga_id` / `numero_carga` | Carga da emissão |
| `lote_id` | Agrupa pedidos emitidos no mesmo lote |

---

#### `ContadorCarga`
Registro único (`chave: 'global'`) que guarda o último número de carga gerado. Garante sequência sem lacunas, mesmo com exclusões.

---

#### `LogCorte` / `Retorno` / `Transferencia` / `Cancelamento`
Entidades de auditoria para cada operação de ajuste de pedidos.

---

#### `FilaEmissaoNF`
Fila para emissão assíncrona de NF-e. Processada por `processarEmissaoNFLote`.

---

#### `FilaBoletoOmie`
Fila para emissão assíncrona de boletos. Processada por `processarFilaBoletoOmie`.

---

#### `ControleCircuitBreakerOmie`
Controle de bloqueio da API Omie. Registros especiais:
- `chave: 'principal'` — circuit breaker global da API (bloqueia se Omie retornar 425)
- `chave: 'portao_global_omie'` — mutex global: garante apenas 1 worker tocando o Omie por vez
- `chave: 'worker_carga'` — lock de auto-encadeamento da fila de carga

---

#### `LogIntegracaoOmie`
Auditoria de todas as chamadas feitas à API Omie (endpoint, call, status, payload, erros).

---

## 3. FLUXO COMPLETO DO MÓDULO — PASSO A PASSO

### FASE 1 — MONTAGEM DE CARGA (`/MontagemCarga`)

#### 3.1 Carregamento de dados

**Hook:** `useDadosMontagem(ativo)`

**Dados carregados em paralelo (Promise.all):**
1. `PedidoLiberadoOmie.filter({ etapa: { $in: ['20','50'] } })` — espelho do Omie
2. `Pedido.filter({ status: { $in: ['liberado','cancelado','faturado'] } })` — pedidos locais
3. `PedidoTroca.filter({ status: 'aprovado' })` — trocas disponíveis
4. `Rota.list()` — nomes de rotas para resolução
5. `Motorista.list()` — lista de motoristas ativos
6. `Veiculo.list()` — lista de veículos ativos
7. `Carga.list()` — cargas existentes (para detectar pedidos já em carga)

**Pós-carregamento:**
- **Deduplicação do espelho:** se existem 2 registros `PedidoLiberadoOmie` para o mesmo `codigo_pedido`, mantém o que tem `produtos[]` preenchido e o mais recente.
- **Busca de clientes por IDs:** apenas os `cliente_id` referenciados (não carrega a base toda). Em lotes de 200, paralelos.
- **Resolução de rota:** por `rota_id` do espelho → fallback por `rota_id` do cliente.
- **Exclusão de pedidos em carga ativa:** pedidos cujos `codigo_pedido` (Omie), `pedido_id` (D1) ou `pedido_troca_id` (Troca) já constam em cargas com `status_carga: montagem` ou `faturada`.
- **Pedidos NF55 locais:** pedidos `modelo_nota:55`, `status:liberado`, sem `carga_id`, que **não estejam no espelho** (webhook ainda não gerou o `PedidoLiberadoOmie`).
- **Busca de itens (pacotes):** função backend `getItensPedidosLote` — retorna `PedidoItem` e `ItemPedidoTroca` em lote para preencher `produtos[]` dos pedidos sem itens no espelho.

**Cache local:** `localStorage` com TTL de 60s. Estratégia `stale-while-revalidate` — exibe snapshot antigo enquanto revalida em background.

**Auto-refresh:** a cada 180s, relê entidades locais (sem chamar Omie).

**Botão "Atualizar":** chama `sincronizarLiberadosOmieRapido` (sincroniza espelho com Omie) e recarrega.

---

#### 3.2 Estrutura dos pedidos exibidos

Cada item na lista de Montagem é um objeto com:

```js
{
  // Identificação
  codigo_pedido: string,         // nCodPed Omie | "D1-{id}" | "TROCA-{id}"
  pedido_id: string,             // ID Pedido local (quando vinculado)
  pedido_troca_id: string,       // ID PedidoTroca (apenas trocas)
  numero_pedido: string,

  // Cliente
  nome_cliente: string,
  nome_fantasia: string,
  cidade: string,
  bairro: string,
  endereco: string,
  cliente_id: string,
  cnpj_cpf_cliente: string,

  // Rota / Vendedor
  rota_id: string,
  rota_nome: string,
  rota_cliente: string,
  vendedor_id: string,
  vendedor_nome: string,

  // Valores
  valor_total_pedido: number,
  quantidade_itens: number,

  // Produtos (pacotes)
  produtos: [{ codigo_produto, descricao, quantidade, valor_unitario, valor_total, unidade }],

  // Classificação
  tipo: 'venda' | 'd1' | 'troca',
  tipo_nota: '55' | 'D1' | '',
  tipo_operacao: string,
  tipo_operacao_fiscal: string,
  etapa: string,                 // etapa Omie atual
}
```

---

#### 3.3 Filtros da Montagem

Aplicados localmente sobre a lista de pedidos:

| Filtro | Campo |
|---|---|
| Tipo | `tipo: venda / d1 / troca` |
| Rota | `rota_nome` |
| Cidade | `cidade` |
| Vendedor | `vendedor_nome` |
| Valor mínimo/máximo | `valor_total_pedido` |
| Texto livre | Nome do cliente, nº pedido, código, cidade, rota, produtos |
| Apenas selecionados | Checkbox especial |

---

#### 3.4 Fechar carga (`PainelFecharCarga`)

**Campos obrigatórios:** Motorista, Veículo, Data de Saída.

**Sequência de execução ao clicar "Fechar carga":**

1. **Validação de seleção:** ≥ 1 pedido selecionado.
2. **Aviso de carga gigante:** acima de 25 pedidos, pede confirmação.
3. **BLINDAGEM anti-duplicata:** consulta `Pedido.filter({ id: { $in: [...] } })` — se qualquer pedido já tem `carga_id` ativo, bloqueia com erro.
4. **Preenchimento de produtos:** pedidos de venda sem `produtos[]` buscam no espelho (`PedidoLiberadoOmie.filter({ codigo_pedido: { $in: [...] } })`) e depois em `PedidoItem.filter({ pedido_id })`. Se algum continuar sem itens → bloqueia.
5. **Snapshot:** congela os arrays antes de qualquer `await` (evita race conditions).
6. **Gerar número de carga:**
   - Busca `ContadorCarga.filter({ chave: 'global' })`
   - Incrementa `ultimo_numero`
   - Tenta criar carga com esse número; se já existir (race), retry até 10x.
7. **Criar `Carga`:**
   ```js
   Carga.create({
     numero_carga, data_carga, motorista_id, motorista_nome,
     veiculo_id, veiculo_placa, status_carga: 'montagem',
     valor_total, quantidade_pedidos, quantidade_clientes,
     quantidade_total_pacotes,
     pedidos_omie: [...],       // vendas NF55
     pedidos_internos: [...],   // D1
     pedidos_troca: [...],      // trocas
     notas_fiscais: [...],
     observacao, observacoes
   })
   ```
8. **Vincular pedidos locais:**
   - Para cada venda/D1: `Pedido.update(pedidoId, { carga_id, numero_carga, status:'montagem', status_logistico:'em_carga', etapa:'logistica' })`
   - Para cada troca: `PedidoTroca.update(id, { carga_id, motorista_id, status:'montagem' })` + `Pedido.update` (quando houver pedido local vinculado)
9. **Enfileirar no Omie:** para cada venda NF55:
   ```js
   FilaCargaOmie.bulkCreate([{
     carga_id, numero_carga, pedido_id, codigo_pedido_omie,
     numero_pedido, data_previsao: dataSaida,
     operacao: 'faturar', etapa_destino: '50',
     status: 'pendente', tentativas: 0
   }])
   ```
10. **Marca carga:** `processamento_omie_status: 'em_andamento'`
11. **Dispara fila imediatamente:** `base44.functions.invoke('processarFilaCargaOmie', {})` (fire-and-forget)
12. **Navega para `/Cargas`**

---

### FASE 2 — PROCESSAMENTO OMIE ASSÍNCRONO

**Função:** `processarFilaCargaOmie` (Deno backend)  
**Acionamento:** disparo imediato ao fechar carga + automação scheduled a cada 5 minutos.

#### Sequência de execução da função:

1. **Circuit breaker check:** se `ControleCircuitBreakerOmie { id: '6a1e06a9aa62ceab7b3b6d97' }` estiver bloqueado → aborta.
2. **Lock de encadeamento:** adquire `worker_carga` no `ControleCircuitBreakerOmie`. Se lock ativo → sai (apenas 1 cadeia por vez).
3. **PASSO 0 — Resgate de órfãos:** itens `status='processando'` há mais de 90s são resetados para `pendente`.
4. **PASSO 1 — Atualizar status de cargas:** recalcula `processamento_omie_status` de todas as cargas em status intermediário.
5. **Portão global:** adquire `portao_global_omie` (mutex global entre todos os workers Omie). Se ocupado → aborta.
6. **PASSO 2 — Limpeza de órfãos:** pedidos cujas cargas foram excluídas → marcados como `erro`.
7. **Buscar pendentes:** até 8 itens por lote (`LOTE=8`), respeitando `proxima_tentativa_em` (janela de consumo redundante).
8. **Para cada item, sequencialmente:**
   - **Idempotência:** se já está na etapa destino → marca `concluido` direto.
   - **Verificação "já faturado":** consulta `ConsultarPedido` no Omie. Se etapa ≥ 60 → `concluido`.
   - **`processarFaturar`:**
     1. `AlterarPedidoVenda` (alterar data de previsão de faturamento no Omie)
     2. `TrocarEtapaPedido` para etapa `50`
     3. Reconsulta `ConsultarPedido` para confirmar etapa ≥ 50
   - **Atualiza localmente:** `FilaCargaOmie.status='concluido'` + `Pedido.etapa='logistica', status_logistico='em_carga'` + `PedidoLiberadoOmie.etapa='50'`
   - **Tratamento de erros especiais:**
     - `redundante`: re-agenda `proxima_tentativa_em + 60s`, até 5 janelas
     - `etapaNaoAvancou`: conta revalidações, após 4 → `aguardando_acao_humana`
     - `destinoInvalido`: erro definitivo, sem retry
     - `jaFaturado`: trata como sucesso, atualiza espelho para etapa `60`
     - `clienteBloqueado`: erro terminal, não retenta
     - `bloqueio Omie (425)`: interrompe o lote, armazena no circuit breaker
9. **Atualiza status de cargas afetadas.**
10. **Auto-encadeamento:** se ainda há pendentes → libera portão + lock e re-invoca a si mesma (fire-and-forget). Garante que lotes grandes sejam processados sem esperar 5min.

---

### FASE 3 — GERENCIAR CARGAS (`/Cargas`)

#### Dados carregados:
- `Carga.list('-created_date', 1000)` — todas as cargas
- `FilaCargaOmie.filter({})` — itens de fila das cargas em `em_andamento/parcial/erro`

#### Abas (classificação visual):
| Aba | Critério |
|---|---|
| Em Montagem | `status_carga='montagem'` |
| Faturando… | `status_carga='faturada'` + `processamento_omie_status: em_andamento/processando` E itens pendentes na fila |
| Faturadas | `status_carga='faturada'` e não "Faturando…" |
| Conferindo | `status_carga='conferindo'` |
| Entregue | `status_carga='entregue'` |
| Canceladas | `status_carga='cancelada'` |
| Log da Fila | Tabela de `FilaCargaOmie` |

#### Ações por carga:

| Ação | Condição | O que faz |
|---|---|---|
| **Faturar** | `status_carga='montagem'` | Chama `faturarCargaOmie` (veja §3.4.1) |
| **NFe** | `faturada` | Navega para `/NotasOmie?carga_id=…` |
| **Boletos** | `faturada` | Navega para `/BoletosOmie?carga_id=…` |
| **Romaneio** | `faturada` | Abre `DocumentosCargaModal` tipo `romaneio` |
| **Reconciliar NFs** | `faturada` | Chama `sincronizarStatusCargasOmie` em loop até `concluida=true` |
| **Lista de carregamento** | sempre | Abre `DocumentosCargaModal` tipo `lista` |
| **Nota D1** | `faturada` + tem D1 | Abre `DocumentosCargaModal` tipo `notad1` |
| **Previsão de entrega** | tem pedidos Omie/D1 | Chama `alterarPrevisaoFaturamentoOmie` |
| **Editar** | sempre | Modal de edição de motorista/veículo |
| **Transferir** | tem pedidos | `TransferirPedidosCargaModal` |
| **Soltar** | tem pedidos + sem processamento | Chama `soltarCarga` (veja §3.4.2) |
| **Excluir** | `montagem` | Cancela fila + reverte etapas Omie + exclui |
| **Processar Fila Agora** | tem pendentes | Chama `processarFilaCargaOmie` |

---

#### 3.4.1 `faturarCargaOmie` (backend)
Operação **100% local** (zero chamadas ao Omie). Apenas marca a carga como `faturada` e os pedidos de venda como `status:'montagem', status_faturamento:'pendente'`. Pedidos D1/Troca/Bonificação são marcados como `faturado:true, status:'faturado'` (não emitem NF).

> **IMPORTANTE:** Esta função NÃO troca etapa no Omie e NÃO emite NF. A emissão é feita na tela "Notas Omie → Emissão".

---

#### 3.4.2 `soltarCarga` (backend)
Reverte a carga, devolvendo pedidos para a fila de Montagem.

**Suporte a soltura parcial:** `body.pedidos_ids[]` com IDs específicos. Sem lista → solta tudo.

**Para cada pedido Omie solto:**
- `Pedido.update({ carga_id:null, numero_carga:null, status:'liberado', etapa:'montagem', solto_manualmente:true })`
- `PedidoLiberadoOmie.update({ etapa:'20' })` (best-effort)

**Para cada D1 solto:**
- `Pedido.update({ carga_id:null, status:'liberado', etapa:'montagem', solto_manualmente:true })`

**Para cada troca solta:**
- `PedidoTroca.update({ carga_id:null, motorista_id:null, status:'aprovado' })`
- `Pedido.update({ ...LIBERADO, solto_manualmente:true })`

**Se soltura parcial e restam pedidos:** recalcula `valor_total`, `quantidade_pedidos`, `produtos_resumo` da carga.

**Se soltura total:** zera a carga, cancela `FilaCargaOmie` pendentes.

**BLINDAGEM FISCAL:** `solto_manualmente:true` impede que automações faturem o pedido automaticamente.

---

### FASE 4 — EMISSÃO DE NF-e (`/NotasOmie`)

**Telas:** `EmissaoNFTab` (emissão) + `NotasNF55Tab` (consulta + impressão) + `NotasD1Tab`

#### Fluxo de emissão:

1. Lista pedidos em `status_faturamento:'pendente'` com `carga_id` preenchido (ou filtra por carga específica).
2. Usuário seleciona pedidos e clica "Emitir".
3. Chama `processarEmissaoNFLote` (via fila `FilaEmissaoNF`).
4. A função backend chama `IncluirFaturamento` no Omie para cada pedido.
5. Se SEFAZ autorizar → atualiza `Pedido.numero_nota_fiscal`, `Pedido.faturado:true`, `Pedido.status:'faturado'`, `PedidoLiberadoOmie.etapa:'60'`.
6. Grava em `LogEmissaoNF` o resultado (autorizada/rejeitada/erro).

#### Reconciliação do espelho de carga:
Botão "Sincronizar espelho da carga" → chama `reconciliarEspelhoCargaCompleto` para cruzar números de NF reais com o espelho local sem disparar operações fiscais.

---

### FASE 5 — BOLETOS (`/BoletosOmie`)

**Fluxo de emissão:**
1. Lista pedidos faturados (com NF) da carga.
2. Verifica se cliente usa modalidade de pagamento com boleto (`modalidade_pagamento_id` → `ModalidadePagamento`).
3. Enfileira em `FilaBoletoOmie`.
4. `processarFilaBoletoOmie` chama `IncluirBoleto` no Omie para cada pedido.
5. Resultado gravado em `LogEmissaoBoleto`.
6. URL do boleto salva em `Pedido.boleto_url` (ou similar).

---

### FASE 6 — AJUSTES DE PEDIDOS (`/AjustesPedidos`)

#### 6.1 Corte de Pedido
- Seleciona carga e pedido.
- Seleciona motivo de corte (`MotivoCorte`).
- Chama `cortarPedidoOmie` → reverte pedido para Montagem e grava `LogCorte`.

#### 6.2 Transferência
- Seleciona pedido de uma carga e carga de destino.
- Chama `transferirPedidoCarga` → remove da carga origem, adiciona na destino.
- Grava `Transferencia`.

#### 6.3 Cancelamento
- Seleciona pedido.
- Chama `cancelarPedidoOmie` → cancela no Omie e atualiza `Pedido.status:'cancelado'`.
- Grava `Cancelamento`.

#### 6.4 Devolução
- Seleciona pedido.
- Chama `devolverPedidoOmie` → cria nota de devolução no Omie.
- Grava `Retorno`.

---

### FASE 7 — ACERTO DE CAIXA (`/AcertoCaixa` + `/AcertoCaixaEditar`)

#### Critério de elegibilidade:
Cargas `status_carga: faturada/conferindo/em_rota` **sem** acerto finalizado, e com pelo menos 1 pedido Omie em etapa 60 **OU** `processamento_omie_status: concluido`.

#### Fluxo:

1. **Criar acerto:** `AcertoCaixa.create(snapshot de todas as notas da carga)`
2. **Editar acerto:** para cada nota, preenche:
   - `status_entrega`: pendente / entregue / parcial / nao_entregue / devolvido
   - `valor_recebido` (pode diferir do `valor_original`)
   - `forma_pagamento`: boleto / dinheiro / pix / cartão
   - `data_recebimento`
   - `motivo_cancelamento` (se não entregue)
   - `observacao`
3. **Finalizar:** marca `status_acerto:'finalizado'`, calcula totais.
4. **PDF:** gera `AcertoResumoPDF` (tela dedicada `/AcertoResumoPDF?id=…`).

---

### FASE 8 — OPERAÇÃO KANBAN (`/Operacao`)

Kanban com colunas baseadas em `status_logistico` das cargas/pedidos.

**Dados:** Cargas faturadas + seus pedidos. Atualização em tempo real via subscribe.

**Colunas:** Em Rota → Entregue → Parcial → Não Entregue → Devolvido

---

## 4. FUNÇÕES BACKEND (Deno) DO MÓDULO

| Função | Trigger | Descrição |
|---|---|---|
| `processarFilaCargaOmie` | scheduled 5min + fire-and-forget | Troca etapa → 50 no Omie para cada pedido da fila de carga |
| `faturarCargaOmie` | botão "Faturar" em `/Cargas` | Marca carga/pedidos como faturados **localmente** |
| `soltarCarga` | botão "Soltar" | Reverte pedidos para Montagem (total ou parcial) |
| `processarEmissaoNFLote` | scheduled + manual | Emite NF-e no Omie para lotes de pedidos |
| `processarFilaBoletoOmie` | scheduled + manual | Emite boletos no Omie |
| `sincronizarStatusCargasOmie` | botão "Reconciliar NFs" / "Sincronizar" | Consulta Omie e atualiza números de NF das cargas |
| `sincronizarLiberadosOmieRapido` | botão "Atualizar" na Montagem | Sincronização rápida do espelho PedidoLiberadoOmie |
| `reconciliarEspelhoCargaCompleto` | botão "Sincronizar espelho" | Reconcilia espelho local com dados reais do Omie |
| `alterarPrevisaoFaturamentoOmie` | modal de previsão | Altera data de previsão nos pedidos do Omie |
| `trocarEtapaPedidoOmie` | exclusão de carga | Reverte etapa Omie de 50→20 nos pedidos |
| `cortarPedidoOmie` | aba Corte | Corta produto de pedido em carga |
| `transferirPedidoCarga` | aba Transferência | Move pedido de uma carga para outra |
| `cancelarPedidoOmie` | aba Cancelamento | Cancela pedido no Omie |
| `devolverPedidoOmie` | aba Devolução | Gera devolução no Omie |
| `getItensPedidosLote` | Montagem | Busca `PedidoItem` + `ItemPedidoTroca` em lote |
| `reconciliarEtapa50Lote` | admin | Reconcilia pedidos presos em etapa intermediária |
| `reenviarItemFilaCarga` | admin | Reenfileira item específico da fila |
| `gerarBoletosOmie` | boletos | Emite boleto para um pedido específico |
| `baixarPdfDanfeOmie` | impressão NF | Baixa PDF da DANFE via Omie (`ObterNfe`) |
| `baixarPdfBoletoOmie` | impressão boleto | Baixa PDF do boleto via Omie |
| `relatorioAnaliticoCarregamento` | acerto de caixa | Gera PDF analítico de carregamento |
| `sincronizarAcertoOmie` | acerto | Sincroniza pagamentos com Omie |

---

## 5. INTEGRAÇÕES EXTERNAS

### 5.1 Omie ERP

**Base URL:** `https://app.omie.com.br/api/v1/`

**Credenciais:**
- `OMIE_APP_KEY` → secret do backend (NUNCA no frontend)
- `OMIE_APP_SECRET` → secret do backend

**Endpoints / calls usados pelo módulo Logístico:**

| Endpoint | Call | Uso |
|---|---|---|
| `produtos/pedido/` | `ConsultarPedido` | Verificar etapa/faturamento atual |
| `produtos/pedido/` | `TrocarEtapaPedido` | Troca etapa: `20→50` (faturar) |
| `produtos/pedido/` | `AlterarPedidoVenda` | Alterar previsão de faturamento |
| `produtos/pedido/` | `IncluirFaturamento` | Emitir NF-e (passo de faturamento real) |
| `produtos/nfconsultar/` | `ConsultarNF` | Consultar status da NF no Omie |
| `produtos/nfce/` | `ObterNfe` | Baixar PDF DANFE (usa `nIdNF`) |
| `financas/boleto/` | `IncluirBoleto` | Emitir boleto |
| `financas/boleto/` | `ConsultarBoleto` | Verificar status do boleto |

**Proteções da integração:**
- **Circuit Breaker:** bloqueia chamadas por N segundos após erros 425/bloqueio
- **Consumo Redundante:** re-agenda com janela de 60s, máximo 5 janelas
- **Portão Global:** mutex exclusivo entre todos os workers Omie
- **Retry automático:** 3 tentativas com backoff exponencial para erros transitórios

### 5.2 SEFAZ (via Omie)
A autorização das NF-e é feita pela SEFAZ através do Omie. O sistema não chama a SEFAZ diretamente. Resultado da autorização:
- `cStat = 100` → autorizada
- `cStat >= 200` → rejeitada

---

## 6. DADOS QUE PRECISAM SER ENVIADOS PARA O MÓDULO

### Para criar uma carga (via PainelFecharCarga):

```js
// Dados do formulário do usuário:
{
  motoristaId: string,       // Motorista.id
  veiculoId: string,         // Veiculo.id
  dataSaida: string,         // "YYYY-MM-DD"
  obs: string,               // Texto livre

  // Seleção de pedidos (arrays montados pelo hook):
  pedidosOmieFmt: [{
    pedido_id, codigo_pedido, codigo_pedido_integracao,
    numero_pedido, codigo_cliente, codigo_cliente_integracao,
    codigo_cliente_cod, cnpj_cpf_cliente, numero_nf,
    nome_cliente, nome_fantasia, cidade, rota_cliente,
    valor_total_pedido, quantidade_itens, tags_cliente,
    tipo_operacao_fiscal, cenario_fiscal_nome, produtos: [...]
  }],

  pedidosD1Fmt: [{
    pedido_id, numero_pedido, modelo_nota: 'd1',
    cenario_fiscal_nome, tipo_operacao_fiscal,
    cliente_id, nome_cliente, nome_fantasia, cidade, rota_cliente,
    vendedor_nome, valor_total_pedido, quantidade_itens, produtos: [...]
  }],

  pedidosTrocaFmt: [{
    pedido_troca_id, pedido_id, numero_pedido,
    cliente_id, nome_cliente, nome_fantasia, cidade, rota_cliente,
    valor_total_pedido, quantidade_itens, produtos: [...]
  }]
}
```

### Para `processarFilaCargaOmie` (enfileirado automaticamente):
```js
// FilaCargaOmie por pedido:
{
  carga_id, numero_carga, pedido_id,
  codigo_pedido_omie,       // nCodPed Omie
  codigo_pedido_integracao,
  numero_pedido, data_previsao,
  operacao: 'faturar', etapa_destino: '50',
  status: 'pendente', tentativas: 0
}
```

### Para `faturarCargaOmie`:
```js
{ carga_id: string }
```

### Para `soltarCarga`:
```js
{
  carga_id: string,
  motivo: string,           // opcional
  pedidos_ids: string[]     // opcional — soltura parcial
}
```

### Para `sincronizarStatusCargasOmie`:
```js
{
  carga_ids: [string],
  sync_limit: number,
  dias_retroativos: number,
  max_pedidos_por_chamada: number
}
```

### Para `alterarPrevisaoFaturamentoOmie`:
```js
{
  pedidos: [{ codigo_pedido, codigo_pedido_integracao, numero_pedido }],
  data_previsao: "YYYY-MM-DD"
}
```

---

## 7. ESTADOS DOS PEDIDOS AO LONGO DO FLUXO

```
Comercial (status: pendente/liberado)
         ↓ Montagem de Carga
Logística (status: montagem, carga_id preenchido)
         ↓ Faturar Carga (faturarCargaOmie)
Carga Faturada (status: montagem, status_faturamento: pendente)
         ↓ processarFilaCargaOmie (etapa Omie 20→50)
Aguardando NF (etapa Omie: 50)
         ↓ processarEmissaoNFLote (IncluirFaturamento)
         ↓ SEFAZ autoriza
Faturado (status: faturado, faturado:true, numero_nota_fiscal preenchido, etapa Omie: 60)
         ↓ Acerto de Caixa
Entregue / Devolvido (status_logistico)
```

**Etapas Omie correlacionadas:**
| Etapa Omie | Significado no sistema |
|---|---|
| `10` | Pendente / aguardando liberação |
| `20` | Liberado para Montagem de Carga |
| `50` | Em Faturamento (carga fechada, aguardando NF) |
| `60` | Faturado / NF emitida |

---

## 8. MECANISMOS DE PROTEÇÃO E RESILIÊNCIA

| Mecanismo | Onde | Proteção |
|---|---|---|
| Cache `stale-while-revalidate` | `useDadosMontagem` | Tela abre instantânea, mesmo sem rede |
| Deduplicação espelho | `useDadosMontagem` | Evita "0 pacotes" por registros duplicados |
| Anti-duplicata de carga | `PainelFecharCarga` | Pedido em carga ativa bloqueia fechar nova |
| Snapshot antes de `await` | `PainelFecharCarga` | Evita race condition por re-render |
| Circuit Breaker | `ControleCircuitBreakerOmie` | Para chamadas ao Omie após erros 425 |
| Portão Global | `portao_global_omie` | 1 worker no Omie por vez (todos os tipos) |
| Lock de encadeamento | `worker_carga` | 1 cadeia de fila por vez |
| Resgate de órfãos | `processarFilaCargaOmie` | Itens em `processando` há +90s são resetados |
| `solto_manualmente` | `Pedido` | Pedido solto não é faturado automaticamente |
| Janela consumo redundante | `FilaCargaOmie.proxima_tentativa_em` | Respeita os ~60s de carência do Omie |
| Auto-encadeamento | `processarFilaCargaOmie` | Processar lotes grandes sem esperar 5min |
| Retry com backoff | Todos os workers | 3 tentativas com delay crescente |

---

## 9. DOCUMENTOS GERADOS

| Documento | Componente | Conteúdo |
|---|---|---|
| Lista de Carregamento | `ListaCarregamentoPdf` | Pedidos + produtos consolidados da carga |
| Romaneio de Entrega | `RomaneioEntregaPdf` | Sequência de entrega com endereços e itens |
| Nota D1 | `NotaD1Pdf` | Documento interno para pedidos sem NF fiscal |
| DANFE (NF-e) | `baixarPdfDanfeOmie` | PDF oficial da NF via Omie (usa `nIdNF`) |
| PDF Boleto | `baixarPdfBoletoOmie` | PDF do boleto via Omie |
| Acerto de Caixa PDF | `AcertoResumoPDF` | Resumo financeiro pós-entrega |
| Relatório Analítico | `RelatorioAnaliticoCarregamentoPdf` | Consolidado de carregamentos por período |

---

## 10. PONTOS DE ATENÇÃO / RISCOS

1. **Espelho defasado:** se o webhook Omie falhar, `PedidoLiberadoOmie` pode não refletir a etapa real. O botão "Atualizar" + `sincronizarLiberadosOmieRapido` resolve. A reconciliação agendada (`reconciliarEtapasAbertasOmie`) cobre o cenário de webhook persistentemente ausente.

2. **Consumo indevido (425):** o Omie bloqueia chamadas excessivas. O circuit breaker e o portão global protegem, mas qualquer falha no release do portão (processo morto sem chegar ao `finally`) pode travar todos os workers por até 160s (TTL do portão).

3. **NFs assíncronas:** a SEFAZ pode demorar para autorizar. O campo `nf_aguardando_autorizacao:true` sinaliza pedidos nesse estado. A função `atualizarStatusLogsPendentes` reconcilia periodicamente.

4. **Pedido sem espelho:** pedidos locais `modelo_nota:55, status:liberado` sem entrada no `PedidoLiberadoOmie` aparecem na Montagem mas **sem itens de produtos**. O fechamento é bloqueado até os itens serem preenchidos.

5. **Carga grande (>25 pedidos):** aviso no frontend, mas o processamento funciona normalmente — o auto-encadeamento divide em lotes de 8.

6. **Soltura manual vs. automação:** `solto_manualmente:true` é a blindagem fiscal mais crítica do módulo. Nenhuma automação pode reverter esse flag — só ação humana (colocar o pedido em nova carga).

---

*Fim do documento — gerado a partir da leitura direta do código-fonte em 2026-06-30.*