# 🚨 Prioridades — 16/05/2026 (Rodrigo Pão & Mel)

> Documento vivo. Cada item começa 🔴 e vai pra 🟢 só depois de **testado e validado em produção**.
> Última revisão: **2026-05-16**

---

## 🔥 EXTREMA PRIORIDADE

### P1. 🟢 Bloqueio financeiro automático ao LIBERAR pedido

**Situação atual:** o bloqueio só acontece quando alguém abre manualmente o modal "Débitos do Cliente". Pedidos podem ser liberados (etapa 10→20) mesmo com débitos em aberto.

**O que precisa acontecer:**
1. Ao clicar em "Liberar pedido" (em `EmissaoPedidos`, `Pedidos`, `MontagemCarga`, etc.) o sistema consulta automaticamente o Omie via `consultarBloqueioFinanceiroOmie`.
2. Se **há pendência** → bloqueia o cliente (`bloquear_faturamento=true`) E abre o pop-up.
3. Pop-up exibe os títulos em aberto com colunas: **nº título, data emissão, data vencimento, valor, status** — cada linha com checkbox.
4. Usuário marca um ou mais títulos e clica "Liberar ignorando estes títulos".
5. Apenas usuários com permissão `desbloquear_financeiro` podem usar o pop-up.
6. "Ignorar" = a liberação prossegue para aquele pedido E os títulos marcados ficam registrados no `LogGerencial` como "perdoados nesta liberação" (o cliente continua bloqueado para futuras liberações se a pendência permanecer).

**Decisão arquitetural:** o desbloqueio é **por liberação**, NÃO altera o cadastro do cliente. Bloqueio do cliente continua até o título sair do Omie (pagamento) ou desbloqueio manual via tela de Débitos.

**Onde mexer:**
- Criar `components/Pedidos/BloqueioLiberarModal.jsx`
- Integrar nos pontos de "Liberar" (telas que chamam `liberarPedidoOmie`/`trocarEtapaPedidoOmie`/`enviarPedidoOmie`)
- Registrar log gerencial das liberações com títulos ignorados

---

### P2. 🟢 Log de Emissão preenchido AUTOMATICAMENTE pós-emissão

**Situação atual:** após `FaturarPedidoVenda`, a função `emitirNfsLoteOmie` já tenta capturar status via espelho + `consultarStatusAtivoOmie`, mas em muitos casos não pega — log fica como "pendente" e só o varredor de 15min resolve.

**O que precisa acontecer:**
- Ampliar a janela de consulta ativa pós-emissão: ao invés de 4 tentativas de 4s (espelho) + 1 consulta ativa, fazer um loop combinado de até **6 tentativas com backoff** que use a mesma lógica do `atualizarStatusLogsPendentes` (espelho → ConsultarPedido → ListarNF) antes de gravar "pendente".
- Para pedidos que continuam pendentes, gravar com `status='pendente'` mas marcar `mensagem` indicando "será reconciliado em até 15min".

**Onde mexer:**
- `functions/emitirNfsLoteOmie.js` — refatorar `aguardarEspelhoRapido` + `consultarStatusAtivoOmie` em um único loop com mais tentativas.

---

### P3. 🟢 Boletos NÃO estão sendo gerados automaticamente com a NF-e

**Situação atual:** Já existe `gerarBoletosAutoPedidos` que é chamado por `emitirNfsLoteOmie` quando `clienteUsaBoleto()` retorna true. Mas Rodrigo diz que **não está disparando em produção**.

**Hipóteses a investigar (em ordem):**
1. **Cliente sem `modalidade_pagamento_id` preenchido.** A função `clienteUsaBoleto` retorna `false` se o cliente não tiver modalidade. Esses clientes precisariam ter a modalidade "BOLETO BANCARIO" linkada.
2. **Modalidade existe mas nome não contém "BOLETO"** — busca usa `.includes('BOLETO')`.
3. **Pedido ainda não terminou de ser autorizado dentro da janela de 20s** → `clienteUsaBoleto` nem chega a ser chamado, vai pra "pendente" e o boleto fica para depois (mas hoje **não há automação que dispara boleto após reconciliação** — o `atualizarStatusLogsPendentes` chama `gerarBoletosAutoPedidos`, mas só para os que ele mesmo reconcilia).
4. **Webhook chega mas `processarWebhookOmie.handleNFe` faz a chamada?** Sim — verificar.

**O que precisa acontecer:**
1. **Diagnóstico imediato:** criar uma rotina/console que liste todos os clientes com `modalidade_pagamento_id` vazio mas que receberam NF nos últimos 7 dias → ação corretiva.
2. **Reforço de cobertura:** garantir que `processarWebhookOmie.handleNFe` (caso NFe.NotaAutorizada) também chama `gerarBoletosAutoPedidos`. Verificar e adicionar se faltar.
3. **Documentar no Cadastro de Cliente:** quando a modalidade muda para boleto, deixar claro no UI que isso aciona boleto automático.

**SEGUNDA OPÇÃO (futuro, mais avançada):** sincronizar a flag "boleto automático" diretamente no cadastro Omie do cliente quando a modalidade for BOLETO. Risco: webhook circular. Deixar para depois de validar opção 1.

**Onde mexer:**
- `functions/processarWebhookOmie.js` (handleNFe NFe.NotaAutorizada) — garantir chamada de boleto auto
- `functions/atualizarStatusLogsPendentes.js` — confirmar chamada de boleto auto (já existe)
- Criar diagnóstico simples na tela de Boletos: "Clientes com NF emitida sem modalidade definida"

---

### P4. 🟢 NF-e canceladas continuam aparecendo em "Notas a Emitir"

**Situação atual:** a aba `EmissaoNFTab` já filtra pedidos cuja carga é "faturada" + pedido sem NF + `status_real !== cancelada/denegada` + pedido local `!== cancelado`. Mas Rodrigo diz que ainda aparecem canceladas — provavelmente o `status` do pedido local não foi atualizado quando a NF foi cancelada no Omie depois.

**O que precisa acontecer:**
- `processarWebhookOmie.handleNFe` (NFe.NotaCancelada) já marca `Pedido.status='cancelado'` → confirmar que está rodando.
- `reconciliarNfsCanceladasOmie` (job diário) varre NFs canceladas e marca local → confirmar que está rodando 03:00 todo dia.
- **Reforço no filtro frontend:** também excluir pedidos cujo espelho `PedidoLiberadoOmie.status_real === 'cancelada'` (já faz) E cuja etapa Omie atual seja `70/80` (cancelado/excluído).
- Aplicar o mesmo filtro em `buscarPedidosOmie` (passar `incluir_cancelados: false` — já existe parâmetro, validar que está sendo aplicado).

**Onde mexer:**
- `functions/buscarPedidosOmie.js` — garantir que `incluir_cancelados: false` filtra etapa ≠ 70/80
- `components/notasOmie/EmissaoNFTab.jsx` — adicionar filtro de etapa no espelho

---

## 📋 PENDÊNCIAS DA RODADA ANTERIOR (revalidar)

### P5. 🟢 Item 8 (anterior) — Duplicar pedido com escolha de cenário fiscal/forma pagamento

**Situação atual (após correção anterior):** o backend já preserva o cenário fiscal e o vínculo `cCodIntPed`. Funciona.

**Nova solicitação do Rodrigo:** ao clicar em "Duplicar", em vez de duplicar direto, **abrir um modal** pedindo:
- **Cenário fiscal** (lista de `CenarioFiscalLocal` ativos, filtrados por `tipo_operacao`)
- **Forma de pagamento** (Plano de Pagamento)
- (Itens são reaproveitados do pedido original — não digita)

E aí dispara o `IncluirPedido` com o cenário e plano escolhidos.

**Onde mexer:**
- Criar `components/Pedidos/DuplicarPedidoModal.jsx`
- Adaptar `functions/duplicarPedidoOmie.js` para aceitar `cenario_local_id` e `plano_pagamento_id` no body.

---

### P6. 🔵 Item 9 (anterior) — Motivo da troca na nota D1 (aguarda caso real)

**Diagnóstico 16/05:** auditoria completa da cadeia mostra que **todos os elos estão corretos**:
1. `ItemPedidoTroca` tem `motivo_descricao` ✅
2. `PedidoItem` tem `motivo_troca_descricao` e o PedidoFormulario salva quando há motivo (linha 405-408) ✅
3. `useDadosMontagem` mapeia `i.motivo_descricao` → `motivo_troca_descricao` no produto (linha 173) ✅
   E também mapeia `i.motivo_troca_descricao` → `motivo_troca_descricao` para D1 (linha 137) ✅
4. `PainelFecharCarga` passa `produtos: p.produtos || []` preservando todos os campos (linha 96, 109) ✅
5. `NotaD1Pdf` lê `item.motivo_troca_descricao` na coluna MOTIVO (linha 287) ✅

**Próximo passo:** pedir ao Rodrigo um caso ESPECÍFICO (número da carga + pedido) que está apresentando o problema, para auditar o registro real no banco. Pode ser:
- Carga antiga, criada antes da correção
- Cliente sem `motivo_id` ao digitar a troca
- Pedido de troca via `tipo='troca'` na EmissaoPedidos sem informar motivo no item

---

## 🧩 ITEM DE LONGO PRAZO (mantido em standby)

### P7. ⚪ Escopo completo de permissões granulares

**Status:** será feito após resolver P1–P6. Plano:
1. Listar TODAS as páginas e ações principais
2. Mapear cada ação → permissão
3. Adicionar grupos novos ao schema `Permissao` (`permissoes_logistica`, `permissoes_roteiros_campo`, `permissoes_notas_omie`, `permissoes_ajustes`)
4. Atualizar UI da página `Permissoes`
5. Aplicar `canAcao()` em todos os botões

---

## ✅ Critério de "Pronto"

Cada item só vira 🟢 quando:
- [ ] Código mergeado
- [ ] Teste no preview com caso real do usuário
- [ ] Console limpo (sem erros 4xx/5xx)
- [ ] Rodrigo confirma "300%"

---

## 🗂️ Ordem de execução

1. **P4** (filtrar canceladas) — rápido, visual, alta dor
2. **P2** (log automático) — backend curto, alta dor
3. **P3** (boletos auto) — diagnóstico + reforço de cobertura
4. **P1** (bloqueio ao liberar) — novo modal + integração nas telas
5. **P5** (duplicar com modal) — novo UX
6. **P6** (motivo troca D1) — debug do caso real
7. **P7** (permissões granulares) — refatoração ampla

---

# 🧪 ROTEIRO DE VALIDAÇÃO EM PRODUÇÃO (P1–P5)

> Execute na ordem. Cada cenário tem **passos**, **resultado esperado** e **onde olhar** se falhar.
> Use sempre cliente/pedido de TESTE quando possível. Caso use produção real, anote IDs.

---

## ✅ P1 — Bloqueio financeiro ao LIBERAR pedido

### Cenário 1.1 — Cliente COM débito → modal abre
**Passos:**
1. Abrir `Pedidos` (ou `EmissaoPedidos` / `MontagemCarga`)
2. Escolher pedido de cliente que sabidamente tem título em aberto no Omie
3. Clicar **Liberar**

**Esperado:**
- [ ] Pop-up `BloqueioLiberarModal` abre
- [ ] Lista os títulos com colunas: nº título, emissão, vencimento, valor, status
- [ ] Cliente é marcado com `bloquear_faturamento=true` (verificar em Clientes)
- [ ] Botão "Liberar ignorando estes títulos" aparece SOMENTE se usuário tem `permissoes_cadastros.desbloquear_financeiro=true`

**Se falhar:** abrir runtime logs e verificar resposta de `consultarBloqueioFinanceiroOmie`.

### Cenário 1.2 — Marcar título e liberar
**Passos:**
1. No pop-up, marcar 1 ou mais títulos
2. Clicar **Liberar ignorando estes títulos**

**Esperado:**
- [ ] Pedido segue para etapa 20 (Liberado) no Omie
- [ ] `LogGerencial` recebe registro tipo `liberacao` com observação dos títulos perdoados
- [ ] Cliente CONTINUA com `bloquear_faturamento=true` (não desbloqueia o cadastro)
- [ ] Próximo pedido do mesmo cliente reabre o modal

**Se falhar:** verificar `registrarLogGerencial` e `liberarPedidoOmie`.

### Cenário 1.3 — Usuário SEM permissão
**Passos:**
1. Logar como usuário sem `desbloquear_financeiro`
2. Tentar liberar pedido de cliente com débito

**Esperado:**
- [ ] Pop-up abre mas botão "Liberar ignorando" está oculto/desabilitado
- [ ] Mensagem: "Você não tem permissão para liberar pedidos de clientes com débito"

### Cenário 1.4 — Cliente SEM débito → flui direto
**Passos:**
1. Liberar pedido de cliente em dia

**Esperado:**
- [ ] Sem pop-up, vai direto para etapa 20

---

## ✅ P2 — Log de Emissão preenchido automaticamente

### Cenário 2.1 — Emissão em lote
**Passos:**
1. Abrir `NotasOmie` → aba **Emissão de NF-e**
2. Selecionar 3–5 pedidos
3. Clicar **Emitir NF-e em lote**

**Esperado:**
- [ ] Toast indica início, depois conclusão
- [ ] Imediatamente após, abrir aba **Log de Emissão** e filtrar pelo lote/data → status `autorizada`, `rejeitada` ou `pendente` (com mensagem "será reconciliado em até 15min")
- [ ] **NÃO** ficar todos como "pendente" sem mensagem
- [ ] Para os `autorizada`: `numero_nf` preenchido

**Se falhar:** runtime logs de `emitirNfsLoteOmie` — checar quantas tentativas do loop foram feitas.

### Cenário 2.2 — Reconciliação automática (15min)
**Passos:**
1. Aguardar 15min após emissão se algum ficou `pendente`
2. Verificar `LogEmissaoNF` novamente

**Esperado:**
- [ ] `atualizarStatusLogsPendentes` rodou e os pendentes viraram `autorizada` ou `rejeitada`

---

## ✅ P3 — Boletos automáticos com a NF-e

### Cenário 3.1 — Diagnóstico de clientes sem modalidade
**Passos:**
1. Abrir `BoletosOmie`
2. Localizar componente **DiagnosticoClientesSemModalidade**

**Esperado:**
- [ ] Lista de clientes que emitiram NF nos últimos 7 dias SEM `modalidade_pagamento_id`
- [ ] Cada linha tem botão "Atribuir modalidade"

**Ação corretiva:** Rodrigo preenche modalidade BOLETO BANCARIO para os clientes elegíveis.

### Cenário 3.2 — Emissão de NF com cliente boleto
**Passos:**
1. Confirmar que cliente X tem `modalidade_pagamento_id` apontando para "BOLETO BANCARIO"
2. Emitir NF-e desse cliente via `emitirNfsLoteOmie`
3. Aguardar 30s

**Esperado:**
- [ ] Boleto aparece em `BoletosOmie`
- [ ] `LogEmissaoNF.boleto_gerado=true` para esse pedido

**Se falhar:** runtime logs de `emitirNfsLoteOmie` → procurar mensagem `clienteUsaBoleto` e `gerarBoletosAutoPedidos`.

### Cenário 3.3 — Webhook tardio também dispara boleto
**Passos:**
1. Forçar uma situação onde NF demora a ser autorizada (cliente boleto)
2. Aguardar webhook NFe.NotaAutorizada chegar

**Esperado:**
- [ ] `processarWebhookOmie.handleNFe` chama `gerarBoletosAutoPedidos`
- [ ] Boleto aparece

---

## ✅ P4 — NF-e canceladas removidas de "Notas a Emitir"

### Cenário 4.1 — NF cancelada não aparece
**Passos:**
1. Pegar um pedido cuja NF foi cancelada no Omie
2. Abrir `NotasOmie` → aba **Emissão de NF-e**

**Esperado:**
- [ ] Pedido NÃO aparece na lista
- [ ] Confirmar que `PedidoLiberadoOmie.status_real === 'cancelada'` OU pedido local `status === 'cancelado'`

### Cenário 4.2 — Cancelar agora
**Passos:**
1. Cancelar NF de um pedido pelo Omie diretamente
2. Aguardar webhook (1–2 min)
3. Recarregar `NotasOmie`

**Esperado:**
- [ ] Pedido some imediatamente da lista de "Emissão"

**Se falhar:** verificar `processarWebhookOmie.handleNFe` para evento `NFe.NotaCancelada`.

---

## ✅ P5 — Duplicar pedido com modal de cenário/forma pagamento

### Cenário 5.1 — Modal abre com seleções
**Passos:**
1. Abrir `Pedidos` (Pedidos Omie)
2. Selecionar 1 ou mais pedidos
3. Clicar **Duplicar N pedidos**

**Esperado:**
- [ ] Modal `DuplicarPedidosModal` abre
- [ ] Combo "Cenário Fiscal" carrega `CenarioFiscalLocal` ativos
- [ ] Combo "Forma de Pagamento" carrega `PlanoPagamento` ativos
- [ ] Botão **Duplicar** desabilitado até as duas seleções

### Cenário 5.2 — Duplicação com sucesso
**Passos:**
1. Selecionar cenário fiscal X (tipo `venda`) e plano Y (à vista)
2. Clicar **Duplicar**

**Esperado:**
- [ ] Toast "N pedido(s) duplicado(s) com sucesso"
- [ ] Pedido novo aparece no Omie em etapa 10
- [ ] No Omie, conferir que o pedido novo está com o CENÁRIO escolhido (não o do original)
- [ ] `codigo_parcela` do novo bate com o plano escolhido

**Se falhar:** runtime logs de `duplicarPedidoOmie` — conferir se `overrides.cenario_omie_codigo` e `overrides.codigo_parcela` foram aplicados.

### Cenário 5.3 — Cenário sem código Omie vinculado
**Passos:**
1. Escolher um cenário local SEM `cenario_omie_codigo`
2. Tentar duplicar

**Esperado:**
- [ ] Aviso amarelo no modal: "Este cenário local não tem código Omie vinculado"
- [ ] Duplicação prossegue, pedido é criado SEM cenário no Omie (Omie usa o padrão)

---

## 📊 RESUMO DA VALIDAÇÃO

| Item | Cenários | Status Rodrigo |
|------|----------|----------------|
| P1   | 1.1–1.4  | ⬜ |
| P2   | 2.1–2.2  | ⬜ |
| P3   | 3.1–3.3  | ⬜ |
| P4   | 4.1–4.2  | ⬜ |
| P5   | 5.1–5.3  | ⬜ |

> Marcar ✅ ao concluir cada item. Quando todos ✅ + "300%" do Rodrigo → fechar rodada 16/05 e iniciar P7.

---

## 🐛 BUGS ENCONTRADOS NA AUDITORIA (16/05 — pós validação)

| # | Onde | Sintoma | Status |
|---|------|---------|:---:|
| B1 | `functions/liberarPedidoOmie` | Função estava restrita a `role==='admin'` → nenhum vendedor conseguia liberar pedido, mesmo com permissão. Quebra P1 completamente. | 🟢 Corrigido — agora checa `permissoes_pedidos.enviar_pedido` |
| B2 | `components/Pedidos/GerenciarPedidos.handleBatchLiberar` | Chamava função inexistente `consultarBloqueioFinanceiro` (faltava sufixo Omie) e lia campos errados (`bloqueado` em vez de `deve_bloquear`). Bloqueio financeiro **NÃO era verificado** na liberação em lote — qualquer pedido passava sem checagem. **P1 estava furado por aqui.** | 🟢 Corrigido — usa `consultarBloqueioFinanceiroOmie` com `cliente_id` e lê `deve_bloquear` |

**Impacto:** Antes desta auditoria, P1 funcionava só no fluxo individual (via `BloqueioLiberarModal`). Na liberação em lote a verificação era silenciosamente ignorada. **Agora os dois caminhos estão íntegros.**