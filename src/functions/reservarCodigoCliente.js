import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const reservas = await base44.asServiceRole.entities.ConfiguracaoImportacao.filter({ chave: 'sequencial_codigo_cliente' });
    const reservaAtual = reservas[0];

    if (!reservaAtual) {
      const clientes = await base44.asServiceRole.entities.Cliente.list();
      const maiorCodigo = Math.max(
        0,
        ...clientes.map((cliente) => Number.parseInt(String(cliente.codigo || '').trim(), 10)).filter(Number.isFinite),
      );
      const proximoCodigo = String(maiorCodigo + 1);

      const novaReserva = await base44.asServiceRole.entities.ConfiguracaoImportacao.create({
        chave: 'sequencial_codigo_cliente',
        valor: String(maiorCodigo + 1),
        descricao: 'Último código reservado automaticamente para cliente/pré-cadastro'
      });

      return Response.json({ codigo: proximoCodigo, reserva_id: novaReserva.id });
    }

    const ultimoReservado = Number.parseInt(String(reservaAtual.valor || '0').trim(), 10);
    const proximoNumero = Number.isFinite(ultimoReservado) ? ultimoReservado + 1 : 1;
    const proximoCodigo = String(proximoNumero);

    await base44.asServiceRole.entities.ConfiguracaoImportacao.update(reservaAtual.id, {
      ...reservaAtual,
      valor: proximoCodigo,
      descricao: 'Último código reservado automaticamente para cliente/pré-cadastro'
    });

    return Response.json({ codigo: proximoCodigo, reserva_id: reservaAtual.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});