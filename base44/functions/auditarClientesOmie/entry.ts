import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const clientes = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);

    const total = clientes.length;
    const comCodigoOmie = clientes.filter(c => c.codigo_omie && String(c.codigo_omie).trim() !== '').length;
    const semCodigoOmie = total - comCodigoOmie;

    const porStatus = {};
    const porTipoNota = {};
    const porTipoPessoa = {};

    for (const c of clientes) {
      const status = c.status || 'sem_status';
      porStatus[status] = (porStatus[status] || 0) + 1;

      const tn = c.tipo_nota || 'sem_tipo';
      porTipoNota[tn] = (porTipoNota[tn] || 0) + 1;

      const tp = c.tipo_pessoa || 'sem_tipo';
      porTipoPessoa[tp] = (porTipoPessoa[tp] || 0) + 1;
    }

    // Amostra de clientes SEM codigo_omie, ativos, tipo_nota != D1 (candidatos a exportação)
    const candidatosExportacao = clientes.filter(c =>
      (!c.codigo_omie || String(c.codigo_omie).trim() === '') &&
      (c.status || 'ativo') === 'ativo' &&
      c.tipo_nota !== 'D1' &&
      !c.pre_cadastro
    );

    // Clientes D1 (nunca vão pro Omie por regra de negócio)
    const clientesD1 = clientes.filter(c => c.tipo_nota === 'D1').length;

    // Clientes sem CNPJ/CPF válido
    const semDocumento = clientes.filter(c => !c.cnpj_cpf || c.cnpj_cpf.replace(/\D/g, '').length < 11).length;

    return Response.json({
      total,
      vinculados_omie: comCodigoOmie,
      nao_vinculados: semCodigoOmie,
      percentual_vinculado: total > 0 ? ((comCodigoOmie / total) * 100).toFixed(1) + '%' : '0%',
      por_status: porStatus,
      por_tipo_nota: porTipoNota,
      por_tipo_pessoa: porTipoPessoa,
      clientes_d1: clientesD1,
      sem_documento: semDocumento,
      candidatos_exportacao: {
        total: candidatosExportacao.length,
        amostra: candidatosExportacao.slice(0, 10).map(c => ({
          id: c.id,
          codigo_interno: c.codigo_interno,
          razao_social: c.razao_social,
          cnpj_cpf: c.cnpj_cpf,
          cidade: c.cidade,
          estado: c.estado
        }))
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});