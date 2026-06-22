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
    numero_parcela: '',
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
  });

  return { titulos, cnpjsComFalha, houveFalhaOmie: cnpjsComFalha.size > 0 };
}