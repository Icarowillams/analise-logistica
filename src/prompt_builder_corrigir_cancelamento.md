# Corrigir Cancelamento — erro "Consumo redundante" do Omie

Dos 14 cancelamentos reais, 11 falharam com "Consumo redundante. Aguarde e tente novamente." Causa: a função faz 2 chamadas Omie coladas (ConsultarPedido + CancelarPedidoVenda) e o usuário clica várias vezes.

## Backend (cancelarNfOmie)
- Ampliar os retries de `[1000,2000,4000]` para `[2000,5000,10000]`.
- Esperar ~800ms entre ConsultarPedido e CancelarPedidoVenda.
- Deduplicar por `pedido_codigo_omie` (não cancelar de novo se já houve sucesso nos últimos 60s).
- Retornar mensagem amigável "O Omie está processando outra solicitação, aguarde ~30s" em vez do texto cru.
- Manter ConsultarPedido/CancelarPedidoVenda (não usar ListarNF).

## Frontend (CancelamentoTab.jsx)
- Ao receber erro "redundante", iniciar cooldown de 30s no botão (contador visível).
- Usar toast amarelo (aviso), não vermelho.