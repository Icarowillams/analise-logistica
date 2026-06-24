import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Gera a AgendaComercial de um mês para um papel, distribuindo os clientes da carteira
// nas datas conforme dias_visita do cliente e periodicidade (semanal/quinzenal/mensal).
// Payload: { mes_referencia: "YYYY-MM-01", papel: "vendedor", usuario_id?: "...", recriar?: bool }

const DIA_MAP = { 0: 'domingo', 1: 'segunda', 2: 'terca', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sabado' };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const db = base44.asServiceRole.entities;

    const body = await req.json().catch(() => ({}));
    const { mes_referencia, papel, usuario_id, recriar = false } = body;
    if (!mes_referencia || !papel) {
      return Response.json({ error: 'mes_referencia e papel são obrigatórios' }, { status: 400 });
    }

    const params = (await db.ParametroCobertura.filter({ chave: 'principal' }))[0] || {};
    const periodicidadePadrao = params[`periodicidade_${papel}`] || 'semanal';

    const inicio = new Date(mes_referencia + 'T00:00:00');
    const ano = inicio.getFullYear();
    const mes = inicio.getMonth();
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();

    // Funcionários (para nome do responsável)
    const vendedores = await db.Vendedor.list('', 2000);
    const nomePorId = Object.fromEntries(vendedores.map((v) => [v.id, v.nome]));

    // Clientes da carteira
    let clientes = await db.Cliente.filter({ status: 'ativo' }, '', 5000);
    if (usuario_id) {
      clientes = clientes.filter((c) => c.responsavel_id === usuario_id || c.vendedor_id === usuario_id);
    }

    // Apaga agenda anterior do mesmo escopo se recriar
    if (recriar) {
      const q = { mes_referencia, papel };
      if (usuario_id) q.usuario_id = usuario_id;
      const antigas = await db.AgendaComercial.filter(q, '', 5000);
      const aApagar = antigas.filter((a) => a.status_visita === 'pendente');
      for (let i = 0; i < aApagar.length; i += 100) {
        await Promise.all(aApagar.slice(i, i + 100).map((a) => db.AgendaComercial.delete(a.id)));
      }
    }

    // Já existentes (para não duplicar)
    const existentes = await db.AgendaComercial.filter({ mes_referencia, papel }, '', 5000);
    const chaveExistente = new Set(existentes.map((a) => `${a.cliente_id}|${a.data_prevista}`));

    const meioComprovacao = papel === 'gerencia' || papel === 'coordenador' ? 'geolocalizacao' : 'geolocalizacao';

    const novos = [];
    let semanaQuinzenal = 0;
    for (let dia = 1; dia <= ultimoDia; dia++) {
      const dataObj = new Date(ano, mes, dia);
      const nomeDia = DIA_MAP[dataObj.getDay()];
      const dataStr = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      const semanaDoMes = Math.floor((dia - 1) / 7);

      for (const c of clientes) {
        const dv = Array.isArray(c.dias_visita) ? c.dias_visita : [];
        if (!dv.includes(nomeDia)) continue;
        const period = c.periodicidade_visita || periodicidadePadrao;
        // quinzenal: só semanas pares; mensal: só 1ª semana
        if (period === 'quinzenal' && semanaDoMes % 2 !== 0) continue;
        if (period === 'mensal' && semanaDoMes !== 0) continue;

        const chave = `${c.id}|${dataStr}`;
        if (chaveExistente.has(chave)) continue;
        chaveExistente.add(chave);

        const responsavelId = c.responsavel_id || c.vendedor_id || usuario_id || null;
        if (!responsavelId) continue; // cliente sem responsável não entra na agenda
        novos.push({
          usuario_id: responsavelId,
          usuario_nome: nomePorId[responsavelId] || '',
          cliente_id: c.id,
          cliente_nome: c.nome_fantasia || c.razao_social,
          cliente_regiao: c.regiao || c.bairro || '',
          data_prevista: dataStr,
          papel,
          finalidade_visita: papel === 'promotor' ? 'reposicao' : 'venda',
          periodicidade_papel: periodicidadePadrao,
          meio_comprovacao: meioComprovacao,
          mes_referencia,
          status_visita: 'pendente',
        });
      }
    }

    for (let i = 0; i < novos.length; i += 100) {
      await db.AgendaComercial.bulkCreate(novos.slice(i, i + 100));
    }

    return Response.json({ ok: true, agendas_criadas: novos.length, clientes_carteira: clientes.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});