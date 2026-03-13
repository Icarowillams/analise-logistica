import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Buscar pedidos que estão "enviado" ou "liberado" E foram enviados ao Omie
        const pedidosEnviados = await base44.asServiceRole.entities.Pedido.filter({ status: 'enviado', omie_enviado: true });
        const pedidosLiberados = await base44.asServiceRole.entities.Pedido.filter({ status: 'liberado', omie_enviado: true });
        const pedidos = [...pedidosEnviados, ...pedidosLiberados];

        console.log(`[sincronizarStatusPedidos] Verificando ${pedidos.length} pedidos (${pedidosEnviados.length} enviados, ${pedidosLiberados.length} liberados)`);

        let atualizados = 0;
        let erros = 0;

        for (const pedido of pedidos) {
            if (!pedido.omie_codigo_pedido) continue;

            try {
                // Consultar status do pedido no Omie
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarPedido",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{
                            codigo_pedido: Number(pedido.omie_codigo_pedido)
                        }]
                    })
                });

                const resultText = await response.text();
                let result;
                try { result = JSON.parse(resultText); } catch (e) { /* continua */ }

                // Se o Omie retornou erro de "não encontrado" ou "excluído", o pedido foi cancelado lá
                if (result && (result.faultstring || result.faultcode)) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    const isExcluido = faultMsg.includes('não encontrad') || 
                                       faultMsg.includes('nao encontrad') ||
                                       faultMsg.includes('não cadastrad') ||
                                       faultMsg.includes('nao cadastrad') ||
                                       faultMsg.includes('excluíd') ||
                                       faultMsg.includes('excluid') ||
                                       faultMsg.includes('cancelad') ||
                                       faultMsg.includes('não existe') ||
                                       faultMsg.includes('nao existe');

                    if (isExcluido) {
                        console.log(`[sincronizarStatusPedidos] Pedido #${pedido.numero_pedido} (Omie: ${pedido.omie_codigo_pedido}) foi excluído/cancelado no Omie. Atualizando local...`);
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                            status: 'cancelado',
                            motivo_cancelamento: `Cancelado/excluído no Omie (sincronização automática). Omie: ${result.faultstring}`,
                            data_cancelamento: new Date().toISOString(),
                            cancelado_por: 'sistema',
                            cancelado_por_nome: 'Sincronização Automática'
                        });
                        atualizados++;
                    } else {
                        console.log(`[sincronizarStatusPedidos] Pedido #${pedido.numero_pedido} - Erro Omie diferente: ${result.faultstring}`);
                    }
                } else if (result && result.pedido_venda_produto) {
                    // Pedido existe no Omie - verificar se a etapa indica cancelamento
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado;
                    
                    if (cancelado === 'S' || etapa === '80') {
                        console.log(`[sincronizarStatusPedidos] Pedido #${pedido.numero_pedido} cancelado no Omie (etapa: ${etapa}, cancelado: ${cancelado})`);
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                            status: 'cancelado',
                            motivo_cancelamento: 'Cancelado no Omie (sincronização automática)',
                            data_cancelamento: new Date().toISOString(),
                            cancelado_por: 'sistema',
                            cancelado_por_nome: 'Sincronização Automática'
                        });
                        atualizados++;
                    }
                }

                // Delay para não sobrecarregar API do Omie
                await new Promise(r => setTimeout(r, 500));

            } catch (pedidoErr) {
                console.error(`[sincronizarStatusPedidos] Erro ao consultar pedido #${pedido.numero_pedido}:`, pedidoErr.message);
                erros++;
            }
        }

        console.log(`[sincronizarStatusPedidos] Finalizado. Total: ${pedidos.length}, Atualizados: ${atualizados}, Erros: ${erros}`);

        return Response.json({
            sucesso: true,
            total_verificados: pedidos.length,
            atualizados,
            erros
        });

    } catch (error) {
        console.error('[sincronizarStatusPedidos] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});