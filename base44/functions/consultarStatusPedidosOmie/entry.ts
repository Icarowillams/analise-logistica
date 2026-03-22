import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// Mapeamento de etapas do Omie para labels do Kanban
const ETAPA_LABELS = {
    '10': 'Pedido de Venda',
    '20': 'Pedidos Liberados',
    '50': 'Faturar',
    '60': 'Faturado',
    '70': 'Entrega',
    '80': 'Cancelado',
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { omie_codigos } = body; // Array de { pedido_id, omie_codigo_pedido }

        if (!omie_codigos || !Array.isArray(omie_codigos) || omie_codigos.length === 0) {
            return Response.json({ error: 'omie_codigos é obrigatório (array)' }, { status: 400 });
        }

        // Limitar a 350 pedidos por chamada
        const codigos = omie_codigos.slice(0, 350);
        const resultados = {};

        for (const item of codigos) {
            const codigoPedido = Number(item.omie_codigo_pedido);
            if (!codigoPedido) {
                resultados[item.pedido_id] = { etapa: null, etapa_label: 'Sem código Omie', cancelado: false, erro: true };
                continue;
            }

            try {
                const response = await fetch(OMIE_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        call: "ConsultarPedido",
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo_pedido: codigoPedido }]
                    })
                });

                const text = await response.text();
                let result;
                try { result = JSON.parse(text); } catch (e) {
                    resultados[item.pedido_id] = { etapa: null, etapa_label: 'Erro de resposta', cancelado: false, erro: true };
                    continue;
                }

                if (result.faultstring || result.faultcode) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    const naoEncontrado = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                        faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                        faultMsg.includes('não existe') || faultMsg.includes('nao existe');
                    const apiBloqueada = faultMsg.includes('bloqueada por consumo indevido');
                    
                    resultados[item.pedido_id] = {
                        etapa: naoEncontrado ? '80' : null,
                        etapa_label: naoEncontrado ? 'Excluído no Omie' : (apiBloqueada ? 'Omie Bloqueado' : null),
                        cancelado: naoEncontrado,
                        erro: !naoEncontrado,
                        api_bloqueada: apiBloqueada,
                        mensagem_erro: result.faultstring || null
                    };
                } else if (result.pedido_venda_produto) {
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa || null;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado === 'S';

                    resultados[item.pedido_id] = {
                        etapa,
                        etapa_label: cancelado ? 'Cancelado' : (ETAPA_LABELS[etapa] || `Etapa ${etapa}`),
                        cancelado,
                        erro: false
                    };
                } else {
                    resultados[item.pedido_id] = { etapa: null, etapa_label: 'Resposta inesperada', cancelado: false, erro: true };
                }

                // Rate limit do Omie - aguardar entre requisições
                await new Promise(r => setTimeout(r, 350));

            } catch (e) {
                console.error(`[consultarStatusPedidosOmie] Erro pedido ${item.pedido_id}:`, e.message);
                resultados[item.pedido_id] = { etapa: null, etapa_label: 'Erro na consulta', cancelado: false, erro: true };
            }
        }

        return Response.json({ sucesso: true, resultados });

    } catch (error) {
        console.error('[consultarStatusPedidosOmie] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});