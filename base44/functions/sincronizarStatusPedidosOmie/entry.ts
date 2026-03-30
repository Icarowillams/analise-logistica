import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

        // Buscar pedidos ativos (não cancelados/faturados) que foram enviados ao Omie (sem trocas)
        const [pedidosMontagem, pedidosLiberados, pedidosEnviados] = await Promise.all([
            base44.asServiceRole.entities.Pedido.filter({ status: 'montagem', omie_enviado: true }),
            base44.asServiceRole.entities.Pedido.filter({ status: 'liberado', omie_enviado: true }),
            base44.asServiceRole.entities.Pedido.filter({ status: 'enviado', omie_enviado: true }),
        ]);
        const pedidos = [...pedidosMontagem, ...pedidosLiberados, ...pedidosEnviados].filter(p => p.omie_codigo_pedido && p.tipo !== 'troca');

        console.log(`[sincronizarStatusPedidos] Verificando ${pedidos.length} pedidos (${pedidosMontagem.length} montagem, ${pedidosLiberados.length} liberados, ${pedidosEnviados.length} enviados)`);

        let atualizados = 0;
        let erros = 0;

        for (const pedido of pedidos) {
            try {
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarPedido",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo_pedido: Number(pedido.omie_codigo_pedido) }]
                    })
                });

                const resultText = await response.text();
                let result;
                try { result = JSON.parse(resultText); } catch (e) { continue; }

                if (result && (result.faultstring || result.faultcode)) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    
                    // API bloqueada — parar imediatamente para não piorar
                    if (faultMsg.includes('bloqueada por consumo indevido')) {
                        console.warn(`[sincronizarStatusPedidos] API Omie BLOQUEADA. Parando sincronização.`);
                        break;
                    }
                    
                    const isExcluido = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                                       faultMsg.includes('não cadastrad') || faultMsg.includes('nao cadastrad') ||
                                       faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                                       faultMsg.includes('cancelad') ||
                                       faultMsg.includes('não existe') || faultMsg.includes('nao existe');

                    if (isExcluido) {
                        console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} (Omie: ${pedido.omie_codigo_pedido}) excluído/cancelado no Omie.`);
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                            status: 'cancelado',
                            motivo_cancelamento: `Cancelado/excluído no Omie (sincronização automática). Omie: ${result.faultstring}`,
                            data_cancelamento: new Date().toISOString(),
                            cancelado_por: 'sistema',
                            cancelado_por_nome: 'Sincronização Automática'
                        });
                        atualizados++;
                    }
                } else if (result && result.pedido_venda_produto) {
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado;
                    const numeroPedidoOmie = result.pedido_venda_produto.cabecalho?.numero_pedido;
                    
                    const updateData = {};
                    
                    if (cancelado === 'S' || etapa === '80') {
                        console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} cancelado no Omie (etapa: ${etapa}, cancelado: ${cancelado})`);
                        updateData.status = 'cancelado';
                        updateData.motivo_cancelamento = 'Cancelado no Omie (sincronização automática)';
                        updateData.data_cancelamento = new Date().toISOString();
                        updateData.cancelado_por = 'sistema';
                        updateData.cancelado_por_nome = 'Sincronização Automática';
                    } else if (etapa === '70' || etapa === '60') {
                        // Faturado ou Entrega
                        if (pedido.status !== 'faturado') {
                            updateData.status = 'faturado';
                        }
                    } else if (etapa === '50') {
                        // Faturar = Montagem
                        if (pedido.status !== 'montagem') {
                            updateData.status = 'montagem';
                        }
                    } else if (etapa === '20') {
                        // Pedidos Liberados
                        if (pedido.status !== 'liberado') {
                            updateData.status = 'liberado';
                        }
                    }
                    
                    // Sincronizar numero_pedido do Omie (sempre como String)
                    if (numeroPedidoOmie && String(numeroPedidoOmie) !== String(pedido.numero_pedido || '')) {
                        updateData.numero_pedido = String(numeroPedidoOmie);
                    }
                    
                    if (Object.keys(updateData).length > 0) {
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, updateData);
                        atualizados++;
                    }
                }

                // Rate limit do Omie — delay entre chamadas
                await new Promise(r => setTimeout(r, 800));

            } catch (pedidoErr) {
                console.error(`[sincronizarStatusPedidos] Erro pedido ${pedido.id}:`, pedidoErr.message);
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