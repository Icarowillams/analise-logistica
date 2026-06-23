import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Watchdog: re-invoca processarEmissaoNFLote enquanto houver lote em andamento.
// A automação de emissão dispara só no CREATE da fila — se essa única execução
// estourar o tempo limite e parar no meio (ex.: 9/21), ninguém retoma o lote.
// processarEmissaoNFLote retoma do ponto `processados` e é idempotente, então
// basta re-invocá-la enquanto o lote não tiver concluído/erro.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Pega lotes ainda em andamento (processando OU executando), do mais antigo ao mais novo.
    const emProcessamento = await base44.asServiceRole.entities.FilaEmissaoNF
      .filter({ status: 'processando' }, 'created_date', 20).catch(() => []);
    const emExecucao = await base44.asServiceRole.entities.FilaEmissaoNF
      .filter({ status: 'executando' }, 'created_date', 20).catch(() => []);

    // Só retoma um "executando" se estiver parado há mais de 2 min (evita rodar em paralelo
    // com uma execução que ainda está ativa — limparExecucoesPresas dentro da função também protege).
    const PARADO_MS = 2 * 60 * 1000;
    const agora = Date.now();
    const executandoParado = emExecucao.filter(f => {
      const ref = new Date(f.atualizado_em || f.iniciado_em || f.created_date).getTime();
      return agora - ref > PARADO_MS;
    });

    const candidatos = [...emProcessamento, ...executandoParado];
    if (candidatos.length === 0) {
      return Response.json({ sucesso: true, mensagem: 'Nenhum lote pendente para retomar', retomados: 0 });
    }

    // Retoma um lote por execução (a própria função já avança vários pedidos).
    const fila = candidatos[0];
    const res = await base44.asServiceRole.functions.invoke('processarEmissaoNFLote', { fila_id: fila.id });

    return Response.json({
      sucesso: true,
      retomados: 1,
      fila_id: fila.id,
      pendentes_restantes: candidatos.length - 1,
      resultado: res?.data || null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});