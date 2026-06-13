import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Reconstroi os roteiros da vendedora Gessica (seg a sab).
// Logica: 115 clientes divididos em 6 grupos (~19 cada).
// Dias iniciais pegam 1 grupo, dias finais pegam 2 grupos (mesma direcao + area extra).
// Seg=grupo0, Qui=grupo0+grupo3 | Ter=grupo1, Sex=grupo1+grupo4 | Qua=grupo2, Sab=grupo2+grupo5

const DIAS = [
  { dia: 'segunda-feira', grupos: [0] },
  { dia: 'quinta-feira',  grupos: [0, 3] },
  { dia: 'terca-feira',   grupos: [1] },
  { dia: 'sexta-feira',   grupos: [1, 4] },
  { dia: 'quarta-feira',  grupos: [2] },
  { dia: 'sabado',        grupos: [2, 5] },
];
const VENDEDOR_ID = '69ff70a75fbcb49b6597113f';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins' }, { status: 403 });

    // 1. Buscar vendedora
    const vendedor = await base44.asServiceRole.entities.Vendedor.get(VENDEDOR_ID);
    if (!vendedor) return Response.json({ error: 'Vendedora nao encontrada' }, { status: 404 });

    // 2. Buscar todos os clientes ativos da Gessica
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();
    const clientesAtivos = todosClientes.filter(c =>
      c.vendedor_id === VENDEDOR_ID &&
      c.status === 'ativo'
    );

    // 3. Buscar roteiros existentes para preservar clientes ja vinculados
    const todosRoteiros = await base44.asServiceRole.entities.Roteiro.list();
    const roteirosExistentes = todosRoteiros.filter(r => r.vendedor_id === VENDEDOR_ID);

    // 4. Coletar todos os IDs de clientes ja nos roteiros existentes
    const idsJaNosRoteiros = new Set();
    const clientesJaDetalhados = new Map(); // cliente_id -> detalhe
    roteirosExistentes.forEach(r => {
      (r.clientes_ids || []).forEach(id => idsJaNosRoteiros.add(id));
      (r.clientes_detalhes || []).forEach(d => {
        if (d.cliente_id && !clientesJaDetalhados.has(d.cliente_id)) {
          clientesJaDetalhados.set(d.cliente_id, d);
        }
      });
    });

    // 5. Juntar TODOS os clientes (dos roteiros + novos da base)
    const todosIds = new Set([...idsJaNosRoteiros]);
    clientesAtivos.forEach(c => todosIds.add(c.id));

    const clientesUnicos = [];
    for (const id of todosIds) {
      const c = clientesAtivos.find(x => x.id === id);
      if (c) {
        clientesUnicos.push(c);
      }
    }

    // 6. Distribuir clientes em 6 grupos (round-robin entre os 6)
    const grupos = [[], [], [], [], [], []];
    clientesUnicos.forEach((c, i) => {
      grupos[i % 6].push(c);
    });

    // 7. Criar/atualizar roteiros conforme configuracao de grupos por dia
    const resultado = [];

    // Cache de detalhes por cliente_id para manter consistencia entre dias
    const detalhesCache = new Map();

    for (const cfg of DIAS) {
      // Juntar os grupos que alimentam este dia
      let clientesDoDia = [];
      for (const g of cfg.grupos) {
        clientesDoDia = clientesDoDia.concat(grupos[g]);
      }

      const idsDoDia = clientesDoDia.map(c => c.id);

      const detalhesDoDia = clientesDoDia.map((c, i) => {
        if (!detalhesCache.has(c.id)) {
          const existente = clientesJaDetalhados.get(c.id);
          detalhesCache.set(c.id, {
            cliente_id: c.id,
            cliente_nome: existente?.cliente_nome || c.razao_social || '',
            nome_fantasia: existente?.nome_fantasia || c.nome_fantasia || '',
            cliente_codigo: existente?.cliente_codigo || String(c.codigo_interno || ''),
            cliente_cidade: existente?.cliente_cidade || c.cidade || '',
            cliente_bairro: existente?.cliente_bairro || c.bairro || '',
            cliente_endereco: existente?.cliente_endereco || c.endereco || '',
            cliente_telefone: existente?.cliente_telefone || c.telefone || '',
          });
        }
        return { ...detalhesCache.get(c.id), ordem: i + 1 };
      });

      let roteiro = roteirosExistentes.find(r => r.dia_semana === cfg.dia);

      if (roteiro) {
        await base44.asServiceRole.entities.Roteiro.update(roteiro.id, {
          clientes_ids: idsDoDia,
          clientes_detalhes: detalhesDoDia,
          status: 'ativo',
          ativo: true
        });
        resultado.push({ dia: cfg.dia, acao: 'atualizado', roteiro_id: roteiro.id, clientes: idsDoDia.length });
      } else {
        const novo = await base44.asServiceRole.entities.Roteiro.create({
          vendedor_id: VENDEDOR_ID,
          vendedor_nome: vendedor.nome || 'GESSICA EDVANIA DE SOUSA',
          dia_semana: cfg.dia,
          clientes_ids: idsDoDia,
          clientes_detalhes: detalhesDoDia,
          status: 'ativo',
          ativo: true
        });
        resultado.push({ dia: cfg.dia, acao: 'criado', roteiro_id: novo.id, clientes: idsDoDia.length });
      }
    }

    return Response.json({
      sucesso: true,
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      total_clientes: clientesUnicos.length,
      resultado
    });

  } catch (error) {
    console.error('[reconstruirRoteirosGessica] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});