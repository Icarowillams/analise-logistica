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

    // Dedup por codigo_lancamento na própria entrada
    const vistos = new Set();

    for (const t of titulos) {
      const codigo = String(t.codigo_lancamento || '').trim();
      const temBoleto = t.boleto_gerado === true ||
        !!(String(t.numero_boleto || '').trim());
      if (!codigo || !temBoleto || vistos.has(codigo)) { ignorados++; continue; }
      vistos.add(codigo);

      const payload = {
        codigo_lancamento: codigo,
        numero_pedido: String(t.numero_pedido_vinculado || t.numero_pedido || '').trim(),
        numero_nf: String(t.numero_documento || t.numero_nf || '').trim(),
        numero_parcela: String(t.numero_parcela || '').trim() || '001/001',
        numero_boleto: String(t.numero_boleto || '').trim(),
        numero_bancario: String(t.numero_bancario || '').trim(),
        codigo_barras: String(t.codigo_barras || '').trim(),
        linha_digitavel: String(t.linha_digitavel || '').trim(),
        link_boleto: String(t.url_boleto || t.link_boleto || '').trim(),
        valor: Number(t.valor_documento || t.valor || 0),
        data_emissao_boleto: t.data_emissao_boleto || '',
        data_vencimento: t.data_vencimento || '',
        cliente_nome: t.nome_cliente || t.cliente_nome || '',
        cliente_id: t.cliente_id || '',
        numero_carga: String(numero_carga || ''),
        carga_id: String(carga_id || ''),
        status: 'gerado',
        usuario_email: user.email || 'sistema',
        usuario_nome: user.full_name || ''
      };

      try {
        const existentes = await base44.asServiceRole.entities.LogEmissaoBoleto.filter(
          { codigo_lancamento: codigo }, '-created_date', 1
        ).catch(() => []);
        if (existentes?.[0]) {
          // Não sobrescreve numero_carga/carga_id já preenchidos com vazio.
          const upd = { ...payload };
          if (!payload.numero_carga && existentes[0].numero_carga) upd.numero_carga = existentes[0].numero_carga;
          if (!payload.carga_id && existentes[0].carga_id) upd.carga_id = existentes[0].carga_id;
          if (!payload.cliente_nome && existentes[0].cliente_nome) upd.cliente_nome = existentes[0].cliente_nome;
          if (!payload.cliente_id && existentes[0].cliente_id) upd.cliente_id = existentes[0].cliente_id;
          if (!payload.numero_nf && existentes[0].numero_nf) upd.numero_nf = existentes[0].numero_nf;
          if ((!payload.data_vencimento) && existentes[0].data_vencimento) upd.data_vencimento = existentes[0].data_vencimento;
          if ((!payload.numero_parcela || payload.numero_parcela === '001/001') && existentes[0].numero_parcela) upd.numero_parcela = existentes[0].numero_parcela;
          await base44.asServiceRole.entities.LogEmissaoBoleto.update(existentes[0].id, upd);
          atualizados++;
        } else {
          await base44.asServiceRole.entities.LogEmissaoBoleto.create(payload);
          gravados++;
        }
      } catch (e) {
        console.warn('[salvarBoletosLocais] falha ao gravar', codigo, e?.message);
        ignorados++;
      }
    }

    return Response.json({ sucesso: true, gravados, atualizados, ignorados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});