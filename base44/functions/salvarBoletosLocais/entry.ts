// Write-through dos boletos JÁ EXISTENTES no Omie → LogEmissaoBoleto.
// Recebe uma lista de títulos (formato unificado de listarContasReceberOmie) que JÁ TÊM boleto
// confirmado no Omie (boleto_gerado=true) e grava/atualiza cada um localmente.
// Idempotente por codigo_lancamento (filter → update/create, nunca duplica).
//
// Chamado pela tela (buscarTitulosCarga) ao abrir uma carga: assim a 1ª abertura popula o
// cache local e o próximo F5 lê do LOCAL (instantâneo, imune a rate limit do Omie).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { titulos = [], numero_carga = '', carga_id = '' } = body;

    if (!Array.isArray(titulos) || titulos.length === 0) {
      return Response.json({ sucesso: true, gravados: 0, atualizados: 0, ignorados: 0 });
    }

    let gravados = 0;
    let atualizados = 0;
    let ignorados = 0;
    let duplicados_removidos = 0;

    // 1) DEDUPE da lista de entrada por codigo_lancamento (não gravar o mesmo 2x no lote).
    const vistos = new Set();
    const titulosUnicos = [];
    for (const t of titulos) {
      const codigo = String(t.codigo_lancamento || '').trim();
      const temBoleto = t.boleto_gerado === true || !!(String(t.numero_boleto || '').trim());
      if (!codigo || !temBoleto || vistos.has(codigo)) { ignorados++; continue; }
      vistos.add(codigo);
      titulosUnicos.push({ ...t, _codigo: codigo });
    }

    // 2) PRÉ-CARGA em lote dos existentes por codigo_lancamento (decisão em memória, sem corrida).
    //    Mapa codigo_lancamento (string) -> array de registros existentes (para auto-cura).
    const existentesPorCodigo = new Map();
    const codigosLote = titulosUnicos.map(t => t._codigo);
    for (const codigo of codigosLote) {
      const achados = await base44.asServiceRole.entities.LogEmissaoBoleto.filter(
        { codigo_lancamento: codigo }, '-created_date', 50
      ).catch(() => []);
      if (achados?.length) {
        existentesPorCodigo.set(codigo, achados.filter(r => String(r.codigo_lancamento || '').trim() === codigo));
      }
    }

    // 2.1) FALLBACK pelos Pedidos: nome do cliente e Nº NF vêm dos campos REAIS do Pedido
    //      (cliente_nome / numero_nota_fiscal), nunca de nome_cliente/numero_nf inexistentes.
    //      Cruzamento por numero_pedido normalizado (sem zeros à esquerda).
    const normPed = (v) => String(v || '').trim().replace(/^0+/, '');
    const numerosPedido = [...new Set(titulosUnicos
      .map(t => normPed(t.numero_pedido_vinculado || t.numero_pedido))
      .filter(Boolean))];
    const pedidoPorNumero = new Map();
    for (let i = 0; i < numerosPedido.length; i += 100) {
      const lote = numerosPedido.slice(i, i + 100);
      const peds = await base44.asServiceRole.entities.Pedido.filter(
        { numero_pedido: { $in: lote } }, '-data_faturamento', 200
      ).catch(() => []);
      (peds || []).forEach(p => {
        const chave = normPed(p.numero_pedido);
        if (chave && !pedidoPorNumero.has(chave)) pedidoPorNumero.set(chave, p);
      });
    }

    for (const t of titulosUnicos) {
      const codigo = t._codigo;
      const numeroPedidoNorm = normPed(t.numero_pedido_vinculado || t.numero_pedido);
      const ped = numeroPedidoNorm ? pedidoPorNumero.get(numeroPedidoNorm) : null;

      const payload = {
        codigo_lancamento: codigo,
        numero_pedido: numeroPedidoNorm,
        numero_nf: String(t.numero_documento || t.numero_nf || '').trim() || String(ped?.numero_nota_fiscal || '').trim(),
        numero_parcela: String(t.numero_parcela || '').trim() || '001/001',
        numero_boleto: String(t.numero_boleto || '').trim(),
        numero_bancario: String(t.numero_bancario || '').trim(),
        codigo_barras: String(t.codigo_barras || '').trim(),
        linha_digitavel: String(t.linha_digitavel || '').trim(),
        link_boleto: String(t.url_boleto || t.link_boleto || '').trim(),
        valor: Number(t.valor_documento || t.valor || 0),
        data_emissao_boleto: t.data_emissao_boleto || '',
        data_vencimento: t.data_vencimento || '',
        cliente_nome: t.nome_cliente || t.cliente_nome || ped?.cliente_nome || ped?.cliente_nome_fantasia || '',
        cliente_id: t.cliente_id || '',
        numero_carga: String(numero_carga || ''),
        carga_id: String(carga_id || ''),
        status: 'gerado',
        usuario_email: user.email || 'sistema',
        usuario_nome: user.full_name || ''
      };

      try {
        const existentes = existentesPorCodigo.get(codigo) || [];
        if (existentes.length > 0) {
          // Mais recente fica como canônico (lista já vem ordenada por -created_date).
          const canonico = existentes[0];

          // AUTO-CURA: se houver mais de um com o mesmo codigo_lancamento, remove os demais.
          for (let i = 1; i < existentes.length; i++) {
            await base44.asServiceRole.entities.LogEmissaoBoleto.delete(existentes[i].id).catch(() => {});
            duplicados_removidos++;
          }

          // Não sobrescreve campos já preenchidos com vazio.
          const upd = { ...payload };
          if (!payload.numero_carga && canonico.numero_carga) upd.numero_carga = canonico.numero_carga;
          if (!payload.carga_id && canonico.carga_id) upd.carga_id = canonico.carga_id;
          if (!payload.cliente_nome && canonico.cliente_nome) upd.cliente_nome = canonico.cliente_nome;
          if (!payload.cliente_id && canonico.cliente_id) upd.cliente_id = canonico.cliente_id;
          if (!payload.numero_nf && canonico.numero_nf) upd.numero_nf = canonico.numero_nf;
          if (!payload.data_vencimento && canonico.data_vencimento) upd.data_vencimento = canonico.data_vencimento;
          if ((!payload.numero_parcela || payload.numero_parcela === '001/001') && canonico.numero_parcela) upd.numero_parcela = canonico.numero_parcela;
          await base44.asServiceRole.entities.LogEmissaoBoleto.update(canonico.id, upd);
          existentesPorCodigo.set(codigo, [{ ...canonico, ...upd }]);
          atualizados++;
        } else {
          const criado = await base44.asServiceRole.entities.LogEmissaoBoleto.create(payload);
          // Registra na pré-carga para blindar contra duplicata dentro do mesmo lote.
          existentesPorCodigo.set(codigo, [criado]);
          gravados++;
        }
      } catch (e) {
        console.warn('[salvarBoletosLocais] falha ao gravar', codigo, e?.message);
        ignorados++;
      }
    }

    return Response.json({ sucesso: true, gravados, atualizados, ignorados, duplicados_removidos });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});