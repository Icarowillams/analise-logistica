import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });

  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring || '').toLowerCase();
    const code = String(data.faultcode || '');
    const retry = res.status === 429 || code.includes('425') || code.includes('520') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
    if (retry && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

function extrairPedido(consulta, pedidoOriginal) {
  const pedido = consulta?.pedido_venda_produto || consulta || {};
  const cab = pedido.cabecalho || {};
  const info = pedido.informacoes_adicionais || {};
  const texto = JSON.stringify(consulta || {}).toLowerCase();
  const etapa = String(cab.etapa || pedidoOriginal.etapa || '');
  const numeroNf = cab.numero_nf || cab.numero_nota_fiscal || info.numero_nf || info.numero_nota_fiscal || pedidoOriginal.numero_nf || '';

  return {
    etapa,
    status_pedido: cab.status_pedido || cab.status || pedidoOriginal.status_pedido || '',
    numero_nf: numeroNf,
    faturado: etapa === '60' || !!numeroNf,
    cancelado: texto.includes('cancelado') || texto.includes('cancelada')
  };
}

function definirStatusCarga(pedidosStatus, statusAtual) {
  if (pedidosStatus.length === 0) return statusAtual || 'montagem';
  if (pedidosStatus.every(p => p.cancelado)) return 'cancelada';
  if (pedidosStatus.every(p => p.faturado)) return 'faturada';
  if (pedidosStatus.some(p => p.etapa === '60')) return 'faturada';
  if (pedidosStatus.some(p => p.etapa === '50')) return 'pronta';
  return statusAtual || 'conferindo';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const listLimit = Math.min(Number(body.list_limit || 500), 500);
    const syncLimit = Math.min(Number(body.sync_limit || 50), listLimit);

    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', listLimit);
    const cargasAtualizadas = [];

    for (const carga of cargas.slice(0, syncLimit)) {
      const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
      if (pedidos.length === 0) {
        cargasAtualizadas.push(carga);
        continue;
      }

      const pedidosStatus = [];
      const pedidosAtualizados = [];

      for (const pedido of pedidos) {
        const codigo = pedido.codigo_pedido || pedido.codigo_pedido_integracao;
        if (!codigo) {
          pedidosAtualizados.push(pedido);
          continue;
        }

        try {
          const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo) });
          const status = extrairPedido(consulta, pedido);
          pedidosStatus.push(status);
          pedidosAtualizados.push({
            ...pedido,
            etapa: status.etapa || pedido.etapa,
            status_pedido: status.status_pedido || pedido.status_pedido,
            numero_nf: status.numero_nf || pedido.numero_nf
          });
        } catch (error) {
          pedidosAtualizados.push(pedido);
        }

        await new Promise(r => setTimeout(r, 250));
      }

      const novoStatus = definirStatusCarga(pedidosStatus, carga.status_carga);
      const precisaAtualizar = novoStatus !== carga.status_carga || JSON.stringify(pedidosAtualizados) !== JSON.stringify(pedidos);

      if (precisaAtualizar) {
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          status_carga: novoStatus,
          pedidos_omie: pedidosAtualizados,
          data_faturamento: novoStatus === 'faturada' ? (carga.data_faturamento || new Date().toISOString()) : carga.data_faturamento
        });
        cargasAtualizadas.push({ ...carga, status_carga: novoStatus, pedidos_omie: pedidosAtualizados });
      } else {
        cargasAtualizadas.push(carga);
      }
    }

    const resto = cargas.slice(syncLimit);

    return Response.json({
      sucesso: true,
      cargas: [...cargasAtualizadas, ...resto],
      sincronizadas: cargasAtualizadas.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});