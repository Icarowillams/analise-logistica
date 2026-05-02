import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

/**
 * Diagnóstico de um cliente específico: verifica se ele está no Omie
 * por todas as formas possíveis (codigo_omie, codigo_integracao, ID Base44, CNPJ/CPF, código)
 * e retorna um relatório detalhado do status.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { cliente_id } = body;
    if (!cliente_id) return Response.json({ error: 'cliente_id obrigatório' }, { status: 400 });

    const cliente = await base44.asServiceRole.entities.Cliente.get(cliente_id);
    if (!cliente) return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const report = {
      base44: {
        id: cliente.id,
        codigo: cliente.codigo,
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        cnpj_cpf: cliente.cnpj_cpf,
        codigo_omie_salvo: cliente.codigo_omie,
        tipo_pessoa: cliente.tipo_pessoa,
        tipo_nota: cliente.tipo_nota,
        status: cliente.status,
        criado_em: cliente.created_date,
      },
      tentativas: [],
      encontrado_no_omie: false,
      omie_record: null,
    };

    const cnpjCpfLimpo = (cliente.cnpj_cpf || '').replace(/\D/g, '');

    // Helper
    const consultar = async (label, param) => {
      try {
        const res = await fetch(OMIE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ConsultarCliente',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [param]
          })
        });
        const data = await res.json();
        if (data.faultstring) {
          report.tentativas.push({ tipo: label, param, sucesso: false, erro: data.faultstring });
          return null;
        }
        report.tentativas.push({ tipo: label, param, sucesso: true, codigo_omie: data.codigo_cliente_omie });
        return data;
      } catch (e) {
        report.tentativas.push({ tipo: label, param, sucesso: false, erro: e.message });
        return null;
      }
    };

    // 1. Por codigo_omie salvo
    if (cliente.codigo_omie) {
      const r = await consultar('codigo_omie_salvo', { codigo_cliente_omie: Number(cliente.codigo_omie) });
      if (r) { report.encontrado_no_omie = true; report.omie_record = r; }
    }

    // 2. Por código (codigo_cliente_integracao)
    if (!report.encontrado_no_omie && cliente.codigo) {
      const r = await consultar('codigo_integracao', { codigo_cliente_integracao: cliente.codigo });
      if (r) { report.encontrado_no_omie = true; report.omie_record = r; }
    }

    // 3. Por ID Base44
    if (!report.encontrado_no_omie) {
      const r = await consultar('id_base44', { codigo_cliente_integracao: cliente.id });
      if (r) { report.encontrado_no_omie = true; report.omie_record = r; }
    }

    // 4. Por CNPJ/CPF (ListarClientes com filtro)
    if (!report.encontrado_no_omie && cnpjCpfLimpo) {
      try {
        const res = await fetch(OMIE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ListarClientes',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{ pagina: 1, registros_por_pagina: 5, clientesFiltro: { cnpj_cpf: cnpjCpfLimpo } }]
          })
        });
        const data = await res.json();
        if (!data.faultstring && data.clientes_cadastro?.length > 0) {
          report.tentativas.push({ tipo: 'cnpj_cpf', param: { cnpj_cpf: cnpjCpfLimpo }, sucesso: true, total: data.clientes_cadastro.length });
          report.encontrado_no_omie = true;
          report.omie_record = data.clientes_cadastro[0];
        } else {
          report.tentativas.push({ tipo: 'cnpj_cpf', param: { cnpj_cpf: cnpjCpfLimpo }, sucesso: false, erro: data.faultstring || 'não encontrado' });
        }
      } catch (e) {
        report.tentativas.push({ tipo: 'cnpj_cpf', sucesso: false, erro: e.message });
      }
    }

    // Resumo
    report.resumo = report.encontrado_no_omie
      ? `✅ Cliente EXISTE no Omie (codigo_omie: ${report.omie_record?.codigo_cliente_omie}, codigo_integracao: ${report.omie_record?.codigo_cliente_integracao})`
      : `❌ Cliente NÃO existe no Omie. Precisa ser exportado.`;

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});