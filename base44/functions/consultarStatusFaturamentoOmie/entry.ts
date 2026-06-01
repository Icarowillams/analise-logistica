import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = data.faultstring.toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Lista pedidos da etapa 60 (Faturado) e cruza com ListarNF para devolver
// o status real de cada NF: emitida / rejeitada / cancelada / denegada / aguardando.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { registros_por_pagina = 50, pagina = 1, incluir_cancelados = false } = body;

    // 1) Pedidos etapa 60
    let pedidosData;
    try {
      pedidosData = await omieCall(OMIE_PEDIDO_URL, 'ListarPedidos', {
        pagina,
        registros_por_pagina,
        apenas_importado_api: 'N',
        etapa: '60'
      });
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e.message)) {
        return Response.json({ sucesso: true, pedidos: [] });
      }
      throw e;
    }

    const pedidos = (pedidosData.pedido_venda_produto || []).map(p => ({
      codigo_pedido: String(p.cabecalho?.codigo_pedido || ''),
      codigo_pedido_integracao: p.cabecalho?.codigo_pedido_integracao || '',
      numero_pedido: p.cabecalho?.numero_pedido || '',
      codigo_cliente: String(p.cabecalho?.codigo_cliente || ''),
      data_previsao: p.cabecalho?.data_previsao || '',
      etapa: p.cabecalho?.etapa || '',
      valor_total_pedido: p.total_pedido?.valor_total_pedido || 0,
      quantidade_itens: (p.det || []).length
    }));

    if (pedidos.length === 0) {
      return Response.json({ sucesso: true, pedidos: [] });
    }

    // 2) Consulta NFs nos últimos 90 dias
    const hoje = new Date();
    const dias90 = new Date(hoje.getTime() - 90 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    const nfsMap = {}; // codigo_pedido -> nf
    let paginaNf = 1;
    let totalPaginas = 1;
    do {
      try {
        const nfData = await omieCall(OMIE_NF_URL, 'ListarNF', {
          pagina: paginaNf,
          registros_por_pagina: 200,
          dEmiInicial: fmt(dias90),
          dEmiFinal: fmt(hoje)
        });
        totalPaginas = nfData.nTotPaginas || 1;
        (nfData.nfCadastro || []).forEach(nf => {
          const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
          if (idPed) {
            nfsMap[idPed] = {
              numero_nf: nf.ide?.nNF || nf.cNumero || null,
              serie: nf.ide?.serie || nf.cSerie || null,
              chave: nf.compl?.cChaveNFe || nf.cChaveNFe || null,
              cStat: nf.ide?.cStat || nf.cStatus || null,
              dEmi: nf.ide?.dEmi || nf.dEmiNF || null,
              valor: nf.total?.ICMSTot?.vNF || nf.nValorNF || null
            };
          }
        });
        paginaNf++;
      } catch (e) {
        if (/n[ãa]o existem registros/i.test(e.message)) break;
        throw e;
      }
      if (paginaNf > 5) break; // limite de segurança
    } while (paginaNf <= totalPaginas);

    // 3) Cruza pedidos com NFs e classifica status real
    const enriquecidosTodos = pedidos.map(p => {
      const nf = nfsMap[p.codigo_pedido];
      let status_real = 'aguardando_nf'; // default: etapa 60 mas sem NF localizada
      let label = 'Aguardando NF';

      if (nf) {
        const stat = String(nf.cStat || '');
        // Códigos SEFAZ:
        // 100 = Autorizado | 101 = Cancelamento autorizado
        // 110, 301, 302 = Denegada | 135 = Evento registrado
        // 200-300 = rejeições
        if (stat === '100' || stat === '150') {
          status_real = 'emitida';
          label = `NF ${nf.numero_nf} emitida`;
        } else if (stat === '101' || stat === '135') {
          status_real = 'cancelada';
          label = `NF ${nf.numero_nf} cancelada`;
        } else if (['110', '301', '302', '205'].includes(stat)) {
          status_real = 'denegada';
          label = `NF denegada (${stat})`;
        } else if (stat && Number(stat) >= 200 && Number(stat) < 300) {
          status_real = 'rejeitada';
          label = `NF rejeitada (${stat})`;
        } else if (nf.numero_nf) {
          status_real = 'emitida';
          label = `NF ${nf.numero_nf}`;
        }
      }

      return {
        ...p,
        numero_nf: nf?.numero_nf || null,
        chave_nfe: nf?.chave || null,
        cStat: nf?.cStat || null,
        status_real,
        status_label: label
      };
    });

    const enriquecidos = incluir_cancelados
      ? enriquecidosTodos
      : enriquecidosTodos.filter(p => p.status_real !== 'cancelada' && p.status_real !== 'denegada');

    return Response.json({
      sucesso: true,
      pedidos: enriquecidos,
      total: enriquecidos.length,
      com_nf: enriquecidos.filter(p => p.numero_nf).length,
      rejeitadas: enriquecidos.filter(p => p.status_real === 'rejeitada').length,
      canceladas: enriquecidos.filter(p => p.status_real === 'cancelada').length,
      aguardando: enriquecidos.filter(p => p.status_real === 'aguardando_nf').length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});