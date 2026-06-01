import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// NOVA VERSÃO: Consulta APENAS pedidos com status 'faturado' para detectar cancelamentos no Omie.
// Todos os outros status (pendente, liberado, montagem) são controlados pelo Logístico Control via webhook.

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Buscar APENAS pedidos faturados que foram enviados ao Omie (sem trocas)
        const pedidosFaturados = await base44.asServiceRole.entities.Pedido.filter({ status: 'faturado', omie_enviado: true });
        const pedidos = pedidosFaturados.filter(p => p.omie_codigo_pedido && p.tipo !== 'troca');

        console.log(`[sincronizarStatusPedidos] Verificando ${pedidos.length} pedidos FATURADOS para detectar cancelamentos`);

        if (pedidos.length === 0) {
            return Response.json({ sucesso: true, total_verificados: 0, atualizados: 0, erros: 0, message: 'Nenhum pedido faturado para verificar' });
        }

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
                    
                    // API bloqueada — parar imediatamente
                    if (faultMsg.includes('bloqueada por consumo indevido')) {
                        console.warn(`[sincronizarStatusPedidos] API Omie BLOQUEADA. Parando sincronização.`);
                        break;
                    }
                    
                    // Só considera "excluído/inexistente" — NUNCA inferir cancelamento por texto frouxo.
                    // Cancelamento real vem da etapa/cabecalho.cancelado quando o pedido existe.
                    const isExcluido = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                                       faultMsg.includes('não cadastrad') || faultMsg.includes('nao cadastrad') ||
                                       faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                                       faultMsg.includes('não existe') || faultMsg.includes('nao existe') ||
                                       faultMsg.includes('inexistente');

                    if (isExcluido) {
                        console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} (Omie: ${pedido.omie_codigo_pedido}) cancelado/excluído no Omie.`);
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
                    
                    if (cancelado === 'S' || etapa === '80') {
                        console.log(`[sincronizarStatusPedidos] Pedido #${String(pedido.numero_pedido || '')} cancelado no Omie (etapa: ${etapa}, cancelado: ${cancelado})`);
                        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
                            status: 'cancelado',
                            motivo_cancelamento: 'Cancelado no Omie (sincronização automática)',
                            data_cancelamento: new Date().toISOString(),
                            cancelado_por: 'sistema',
                            cancelado_por_nome: 'Sincronização Automática'
                        });
                        atualizados++;
                    }
                    // Não precisa verificar outros status — se está faturado no banco e no Omie, tudo certo
                }

                // Rate limit do Omie
                await new Promise(r => setTimeout(r, 800));

            } catch (pedidoErr) {
                console.error(`[sincronizarStatusPedidos] Erro pedido ${pedido.id}:`, pedidoErr.message);
                erros++;
            }
        }

        console.log(`[sincronizarStatusPedidos] Finalizado. Faturados verificados: ${pedidos.length}, Cancelados detectados: ${atualizados}, Erros: ${erros}`);

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