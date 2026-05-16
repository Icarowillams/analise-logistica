# 📋 Checklist de Pendências Operacionais — Pão & Mel × Omie

> **Documento vivo.** Toda vez que houver uma nova sessão de trabalho, este arquivo
> deve ser RELIDO INTEIRO antes de qualquer alteração. Marcar progresso com:
> - 🔴 Não iniciado
> - 🟡 Em andamento / parcial
> - 🟢 Concluído e validado em produção
> - ⚪ Bloqueado (depende de decisão externa)

Última revisão: **2026-05-16**

---

## 1. 🟢 Boleto NÃO está sendo gerado ao emitir NF-e — CONCLUÍDO 2026-05-16

**Causa raiz identificada em `functions/gerarBoletosAutoPedidos.js`:**

A função `listarTitulosDoPedido` tinha um bug crítico no loop de paginação (linha 56):
```js
if (titulos.length > 0 || pagina >= ...) break;  // ❌ ERRADO
```
Esse `break` parava a varredura assim que UMA página tivesse algum título — mas se a página 1 retornasse 100 títulos não-relacionados ao pedido, o filtro vinha vazio e o loop saía sem testar as páginas seguintes. Resultado: títulos novos (recém-criados pela emissão da NF) **nunca eram encontrados** porque costumam estar nas páginas 2+ (ordenação por código).

**Correção aplicada:**
- Loop refeito com `do...while` que varre **todas** as páginas (até 15) até cobrir `total_de_paginas`.
- Janela reduzida de 60 → 30 dias (suficiente, mais rápido).
- 300ms de respiro entre páginas para preservar cota Omie.

**Fluxos cobertos:**
1. Emissão dentro da janela de 20s (em `emitirNfsLoteOmie`) → boleto disparado imediato (já funcionava).
2. Emissão fora da janela (webhook `NFe.NotaAutorizada`) → `processarWebhookOmie.handleNFe` chama `gerarBoletoAuto` (já funcionava).
3. Webhook NÃO chega → `atualizarStatusLogsPendentes` (rodando a cada 15min, ver item 2) descobre que ficou autorizada e dispara o boleto.

---

## 2. 🟢 Log de Transmissão fica como "Pendente" mesmo SEFAZ tendo respondido — CONCLUÍDO 2026-05-16

**Correções aplicadas:**

1. **`functions/atualizarStatusLogsPendentes.js`** já consultava ativamente o Omie (`ConsultarPedido` + `ListarNF` com índice) e atualizava `LogEmissaoNF`, mas só rodava sob demanda (botão "Atualizar" na tela). Agora **rodando automaticamente a cada 15 minutos** via automação agendada `Reconciliar Logs NF Pendentes (15min)`.

2. **Permitida execução pelo agendador (sem usuário autenticado)**: adicionado bypass que aceita `body.scheduled === true` e cria contexto `sistema@automation` para gravar logs corretamente.

3. **Boletos automáticos integrados ao fluxo de reconciliação**: quando o varredor detecta que uma NF pendente virou `autorizada`, ele já chama `gerarBoletosAutoPedidos` (caso o cliente tenha modalidade BOLETO BANCÁRIO).

**Resultado prático:** mesmo se o webhook nunca chegar, no máximo **15 minutos** após a emissão o log é reconciliado, status atualizado e boleto disparado.

**Sintoma original:** log eternamente "pendente" sem mostrar autorizada/rejeitada — webhook intermitente ou faultstring transitório do Omie deixava o estado preso.

---

## 3. 🟡 Bonificação não emite NF — CFOP não configurado no Omie — ALERTA VISUAL APLICADO 2026-05-16

**Sintoma:** pedidos com cenário fiscal de **bonificação** não foram faturados
ontem porque o CFOP no Omie está sem configuração correta.

**O que foi feito (lado Base44):**
- `components/Pedidos/PedidoFormulario.jsx` agora exibe um **alerta amarelo dedicado** sempre que o usuário seleciona um cenário fiscal local com `tipo_operacao = 'bonificacao'` (Nota 55), lembrando de validar no Omie se o CFOP é **5910** (interno) ou **6910** (interestadual).
- Mostra também o nome do cenário Omie vinculado (quando existe) pra facilitar a conferência.

**Pendente (lado Omie — ação manual do cliente):**
- Validar no Omie a aba **Tributação** do cenário fiscal vinculado a "Bonificação" e garantir CFOP 5910/6910.
- Não há como ler o CFOP via API pública do Omie de forma confiável; portanto não há validação programática — só alerta preventivo.

**Após o cliente corrigir o CFOP no Omie, marcar como 🟢.**

---

## 4. 🟢 Notas rejeitadas/canceladas no Omie aparecem como emitidas na rotina de NF-e — CONCLUÍDO 2026-05-16

**Verificações + correções aplicadas:**

1. **Frontend NF-55 (`NotasNF55Tab.jsx` linha 112)** já filtra `cStatus === 'autorizada'` antes de exibir. Notas canceladas/denegadas/rejeitadas/pendentes não aparecem na aba. ✅

2. **`listarNfsOmie.derivarStatus`** já prioriza `cStat` da SEFAZ (100/135 → autorizada; 101 → cancelada; 102 → inutilizada; 110/301/302 → denegada; demais → rejeitada). ✅

3. **`processarWebhookOmie` `NFe.NotaCancelada` e `VendaProduto.Cancelada/Excluida`** já marcam `Pedido.status='cancelado'`, gravam `data_cancelamento` + `motivo_cancelamento` e propagam para a Carga via `atualizarPedidoNaCarga`. ✅

4. **NOVO: `functions/reconciliarNfsCanceladasOmie.js`** — fallback para o caso de webhook NÃO chegar. Varre `ListarNF` dos últimos N dias (default 7) e, para cada NF com `cStat` ≠ autorizada, marca `Pedido.status='cancelado'` e ajusta `LogEmissaoNF` correspondente.

5. **NOVO: automação agendada "Reconciliação NFs Canceladas Omie (diária)"** rodando todo dia às 03:00 (America/Recife) com janela de 7 dias. Garante consistência mesmo se a rede do Omie deixar de entregar algum webhook.

**Sintoma original:** notas canceladas/rejeitadas no Omie continuavam aparecendo como emitidas no Base44.

---

## 5. 🔴 Excluir funcionalidades de sincronização desnecessárias

**Sintoma:** menu/sistema poluídos com sincronizações redundantes.

**Avaliar para remover:**
- `pages/SincronizarClientesCSVPage` — mantém? CSV é caso raro.
- `pages/SincronizarClienteOmie` — duplicado?
- `functions/sincronizacaoCompletaOmie` — usada hoje?
- `functions/importarTudoDoOmie` — usada hoje?
- `functions/espelharBase44Omie` — usada hoje?
- `functions/sincronizarClientesCSV`, `validarClientesCsv`, `validarClientesXlsx`

**Definição:** o usuário precisa listar quais ele USA. Antes de deletar nada,
listar tudo e perguntar item por item.

---

## 6. 🔴 Mapear escopo de permissões para cobrir TODAS as funcionalidades

**Necessidade:** atualmente as permissões cobrem apenas algumas áreas (cadastros,
metas, importar, análises, visitas, visita comercial, relatórios, pedidos).
Precisa cobrir TUDO: Logística (cargas, NF, boletos, acerto), Roteiros, Gerenciamento.

**Plano:**
1. Listar todas as páginas do sistema e cada ação principal por página
2. Mapear cada ação para uma permissão granular
3. Adicionar grupos faltantes ao schema `Permissao`
4. Atualizar página `Permissoes` para exibir todos os grupos novos
5. Aplicar os `canAcao()` em cada botão/operação

**Áreas faltantes detectadas:**
- Logística: emitir NF, cancelar NF, gerar boleto, faturar carga, transferir carga, acerto de caixa, ajustes (corte/transferência/devolução/cancelamento)
- Roteiros de Campo: gestor, painel, edição massiva
- Gerenciamento: log gerencial (já tem implícito via `isAdmin`)
- Notas Fiscais Omie: emissão, impressão, log

---

## 7. 🟢 Rotina de bloqueio financeiro por cliente — CONCLUÍDO 2026-05-16

**Correções aplicadas:**

1. **Backend já filtrava por cliente.** Tanto `consultarDebitosOmie` quanto `consultarBloqueioFinanceiroOmie` já usam `cCPFCNPJCliente` no `PesquisarLancamentos`, retornando só os débitos do cliente consultado. O `consultarBloqueioFinanceiroOmie` ainda calcula `deve_bloquear` consolidado (atrasados OU saldo negativo de limite de crédito).

2. **Bloqueio automático aplicado no `Cliente` Base44.** `components/Pedidos/DebitosClienteModal.jsx` foi reformulado para:
   - Chamar `consultarBloqueioFinanceiroOmie` (em vez de `consultarDebitosOmie`).
   - **Quando `deve_bloquear=true`:** grava `Cliente.bloquear_faturamento=true` e `Cliente.motivo_bloqueio="Débito em aberto: <descrição>"` automaticamente.
   - **Quando `deve_bloquear=false` e o bloqueio anterior era automático** (motivo começa com "Débito em aberto"): limpa o bloqueio.
   - **Bloqueios manuais (motivo livre)** são preservados — só admin/operador desbloqueia.

3. **Botão "Desbloquear" com permissão e motivo obrigatório.** O modal mostra um botão verde quando o cliente está bloqueado E o usuário tem `permissoes_cadastros.desbloquear_financeiro=true` (ou é admin). Ao clicar, abre input pedindo motivo → grava `motivo_bloqueio="Desbloqueio manual: <motivo>"` e registra entrada em `LogGerencial` via `registrarLogGerencial`.

4. **Schema `Permissao` atualizado** com o campo `desbloquear_financeiro` em `permissoes_cadastros`. UI de Permissões (`pages/Permissoes.jsx`) expõe o checkbox "Desbloquear Financeiramente" no grupo Cadastros, mapeado também em Marcar/Desmarcar Todas.

**Resultado prático:** consultar débitos de um cliente passou a ser uma ação de governança financeira — o bloqueio é refletido no cadastro automaticamente, e só usuários autorizados podem destravar com justificativa rastreável.

---

## 8. 🟢 Duplicar pedido perde cenário fiscal e vínculo de integração — CONCLUÍDO 2026-05-16

**Correções aplicadas em `functions/duplicarPedidoOmie.js`:**

1. **Fallback de cenário fiscal:** quando `ConsultarPedido` do Omie não retorna `codigo_cenario`/`codigo_cenario_impostos`/`informacoes_adicionais.codigo_cenario`, agora a função consulta o `PedidoLiberadoOmie` (espelho) → `Pedido` local pra recuperar o `cenario_fiscal_codigo` e injetar no payload antes do `IncluirPedido`. Resultado: pedidos de Bonificação/Troca duplicados mantêm a operação fiscal correta.

2. **Vínculo `cCodIntPed` preservado:** já vinha sendo gerado (`DUP-…`) e enviado, mas agora também é **espelhado imediatamente em `PedidoLiberadoOmie`** com `codigo_pedido_integracao`, `codigo_pedido` novo, `tipo_operacao`, `cenario_fiscal_*`, `pedido_id` local e produtos. Isso elimina a janela em que o pedido duplicado existia no Omie mas não aparecia em Montagem/Operação até o webhook chegar.

3. **`omie_codigo_pedido`** do `Pedido` local continua sendo gravado (linha 224 da função) — confirmado funcionando.

**Sintoma original:**
- Cenário fiscal NÃO era replicado (sempre virava "Venda" mesmo se era Bonificação)
- Pedido pós-duplicação aparecia no Omie mas SEM vínculo de integração no espelho
- Mudança de etapa (Liberar) falhava porque o espelho estava desatualizado

---

## 9. 🟢 NF de Troca D1 não recebe motivo no espelho/relatórios — CONCLUÍDO 2026-05-16

**Correção aplicada:** `NotaD1Pdf` agora une `carga.pedidos_internos` + `carga.pedidos_troca` na mesma listagem de notas D1. Antes, trocas (vindas via `PedidoTroca`/`ItemPedidoTroca`) iam parar em `pedidos_troca` da Carga e **não eram exibidas** na aba "Impressão D1". O motivo já estava sendo persistido corretamente em `ItemPedidoTroca.motivo_descricao` → mapeado pelo `useDadosMontagem` → salvo em `Carga.pedidos_troca[].produtos[].motivo_troca_descricao`. A coluna "MOTIVO" ao lado do produto agora exibe o valor corretamente.

**Sintoma original:** ao gerar nota D1 (troca) em "Cargas / Logística":
- Motivo da troca não está sendo armazenado
- Precisa aparecer ao lado do nome do produto, na coluna "Motivo"
- Vai entrar em relatórios do Base44

**Onde investigar:**
- `components/cargas/documentos/NotaD1Pdf.jsx` — exibe motivo?
- `components/cargas/documentos/RomaneioEntregaPdf.jsx` — exibe motivo?
- Garantir que `pedidos_troca.produtos[].motivo_troca_descricao` está sendo persistido na `Carga`
- Verificar `PedidoItem.motivo_troca_id/descricao` está sendo gravado nas trocas
- Atualizar a coluna "Motivo" em romaneio/relatórios para mostrar motivo por produto

---

## Ordem de execução sugerida

1. **Item 9** (motivo troca D1) — rápido, isolado, impacta relatórios
2. **Item 8** (duplicar pedido) — bug crítico, impede operação
3. **Item 4** (notas rejeitadas/canceladas em NF-e) — visualização errada
4. **Item 1** (boleto não gerado) + **Item 2** (log pendente) — relacionados, mesmo fluxo
5. **Item 7** (bloqueio financeiro) — novo desenvolvimento
6. **Item 6** (escopo permissões) — refatoração ampla
7. **Item 5** (limpeza sincronizações) — após mapeamento, com aprovação
8. **Item 3** (CFOP bonificação) — ação no Omie do cliente, só alerta no Base44

---

## Como usar este arquivo

- Antes de qualquer commit nas funções/telas listadas, RELER esta seção
- Após cada correção, atualizar o status do item (🔴 → 🟡 → 🟢) com data
- Itens novos: adicionar ao final com numeração contínua