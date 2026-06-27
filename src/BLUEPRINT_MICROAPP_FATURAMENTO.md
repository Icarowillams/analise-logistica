# 🏭 BLUEPRINT — Microaplicativo de FATURAMENTO & EXPEDIÇÃO (Pão & Mel + Omie)

> **Use este documento como PROMPT/ESPECIFICAÇÃO inicial de um NOVO app Base44.**
> Ele descreve um microaplicativo enxuto, extraído do ERP principal, focado **exclusivamente** no fluxo de saída: **Cargas → Faturamento → NF-e → Boletos → Romaneio → Acerto de Caixa (prestação de contas)**.
> A aba de **Pedidos** existe **apenas como exceção** — para resolver erros na montagem da carga.

---

## 0. CONTEXTO E OBJETIVO

O app principal é denso (140+ funções, 80+ entidades, módulos comercial, roteirização, metas, cobertura, etc.). A estratégia é **separar em microaplicativos**. Este é o microapp de **Faturamento/Logística**.

- **Banco de dados:** COMPARTILHADO com o app principal (mesmas Entidades Base44). O microapp lê/escreve nas MESMAS tabelas — **não** duplica dados. A separação é de **interface (UI) e escopo**, não de base.
- **Integração:** 100% **Omie ERP** (API v1) via funções de backend (Deno). Não usa OAuth connector — usa **App Key/Secret** via Secrets.
- **Princípio mestre:** Faturar é um **fluxo de estados assíncrono**, nunca um clique atômico. Tudo passa por **filas**, **circuit breaker** e um **portão único (mutex global)** para não estourar o rate limit da Omie.

### Escopo INCLUÍDO (só isto)
1. **Cargas** — montagem, edição, fechamento, status.
2. **Faturamento** — marca pedidos como "a faturar" (etapa Omie 50).
3. **Emissão de NF-e** — etapa 50 → 60 + número/chave da NF.
4. **Boletos** — geração e impressão.
5. **Romaneio / Relatórios de carregamento** — PDFs operacionais.
6. **Acerto de Caixa** — prestação de contas pós-entrega (etapa 70 = entregue).
7. **Pedidos (SÓ EXCEÇÃO)** — ajustes de emergência quando um pedido trava na montagem: soltar da carga, transferir entre cargas, cortar item, cancelar/devolver.

### Escopo EXCLUÍDO (fica no app Comercial)
- Criação de pedidos de venda pelo vendedor, app do vendedor.
- Metas, comissionamento, gamificação, scorecards.
- Roteirização inteligente, agendas, cobertura, visitas, promotores.
- Cadastros (cliente/produto/tabela de preço/vendedor) — no microapp são **leitura** apenas, quando necessário.
- Log gerencial global, dashboards comerciais.

---

## 1. RÉGUA DE ETAPAS OMIE (CONFIRMADO PELO SUPORTE OMIE 19/06)

Esta é a espinha dorsal de TODO o fluxo. Memorize:

| Etapa | Significado            | Quem move                                         |
|-------|------------------------|---------------------------------------------------|
| `10`  | Pedido de Venda        | Comercial (criação)                               |
| `20`  | Pedidos Liberados      | Liberação (envio ao Omie)                         |
| `50`  | Faturar (A Faturar)    | **Faturar Carga** (este microapp)                 |
| `60`  | Faturado               | **Emissão de NF-e** (este microapp)               |
| `70`  | Entrega / Entregue     | **Acerto de Caixa** (este microapp)               |
| `80`  | Cancelado              | Cancelamento                                      |

**Regras de ouro:**
- "Faturar carga" **NÃO emite NF** e **NÃO troca etapa no Omie** — é uma operação **local** que marca o pedido como pronto para emissão (`status_faturamento='pendente'`, `status='montagem'`). A NF é um passo manual separado.
- A etapa **60** só é atingida ao **emitir a NF** (endpoint `pedidovendafat` → `FaturarPedidoVenda`).
- A etapa **70** ("Entregue") só pelo **Acerto de Caixa**.
- `tipo_nota='D1'` / `modelo_nota='d1'` = **venda interna / troca SEM NF** — nunca vai ao Omie para emissão.
- **Blindagem fiscal:** `solto_manualmente=true` impede QUALQUER rotina automática de faturar/emitir aquele pedido.

---

## 2. SECRETS / VARIÁVEIS DE AMBIENTE (configurar no novo app)

| Secret                      | Uso                                                                 |
|-----------------------------|---------------------------------------------------------------------|
| `OMIE_APP_KEY`              | App Key da Omie (fonte de verdade — texto). Pré-disponível: `BASE44_APP_ID`. |
| `OMIE_APP_SECRET`           | App Secret da Omie. **Nunca** lido do banco em texto plano — sempre Secret. |
| `OMIE_WEBHOOK_TOKEN`        | Token na query string do endpoint de webhook (`?token=...`). Valida origem. |
| `FATURAMENTO_API_KEY`       | (Opcional) chave para endpoints internos de faturamento, se expostos. |
| `WEBHOOK_INDICADORES_TOKEN` | (Opcional) token de webhooks de indicadores — só se reaproveitar.   |

**Resolução de credenciais (ordem):** Secret `OMIE_APP_KEY`/`OMIE_APP_SECRET` → fallback entidade `ConfiguracaoOmie` (apenas se Secret ausente). Cache de 30s por isolate.

---

## 3. INTEGRAÇÃO OMIE — ENDPOINTS USADOS

Base: `https://app.omie.com.br/api/v1/`

| Domínio        | Endpoint                              | Métodos (`call`)                                      |
|----------------|---------------------------------------|-------------------------------------------------------|
| Pedido         | `produtos/pedido/`                    | `ConsultarPedido`, `AlterarPedidoVenda`, `TrocarEtapaPedido`, `ExcluirPedido`, `IncluirPedido` |
| Faturamento    | `produtos/pedidovendafat/`            | `FaturarPedidoVenda`, `ValidarPedidoVenda`            |
| NF-e           | `produtos/nfconsultar/` (consulta NF) | `ConsultarNF`, `ObterNfe` (PDF DANFE)                 |
| Contas Receber | `financas/contareceber/`              | `ListarContasReceber`                                 |
| Boleto         | `financas/contareceberboleto/`        | `GerarBoleto`                                         |

### Padrão de chamada (payload)
```json
{ "call": "ConsultarPedido", "app_key": "...", "app_secret": "...", "param": [ { /* params */ } ] }
```

### Cliente Omie centralizado — `functions/_shared/omieClient.ts`
Toda chamada DEVE passar por `omieCall(base44, endpoint, param, { call })`. Ele já implementa:
- **Credenciais** resolvidas (Secret → banco), cache 30s.
- **Circuit breaker** persistente (entidade `ControleCircuitBreakerOmie`, registro fixo).
- **Throttle global atômico** (reserva de slot, ~1 chamada / 1,5s para todo o app).
- **Throttle por método** (~3 req/s).
- **Fila sequencial** para métodos críticos de escrita (`FaturarPedidoVenda`, `IncluirPedido`, `CancelarNF`, `UpsertCliente`, ...) — Omie rejeita paralelismo.
- **Retry** exponencial (1s/2s/4s) para 429; tratamento de **CÓDIGO 6** ("consumo redundante, aguarde X s") e **MISUSE_API_PROCESS** ("consumo indevido", 425 → bloqueio 30 min).
- **Cache** (memória + entidade `CacheOmieConsulta`) só para leitura.
- **Log** automático em `LogIntegracaoOmie` + mascaramento de CPF/CNPJ (LGPD).

> **Não reescrever a lógica de resiliência.** Copie `omieClient.ts` como está para o novo app.

---

## 4. WEBHOOKS OMIE

### 4.1. Endpoint receptor — `functions/receberWebhookOmie`
URL a cadastrar no painel Omie:
```
https://app.base44.com/api/apps/<APP_ID>/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>
```
Características:
- **Ultra leve (<200ms):** valida token + app_key, sanitiza payload (Content-Type JSON, ≤50KB), responde 200 rápido.
- **Ping de validação:** payload sem `topic` → responde `{ ping: 'success' }` (o Omie exige isso ao cadastrar).
- **Idempotência:** dedup por `messageId` (consulta `LogIntegracaoOmie.webhook_message_id`).
- **Só enfileira:** grava log `pendente` e dispara `processarFilaWebhookOmie` (fire-and-forget). Nunca processa pesado no receiver.
- **Tópicos irrelevantes** (`Financas.`, `Produto.`, `Categoria`, ...) entram já como `ignorado`.

### 4.2. Tópicos relevantes a tratar
| Tópico                         | Ação                                                        |
|--------------------------------|-------------------------------------------------------------|
| `VendaProduto.EtapaAlterada`   | Atualiza etapa do espelho/pedido local                      |
| `VendaProduto.Faturada`        | Marca faturado, grava nº NF / chave                         |
| `VendaProduto.Cancelada`       | Marca cancelado (`status=cancelado` / `_pos_faturamento`)   |
| `NFe.NotaAutorizada`           | Grava número/chave da NF quando autorização é assíncrona    |
| `NFe.NotaDenegada/Rejeitada`   | Marca rejeição                                              |

### 4.3. Worker de fila de webhook — `functions/processarFilaWebhookOmie`
Consome `LogIntegracaoOmie` pendentes **UM por vez** (sequencial), com throttle global e lock de instância única. Dedup por `messageId` e por `codIntPedido+etapa`. **Blindagem fiscal:** nunca sobrescreve status verificado.

> **Automação:** criar uma automação **scheduled** (a cada ~5 min) chamando `processarFilaWebhookOmie` como rede de segurança, além do disparo por webhook.

---

## 5. CONTROLE DE CONCORRÊNCIA — PORTÃO ÚNICO + CIRCUIT BREAKER

Reutiliza a entidade `ControleCircuitBreakerOmie` para 3 papéis (por `chave`):

1. **Circuit breaker** (registro de ID fixo `6a1e06a9aa62ceab7b3b6d97`): `bloqueado`, `bloqueado_ate`, `erros_consecutivos`, `threshold_erros`. Abre após N erros 425/MISUSE; auto-desbloqueia ao expirar `bloqueado_ate`.
2. **Rate limit global** (`chave='rate_limit_global'`): reserva de slot atômica (1 chamada / 1,5s global).
3. **Portão único** (`chave='portao_global_omie'`) — `functions/_shared/portaoOmie`:
   - `adquirirPortao(base44, nome)` → mutex **marca-e-confirma** (TTL 5 min auto-release).
   - `liberarPortao(base44, donoId)` → só libera se ainda for o dono.
   - `temTrabalhoOperacaoPendente(base44)` → rotinas de LEITURA cedem a vez se há Fila Envio/Carga pendente.

**Ordem de prioridade ao tocar o Omie:**
1. Verifica **circuit breaker** (se bloqueado → aborta cedo, sem tocar o Omie).
2. **Operação** (Fila Envio, Fila Carga) adquire o portão direto.
3. **Leitura/limpeza** (reconciliações, correção de espelho) cede a vez quando há operação pendente.

> **Automação:** `desbloqueioAutomaticoOmie` (scheduled ~5 min) reseta breakers expirados e libera locks órfãos.

---

## 6. ENTIDADES (esquemas a recriar no novo app)

> Recriar como JSON Schema idêntico. Abaixo, os campos-chave de cada uma. **Built-in** (não declarar): `id`, `created_date`, `updated_date`, `created_by_id`.

### 6.1. `Carga` — container principal da expedição
Campos essenciais: `numero_carga`, `data_carga`, `data_faturamento`, `motorista_id/nome`, `veiculo_id/placa`, `ajudante_id/nome`, `checkin_saida{latitude,longitude,precisao,capturado_em}`.
- `pedidos_omie[]` — pedidos da Omie (NF-e 55): `{codigo_pedido, codigo_pedido_integracao, numero_pedido, numero_nf, codigo_cliente, cnpj_cpf_cliente, nome_cliente, nome_fantasia, cidade, etapa, tipo_nota, valor_total_pedido, rota_cliente, produtos[]}`.
- `pedidos_internos[]` — D1/bonificação (sem NF): `{pedido_id, numero_pedido, modelo_nota, cliente_id, nome_cliente, valor_total_pedido, produtos[]}`.
- `pedidos_troca[]` — trocas (sem NF).
- `notas_fiscais[]`, `produtos_resumo[]`, `quantidade_pedidos/clientes/total_pacotes`, `valor_total`, `peso_total_kg`, `volume_total_m3`.
- `status_carga`: `montagem` | `faturada` | `entregue` (status LOCAL binário).
- `processamento_omie_status`: `nao_iniciado` | `em_andamento` | `concluido` | `parcial` | `erro` (status da `FilaCargaOmie`).
- `pdf_resumo_url`, `pdf_romaneio_url`, `observacao(es)`.

### 6.2. `Pedido` — documento mestre
Campos-chave de faturamento: `numero_pedido`, `status` (`pendente|enviado|liberado|montagem|faturado|cancelado|cancelado_pos_faturamento`), `status_faturamento` (`pendente|processando|faturado|rejeitado|erro`), `etapa`, `modelo_nota` (`55|nfce|d1`), `faturado`, `data_faturamento`.
- `omie_codigo_pedido` (nCodPed), `numero_nota_fiscal`, `chave_nfe`, `omie_id_nf` (nIdNF), `nf_aguardando_autorizacao`.
- Blindagem: `solto_manualmente`, `data_solto`, `pendente_emissao`, `motivo_pendencia_emissao`.
- Vínculos: `cliente_id/nome/cpf_cnpj`, `carga_id`, `numero_carga`, `carga_faturamento_numero` (imutável — preserva a carga que gerou a NF).
- `tipo` (`venda|troca|bonificacao|devolucao`).

### 6.3. `FilaCargaOmie` — fila de faturamento da carga (1 registro/pedido)
`carga_id`, `numero_carga`, `pedido_id`, `codigo_pedido_omie`, `codigo_pedido_integracao`, `numero_pedido`, `data_previsao`, `operacao` (`faturar|emitir_nf|ambos`), `etapa_destino` (default `50`), `status` (`pendente|processando|concluido|erro|aguardando_acao_humana`), `tentativas`, `tentativas_redundante`, `tentativas_revalidacao`, `proxima_tentativa_em`, `processando_em`, `erro_log`, `processado_em`.
> `aguardando_acao_humana` = pedido em etapa < 50 que não avançou após N revalidações — **sai do loop automático** (não martela o Omie); volta só por ação humana ou webhook. **Não é erro vermelho.**

### 6.4. `FilaEnvioPedidoOmie` — fila de envio de pedido local → Omie
`pedido_id`, `status` (`pendente|processando|concluido|erro`), `tentativas`, `proxima_tentativa_em`, `processando_em`, `erro_log`. (Operação prioritária no portão.)

### 6.5. `FilaBoletoOmie` — fila de geração de boletos
Análoga: por pedido/título, `status`, `tentativas`, `erro_log`.

### 6.6. `FilaEmissaoNF` — fila de emissão de NF em lote
Por pedido, com `lote_id`, `status`, controle de retomada.

### 6.7. `LogEmissaoNF` — auditoria de cada emissão de NF (1 linha/pedido)
`codigo_pedido` (nCodPed), `numero_pedido`, `numero_nf`, `nid_nf` (nIdNF, cache p/ impressão instantânea), `chave_nfe`, `cliente_id/nome`, `carga_id`, `numero_carga`, `lote_id`, `status` (`autorizada|rejeitada|pendente|erro|bloqueado_cliente`), `codigo_sefaz` (cStat), `mensagem`, `faultstring/faultcode`, `erro_tipo` (`omie|interno|sefaz`), `boleto_gerado`, `tentativas_reconsulta`, `usuario_email/nome`.
> `bloqueado_cliente` = erro TERMINAL (cliente bloqueado para faturar no Omie) — não retentar até desbloquear o cadastro.

### 6.8. `LogEmissaoBoleto` — auditoria/cache de boletos (1 linha/codigo_lancamento)
`codigo_lancamento`, `numero_pedido`, `numero_nf`, `numero_parcela`, `numero_boleto`, `numero_bancario`, `codigo_barras`, `linha_digitavel`, `link_boleto`, `valor`, `data_emissao_boleto`, `data_vencimento`, `cliente_nome/id`, `numero_carga`, `carga_id`, `lote_id`, `status`, `usuario_email/nome`. (Write-through: próxima abertura da carga vem do local, sem consultar Omie.)

### 6.9. `LogIntegracaoOmie` — auditoria de TODA chamada Omie + fila de webhook
`endpoint`, `call`, `operacao`, `entidade_tipo/id`, `status` (`sucesso|erro|erro_omie|warning|pendente|processado|ignorado`), `codigo_erro`, `mensagem_erro`, `erro_detalhado`, `payload_enviado/resposta`, `duracao_ms`, `tentativas`, `usuario_email`, `webhook_topic`, `webhook_message_id`, `webhook_processado_em`. (Também serve de FILA de webhooks via `status='pendente'`.)

### 6.10. `ControleCircuitBreakerOmie` — concorrência (RLS: admin)
`chave` (`principal`|`rate_limit_global`|`portao_global_omie`), `bloqueado`, `bloqueado_ate`, `ultimo_erro`, `atualizado_em`, `erros_consecutivos`, `threshold_erros` (default 3), `worker_rodando`, `worker_lock_ate`.

### 6.11. `CacheOmieConsulta` — cache persistente de leituras
`chave`, `valor`, `tipo`, `expira_em`, `criado_em`.

### 6.12. `ConfiguracaoOmie` — config (fallback de credenciais)
`nome`, `app_key`, `app_secret_mascara`, `secret_em_secrets`, `ativo`. (Secret real nos Secrets, não aqui.)

### 6.13. `Retorno` — devolução/troca/recusa pós-entrega (alimenta Acerto)
`carga_id/numero`, `pedido_codigo_omie`, `numero_pedido/nf`, `cliente_id/nome`, `data_retorno`, `produtos[]`, `tipo_retorno` (`devolucao_total|devolucao_parcial|troca|recusa_cliente|nao_entregue|avaria`), `valor_total_retorno`, `status` (`pendente|processado|devolvido_omie|cancelado`), `motorista_id/nome`.

### 6.14. `AcertoCaixa` — prestação de contas (recriar schema do app principal)
Fechamento financeiro da carga pós-entrega: valores entregues, devolvidos, recebidos, divergências. (Ver `entities/AcertoCaixa.json` do app original.)

### 6.15. Apoio / leitura
`Cliente`, `Produto`, `Vendedor` (motoristas/ajudantes), `Veiculo`, `Motorista`, `Rota`, `ModalidadePagamento`, `PlanoPagamento`, `PedidoItem`, `PedidoLiberadoOmie` (espelho), `ContadorCarga`, `LogGerencial` (auditoria de ações sensíveis), `RateLimitWebhook`.

---

## 7. FUNÇÕES DE BACKEND (Deno) — recriar/copiar

### 7.1. Compartilhadas (copiar idênticas)
- `_shared/omieClient.ts` — cliente Omie central (resiliência completa).
- `_shared/portaoOmie` — mutex global + prioridade.
- `_shared/constantes` — `ETAPAS_OMIE`, `ETAPA_FATURADO=60`, `ETAPA_ENTREGUE=70`, `CONTA_CORRENTE_PADRAO`, `STATUS_ABERTOS_BOLETOS`, `DELAY_PADRAO_RETRY`.

### 7.2. Faturamento & Emissão
- `faturarCargaOmie` — marca carga/pedidos como faturados **localmente** (etapa 50, sem tocar Omie). Enriquece CNPJ/nome best-effort. Bloqueia D1. Verifica breaker antes.
- `faturarPedidoOmie` — fatura 1 pedido.
- `emitirNfPedidoOmie` — emite NF de 1 pedido (`pedidovendafat` → `FaturarPedidoVenda`); grava nNF/chave/nIdNF ou marca `nf_aguardando_autorizacao`; idempotente; trata recusa Omie (cliente bloqueado).
- `emitirNfsLoteOmie` / `processarEmissaoNFLote` / `retomarEmissaoNFLotePendente` — emissão em lote com `lote_id`, sequencial.
- `reemitirNfPresasEtapa50` — reemite NFs presas (etapa 50 que não avançaram).
- `trocarEtapaPedidoOmie`, `alterarPrevisaoFaturamentoOmie`, `liberarPedidoOmie`.

### 7.3. Filas (workers) — todos com portão + breaker
- `processarFilaCargaOmie` — fatura carga assíncrono (troca etapa 50 + previsão), anti-órfão, auto-encadeamento.
- `processarFilaEnvioPedidoOmie` — envia pedidos locais → Omie.
- `processarFilaBoletoOmie` — gera boletos em fila.
- `processarFilaWebhookOmie` — consome webhooks pendentes (sequencial).
- `reenviarItemFilaCarga`, `reenfileirarPedidosOrfaos`, `limparFilaEnvioConcluidos`.

### 7.4. Boletos
- `gerarBoletosOmie` — gera/recupera boletos por título (`GerarBoleto`), sequencial (anti-8020), write-through `LogEmissaoBoleto`. `origem='auto'` = chamada interna (service role); `origem='manual'` = exige usuário.
- `gerarBoletosFaltantesPrazo`, `baixarPdfBoletoOmie`, `listarContasReceberOmie`, `dadosClienteNfBoletos`, `salvarBoletosLocais`.

### 7.5. NF — consulta/PDF/reconciliação
- `consultarDetalheNotaOmie`, `listarNfsOmie`, `baixarPdfDanfeOmie` (DANFE base64), `reconsultarStatusNFsPendentes`, `reconciliarNfAguardandoAutorizacao`, `reconciliarNfsCanceladasOmie`, `preencherDadosNFLogs`, `prepararNidNfCarga`, `cancelarNfOmie`, `cancelarNfAcerto`.

### 7.6. Webhook
- `receberWebhookOmie` — receiver leve (ver §4).
- `processarWebhookOmie` — handlers por tópico (pedido/NFe/financeiro).

### 7.7. Cargas — ajustes/exceção de pedidos
- `soltarCarga`, `transferirPedidoCarga`, `cortarPedidoOmie`, `devolverPedidoOmie`, `cancelarPedidoOmie`, `editarPedidoOmie`, `duplicarPedidoOmie`.
- `revalidarCargaOmie`, `reconciliarEspelhoCargaCompleto`, `enriquecerPedidosCarga`, `repararProdutosCarga`, `indiceCargasPorPedido`, `sincronizarStatusCargasOmie`, `corrigirStatusCargas`.

### 7.8. Acerto de Caixa & Relatórios
- `sincronizarAcertoOmie`, `relatorioAnaliticoCarregamento`, `exportarFaturamentoDia`.

### 7.9. Reconciliação / Saúde (scheduled)
- `reconciliarEtapasAbertasOmie`, `reconciliarStatusPedidosOmie`, `sincronizarStatusPedidosOmie`, `sincronizarLiberadosOmieRapido`, `corrigirEspelho20Falso`, `desbloqueioAutomaticoOmie`, `limparCacheExpiradoOmie`, `statusCircuitBreakerOmie`, `testarConexaoOmie`.

---

## 8. AUTOMAÇÕES (scheduled) a criar no novo app

| Automação                       | Frequência     | Função                          |
|---------------------------------|----------------|---------------------------------|
| Worker fila de carga            | ~5 min         | `processarFilaCargaOmie`        |
| Worker fila de envio            | ~5 min         | `processarFilaEnvioPedidoOmie`  |
| Worker fila de webhook (backup) | ~5 min         | `processarFilaWebhookOmie`      |
| Worker fila de boleto           | ~5 min         | `processarFilaBoletoOmie`       |
| Desbloqueio automático breaker  | ~5 min         | `desbloqueioAutomaticoOmie`     |
| Reconciliar etapas abertas      | ~15-30 min     | `reconciliarEtapasAbertasOmie`  |
| Reconsultar NFs pendentes       | ~15 min        | `reconsultarStatusNFsPendentes` |
| Limpar cache expirado           | 1x/dia         | `limparCacheExpiradoOmie`       |

---

## 9. PÁGINAS / UI (recriar do app principal)

Layout: sidebar enxuta com **2 grupos apenas**.

### Grupo 1 — LOGÍSTICA (principal)
- `MontagemCarga` — montar carga (clientes por rota, produtos consolidados, fechar carga). Componentes: `CargasEmMontagem`, `PedidosPorRota`, `PainelFecharCarga`, `ProdutosConsolidados`, `StatsCardsMontagem`, `useDadosMontagem`.
- `Cargas` — lista/gestão de cargas, status processamento Omie, documentos (romaneio, lista de carregamento, nota D1), editar/soltar/transferir.
- `NotasOmie` — abas: Emissão (50→60), NF-55, D1, Log de Emissão de NF, reemitir presas. Alerta de pendências de emissão.
- `BoletosOmie` — consulta + emissão + impressão de boletos; títulos por carga.
- `AcertoCaixa` (+ `AcertoCaixaEditar`, `AcertoResumoPDF`) — prestação de contas.
- `RelatorioCarregamento` — relatório analítico de carregamento (PDF).
- `IntegracaoOmieDashboard` — saúde da integração, breaker, fila, usuários ativos (admin).

### Grupo 2 — PEDIDOS (SÓ EXCEÇÃO)
- `AjustesPedidos` — abas: Corte, Cancelamento, Transferência, Devolução. **Só para destravar carga.**
- Listagem mínima de pedidos com erro de montagem (filtro por `status_faturamento='erro'` / `pendente_emissao=true` / divergência de etapa). Sem criação de pedido.

### Componentes de documento (PDF) a portar
`components/cargas/documentos/`: `DocumentosCargaModal`, `RomaneioEntregaPdf`, `ListaCarregamentoPdf`, `NotaD1Pdf`, `printHelper`.
Impressão de NF/boleto: `NfsImpressaoDialog`, `NfCompletaDialog`, `BoletosImpressaoDialog`.

### Indicador global
`StatusOmieIndicator` na sidebar — mostra breaker bloqueado/livre, fila pendente.

---

## 10. FLUXO COMPLETO (end-to-end)

```
[Comercial cria pedido] → etapa 10
        ↓ (liberação / envio)
[FilaEnvioPedidoOmie] → IncluirPedido → etapa 20 (Liberado)   ← espelho PedidoLiberadoOmie
        ↓ (MONTAGEM DE CARGA — este app)
[Carga: montagem] → adiciona pedidos_omie / internos / troca
        ↓ (FATURAR CARGA — faturarCargaOmie, LOCAL)
status_carga=faturada; Pedido.status=montagem, status_faturamento=pendente
[FilaCargaOmie] (worker) → TrocarEtapaPedido 50 + previsão de faturamento → etapa 50
        ↓ (EMISSÃO NF — NotasOmie → emitirNfPedidoOmie)
FaturarPedidoVenda → etapa 60 (Faturado) + nNF/chave/nIdNF → LogEmissaoNF=autorizada
   (autorização assíncrona? nf_aguardando_autorizacao=true → webhook NFe.NotaAutorizada grava nº)
        ↓ (BOLETOS — gerarBoletosOmie)
ListarContasReceber → GerarBoleto → LogEmissaoBoleto (write-through)
        ↓ (ROMANEIO / LISTA DE CARREGAMENTO — PDFs)
        ↓ (ENTREGA + ACERTO DE CAIXA)
Acerto → etapa 70 (Entregue); Retorno[] para devoluções/trocas/recusas
```

**Webhooks** atualizam etapas/NF em paralelo a tudo isso (rede de segurança + tempo real).

---

## 11. INVARIANTES / REGRAS QUE NÃO PODEM QUEBRAR

1. `numero_nf` preenchido **NUNCA** é apagado (regra imutável).
2. `carga_faturamento_numero` é **imutável** após gravado (preserva a carga que gerou a NF mesmo após transferência).
3. `solto_manualmente=true` → nenhuma rotina automática fatura/emite.
4. D1 (`modelo_nota='d1'`/`tipo_nota='D1'`) → nunca emite NF no Omie.
5. Reemissão bloqueada se pedido já tem `numero_nota_fiscal` / `faturado` / `status_faturamento='faturado'`.
6. Toda chamada Omie passa por `omieCall` (breaker + throttle + log). **Nunca** chamar `fetch` direto ao Omie fora dele.
7. Erros de escrita Omie nunca são `try/catch` silenciosos que escondem falha fiscal — sempre logam em `LogIntegracaoOmie` / `LogEmissaoNF`.
8. Idempotência por `omie_codigo_pedido` (pedido), `messageId` (webhook), `codigo_lancamento` (boleto), `nid_nf` (NF).

---

## 12. CHECKLIST DE BOOTSTRAP DO NOVO APP

- [ ] Configurar Secrets: `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_WEBHOOK_TOKEN`.
- [ ] Recriar entidades da §6 (mesmos schemas do app original).
- [ ] Copiar `_shared/omieClient.ts`, `_shared/portaoOmie`, `_shared/constantes`.
- [ ] Copiar funções das §7.2 a §7.9.
- [ ] Recriar páginas da §9 (2 grupos: Logística + Pedidos-exceção).
- [ ] Criar automações da §8.
- [ ] Cadastrar a URL de webhook no painel Omie (§4.1) e testar o ping.
- [ ] Testar o fluxo §10 em uma carga real pequena (1-2 pedidos).
- [ ] Validar circuit breaker / portão (operação não roda em paralelo; breaker bloqueado aborta cedo).

---

> **Resumo de uma frase:** este microapp é a "fábrica de saída" — pega pedidos já liberados (etapa 20), monta cargas, fatura (50), emite NF (60), gera boletos, imprime romaneios e fecha o acerto (70) — tudo serializado por um portão único contra o rate limit da Omie, com os Pedidos aparecendo só para destravar erros de carga.