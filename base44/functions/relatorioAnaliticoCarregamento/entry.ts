import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Relatório Analítico do Carregamento — consolida todas as cargas de uma data.
 * Body: { data: "YYYY-MM-DD" }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dataFiltro = body.data || '';

    if (!dataFiltro) {
      return Response.json({ error: 'Parâmetro "data" obrigatório (YYYY-MM-DD)' }, { status: 400 });
    }

    // Busca todas as cargas (limite alto para cobrir histórico)
    const todasCargas = await base44.asServiceRole.entities.Carga.list('-created_date', 2000);

    // Filtra pela data_carga
    const cargasDoDia = todasCargas.filter(c => c.data_carga === dataFiltro);

    // Para cada carga, busca o faturista (usuário que criou)
    const linhas = [];
    for (const carga of cargasDoDia) {
      // Destino: primeira cidade dos pedidos Omie ou "—"
      const pedidosOmie = carga.pedidos_omie || [];
      const destino = pedidosOmie.length > 0
        ? (pedidosOmie[0].cidade || '—')
        : (carga.rota_nome || '—');

      // Faturista: o usuário que criou a carga (created_by no registro)
      const faturista = carga.created_by || '—';

      // Peso bruto (kg) — do campo peso_total_kg, ou soma dos produtos se 0
      let pesoBruto = Number(carga.peso_total_kg || 0);
      // Peso líquido — mesmo valor se não houver distinção
      let pesoLiq = pesoBruto;

      linhas.push({
        carregamento: carga.numero_carga || '—',
        data_saida: carga.data_carga || '',
        placa: carga.veiculo_placa || '—',
        motorista: carga.motorista_nome || '—',
        qt_pedidos: Number(carga.quantidade_pedidos || 0),
        vl_total: Number(carga.valor_total || 0),
        peso_bruto: pesoBruto,
        peso_liq: pesoLiq,
        destino,
        dt_acerto: '', // Futuro: integrar com AcertoCaixa
        faturista,
        status: carga.status_carga === 'faturada' ? 'F' : 'M'
      });
    }

    // Totais
    const totais = {
      qt_pedidos: linhas.reduce((s, l) => s + l.qt_pedidos, 0),
      vl_total: linhas.reduce((s, l) => s + l.vl_total, 0),
      peso_bruto: linhas.reduce((s, l) => s + l.peso_bruto, 0),
      peso_liq: linhas.reduce((s, l) => s + l.peso_liq, 0),
    };

    return Response.json({
      sucesso: true,
      data: dataFiltro,
      total_carregamentos: linhas.length,
      linhas,
      totais
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});