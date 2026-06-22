// ─────────────────────────────────────────────────────────────────────────────
// Helper UNIFICADO de busca de títulos/boletos de uma carga.
// Usado pelas DUAS abas (Emissão e Consulta/Impressão) para nunca divergirem.
//
// Arquitetura (espelha o que resolveu as NFs: LOCAL primeiro, Omie sob demanda):
//   A) Boletos JÁ emitidos vêm do LOCAL (LogEmissaoBoleto) — instantâneo, sem Omie.
//      Elo com a carga = numero_pedido (carga_id/numero_carga vêm vazios no log).
//   B) Títulos AINDA SEM boleto → busca no Omie EM PARALELO (runPool, concorrência 5),
//      só para os CNPJs dos pedidos que NÃO casaram com nenhum boleto local.
//      Janela de EMISSÃO ±7 dias da data da carga, apenas_pendentes:false, 1 página/CNPJ.
//   C) Funde A+B por codigo_lancamento (dedup).
// ─────────────────────────────────────────────────────────────────────────────
import { base44 } from '@/api/base44Client';
import { runPool } from '@/lib/concurrentPool';

const somenteNumeros = (v) => String(v || '').replace(/\D/g, '');
// Normaliza nº de pedido p/ casar Pedido (zero-padded 15 díg.) com título (sem padding).
const numLimpo = (v) => String(v || '').trim().replace(/^0+/, '');
const fmtBR = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// Janela de emissão ±7 dias da data da carga (ou hoje se ausente).
function janelaEmissao(carga) {
  let ref = new Date();
  if (carga?.data_carga) {
    const [y, m, d] = String(carga.data_carga).split('-');
    if (y && m && d) ref = new Date(Number(y), Number(m) - 1, Number(d));
  }
  return {
    data_de: fmtBR(new Date(ref.getTime() - 7 * 86400000)),
    data_ate: fmtBR(new Date(ref.getTime() + 7 * 86400000))
  };
}

// Converte um LogEmissaoBoleto local no mesmo formato dos títulos do Omie,
// para a UI tratar os dois de forma idêntica.
function logParaTitulo(l) {
  return {
    codigo_lancamento: l.codigo_lancamento,
    numero_documento: l.numero_nf || '',
    numero_parcela: l.numero_parcela || '001/001',
    data_emissao: l.data_emissao_boleto || '',
    data_vencimento: l.data_vencimento || '',
    valor_documento: l.valor || 0,
    status_titulo: 'ABERTO',
    cnpj_cpf: '',
    nome_cliente: l.cliente_nome || '',
    nome_fantasia: '',
    boleto_gerado: true,
    numero_boleto: l.numero_boleto || '',
    numero_bancario: l.numero_bancario || '',
    codigo_barras: l.codigo_barras || '',
    linha_digitavel: l.linha_digitavel || '',
    url_boleto: l.link_boleto || '',
    codigo_pedido_omie: '',
    numero_pedido_vinculado: l.numero_pedido || '',
    _origem: 'local'
  };
}

// Detecta rate-limit / bloqueio temporário do Omie (425/429/"consumo indevido"/"bloqueada"/"aguarde").
// Falha por rate limit ≠ "título inexistente" — precisamos distinguir os dois.
function isRateLimit(msg) {
  const m = String(msg || '').toLowerCase();
  return m.includes('425') || m.includes('429') || m.includes('consumo indevido') ||
         m.includes('bloqueada') || m.includes('bloqueio') || m.includes('aguarde') ||
         m.includes('cota') || m.includes('redundant') || m.includes('timeout') ||
         m.includes('abort') || m.includes('failed to fetch');
}

// Busca títulos de UM CNPJ no Omie com retry/backoff (2s, 5s, 10s) em rate limit.
// Retorna { titulos } em sucesso, ou { falha: true } se esgotar as tentativas (rate limit/erro).
async function buscarTitulosCnpj(cnpj, janela) {
  const esperas = [2000, 5000, 10000]; // backoff crescente
  for (let tentativa = 0; tentativa <= esperas.length; tentativa++) {
    try {
      const { data } = await base44.functions.invoke('listarContasReceberOmie', {
        data_de: janela.data_de,
        data_ate: janela.data_ate,
        filtrar_por_data: 'E',
        cnpj_cpf: cnpj,
        apenas_pendentes: false,
        pagina: 1,
        registros_por_pagina: 100
      });
      if (data?.sucesso) return { titulos: data.titulos || [] };
      // Resposta de erro: só re-tenta se for rate limit e ainda houver tentativas
      if (isRateLimit(data?.error) && tentativa < esperas.length) {
        await new Promise(r => setTimeout(r, esperas[tentativa]));
        continue;
      }
      // Erro NÃO rate-limit (ex: credenciais) — não é "título inexistente", marca falha
      return { falha: true };
    } catch (e) {
      if (isRateLimit(e.message) && tentativa < esperas.length) {
        await new Promise(r => setTimeout(r, esperas[tentativa]));
        continue;
      }
      return { falha: true };
    }
  }
  return { falha: true };
}

/**
 * Fallback LOCAL puro: lê só o LogEmissaoBoleto casado pelos pedidos da carga.
 * Usado quando a busca completa (com Omie) falha — degrada com elegância mostrando
 * o que já está no cache local, sem quebrar a tela com erro vermelho.
 * @param {object} carga objeto Carga (com pedidos_omie)
 * @returns {Promise<Array>} títulos no formato unificado
 */
export async function buscarBoletosLocaisCarga(carga) {
  const pedidos = carga?.pedidos_omie || [];
  if (pedidos.length === 0) return [];
  const numPedidosCarga = new Set(pedidos.map(p => String(p.numero_pedido || '').trim()).filter(Boolean));
  const logs = await base44.entities.LogEmissaoBoleto.list('-created_date', 1000).catch(() => []);
  return logs
    .filter(l => l.status === 'gerado' && numPedidosCarga.has(String(l.numero_pedido || '').trim()))
    .map(logParaTitulo);
}

/**
 * Busca os títulos/boletos de uma carga (local + Omie paralelo).
 * @param {object} carga objeto Carga (com pedidos_omie)
 * @returns {Promise<{titulos: Array, cnpjsComFalha: Set<string>, houveFalhaOmie: boolean}>}
 *   titulos: formato unificado (dedup por codigo_lancamento)
 *   cnpjsComFalha: CNPJs cuja busca no Omie FALHOU (rate limit/erro) — "não consegui verificar"
 *   houveFalhaOmie: true se qualquer CNPJ falhou
 */
export async function buscarTitulosCarga(carga) {
  const pedidos = carga?.pedidos_omie || [];
  if (pedidos.length === 0) return { titulos: [], cnpjsComFalha: new Set(), houveFalhaOmie: false };

  const numPedidosCarga = new Set(
    pedidos.map(p => String(p.numero_pedido || '').trim()).filter(Boolean)
  );

  // Map numero_pedido (sem padding) → { nome, id } a partir dos Pedidos da carga.
  // O ListarContasReceber do Omie NÃO retorna nome do cliente — preenchemos daqui.
  const numerosPedido = [...new Set(pedidos.map(p => numLimpo(p.numero_pedido)).filter(Boolean))];
  const mapaCliente = new Map();
  if (numerosPedido.length > 0) {
    const pedidosLocais = await base44.entities.Pedido.filter({}, '-created_date', 2000).catch(() => []);
    for (const pl of pedidosLocais) {
      const k = numLimpo(pl.numero_pedido);
      if (k && numerosPedido.includes(k) && (pl.cliente_nome || pl.numero_nota_fiscal)) {
        if (!mapaCliente.has(k)) mapaCliente.set(k, { nome: pl.cliente_nome || '', fantasia: pl.cliente_nome_fantasia || '', id: pl.cliente_id || '', nf: pl.numero_nota_fiscal || '' });
      }
    }
  }
  // Preenche nome/fantasia/id/NF de um título a partir do Pedido (só quando faltar).
  const enriquecerCliente = (t) => {
    const k = numLimpo(t.numero_pedido_vinculado || t.numero_pedido);
    const info = k && mapaCliente.get(k);
    if (!info) return t;
    if ((!t.nome_cliente || !String(t.nome_cliente).trim()) && info.nome) t.nome_cliente = info.nome;
    if (!t.nome_fantasia && info.fantasia) t.nome_fantasia = info.fantasia;
    if (!t.cliente_id && info.id) t.cliente_id = info.id;
    // Nº NF não vem do ListarContasReceber → preenche de Pedido.numero_nota_fiscal.
    if ((!t.numero_documento || !String(t.numero_documento).trim()) && info.nf) t.numero_documento = info.nf;
    return t;
  };

  // ── A) LOCAL: boletos já emitidos, casados por numero_pedido ──────────────
  const logs = await base44.entities.LogEmissaoBoleto.list('-created_date', 1000).catch(() => []);
  const boletosLocais = logs.filter(l =>
    l.status === 'gerado' &&
    numPedidosCarga.has(String(l.numero_pedido || '').trim())
  );
  const titulosLocais = boletosLocais.map(logParaTitulo);
  const pedidosComBoletoLocal = new Set(
    boletosLocais.map(l => String(l.numero_pedido || '').trim())
  );

  // ── B) OMIE PARALELO: só CNPJs de pedidos SEM boleto local ────────────────
  const cnpjsFaltantes = [...new Set(
    pedidos
      .filter(p => !pedidosComBoletoLocal.has(String(p.numero_pedido || '').trim()))
      .map(p => somenteNumeros(p.cnpj_cpf_cliente))
      .filter(c => c.length >= 11)
  )];

  console.log(
    `[Boletos] carga ${carga?.numero_carga}: ${titulosLocais.length} boleto(s) LOCAL (instantâneo) + ${cnpjsFaltantes.length} CNPJ(s) p/ Omie paralelo`
  );

  let titulosOmie = [];
  const cnpjsComFalha = new Set();
  if (cnpjsFaltantes.length > 0) {
    const janela = janelaEmissao(carga);
    const resultados = await runPool(
      cnpjsFaltantes,
      // Cada CNPJ tem retry/backoff próprio e devolve { cnpj, titulos } OU { cnpj, falha }.
      async (cnpj) => {
        const r = await buscarTitulosCnpj(cnpj, janela);
        return { cnpj, ...r };
      },
      { concorrencia: 5 }
    );
    for (const r of resultados) {
      // Erro do próprio runPool (não capturado) também conta como falha de verificação.
      if (!r.ok) continue;
      const val = r.value;
      if (val.falha) cnpjsComFalha.add(val.cnpj);
      else titulosOmie = titulosOmie.concat(val.titulos || []);
    }
    if (cnpjsComFalha.size > 0) {
      console.warn(`[Boletos] carga ${carga?.numero_carga}: ${cnpjsComFalha.size} CNPJ(s) com FALHA de busca (Omie limitou) — NÃO são "sem título"`);
    }
  }

  // ── C) FUNDE local + Omie, dedup por codigo_lancamento (local tem prioridade) ──
  const porCodigo = new Map();
  for (const t of titulosLocais) porCodigo.set(String(t.codigo_lancamento), t);
  for (const t of titulosOmie) {
    const cod = String(t.codigo_lancamento);
    if (!porCodigo.has(cod)) porCodigo.set(cod, t);
  }

  // Mantém só títulos que casam com pedidos desta carga (por numero_pedido_vinculado/codigo_pedido).
  const codPedidosCarga = new Set(pedidos.map(p => String(p.codigo_pedido || '').trim()).filter(Boolean));
  const titulos = [...porCodigo.values()].filter(t => {
    if (t._origem === 'local') return true; // já filtrado por numero_pedido
    const numV = String(t.numero_pedido_vinculado || '').trim();
    const codV = String(t.codigo_pedido_omie || '').trim();
    return (numV && numPedidosCarga.has(numV)) || (codV && codPedidosCarga.has(codV));
  }).map(enriquecerCliente);

  // ── WRITE-THROUGH: grava localmente os boletos do OMIE que ainda não estão no log ──
  // Ao abrir a carga uma vez, popula o LogEmissaoBoleto → próximo F5 vem do LOCAL,
  // imune a rate limit. Fire-and-forget: não atrasa nem quebra a tela.
  const novosDoOmie = titulos.filter(t =>
    t._origem !== 'local' && t.boleto_gerado === true && String(t.codigo_lancamento || '').trim()
  );
  if (novosDoOmie.length > 0) {
    base44.functions.invoke('salvarBoletosLocais', {
      titulos: novosDoOmie,
      numero_carga: carga?.numero_carga || '',
      carga_id: carga?.id || ''
    }).catch(() => {});
  }

  return { titulos, cnpjsComFalha, houveFalhaOmie: cnpjsComFalha.size > 0 };
}