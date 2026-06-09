import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// PROBLEMA 1: vincula cliente 28964 ao roteiro de Jose Edvaldo
// PROBLEMA 2: diagnostica por que cliente 28946 não aparece para nenhum vendedor

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const resultado: any = {
    problema1_jose_edvaldo: null,
    problema2_diagnostico_28946: null
  };

  // ═══════════════════════════════════════════════════════
  // PROBLEMA 2 — diagnóstico primeiro (read-only, mais rápido)
  // ═══════════════════════════════════════════════════════
  try {
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();

    const cliente28946 = todosClientes.find(c =>
      String(c.codigo_interno || '').trim() === '28946'
    );

    if (!cliente28946) {
      // Busca aproximada para ajudar a identificar cadastro com nome/código parecido
      const proximos = todosClientes
        .filter(c => String(c.codigo_interno || '').includes('2894') || String(c.codigo_interno || '').includes('28946'))
        .map(c => ({ id: c.id, codigo_interno: c.codigo_interno, razao_social: c.razao_social, status: c.status }));

      resultado.problema2_diagnostico_28946 = {
        encontrado: false,
        causa_raiz: 'Cliente com codigo_interno 28946 NÃO existe no banco',
        codigos_proximos: proximos,
        sugestao: proximos.length
          ? 'Verifique os registros próximos — pode ser um typo ou código diferente do esperado'
          : 'Nenhum registro próximo encontrado. O cliente pode nunca ter sido importado.'
      };
    } else {
      // Cliente existe — inspeciona todos os campos suspeitos
      const todosVendedores = await base44.asServiceRole.entities.Vendedor.list();
      const roteirosList = await base44.asServiceRole.entities.Roteiro.list();
      const todasPermissoes = await base44.asServiceRole.entities.Permissao.list();

      const vendedorDono = todosVendedores.find(v => v.id === cliente28946.vendedor_id) || null;

      // Roteiros que contêm este cliente
      const roteirosQueContem = roteirosList
        .filter(r => (r.clientes_ids || []).includes(cliente28946.id))
        .map(r => {
          const v = todosVendedores.find(vv => vv.id === r.vendedor_id);
          return { roteiro_id: r.id, dia_semana: r.dia_semana, vendedor_id: r.vendedor_id, vendedor_nome: v?.nome || '?' };
        });

      // Vendedores com visibilidade 'base' que teoricamente deveriam ver este cliente
      const vendedoresBase = todosVendedores
        .map(v => {
          const perm = todasPermissoes.find(p => p.vendedor_id === v.id);
          return { vendedor_id: v.id, nome: v.nome, visibilidade: perm?.visibilidade_clientes || 'todos' };
        })
        .filter(v => v.visibilidade === 'base');

      // Resumo de suspeitos
      const suspeitos: string[] = [];
      if (cliente28946.status !== 'ativo') suspeitos.push(`status='${cliente28946.status}' (não é 'ativo')`);
      if (!cliente28946.vendedor_id) suspeitos.push('vendedor_id vazio — sem vínculo direto com nenhum vendedor');
      if (cliente28946.pre_cadastro) suspeitos.push('pre_cadastro=true — pode ser filtrado como pré-cadastro na UI');
      if (roteirosQueContem.length === 0) suspeitos.push('não está em nenhum roteiro de vendedor');

      // Causa raiz consolidada
      let causa_raiz = '';
      if (suspeitos.length) {
        causa_raiz = suspeitos.join(' | ');
      } else {
        causa_raiz = 'Cliente existe e parece consistente. Problema pode ser filtro de UI (ex: status ou ativo) ou vendedor com visibilidade=base sem vínculo.';
      }

      resultado.problema2_diagnostico_28946 = {
        encontrado: true,
        causa_raiz,
        suspeitos,
        cliente: {
          id: cliente28946.id,
          codigo_interno: cliente28946.codigo_interno,
          razao_social: cliente28946.razao_social,
          nome_fantasia: cliente28946.nome_fantasia,
          status: cliente28946.status,
          pre_cadastro: cliente28946.pre_cadastro ?? false,
          vendedor_id: cliente28946.vendedor_id ?? null,
          vendedor_nome: vendedorDono?.nome ?? null,
          supervisor_id: cliente28946.supervisor_id ?? null,
          bloquear_faturamento: cliente28946.bloquear_faturamento ?? false,
          codigo_omie: cliente28946.codigo_omie ?? null,
          codigo_integracao: cliente28946.codigo_integracao ?? null,
          cidade: cliente28946.cidade ?? null,
          created_date: cliente28946.created_date ?? null,
          updated_date: cliente28946.updated_date ?? null
        },
        roteiros_que_contem: roteirosQueContem,
        total_vendedores_com_visibilidade_base: vendedoresBase.length,
        sugestao: suspeitos.length
          ? 'Corrija os campos suspeitos listados acima'
          : 'Vincule o cliente ao vendedor_id correto ou adicione a um roteiro'
      };
    }
  } catch (e) {
    resultado.problema2_diagnostico_28946 = { erro: e.message };
  }

  // ═══════════════════════════════════════════════════════
  // PROBLEMA 1 — fix: vincular 28964 ao roteiro de Jose Edvaldo
  // ═══════════════════════════════════════════════════════
  try {
    const todosVendedores = await base44.asServiceRole.entities.Vendedor.list();
    const vendedor = todosVendedores.find(v =>
      v.nome?.toLowerCase().includes('jose edvaldo') ||
      v.nome?.toLowerCase().includes('josé edvaldo')
    );
    if (!vendedor) {
      resultado.problema1_jose_edvaldo = { sucesso: false, erro: 'Vendedor Jose Edvaldo não encontrado' };
    } else {
      const todosClientes = await base44.asServiceRole.entities.Cliente.list();
      const cliente28964 = todosClientes.find(c => String(c.codigo_interno || '').trim() === '28964');

      if (!cliente28964) {
        resultado.problema1_jose_edvaldo = { sucesso: false, erro: 'Cliente com codigo_interno 28964 não encontrado' };
      } else {
        const roteirosList = await base44.asServiceRole.entities.Roteiro.list();
        const roteirosDoVendedor = roteirosList.filter(r => r.vendedor_id === vendedor.id);

        const idsJaVinculados = new Set<string>();
        roteirosDoVendedor.forEach(r => (r.clientes_ids || []).forEach(id => idsJaVinculados.add(id)));

        if (idsJaVinculados.has(cliente28964.id)) {
          resultado.problema1_jose_edvaldo = {
            sucesso: true,
            mensagem: 'Cliente 28964 já estava vinculado a um roteiro de Jose Edvaldo',
            vendedor: { id: vendedor.id, nome: vendedor.nome },
            cliente: { id: cliente28964.id, codigo_interno: cliente28964.codigo_interno, nome: cliente28964.razao_social }
          };
        } else {
          // Roteiro alvo: primeiro ativo ou cria novo
          let roteiro = roteirosDoVendedor.find(r => r.ativo !== false) || roteirosDoVendedor[0] || null;
          let roteiroCriado = false;
          if (!roteiro) {
            roteiro = await base44.asServiceRole.entities.Roteiro.create({
              vendedor_id: vendedor.id,
              vendedor_nome: vendedor.nome || '',
              dia_semana: 'segunda-feira',
              clientes_ids: [],
              clientes_detalhes: [],
              status: 'ativo',
              ativo: true
            });
            roteiroCriado = true;
          }

          const idsAtuais: string[] = roteiro.clientes_ids || [];
          const detalhesAtuais = roteiro.clientes_detalhes || [];

          await base44.asServiceRole.entities.Roteiro.update(roteiro.id, {
            clientes_ids: [...idsAtuais, cliente28964.id],
            clientes_detalhes: [...detalhesAtuais, {
              cliente_id: cliente28964.id,
              cliente_nome: cliente28964.razao_social || '',
              nome_fantasia: cliente28964.nome_fantasia || '',
              cliente_codigo: String(cliente28964.codigo_interno || ''),
              cliente_cidade: cliente28964.cidade || '',
              cliente_bairro: cliente28964.bairro || '',
              cliente_endereco: cliente28964.logradouro || '',
              cliente_telefone: cliente28964.telefone || '',
              ordem: idsAtuais.length + 1
            }]
          });

          resultado.problema1_jose_edvaldo = {
            sucesso: true,
            vendedor: { id: vendedor.id, nome: vendedor.nome },
            roteiro: { id: roteiro.id, dia_semana: roteiro.dia_semana, criado: roteiroCriado },
            cliente_adicionado: { id: cliente28964.id, codigo_interno: cliente28964.codigo_interno, nome: cliente28964.razao_social }
          };
        }
      }
    }
  } catch (e) {
    resultado.problema1_jose_edvaldo = { sucesso: false, erro: e.message };
  }

  return Response.json(resultado);
});
