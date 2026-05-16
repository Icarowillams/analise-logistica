# 🚨 Prioridades — 16/05/2026 (Rodrigo Pão & Mel)

> Documento vivo. Cada item começa 🔴 e vai pra 🟢 só depois de **testado e validado em produção**.
> Última revisão: **2026-05-16**

---

## 🔥 EXTREMA PRIORIDADE

### P1. 🔴 Bloqueio financeiro automático ao LIBERAR pedido

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

### P2. 🔴 Log de Emissão preenchido AUTOMATICAMENTE pós-emissão

**Situação atual:** após `FaturarPedidoVenda`, a função `emitirNfsLoteOmie` já tenta capturar status via espelho + `consultarStatusAtivoOmie`, mas em muitos casos não pega — log fica como "pendente" e só o varredor de 15min resolve.

**O que precisa acontecer:**
- Ampliar a janela de consulta ativa pós-emissão: ao invés de 4 tentativas de 4s (espelho) + 1 consulta ativa, fazer um loop combinado de até **6 tentativas com backoff** que use a mesma lógica do `atualizarStatusLogsPendentes` (espelho → ConsultarPedido → ListarNF) antes de gravar "pendente".
- Para pedidos que continuam pendentes, gravar com `status='pendente'` mas marcar `mensagem` indicando "será reconciliado em até 15min".

**Onde mexer:**
- `functions/emitirNfsLoteOmie.js` — refatorar `aguardarEspelhoRapido` + `consultarStatusAtivoOmie` em um único loop com mais tentativas.

---

### P3. 🔴 Boletos NÃO estão sendo gerados automaticamente com a NF-e

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

### P4. 🔴 NF-e canceladas continuam aparecendo em "Notas a Emitir"

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

### P5. 🟡 Item 8 (anterior) — Duplicar pedido com escolha de cenário fiscal/forma pagamento

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

### P6. 🟡 Item 9 (anterior) — Motivo da troca na nota D1

**Situação atual:** correção já foi aplicada no `NotaD1Pdf` para unir `pedidos_internos` + `pedidos_troca`. Rodrigo diz que ainda não aparece.

**Próximo passo:** validar com caso real (carga + pedido troca específico) e debugar a cadeia:
1. `ItemPedidoTroca.motivo_descricao` foi salvo? → consultar entidade
2. `useDadosMontagem` mapeou para `motivo_troca_descricao`? → confirmar
3. `Carga.pedidos_troca[].produtos[].motivo_troca_descricao` persistiu na criação da carga? → confirmar
4. `NotaD1Pdf` está usando o campo correto na coluna "MOTIVO"? → confirmar

**Onde mexer:** depende do diagnóstico.

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