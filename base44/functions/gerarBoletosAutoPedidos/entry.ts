import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🤖 Geração AUTOMÁTICA de boletos a partir de uma lista de códigos de pedido Omie.
// Fluxo:
//   1. Para cada pedido, busca os títulos (ContasReceber) vinculados via ListarContasReceber filtrando por nCodPed.
//   2. Para cada título em ABERTO e SEM boleto, chama GerarBoleto.
// Pode ser chamada:
//   - pelo frontend (createClientFromRequest com usuário autenticado)
//   - por outras backend functions / webhooks (createClient + token de serviço)

const OMIE_CR_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_CR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Lista títulos em aberto vinculados a um pedido Omie (nCodPed)
async function listarTitulosDoPedido(codigoPedido) {
  // O Omie aceita filtro por nCodPed em ListarContasReceber
  const data = await omieCall('ListarContasReceber', {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: 'N',
    filtrar_por_nCodPed: Number(codigoPedido)
  }).catch(async () => {
    // Fallback: se o param filtrar_por_nCodPed não for aceito, lista geral e filtra em memória
    const todos = await omieCall('ListarContasReceber', {
      pagina: 1,
      registros_por_pagina: 500,
      apenas_importado_api: 'N'
    });
    return todos;
  });
  const lista = data?.conta_receber_cadastro || [];
  return lista.filter(t => String(t.nCodPed || t.codigo_pedido_omie || '') === String(codigoPedido));
}

async function gerarBoletosParaPedidos(base44, codigosPedido, usuarioEmail) {
  const resultados = [];
  for (const codPedido of (codigosPedido || [])) {
    try {
      const titulos = await listarTitulosDoPedido(codPedido);
      if (titulos.length === 0) {
        resultados.push({ codigo_pedido: codPedido, sucesso: false, motivo: 'Nenhum título encontrado para o pedido' });
        continue;
      }
      for (const t of titulos) {
        const cod = t.codigo_lancamento_omie;
        const liquidado = t.status_titulo && t.status_titulo !== 'ABERTO';
        const jaTemBoleto = !!(t.numero_boleto && String(t.numero_boleto).trim());
        if (liquidado || jaTemBoleto) {
          resultados.push({
            codigo_pedido: codPedido,
            codigo_lancamento: cod,
            sucesso: false,
            skip: true,
            motivo: liquidado ? `Título ${t.status_titulo}` : `Boleto já gerado: ${t.numero_boleto}`
          });
          continue;
        }
        try {
          const data = await omieCall('GerarBoleto', { codigo_lancamento: Number(cod) });
          resultados.push({
            codigo_pedido: codPedido,
            codigo_lancamento: cod,
            sucesso: true,
            numero_boleto: data.numero_boleto || data.nNumBoleto || '',
            linha_digitavel: data.linha_digitavel || data.cLinDig || '',
            link_boleto: data.link_boleto || data.cLinkBoleto || ''
          });
        } catch (err) {
          resultados.push({ codigo_pedido: codPedido, codigo_lancamento: cod, sucesso: false, motivo: err.message });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      resultados.push({ codigo_pedido: codPedido, sucesso: false, motivo: err.message });
    }
  }

  const sucessos = resultados.filter(r => r.sucesso).length;
  const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
  const skips = resultados.filter(r => r.skip).length;

  try {
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceber',
      call: 'GerarBoleto',
      operacao: 'gerar_boletos_auto',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      tentativas: codigosPedido.length,
      usuario_email: usuarioEmail || 'sistema',
      payload_resposta: JSON.stringify(resultados).slice(0, 2000)
    });
  } catch {}

  return { sucesso: true, total_pedidos: codigosPedido.length, sucessos, erros, skips, resultados };
}

// Endpoint HTTP — permite chamada manual via frontend
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigos_pedido = [] } = body;
    if (!Array.isArray(codigos_pedido) || codigos_pedido.length === 0) {
      return Response.json({ error: 'codigos_pedido vazio' }, { status: 400 });
    }

    const resultado = await gerarBoletosParaPedidos(base44, codigos_pedido, user.email);
    return Response.json(resultado);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});