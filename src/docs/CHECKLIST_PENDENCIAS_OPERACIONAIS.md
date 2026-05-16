# 📋 Checklist de Pendências Operacionais — Pão & Mel × Omie

> **Documento vivo.** Toda vez que houver uma nova sessão de trabalho, este arquivo
> deve ser RELIDO INTEIRO antes de qualquer alteração. Marcar progresso com:
> - 🔴 Não iniciado
> - 🟡 Em andamento / parcial
> - 🟢 Concluído e validado em produção
> - ⚪ Bloqueado (depende de decisão externa)

Última revisão: **2026-05-16**

---

## 1. 🔴 Boleto NÃO está sendo gerado ao emitir NF-e

**Sintoma:** ao acionar emissão da NF-e, mesmo para clientes com modalidade
**BOLETO BANCARIO** no cadastro Base44 e pedido tipo **venda**, o boleto não é
gerado automaticamente.

**Regras de negócio:**
- Só gera boleto se `Pedido.tipo === 'venda'`
- Só gera boleto se `Cliente.modalidade_pagamento.nome` contém `"BOLETO"`
- Disparo automático imediatamente após NF autorizada (cStat 100/150)

**Onde investigar:**
- `functions/emitirNfsLoteOmie.js` → função `clienteUsaBoleto` + array `codigosParaBoleto`
- `functions/gerarBoletosAutoPedidos.js` → chamada efetiva
- Confirmar que `gerarBoletosAutoPedidos` está respondendo sem erro
- Verificar logs `LogIntegracaoOmie` com operacao=`emitir_nf_lote`
- Garantir que após **consulta ativa** (quando webhook não chega) o boleto também seja disparado

---

## 2. 🔴 Log de Transmissão fica como "Pendente" mesmo SEFAZ tendo respondido

**Sintoma:** o pedido foi enviado pra SEFAZ com sucesso, mas o log de emissão
fica eternamente como "pendente" — sem mostrar se foi autorizada ou rejeitada.
Antes funcionava, agora parou.

**Causa suspeita:** o `consultarStatusAtivoOmie` no `emitirNfsLoteOmie` pode
estar falhando silenciosamente (lista ListarNF não traz pelo `nIdPedido` certo)
ou o intervalo de tentativas (`aguardarEspelhoRapido`) está curto demais.

**Onde investigar:**
- `functions/emitirNfsLoteOmie.js` → função `consultarStatusAtivoOmie`
- Conferir o campo correto retornado pelo Omie: `nf.compl.nIdPedido` vs `nf.cabecalho.nIdPedido`
- Aumentar janela total de espera + número de tentativas
- Garantir que `atualizarStatusLogsPendentes` rode com mais frequência (automação periódica? a cada 5min?)

---

## 3. 🔴 Bonificação não emite NF — CFOP não configurado no Omie

**Sintoma:** pedidos com cenário fiscal de **bonificação** não foram faturados
ontem porque o CFOP no Omie está sem configuração correta.

**Onde investigar / agir:**
- Conferir no Omie qual `cenario_fiscal` está vinculado ao CenarioFiscalLocal "Bonificação"
- O CFOP deve ser `5910` (bonificação dentro do estado) ou `6910` (interestadual)
- Validar a aba **Tributação** do cenário fiscal Omie
- **AÇÃO MANUAL no Omie:** o cliente precisa corrigir lá. Do nosso lado, só checamos se está vinculado.
- Adicionar **alerta visual no Base44** ao criar pedido de bonificação se o cenário Omie não tem CFOP completo

---

## 4. 🔴 Notas rejeitadas/canceladas no Omie aparecem como emitidas na rotina de NF-e

**Sintoma:** na aba de impressão NF-e Omie aparecem notas que estão canceladas
ou rejeitadas no Omie. PDF do pedido pode aparecer, mas a NF não.

**Regras corretas:**
- **Aba "Impressão NF 55"**: SÓ mostra notas com `status='autorizada'` (cStat 100/150)
- **Notas canceladas**: NÃO aparecem em NF-e Omie, status do pedido vai pra `cancelado` em "Gerenciar Pedidos"
- **Notas rejeitadas**: NÃO aparecem em NF-e Omie

**Onde investigar:**
- `components/notasOmie/NotasNF55Tab.jsx` → filtro de `derivarStatus === 'autorizada'`
- `functions/listarNfsOmie.js` → `derivarStatus` já está prioritizando `cStat`, mas o frontend ainda mostra status `'pendente'` e outros?
- Garantir que `processarWebhookOmie` no `NFe.NotaCancelada` atualize o `Pedido.status='cancelado'`
- Adicionar reconciliação periódica que detecta canceladas e atualiza pedido local

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

## 7. 🔴 Rotina de bloqueio financeiro por cliente

**Sintoma atual:** `consultarDebitosOmie` retorna débitos GENÉRICOS, não do
cliente selecionado. Precisa ser específico por cliente.

**Cenário esperado:**
1. Ao consultar débitos de um cliente, retornar APENAS os débitos DAQUELE cliente (via `cCodCliente` no Omie)
2. Se o cliente tem débito → marcar `Cliente.bloquear_faturamento = true` + `Cliente.motivo_bloqueio = "Débito em aberto: <descrição>"`
3. Permitir desbloqueio através de:
   - **Opção A**: desbloqueio manual no Base44 com permissão específica `desbloquear_financeiro`
   - **Opção B**: desbloqueio sincronizado com Omie (se possível via API)

**Onde investigar:**
- `functions/consultarDebitosOmie.js` — adicionar filtro por cliente
- `functions/consultarBloqueioFinanceiroOmie.js` — usar para bloqueio real
- Adicionar permissão `desbloquear_financeiro` ao schema `Permissao`
- Criar tela ou ação para desbloquear cliente com motivo

---

## 8. 🔴 Duplicar pedido perde cenário fiscal e vínculo de integração

**Sintoma:** em "Ajustes de Pedidos" → Duplicar Pedido:
- Cenário fiscal NÃO é replicado (sempre vira "Venda" mesmo se era Bonificação)
- Pedido pós-duplicação aparece no Omie mas SEM vínculo de integração
- Não consegue mudar etapa (liberar) porque perdeu o `cCodIntPed`

**Onde investigar:**
- `functions/duplicarPedidoOmie.js`
- Garantir que o `codigo_cenario` do pedido original seja replicado no novo
- Garantir que o `cCodIntPed` do novo pedido seja gerado e gravado de volta no Pedido local
- Atualizar `omie_codigo_pedido` corretamente após duplicação
- Sincronizar com `PedidoLiberadoOmie` imediatamente

---

## 9. 🔴 NF de Troca D1 não recebe motivo no espelho/relatórios

**Sintoma:** ao gerar nota D1 (troca) em "Cargas / Logística":
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