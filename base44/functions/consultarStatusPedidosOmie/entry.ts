import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
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

async function omieCall(base44, endpoint, param, options = {}) {
  const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
  const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
  
  const body = {
    call: endpoint,
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
  
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://app.omie.com.br/api/v1/geral/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      
      const data = await res.json();
      
      if (!options.skipLog) {
        try {
          await base44.entities.create('LogIntegracaoOmie', {
            endpoint,
            payload_envio: JSON.stringify(param).slice(0, 2000),
            payload_resposta: JSON.stringify(data).slice(0, 2000),
            sucesso: !data.faultcode,
            erro: data.faultstring || null,
            created_date: new Date().toISOString()
          });
        } catch(logErr) { /* silent fail */ }
      }
      
      return data;
    } catch(err) {
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

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

        // Doc Omie: 240 req/min (4/s), 4 simultâneas. Em paralelo controlado é MUITO mais rápido.
        const codigos = omie_codigos.slice(0, 80);
        const resultados = {};
        const PARALELISMO = 3; // conservador (limite 4)
        let apiBloqueada = false;

        async function consultarUm(item, tent = 0) {
            if (item.tipo === 'troca') {
                return [item.pedido_id, { etapa: null, etapa_label: 'Troca (local)', cancelado: false, erro: false }];
            }
            const codigoPedido = Number(item.omie_codigo_pedido);
            if (!codigoPedido) {
                return [item.pedido_id, { etapa: null, etapa_label: 'Sem código Omie', cancelado: false, erro: true }];
            }
            try {
                const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: codigoPedido }, { skipLog: true });

                if (result.faultstring || result.faultcode) {
                    const faultMsg = (result.faultstring || '').toLowerCase();
                    const fc = String(result.faultcode || '');
                    const isRate = faultMsg.includes('limite de requisi') || faultMsg.includes('cota') || faultMsg.includes('aguarde')
                        || fc.includes('425') || fc.includes('520');
                    if (isRate && tent < 3) {
                        await new Promise(r => setTimeout(r, 2000 * (tent + 1)));
                        return consultarUm(item, tent + 1);
                    }
                    const naoEncontrado = faultMsg.includes('não encontrad') || faultMsg.includes('nao encontrad') ||
                        faultMsg.includes('excluíd') || faultMsg.includes('excluid') ||
                        faultMsg.includes('não existe') || faultMsg.includes('nao existe');
                    if (faultMsg.includes('bloqueada por consumo indevido')) {
                        apiBloqueada = true;
                        return [item.pedido_id, { etapa: null, etapa_label: null, cancelado: false, erro: false, api_bloqueada: true }];
                    }
                    return [item.pedido_id, {
                        etapa: naoEncontrado ? '80' : null,
                        etapa_label: naoEncontrado ? 'Excluído no Omie' : null,
                        cancelado: naoEncontrado,
                        erro: !naoEncontrado,
                        api_bloqueada: false,
                        mensagem_erro: result.faultstring || null
                    }];
                }
                if (result.pedido_venda_produto) {
                    const etapa = result.pedido_venda_produto.cabecalho?.etapa || null;
                    const cancelado = result.pedido_venda_produto.infoCadastro?.cancelado === 'S';
                    return [item.pedido_id, {
                        etapa,
                        etapa_label: cancelado ? 'Cancelado' : (ETAPA_LABELS[etapa] || `Etapa ${etapa}`),
                        cancelado,
                        erro: false
                    }];
                }
                return [item.pedido_id, { etapa: null, etapa_label: 'Resposta inesperada', cancelado: false, erro: true }];
            } catch (e) {
                console.error(`[consultarStatusPedidosOmie] Erro pedido ${item.pedido_id}:`, e.message);
                return [item.pedido_id, { etapa: null, etapa_label: 'Erro na consulta', cancelado: false, erro: true }];
            }
        }

        // Lotes paralelos respeitando o rate limit (240 req/min = 4/s)
        for (let i = 0; i < codigos.length; i += PARALELISMO) {
            if (apiBloqueada) {
                for (const r of codigos.slice(i)) {
                    if (!resultados[r.pedido_id]) {
                        resultados[r.pedido_id] = { etapa: null, etapa_label: null, cancelado: false, erro: false, api_bloqueada: true };
                    }
                }
                break;
            }
            const lote = codigos.slice(i, i + PARALELISMO);
            const pares = await Promise.all(lote.map(it => consultarUm(it)));
            for (const [pid, dados] of pares) resultados[pid] = dados;
            // 3 reqs em paralelo a cada ~1s = 180 req/min, abaixo do limite de 240
            if (i + PARALELISMO < codigos.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return Response.json({ sucesso: true, resultados });

    } catch (error) {
        console.error('[consultarStatusPedidosOmie] Erro geral:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});