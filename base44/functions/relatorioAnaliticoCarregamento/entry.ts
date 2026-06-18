import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Relatório Analítico do Carregamento (formato S7) — todas as cargas de um dia,
// uma linha por carga, cruzando com AcertoCaixa por numero_carga.
// payload: { data: 'YYYY-MM-DD' }
// retorna: { data, linhas: [...], totais: {...} }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const data = body.data;
    if (!data) return Response.json({ error: 'Data não informada' }, { status: 400 });

    const cargas = await base44.asServiceRole.entities.Carga.filter({ data_carga: data });
    const acertos = await base44.asServiceRole.entities.AcertoCaixa.list('-created_date', 5000).catch(() => []);

    // Indexa acertos por numero_carga
    const acertoPorCarga = new Map();
    acertos.forEach(a => {
      if (a.numero_carga && !acertoPorCarga.has(a.numero_carga)) acertoPorCarga.set(a.numero_carga, a);
    });

    const linhas = cargas
      .sort((a, b) => String(a.numero_carga || '').localeCompare(String(b.numero_carga || ''), undefined, { numeric: true }))
      .map(c => {
        const acerto = acertoPorCarga.get(c.numero_carga) || {};
        return {
          numero_carga: c.numero_carga || '-',
          data_carga: c.data_carga || '',
          veiculo_placa: c.veiculo_placa || '-',
          motorista_nome: c.motorista_nome || '-',
          quantidade_pedidos: c.quantidade_pedidos || 0,
          quantidade_total_pacotes: c.quantidade_total_pacotes || 0,
          valor_total_carga: c.valor_total_carga || c.valor_total || 0,
          data_acerto: acerto.data_acerto || '',
          faturista: acerto.finalizado_por || acerto.created_by || '',
          status_carga: c.status_carga || '-'
        };
      });

    const totais = {
      carregamentos: linhas.length,
      pedidos: linhas.reduce((s, l) => s + l.quantidade_pedidos, 0),
      pacotes: linhas.reduce((s, l) => s + l.quantidade_total_pacotes, 0),
      valor: linhas.reduce((s, l) => s + l.valor_total_carga, 0)
    };

    return Response.json({ data, linhas, totais });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});