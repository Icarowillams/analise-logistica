import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🤖 Geração AUTOMÁTICA de boletos para uma lista de códigos de pedido Omie.
// Fluxo:
//   1. Para cada pedido, busca os títulos (ContasReceber) vinculados via ListarContasReceber.
//   2. Para títulos em ABERTO/A VENCER e SEM boleto ainda gerado, chama GerarBoleto.
// Importante: o Omie aceita GerarBoleto para qualquer título — a decisão de gerar
// boleto vem do cadastro do cliente, não do tipo_documento do título.

const OMIE_CR_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

// Status considerados "em aberto" pelo Omie
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL']);

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_CR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isTransient = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isTransient && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Lista TODOS os títulos do Omie do período recente e filtra por nCodPedido.
// O Omie NÃO oferece filtro nativo por pedido em ListarContasReceber,
// mas o título tem o campo nCodPedido vinculado.
async function listarTitulosDoPedido(codigoPedido) {
  const titulos = [];
  let pagina = 1;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 60 * 86400000); // últimos 60 dias de emissão
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  while (pagina <= 10) {
    const data = await omieCall('ListarContasReceber', {
      pagina,
      registros_por_pagina: 100,
      apenas_importado_api: 'N',
      filtrar_por_emissao_de: fmt(inicio),
      filtrar_por_emissao_ate: fmt(hoje)
    });
    const lista = data?.conta_receber_cadastro || [];
    titulos.push(...lista.filter(t => String(t.nCodPedido || '') === String(codigoPedido)));
    if (titulos.length > 0 || pagina >= (data?.total_de_paginas || 1)) break;
    pagina++;
  }
  return titulos;
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
        const status = String(t.status_titulo || '').toUpperCase();
        const aberto = STATUS_ABERTOS.has(status);
        const jaTemBoleto = !!(t.numero_boleto && String(t.numero_boleto).trim())
          || !!(t.boleto?.cNumBoleto && String(t.boleto.cNumBoleto).trim())
          || t.boleto?.cGerado === 'S';

        if (!aberto) {
          resultados.push({ codigo_pedido: codPedido, codigo_lancamento: cod, sucesso: false, skip: true, motivo: `Título ${status}` });
          continue;
        }
        if (jaTemBoleto) {
          resultados.push({ codigo_pedido: codPedido, codigo_lancamento: cod, sucesso: false, skip: true, motivo: 'Boleto já gerado' });
          continue;
        }
        try {
          await omieCall('GerarBoleto', { codigo_lancamento: Number(cod) });
          resultados.push({ codigo_pedido: codPedido, codigo_lancamento: cod, sucesso: true });
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