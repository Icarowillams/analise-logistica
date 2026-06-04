// Suíte: integridade do banco de dados (entidades) — somente leitura.
// Detecta órfãos, duplicatas, dados inconsistentes que afetam o usuário no dia-a-dia.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';
import { validarCpfCnpj, normalizarEstado } from '@/lib/omieHelpers';

export function buildSuiteEntidades() {
  const s = createSuite('Integridade de Dados (entidades — leitura)');

  // ============================================================
  // CLIENTES
  // ============================================================
  s.test('CLIENTES: entidade lista sem erro', async () => {
    const clientes = await base44.entities.Cliente.list('-created_date', 5);
    assert.truthy(Array.isArray(clientes));
  });

  s.test('CLIENTES: nenhum cliente com CPF/CNPJ inválido (amostra 100)', async () => {
    const clientes = await base44.entities.Cliente.list('-created_date', 100);
    const invalidos = clientes.filter(c => c.cnpj_cpf && !validarCpfCnpj(c.cnpj_cpf));
    assert.equal(invalidos.length, 0, `${invalidos.length} clientes com documento inválido: ${invalidos.slice(0, 3).map(c => c.razao_social).join(', ')}`);
  });

  s.test('CLIENTES: nenhum CPF/CNPJ duplicado (amostra 200)', async () => {
    const clientes = await base44.entities.Cliente.list('-created_date', 200);
    const docs = clientes.map(c => (c.cnpj_cpf || '').replace(/\D/g, '')).filter(Boolean);
    const set = new Set(docs);
    assert.equal(docs.length, set.size, `${docs.length - set.size} CPF/CNPJ duplicados`);
  });

  s.test('CLIENTES: todos têm razão social', async () => {
    const clientes = await base44.entities.Cliente.list('-created_date', 100);
    const semNome = clientes.filter(c => !c.razao_social || !c.razao_social.trim());
    assert.equal(semNome.length, 0, `${semNome.length} clientes sem razão social`);
  });

  s.test('CLIENTES: estados em UF de 2 letras (após normalização)', async () => {
    const clientes = await base44.entities.Cliente.list('-created_date', 100);
    const errados = clientes.filter(c => {
      if (!c.estado) return false;
      const uf = normalizarEstado(c.estado);
      return uf.length !== 2;
    });
    assert.equal(errados.length, 0);
  });

  // ============================================================
  // PRODUTOS
  // ============================================================
  s.test('PRODUTOS: entidade lista sem erro', async () => {
    const produtos = await base44.entities.Produto.list('-created_date', 5);
    assert.truthy(Array.isArray(produtos));
  });

  s.test('PRODUTOS: todos têm nome e código', async () => {
    const produtos = await base44.entities.Produto.list('-created_date', 100);
    const invalidos = produtos.filter(p => !p.nome || !p.codigo);
    assert.equal(invalidos.length, 0);
  });

  s.test('PRODUTOS: nenhum código duplicado (amostra 200)', async () => {
    const produtos = await base44.entities.Produto.list('-created_date', 200);
    const codigos = produtos.map(p => p.codigo).filter(Boolean);
    const set = new Set(codigos);
    assert.equal(codigos.length, set.size);
  });

  s.test('PRODUTOS: peso e volume não-negativos', async () => {
    const produtos = await base44.entities.Produto.list('-created_date', 100);
    const negativos = produtos.filter(p => (p.peso || 0) < 0 || (p.volume_m3 || 0) < 0);
    assert.equal(negativos.length, 0);
  });

  // ============================================================
  // TABELAS DE PREÇO
  // ============================================================
  s.test('TABELAS: lista sem erro', async () => {
    const tabelas = await base44.entities.TabelaPreco.list();
    assert.truthy(Array.isArray(tabelas));
  });

  s.test('TABELAS: pelo menos 1 tabela ativa', async () => {
    const tabelas = await base44.entities.TabelaPreco.filter({ status: 'ativo' });
    assert.greaterThan(tabelas.length, 0, 'sistema sem nenhuma tabela ativa');
  });

  // ============================================================
  // PEDIDOS
  // ============================================================
  s.test('PEDIDOS: entidade lista sem erro', async () => {
    const pedidos = await base44.entities.Pedido.list('-created_date', 5);
    assert.truthy(Array.isArray(pedidos));
  });

  s.test('PEDIDOS: nenhum sem cliente_id (amostra 50)', async () => {
    const pedidos = await base44.entities.Pedido.list('-created_date', 50);
    const orfaos = pedidos.filter(p => !p.cliente_id);
    assert.equal(orfaos.length, 0);
  });

  s.test('PEDIDOS: status válido (pendente/enviado/liberado/faturado/cancelado)', async () => {
    const validos = ['pendente', 'enviado', 'liberado', 'faturado', 'cancelado'];
    const pedidos = await base44.entities.Pedido.list('-created_date', 50);
    const invalidos = pedidos.filter(p => p.status && !validos.includes(p.status));
    assert.equal(invalidos.length, 0);
  });

  // ============================================================
  // CARGAS
  // ============================================================
  s.test('CARGAS: entidade lista sem erro', async () => {
    const cargas = await base44.entities.Carga.list('-created_date', 5);
    assert.truthy(Array.isArray(cargas));
  });

  s.test('CARGAS: status válido', async () => {
    const validos = ['montagem', 'fechada', 'conferindo', 'pronta', 'faturada', 'em_rota', 'entregue', 'finalizada', 'cancelada'];
    const cargas = await base44.entities.Carga.list('-created_date', 50);
    const invalidos = cargas.filter(c => c.status_carga && !validos.includes(c.status_carga));
    assert.equal(invalidos.length, 0);
  });

  s.test('CARGAS: peso e volume não-negativos', async () => {
    const cargas = await base44.entities.Carga.list('-created_date', 50);
    const ruins = cargas.filter(c => (c.peso_total_kg || 0) < 0 || (c.volume_total_m3 || 0) < 0);
    assert.equal(ruins.length, 0);
  });

  // ============================================================
  // FUNCIONÁRIOS / VEÍCULOS / MOTORISTAS
  // ============================================================
  s.test('VENDEDORES: lista sem erro', async () => {
    const v = await base44.entities.Vendedor.list('-created_date', 5);
    assert.truthy(Array.isArray(v));
  });

  s.test('VEICULOS: pelo menos 1 cadastrado', async () => {
    const v = await base44.entities.Veiculo.list();
    assert.greaterThan(v.length, 0, 'nenhum veículo cadastrado');
  });

  s.test('MOTORISTAS: pelo menos 1 cadastrado', async () => {
    const m = await base44.entities.Motorista.list();
    assert.greaterThan(m.length, 0, 'nenhum motorista cadastrado');
  });

  // ============================================================
  // LOG DE INTEGRAÇÃO
  // ============================================================
  s.test('LOG OMIE: entidade lista sem erro', async () => {
    const logs = await base44.entities.LogIntegracaoOmie.list('-created_date', 5);
    assert.truthy(Array.isArray(logs));
  });

  // ============================================================
  // CENÁRIOS FISCAIS
  // ============================================================
  s.test('CENARIOS FISCAIS: entidade lista sem erro', async () => {
    const c = await base44.entities.CenarioFiscal.list();
    assert.truthy(Array.isArray(c));
  });

  // ============================================================
  // ROTAS
  // ============================================================
  s.test('ROTAS: pelo menos 1 cadastrada', async () => {
    const r = await base44.entities.Rota.list();
    assert.greaterThan(r.length, 0, 'nenhuma rota cadastrada');
  });

  // ============================================================
  // PLANOS DE PAGAMENTO
  // ============================================================
  s.test('PLANOS PAGAMENTO: pelo menos 1 ativo', async () => {
    const p = await base44.entities.PlanoPagamento.filter({ status: 'ativo' });
    assert.greaterThan(p.length, 0);
  });

  return s;
}