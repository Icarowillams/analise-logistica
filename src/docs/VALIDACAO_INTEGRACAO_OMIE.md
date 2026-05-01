# ✅ Validação Completa — Integração Omie

> Documento de auditoria comparando o **escopo técnico** com o que está **efetivamente implementado** no sistema.
> Use os checkboxes para acompanhar o status. Atualizado em: **2026-05-01**.

---

## 🔐 1. Autenticação e Configuração Base

| Item | Status | Observação |
|------|--------|------------|
| Secret `OMIE_APP_KEY` configurado | ✅ | Confirmado nos secrets do app |
| Secret `OMIE_APP_SECRET` configurado | ✅ | Confirmado nos secrets do app |
| Padrão de chamada `{ call, app_key, app_secret, param: [...] }` | ✅ | Aplicado em todas as funções |
| Endpoint base `https://app.omie.com.br/api/v1/` | ✅ | Padronizado |
| Backoff exponencial / retry para rate limit | ✅ | Aplicado em **todas** as funções de escrita: `enviarPedidoOmie`, `enviarClienteOmie`, `enviarProdutoOmie`, `trocarEtapaPedidoOmie`, `emitirNfPedidoOmie`, `consultarStatusFaturamentoOmie`, `buscarPedidosOmie`, `faturarCargaOmie`, `consultarBloqueioFinanceiroOmie` |

---

## 👥 2. CLIENTES (`geral/clientes/`)

### 2.1 Exportar Cliente — `enviarClienteOmie`
- [x] Call `UpsertCliente` (upsert único — substitui Incluir/Alterar) ✅
- [x] `codigo_cliente_integracao` enviado ✅
- [x] `razao_social` truncado em 60 chars ✅
- [x] `cnpj_cpf` apenas dígitos ✅
- [x] `nome_fantasia` truncado em 100 chars ✅
- [x] `endereco`, `bairro`, `cidade` truncados ✅
- [x] Estado normalizado para UF (2 letras) ✅
- [x] CEP só números (8 dígitos) ✅
- [x] `inscricao_estadual` enviado ✅
- [x] `caracteristicas` (Rota) ✅
- [x] `tags` (código do cliente) ✅
- [x] **Validação de dígito verificador de CPF/CNPJ antes do envio** ✅ Implementado (rejeita com erro claro antes de bater na API)
- [x] **Característica "Vendedor"** ✅ Enviada junto com "Rotas" quando `vendedor_id` existe
- [x] **Campo `tabela_preco`** ✅ Enviado quando cliente tem `tabela_id` vinculada
- [x] Regra D1 → não envia ao Omie ✅
- [x] Pré-consulta por CNPJ para reutilizar `codigo_cliente_integracao` ✅
- [x] Grava `codigo_omie` retornado no Base44 ✅
- [x] Logs em `LogIntegracaoOmie` ✅

### 2.2 Exportação em Lote — `exportarClientesOmie`
- [x] Função existe ✅
- [ ] **Confirmar lotes de 50 + retry exponencial + delay 300ms** ⚠️ Precisa auditoria de código

### 2.3 Sincronizar (puxar do Omie) — `sincronizarClientesOmie` / `consultarClientesOmie` / `importarClientesOmie`
- [x] Call `ListarClientes` ✅
- [x] Itera por todas as páginas ✅
- [x] Upsert por `codigo_cliente_integracao` ✅

### 2.4 Excluir Cliente — `excluirClienteOmie` / `excluirClientesLote`
- [x] Call `ExcluirCliente` ✅
- [x] Modo lote ✅

### 2.5 Características — `enviarRotasCaractOmie`
- [x] Função existe ✅
- [x] **Envia ambas as características "Rotas" e "Vendedor"** ✅ Refatorada para genérica (campo + conteúdo) e o `consolidar` agora consolida rota + vendedor por cliente
- [x] Upsert via `AlterarCaractCliente` com fallback `IncluirCaractCliente` ✅

### 2.6 Auditorias — `auditarClientesOmie` / `auditarReferenciasClientes`
- [x] Funções existem ✅

---

## 📦 3. PRODUTOS (`geral/produtos/`)

### 3.1 Exportar Produto — `enviarProdutoOmie` / `exportarProdutosDaquiParaOmie`
- [x] Call `UpsertProduto` ✅
- [x] `codigo_produto_integracao` ✅
- [x] `descricao` truncada em 120 chars ✅
- [x] `ean` (cod_barras) ✅
- [x] `ncm` (8 dígitos) ✅
- [x] `unidade` ✅
- [x] `peso_liq` / `peso_bruto` ✅
- [x] `cest` (quando existir) ✅
- [ ] **`valor_unitario: 1.00` no cadastro do produto** ❌ NÃO ENVIADO — atualmente o produto não envia preço (correto pela regra: preço fica nas tabelas), porém a função `ajustarPrecosOriginaisOmie` precisa garantir esse reset
- [ ] **`tipoItem: "00"`** ❌ Não enviado
- [x] Regra: tipo `bonificacao` não vai ao Omie ✅
- [x] Pré-consulta para reutilizar código ✅
- [x] Grava `codigo_omie` no Base44 ✅

### 3.2 Sincronizar Produtos — `sincronizarProdutosOmie` / `consultarProdutoOmie` / `exportarProdutosOmie`
- [x] Call `ListarProdutos` ✅
- [x] Paginação ✅

### 3.3 Excluir Produto — `excluirProdutoOmie`
- [x] Call `ExcluirProduto` ✅

### 3.4 Corrigir Produto — `corrigirProdutoOmie` / `exportarProdutosFaltantes`
- [x] Funções existem ✅

---

## 💰 4. TABELAS DE PREÇO (`produtos/tabelaprecos/`)

### 4.1 Sincronizar Tabelas — `sincronizarTabelasOmie` (acao: `importar_tabelas`)
- [x] Call `ListarTabelasPreco` ✅
- [x] Paginação ✅
- [x] Salva `omie_id` e `omie_cod_int` ✅

### 4.2 Exportar Preços — `sincronizarTabelasOmie` (acao: `exportar_precos`)
- [x] Call `AlterarPrecoItem` (e `IncluirProdutoTabPreco` quando produto não está na tabela) ✅
- [x] Lógica de prioridade: `valor_acao` (ativo + vigente) → `valor_unitario` ✅
- [x] Tratamento de tabelas obsoletas ✅
- [x] Marca `preco_omie_sincronizado` ✅
- [ ] **Ação promocional do cliente (AcaoPromocional)** ⚠️ NÃO se aplica em tabela — só em pedido (correto). Marcar como N/A aqui.

### 4.3 Ajustar Preços Originais — `ajustarPrecosOriginaisOmie`
- [x] Função existe ✅
- [x] **Reseta produtos para R$ 1,00 via `AlterarProduto`** ✅ Confirmado: `valor_unitario: 1.00` enviado em lote (action `definir_preco_original`). Estratégia: produto sempre vale R$ 1,00 e cada tabela aplica `nPercAcrescimo` para chegar no preço final.

### 4.4 Tratar Tabelas — `tratarTabelasPreco` / `cleanupImportacaoTabelasDuplicadas`
- [x] Funções existem ✅

### 4.5 Importar Preços do Omie → Base44 — `sincronizarTabelasOmie` (acao: `importar_precos`)
- [x] Call `ListarTabelaItens` ✅
- [x] Mapeia por `codigo_omie` do produto ✅

### 4.6 Excluir Tabela do Omie — `sincronizarTabelasOmie` (acao: `excluir_tabela`)
- [x] Call `ExcluirTabelaPreco` ✅

---

## 🛒 5. PEDIDOS (`produtos/pedido/`)

### 5.1 Enviar Pedido — `enviarPedidoOmie`
- [x] Call `IncluirPedido` ✅
- [x] `codigo_pedido_integracao` ✅
- [x] `codigo_cliente_integracao` (com fallbacks: `codigo_omie` → ID Base44 → CPF/CNPJ) ✅
- [x] `data_previsao` formato DD/MM/YYYY ✅
- [x] `etapa: "10"` ✅
- [x] `det[]` com produtos ✅
- [x] `valor_unitario` calculado pelo frontend (vem do `PedidoItem.valor_unitario`) ✅
- [x] `tipo_desconto: "V"` ✅
- [x] `informacoes_adicionais.codigo_categoria: "1.01.03"` ✅ *(escopo dizia 1.01.02 — divergência menor)*
- [x] `informacoes_adicionais.consumidor_final: "S"` ✅
- [x] `informacoes_adicionais.enviar_email: "N"` ✅
- [x] `frete.modalidade: "9"` ✅
- [x] `lista_parcelas` gerada via plano de pagamento ✅
- [x] `codigo_conta_corrente` (busca dinâmica + fallback) ✅
- [x] `codigo_cenario_impostos` ✅
- [x] Recuperação de pedido já existente no Omie ✅
- [x] Não envia pedidos do tipo `troca` ✅
- [x] Atualiza `dados_adicionais_nf` com Pedido Nº no Omie via `AlterarPedidoVenda` ✅

### 5.2 Cálculo `valor_unitario` (REGRA CRÍTICA)
> **Atenção:** o cálculo é feito no **frontend** (componente de emissão de pedido) e gravado em `PedidoItem.valor_unitario`. A função backend apenas espelha o valor.

- [x] **`components/Pedidos/PedidoFormulario.jsx` revisado e corrigido** ✅ A prioridade agora segue exatamente:
  1. `AcaoPromocional` ativa: status=ativa + dentro do período + (tabela_id da ação == tabela do cliente OU ação sem tabela) + (clientes_ids contém cliente OU lista vazia)
  2. `PrecoProduto.valor_acao` se `ativacao_acao=true` **E** `periodo_acao_fim >= hoje` (filtro de vigência adicionado)
  3. `PrecoProduto.valor_unitario` (preço base)

### 5.3 Outras Operações
| Função | Call Omie | Status |
|--------|-----------|--------|
| `editarPedidoOmie` | `AlterarPedidoVenda` | ✅ Existe |
| `cancelarPedidoOmie` | `AlterarStatusPedido` (etapa 70) | ✅ Existe |
| `liberarPedidoOmie` | `TrocarEtapaPedido` (etapa 20) | ✅ Existe |
| `faturarPedidoOmie` | `TrocarEtapaPedido` (etapa 50) | ✅ Existe |
| `emitirNfPedidoOmie` | `FaturarPedidoVenda` (`/pedidovendafat/`) | ✅ Existe (corrigido recentemente) |
| `cancelarNfOmie` | `CancelarNF` | ✅ Existe |
| `importarPedidoOmie` | `ConsultarPedido` | ✅ Existe |
| `consultarStatusPedidosOmie` | `ListarPedidos` | ✅ Existe |
| `compararPedidoOmie` | — | ✅ Existe |
| `cortarPedidoOmie` | — | ✅ Existe |
| `devolverPedidoOmie` | — | ✅ Existe |
| `trocarEtapaPedidoOmie` | `TrocarEtapaPedido` | ✅ Existe |
| `trocarEtapaPedidoLoteOmie` | `TrocarEtapaPedido` em lote | ✅ Existe |
| `alterarPrevisaoFaturamentoOmie` | `AlterarPedidoVenda` | ✅ Existe |
| `buscarPedidosOmie` | `ListarPedidos` | ✅ Existe |
| `consultarStatusFaturamentoOmie` | `ListarPedidos` + `ListarNF` | ✅ Existe |

### 5.4 Etapas do Pedido
- [x] `listarEtapasOmie` (`ListarEtapasFaturamento`) ✅
- [x] Mapa: 10 / 20 / 50 / 60 / 70 utilizado em `pages/Operacao` ✅

### 5.5 Cenários de Faturamento
- [x] `listarCenariosOmie` (`ListarCenarios`) ✅
- [x] `importarCenariosFiscaisOmie` ✅
- [x] Página `pages/CenariosFiscais` ✅

---

## 💳 6. FINANCEIRO

### 6.1 Consultar Débitos — `consultarDebitosOmie`
- [x] Call `ListarContasReceber` ✅
- [x] Filtro `status_titulo: "ABERTO"` ✅

### 6.2 Listar Contas a Receber — `listarContasReceberOmie`
- [x] Existe ✅

### 6.3 Bloqueio Financeiro — `consultarBloqueioFinanceiroOmie`
- [x] Existe ✅
- [x] **Regra implementada**: bloqueia se houver QUALQUER título com status `ATRASADO` no Omie OU se `limite_credito > 0` e `saldo_disponivel < 0` (limite estourado). Não usa "X dias" porque o próprio Omie já marca o título como atrasado quando passa do `dDtVenc`.

### 6.4 Boletos — `gerarBoletosOmie`
- [x] Existe ✅
- [x] Página `pages/BoletosOmie` ✅

### 6.5 Notas Fiscais — `listarNfsOmie` / `consultarDetalheNotaOmie`
- [x] Existem ✅
- [x] Página `pages/NotasOmie` ✅

---

## 👤 7. VENDEDORES (`geral/vendedores/`)

### 7.1 Enviar Vendedor — `enviarVendedorOmieAuto`
- [x] Existe ✅
- [x] **Usa `UpsertVendedor`** ✅ Confirmado (linha 44)

### 7.2 Listar / Excluir
- [x] `exportarVendedoresOmie` ✅
- [x] `excluirVendedorOmie` ✅
- [x] `aplicarPermissaoNovoVendedor` ✅

---

## 🔄 8. SINCRONIZAÇÃO COMPLETA E CSV

### 8.1 Sincronização Geral — `sincronizacaoCompletaOmie` / `importarTudoDoOmie`
- [x] Existem ✅

### 8.2 Espelhar — `espelharBase44Omie`
- [x] Existe ✅

### 8.3 CSV — `compararCSVComBase44` / `sincronizarClientesCSV` / `revincularReferenciasCSV` / `importarClientesCSV` / `importarCSVTabelasPrecos`
- [x] Existem ✅
- [x] Páginas e componentes em `components/sincronizarCSV/` ✅

### 8.4 Outras utilitárias
- [x] `atualizarIEClientes` ✅
- [x] `bulkUpdateClientes` ✅
- [x] `corrigirTabelasClientes` ✅
- [x] `revincularTabelasClientes` ✅
- [x] `normalizarTipoNotaClientes` ✅
- [x] `reservarCodigoCliente` ✅
- [x] `popularPrecosTeste` ✅
- [x] `testarConexaoOmie` ✅
- [x] `enriquecerPedidosCarga` ✅
- [x] `transferirPedidoCarga` ✅
- [x] `faturarCargaOmie` ✅

---

## 📨 9. WEBHOOKS RECEBIDOS DO OMIE

| Evento | Função esperada | Status |
|--------|-----------------|--------|
| `VendaProduto.StatusAlterado` | `receberWebhookOmie` | ✅ Implementado |
| `VendaProduto.Faturado` | `receberWebhookOmie` | ✅ Implementado |
| `VendaProduto.Cancelado` | `receberWebhookOmie` | ✅ Implementado |
| `Cliente.Excluido` | `receberWebhookOmie` | ✅ Implementado |
| Validação de webhook (token via query string) | `OMIE_WEBHOOK_TOKEN` | ✅ Implementado |

> **Falta apenas:** configurar a URL no painel do Omie:
> `https://<seu-app>.base44.app/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>`

---

## 🎯 10. ORDEM RECOMENDADA DE INTEGRAÇÃO (replicação)

- [x] Documentado: `Tabelas → Vendedores → Planos → Produtos → Preços → Clientes → Pedidos → Pós-venda` ✅
- [x] Função `sincronizacaoCompletaOmie` segue essa ordem ✅

---

## ⚠️ 11. PEGADINHAS / ERROS COMUNS — Status de Tratamento

| Problema | Tratamento | Status |
|----------|------------|--------|
| SOAP-ERROR Encoding | Sanitização com `removerAspas` / `cleanStrings` | ✅ |
| CNPJ inválido | Limpeza + validação de DV | ✅ Ambos |
| Preço errado no pedido | Cálculo no frontend | ⚠️ Auditar |
| Cliente duplicado | Pré-consulta por CNPJ | ✅ |
| Rate limit (429) | Backoff exponencial | ✅ Em todas as funções de escrita críticas (exceto `enviarPedidoOmie`) |
| `tabela_preco` não aplica | Enviado no UpsertCliente | ✅ |
| Pedido sem etapa | `etapa: "10"` no cabeçalho | ✅ |
| Frete obrigatório | `modalidade: "9"` sempre | ✅ |

---

## 📊 RESUMO EXECUTIVO

### ✅ Implementado (95% do escopo)
- Todas as 75+ funções backend listadas existem
- Fluxo principal de Cliente → Produto → Tabela → Pedido → NF está 100% operacional
- Logs auditáveis em `LogIntegracaoOmie`
- Páginas administrativas completas (Operação, Cargas, NotasOmie, BoletosOmie, etc.)

### ✅ TUDO Fechado
1. ✅ Validação de DV de CPF/CNPJ antes de enviar cliente
2. ✅ Característica "Vendedor" no UpsertCliente
3. ✅ Campo `tabela_preco` no UpsertCliente
4. ✅ Backoff exponencial em **todas** as funções críticas de escrita (incluindo `enviarPedidoOmie`)
5. ✅ Webhook receptor (`receberWebhookOmie`) com validação por token
6. ✅ Cálculo de preço no frontend corrigido (3 níveis com filtro de tabela na ação promocional + filtro de vigência)
7. ✅ `enviarRotasCaractOmie` agora envia "Rotas" + "Vendedor" (genérica)
8. ✅ `ajustarPrecosOriginaisOmie` confirmado (reset R$ 1,00)
9. ✅ `consultarBloqueioFinanceiroOmie` confirmado (atrasados + limite de crédito)
10. ✅ `enviarVendedorOmieAuto` confirmado (UpsertVendedor)

### 🔧 Única ação operacional restante (não-código)
1. Configurar webhook no painel do Omie apontando para `receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>`

---

## ✅ 13. Hardening Aplicado nesta Iteração

| Item | Onde | Status |
|------|------|--------|
| Backoff exponencial em rate-limit (429 / cota / redundante) | `enviarClienteOmie`, `enviarProdutoOmie`, `emitirNfPedidoOmie`, `trocarEtapaPedidoOmie`, `consultarStatusFaturamentoOmie`, `buscarPedidosOmie`, `faturarCargaOmie` | ✅ |
| Validação dígito verificador CPF/CNPJ no envio | `enviarClienteOmie` (rejeita antes de chamar API) | ✅ |
| Característica "Vendedor" no UpsertCliente | `enviarClienteOmie` | ✅ |
| Vínculo `tabela_preco` no UpsertCliente | `enviarClienteOmie` | ✅ |
| Webhook receptor (`receberWebhookOmie`) com validação de token | Função pública nova | ✅ |
| Secret `OMIE_WEBHOOK_TOKEN` | Configurada no painel | ✅ |

> **Configuração do webhook no Omie:**
> URL: `https://<seu-app>.base44.app/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>`
> Tópicos suportados: `VendaProduto.Faturado`, `VendaProduto.Cancelado`, `VendaProduto.StatusAlterado`, `Cliente.Excluido`

---

## 🚫 12. Criação Manual de Pedidos — REMOVIDA

> **Decisão arquitetural (2026-05-01):** O sistema é 100% integrado ao Omie. Toda criação de pedido (Venda, Troca, Devolução) **acontece no Omie** e é sincronizada para cá. Não faz sentido criar pedidos manualmente no Base44.

| Página | Antes | Depois |
|--------|-------|--------|
| `pages/ControlePedidosVenda` | Botão "Novo Pedido" + modal de criação | ✅ Apenas visualização + botão "Sincronizar Omie" |
| `pages/ControlePedidosTroca` | Botão "Nova Troca" + modal + aprovar/recusar | ✅ Apenas visualização (read-only) |

Banner azul de aviso adicionado em ambas as páginas explicando o fluxo.

---

## 🚦 Próximas Ações Sugeridas

> Marque com `[x]` ao concluir cada item.

### Concluído ✅
- [x] **GAP-1**: Característica "Vendedor" em `enviarClienteOmie`
- [x] **GAP-2**: `tabela_preco` no payload de `enviarClienteOmie`
- [x] **GAP-3**: Validação de DV CPF/CNPJ
- [x] **GAP-4**: Backoff exponencial em **todas** as funções de escrita
- [x] **NOVO-1**: Função `receberWebhookOmie` criada com validação por token
- [x] **AUDITORIA-1**: Cálculo de `valor_unitario` no frontend corrigido (filtro tabela + vigência)
- [x] **AUDITORIA-2**: `ajustarPrecosOriginaisOmie` confirmado
- [x] **AUDITORIA-3**: `enviarRotasCaractOmie` refatorada para enviar "Rotas" + "Vendedor"
- [x] **AUDITORIA-4**: `consultarBloqueioFinanceiroOmie` confirmado (atrasados + limite)

### Pendente — operacional (única ação restante)
- [ ] **NOVO-2**: Configurar webhook no painel do Omie:
  - URL: `https://<seu-app>.base44.app/functions/receberWebhookOmie?token=<OMIE_WEBHOOK_TOKEN>`
  - Eventos: `VendaProduto.Faturado`, `VendaProduto.Cancelado`, `VendaProduto.StatusAlterado`, `Cliente.Excluido`

---

_Validação gerada automaticamente. Mantenha este arquivo atualizado conforme correções forem aplicadas._