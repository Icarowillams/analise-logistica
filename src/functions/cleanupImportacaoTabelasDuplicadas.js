import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const tabelaIds = [
  '69cca62b475cbd9415443230',
  '69cca62b20aba14f01273546',
  '69cca62adf0b044685c8c21b',
  '69cca62a1987b410a4e768fe',
  '69cca62a95c06d486a9d91a5',
  '69cca62971bac928574ff5e7',
  '69cca62972f7d80e8df6594d',
  '69cca6299e36c968da21c499',
  '69cca629becb1e1df52e0e6e',
  '69cca628d7042f6cb6c2fdf5',
  '69cca6281a2e18a95fdcd695',
  '69cca628a13c46721812e7e4',
  '69cca628f9ba579bef29aa86',
  '69cca6276843966b4a3bcbeb',
  '69cca627088cad0429875d46',
  '69cca62740d5a91819701bb4',
  '69cca626687040d3f763e2e9',
  '69cca62689ed0ba0f2a36155',
  '69cca626474be21f76b2805c',
  '69cca6258f08271f260edc9c',
  '69cca6250168364ece3f8283',
  '69cca62540d5a91819701bb3'
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const allPrices = await base44.asServiceRole.entities.PrecoProduto.list();
    const pricesToDelete = allPrices.filter((item) => tabelaIds.includes(item.tabela_id));

    for (const price of pricesToDelete) {
      await base44.asServiceRole.entities.PrecoProduto.delete(price.id);
    }

    for (const tabelaId of tabelaIds) {
      await base44.asServiceRole.entities.TabelaPreco.delete(tabelaId);
    }

    return Response.json({ success: true, deleted_prices: pricesToDelete.length, deleted_tables: tabelaIds.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});