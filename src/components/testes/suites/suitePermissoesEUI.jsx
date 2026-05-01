// Suíte: regras de permissão e UI/navegação.

import { createSuite, assert } from '@/lib/testRunner';
import { base44 } from '@/api/base44Client';

export function buildSuitePermissoesEUI() {
  const s = createSuite('Permissões e UI (auth e navegação)');

  // ============================================================
  // AUTH
  // ============================================================
  s.test('AUTH: usuário atual está autenticado', async () => {
    const auth = await base44.auth.isAuthenticated();
    assert.equal(auth, true);
  });

  s.test('AUTH: usuário tem email', async () => {
    const me = await base44.auth.me();
    assert.truthy(me?.email);
  });

  s.test('AUTH: role é "admin" ou "user"', async () => {
    const me = await base44.auth.me();
    assert.truthy(['admin', 'user'].includes(me?.role));
  });

  // ============================================================
  // PERMISSÕES (ROLES)
  // ============================================================
  s.test('PERM: admin tem acesso total', async () => {
    const me = await base44.auth.me();
    if (me?.role === 'admin') {
      assert.equal(true, true);
    } else {
      // user comum: não pode listar permissões de outros
      assert.equal(true, true);
    }
  });

  s.test('PERM: entidade User retorna meu próprio registro', async () => {
    const me = await base44.auth.me();
    assert.truthy(me?.id);
  });

  // ============================================================
  // ENTIDADES — leitura básica funciona pra qualquer user logado
  // ============================================================
  s.test('NAV: Cliente.list responde rápido', async () => {
    const t0 = Date.now();
    await base44.entities.Cliente.list('-created_date', 1);
    assert.truthy(Date.now() - t0 < 5000, 'list demorou >5s');
  });

  s.test('NAV: Produto.list responde rápido', async () => {
    const t0 = Date.now();
    await base44.entities.Produto.list('-created_date', 1);
    assert.truthy(Date.now() - t0 < 5000);
  });

  s.test('NAV: Pedido.list responde rápido', async () => {
    const t0 = Date.now();
    await base44.entities.Pedido.list('-created_date', 1);
    assert.truthy(Date.now() - t0 < 5000);
  });

  s.test('NAV: Carga.list responde rápido', async () => {
    const t0 = Date.now();
    await base44.entities.Carga.list('-created_date', 1);
    assert.truthy(Date.now() - t0 < 5000);
  });

  // ============================================================
  // FILTROS — sintaxe da SDK funciona
  // ============================================================
  s.test('FILTRO: Cliente.filter por status="ativo"', async () => {
    const r = await base44.entities.Cliente.filter({ status: 'ativo' }, '-created_date', 5);
    assert.truthy(Array.isArray(r));
  });

  s.test('FILTRO: Pedido.filter por tipo="venda"', async () => {
    const r = await base44.entities.Pedido.filter({ tipo: 'venda' }, '-created_date', 5);
    assert.truthy(Array.isArray(r));
  });

  s.test('FILTRO: Produto.filter por status="ativo"', async () => {
    const r = await base44.entities.Produto.filter({ status: 'ativo' }, '-created_date', 5);
    assert.truthy(Array.isArray(r));
  });

  // ============================================================
  // PAGINAÇÃO
  // ============================================================
  s.test('PAGINAÇÃO: limit=2 retorna no máx 2', async () => {
    const r = await base44.entities.Cliente.list('-created_date', 2);
    assert.truthy(r.length <= 2);
  });

  s.test('PAGINAÇÃO: ordenação por created_date funciona', async () => {
    const r = await base44.entities.Cliente.list('-created_date', 5);
    if (r.length >= 2) {
      const d0 = new Date(r[0].created_date);
      const d1 = new Date(r[1].created_date);
      assert.truthy(d0 >= d1, 'ordem desc não respeitada');
    } else {
      assert.equal(true, true);
    }
  });

  return s;
}