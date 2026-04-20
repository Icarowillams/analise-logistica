# 🚚 Roadmap de Migração — Logística Pão & Mel → Análise Comercial

**Data:** 2026-04-20  
**Objetivo:** Absorver integralmente o app de Logística Pão & Mel neste app (Análise Comercial), centralizando Comercial + Logística + Omie em um único ambiente.

---

## 📊 STATUS ATUAL (base)

✅ **Já existe aqui:**
- Integração Omie: Clientes, Produtos, Pedidos (envio/edição/cancelamento), Tabelas Preço, Cenários Fiscais, Etapas, Financeiro, Conta Corrente
- Campo `tipo_nota` (55/D1) normalizado em 100% dos 4.600 clientes
- 60+ funções backend Omie operacionais
- Dashboard de integração + logs de auditoria

⚠️ **Gaps principais:** Cargas, NFs/DANFE, Boletos, Devoluções, Acerto de Caixa, Webhooks bidirecionais com app externo.

---

## 🗺️ FASES DE MIGRAÇÃO

### **FASE 1 — Fundação (1-2 dias)** ⚡ Baixo risco
**Objetivo:** Preparar infra para os módulos logísticos.

| Item | Tipo | Detalhes |
|---|---|---|
| Secrets | config | `PAO_MEL_WEBHOOK_URL`, `PAO_MEL_API_KEY`, `ANALISE_COMERCIAL_API_KEY`, `BASE_REMOTE_API_KEY` |
| Entidade `Carga` | criar | Agrupa pedidos_omie[] + motorista + veículo + rota + status |
| Entidade `LogCorte` | criar | Auditoria de alterações de quantidade em pedidos |
| Entidade `Cancelamento` | criar | NFs canceladas + motivo |
| Entidade `Transferencia` | criar | NF movida entre cargas |
| Entidade `Retorno` | criar | Produtos devolvidos na entrega |
| Entidade `ParametroNaturezaOperacao` | criar | Cadastro CFOPs (não confundir com CenarioFiscal) |

**Entregável:** Schemas prontos + secrets configurados.

---

### **FASE 2 — Motor de Leitura Logística (2-3 dias)** 🔍
**Objetivo:** Ler pedidos do Omie por etapa (fluxo operacional).

| Função backend | Omie call | Uso |
|---|---|---|
| `buscarPedidosOmie` | `ListarPedidos` + enriquecimento | Lista etapa 50/60/70/80 com filtro data |
| `consultarDetalheNotaOmie` | `ConsultarNF` + `GetUrlDanfe` + `GetUrlNotaFiscal` | Detalhe + DANFE + XML |
| `listarNfsOmie` | `ListarNF` | Lista NFs emitidas (até 5 páginas/2 meses) |
| `buscarDocumentosLoteOmie` | `GetUrlDanfe` em lote | URLs em massa (3-5 paralelo) |
| `trocarEtapaPedidoOmie` | `AlterarPedidoVenda` | Só muda etapa |
| `desfazerCarregamentoOmie` | `AlterarPedidoVenda` | Volta etapa p/ 50 |

**Páginas:** `/NotasOmie` (lista+download)

**Entregável:** É possível consultar qualquer pedido/NF do Omie com UI.

---

### **FASE 3 — Montagem de Carga (3-4 dias)** 🚛
**Objetivo:** Fluxo operacional completo de carga.

| Item | Detalhes |
|---|---|
| Página `/MontagemCarga` | Busca pedidos etapa 50, agrupa por rota/cliente, atribui motorista+veículo |
| Página `/FaturamentoCarga` | Fatura lote + dispara boletos + notifica webhooks |
| PDFs | Resumo da Carga + Romaneio de Entrega (jspdf) |
| Entidade `Carga` | pedidos_omie[], motorista_id, veiculo_id, status_carga, valor_total |
| Webhook outbound | Notifica Pão & Mel em eventos |

**Entregável:** Operação logística diária 100% no app.

---

### **FASE 4 — Corte & Devolução (2 dias)** ✂️
**Objetivo:** Alterações de pedido pré/pós faturamento.

| Função backend | Omie call | Uso |
|---|---|---|
| `cortarPedidoOmie` | `ConsultarPedido` + `AlterarPedidoVenda` | Corte de item (recalcula parcelas) |
| `devolverPedidoOmie` | `DevolverPedido` | Devolução parcial/total (usa nCodProd interno!) |
| `cancelarNfOmie` + `cancelarNfAcerto` + `cancelarNfViaAnalise` | `CancelarPedidoVenda` | 3 contextos de cancelamento |
| `alterarPrevisaoFaturamento` | `AlterarPedidoVenda` | Só data_previsao |

**Páginas:** `/Corte`, `/DevolucaoNfe`, `/CancelarNfOmie`, `/AcertoCaixa`, `/TransferenciaNotas`

**Entregável:** Todo ajuste comercial pós-emissão é feito daqui.

---

### **FASE 5 — Financeiro Operacional (1-2 dias)** 💰
**Objetivo:** Boletos e títulos integrados ao fluxo.

| Função backend | Omie call | Uso |
|---|---|---|
| `gerarBoletosOmie` | `ListarContasReceber` + `GerarBoleto` | Lote (filtra LIQUIDADO/CANCELADO) |
| `consultarDocumentosFaturamentoOmie` | docs + contas a receber | Dossiê completo |

**Páginas:** `/BoletosOmie`, `/RelatorioCargas`

**Entregável:** Geração de boletos em lote + relatórios consolidados.

---

### **FASE 6 — Webhooks Bidirecionais (1 dia)** 🔗
**Objetivo:** App fica reativo a eventos externos.

| Endpoint | Tipo | Função |
|---|---|---|
| `POST webhookAnaliseComercial` | inbound | Recebe eventos do app externo (trocas, ajustes) |
| `notificarAppExterno` | outbound util | Dispara em corte/cancela/fatura |

**Entregável:** Integração viva entre os dois apps.

---

## ⚠️ REGRAS CRÍTICAS (MANTER SEMPRE)

1. **Rate limit Omie:** retry backoff (3s→6s→9s) em 429 / "cota" / "redundante" / "Aguarde"
2. **Delay em loop:** mínimo 1500ms entre chamadas
3. **Paralelismo:** máx 3-5 requests simultâneos
4. **Validação sucesso:** `cCodStatus === "0"`
5. **CNPJ:** sempre normalizar (só dígitos) antes de comparar
6. **DevolverPedido:** usa `nCodProd` (código interno Omie), NÃO `codigo_produto_integracao`
7. **Cliente:** nunca excluir no Omie ao excluir localmente
8. **Logs:** toda chamada Omie → `LogIntegracaoOmie`
9. **tipo_nota='D1':** NUNCA enviar ao Omie (bloqueio obrigatório no backend)

---

## 📐 ORDEM RECOMENDADA DE EXECUÇÃO

```
FASE 1 (fundação)  →  FASE 2 (leitura)  →  FASE 3 (carga)
                                                ↓
FASE 6 (webhooks)  ←  FASE 5 (financeiro)  ←  FASE 4 (ajustes)
```

**Total estimado:** 10-14 dias úteis de desenvolvimento executando em série.

---

## ✅ PRÓXIMO PASSO

Confirme qual **FASE** iniciar:
- `F1` → Fundação (entidades + secrets) — recomendado começar aqui
- `F2` → Motor de leitura (se já tem entidades)
- `F3` → Montagem de Carga (operacional diário)
- Pular para fase específica de urgência operacional

Ou peça ajustes no roadmap antes de executar.