import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Buscar o maior código existente entre todos os clientes
    const clientes = await base44.asServiceRole.entities.Cliente.list();
    const maiorCodigoClientes = Math.max(
      0,
      ...clientes.map(c => parseInt(String(c.codigo || '0').trim(), 10)).filter(Number.isFinite)
    );

    // Buscar o valor do sequencial armazenado
    const reservas = await base44.asServiceRole.entities.ConfiguracaoImportacao.filter({ chave: 'sequencial_codigo_cliente' });
    const reservaAtual = reservas[0];
    const valorArmazenado = reservaAtual ? parseInt(String(reservaAtual.valor || '0').trim(), 10) : 0;

    // Usar o MAIOR entre o sequencial armazenado e o maior código real dos clientes
    const maiorCodigo = Math.max(maiorCodigoClientes, Number.isFinite(valorArmazenado) ? valorArmazenado : 0);
    const proximoCodigo = String(maiorCodigo + 1);

    // Atualizar ou criar o sequencial
    if (reservaAtual) {
      await base44.asServiceRole.entities.ConfiguracaoImportacao.update(reservaAtual.id, {
        valor: proximoCodigo,
        descricao: 'Último código reservado automaticamente para cliente/pré-cadastro'
      });
    } else {
      await base44.asServiceRole.entities.ConfiguracaoImportacao.create({
        chave: 'sequencial_codigo_cliente',
        valor: proximoCodigo,
        descricao: 'Último código reservado automaticamente para cliente/pré-cadastro'
      });
    }

    return Response.json({ codigo: proximoCodigo });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});