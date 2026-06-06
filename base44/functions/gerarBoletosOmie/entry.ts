// deploy v2 — 2026-06-06 — processamento em lotes paralelos (3 simultâneos) + delay reduzido
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_URL_BOLETO = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';
const OMIE_URL_CR = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL', 'ATRASADO']);
const BATCH_SIZE = 3;       // títulos processados em paralelo
const BATCH_DELAY_MS = 600; // delay entre lotes (respeita rate limit Omie)

async function omieCall(base44: any, callOrEndpoint: string, param: any, optsOrUndef?: any) {
  if (typeof optsOrUndef === 'object' && optsOrUndef !== null) return omieCallShared(base44, callOrEndpoint, param, optsOrUndef);
  if (callOrEndpoint && callOrEndpoint.includes('/')) return omieCallShared(base44, callOrEndpoint, param, {});
  return omieCallShared(base44, 'financas/contareceber/', param, { call: callOrEndpoint });
}

async function listarTitulosDoPedido(base44: any, codigoPedido: string | number) {
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 365 * 86400000);
  const futuro = new Date(hoje.getTime() + 90 * 86400000);

  let cnpj: string | null = null;
  let numNf: string | null = null;
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1);
    const pedido = pedidos?.[0];
    if (pedido) {
      cnpj = String(pedido.cliente_cpf_cnpj || '').replace(/\D/g, '');
      numNf = pedido.numero_nota_fiscal ? String(pedido.numero_nota_fiscal).replace(/\D/g, '') : null;
    }
  } catch { /* fallback */ }

  if (!cnpj) {
    console.warn('[listarTitulosDoPedido] Pedido', codigoPedido, 'sem CNPJ');
    return [];
  }

  let acumulados: any[] = [];
  for (let pag = 1; pag <= 5; pag++) {
    const data = await omieCall(OMIE_URL_CR, base44, 'ListarContasReceber', {
      pagina: pag, registros_por_pagina: 100, apenas_importado_api: 'N',
      filtrar_por_data_de: fmt(inicio), filtrar_por_data_ate: fmt(futuro),
      filtrar_por_cpf_cnpj: cnpj, filtrar_apenas_titulos_em_aberto: 'S'
    });
    const lista = data?.conta_receber_cadastro || [];
    acumulados.push(...lista);
    if (pag >= (data?.total_de_paginas || 1)) break;
    await new Promise(r => setTimeout(r, 300));
  }

  if (numNf) {
    const comNf = acumulados.filter((t: any) => String(t.numero_documento || '').replace(/\D/g, '') === numNf);
    if (comNf.length > 0) return comNf;
  }
  return acumulados;
}

// Processa um único título e retorna o resultado
async function processarTitulo(base44: any, titulo: any): Promise<any> {
  const codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento || titulo;
  const status = String(titulo.status_titulo || '').toUpperCase();
  const aberto = !status || STATUS_ABERTOS.has(status);
  const jaTemBoleto = !!(titulo.numero_boleto && String(titulo.numero_boleto).trim()) || titulo.boleto?.cGerado === 'S';

  if (!aberto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Título ${status}` };
  if (jaTemBoleto) return { codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Boleto já gerado: ${titulo.numero_boleto || ''}` };

  try {
    const param = { nCodTitulo: Number(codigo) };
    console.log('[GerarBoleto] Enviando para', codigo);
    const data = await omieCall(OMIE_URL_BOLETO, base44, 'GerarBoleto', param);

    const codStatus = String(data.cCodStatus || '0');
    if (codStatus !== '0' && codStatus !== '') {
      return { codigo_lancamento: codigo, sucesso: false, mensagem: data.cDesStatus || `Erro Omie (status ${codStatus})`, resposta_omie: data };
    }

    const numBoleto = data.cNumBoleto || '';
    const codBarras = data.cCodBarras || '';
    const linkBoleto = data.cLinkBoleto || '';
    const numBancario = data.cNumBancario || '';
    const sucessoReal = !!(String(numBoleto).trim() || String(codBarras).trim() || String(linkBoleto).trim());

    return {
      codigo_lancamento: codigo, sucesso: sucessoReal,
      numero_boleto: numBoleto, codigo_barras: codBarras, linha_digitavel: '',
      link_boleto: linkBoleto, numero_bancario: numBancario,
      data_emissao_boleto: data.dDtEmBol || '',
      mensagem: sucessoReal ? 'Boleto gerado com sucesso' : 'Omie respondeu sem dados de boleto — verifique a conta corrente/convênio bancário no Omie'
    };
  } catch (err: any) {
    const msg = err.message || '';
    return {
      codigo_lancamento: codigo, sucesso: false,
      skip: msg.toLowerCase().includes('liquidado') || msg.toLowerCase().includes('baixado') || msg.toLowerCase().includes('cancelado'),
      mensagem: msg
    };
  }
}

// Processa títulos em lotes paralelos de BATCH_SIZE
async function gerarBoletosTitulos(base44: any, titulos: any[]) {
  const resultados: any[] = [];

  for (let i = 0; i < titulos.length; i += BATCH_SIZE) {
    const lote = titulos.slice(i, i + BATCH_SIZE);
    const loteResultados = await Promise.allSettled(
      lote.map(titulo => processarTitulo(base44, titulo))
    );

    for (const r of loteResultados) {
      if (r.status === 'fulfilled') {
        resultados.push(r.value);
      } else {
        resultados.push({ sucesso: false, mensagem: r.reason?.message || 'Erro desconhecido' });
      }
    }

    // Delay entre lotes (só se há mais lotes restantes)
    if (i + BATCH_SIZE < titulos.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return resultados;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { origem = 'manual', pedidos = [], titulos = [], id_conta_corrente } = body;

    let user: any = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let titulosParaGerar: any[] = [];
    if (origem === 'auto') {
      const codigosPedido = pedidos.map((p: any) => p.codigo_pedido || p).filter(Boolean);
      for (const codigoPedido of codigosPedido) {
        const titulosPedido = await listarTitulosDoPedido(base44, codigoPedido);
        titulosParaGerar.push(...titulosPedido.map((t: any) => ({ ...t, codigo_pedido: codigoPedido })));
      }
    } else {
      if (!Array.isArray(titulos) || titulos.length === 0) return Response.json({ error: 'titulos vazio' }, { status: 400 });
      titulosParaGerar = titulos;
    }

    const startedAt = Date.now();
    const resultados = await gerarBoletosTitulos(base44, titulosParaGerar);
    const duracao_ms = Date.now() - startedAt;
    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceberboleto',
      call: 'GerarBoleto',
      operacao: origem === 'auto' ? 'gerar_boletos_auto' : 'gerar_boletos_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      duracao_ms,
      tentativas: titulosParaGerar.length,
      usuario_email: user.email,
      payload_resposta: JSON.stringify(resultados).slice(0, 2000)
    }).catch(() => {});

    return Response.json({
      sucesso: true, origem,
      total: titulosParaGerar.length, processados: titulosParaGerar.length,
      sucessos, erros, skips, duracao_ms,
      resultados
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
