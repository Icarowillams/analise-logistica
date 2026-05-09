import { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

// Hook central da tela de Montagem de Carga.
// Carrega em paralelo: pedidos Omie (etapa 20), trocas aprovadas, motoristas, veículos, cargas.
export default function useDadosMontagem() {
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState([]);
  const [motoristas, setMotoristas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [cargas, setCargas] = useState([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Paralelo: cadastros locais
      const [motP, veiP, carP] = await Promise.all([
        base44.entities.Motorista.list('-created_date', 500),
        base44.entities.Veiculo.list('-created_date', 500),
        base44.entities.Carga.list('-created_date', 500)
      ]);
      setMotoristas(motP.filter(m => m.status === 'ativo'));
      setVeiculos(veiP.filter(v => v.ativo !== false));
      setCargas(carP);

      // Pedidos Omie não podem bloquear os pedidos D1 locais se a integração falhar
      let vendasRes = null;
      try {
        vendasRes = await base44.functions.invoke('buscarPedidosOmie', { etapa: '20', registros_por_pagina: 100, buscar_todas_paginas: true, max_paginas: 8 });
      } catch (omieError) {
        toast.warning('Pedidos Omie não carregaram, mas os pedidos D1 internos serão exibidos.');
      }

      const [todosPedidosLocais, trocasAprovadas, clientesBase, rotas] = await Promise.all([
        base44.entities.Pedido.list('-created_date', 1000),
        base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500),
        base44.entities.Cliente.list('-created_date', 5000),
        base44.entities.Rota.list('-created_date', 500)
      ]);
      const clienteIdsPedidos = [...new Set([...(todosPedidosLocais || []).map(p => p.cliente_id), ...(trocasAprovadas || []).map(t => t.cliente_id)].filter(Boolean))];
      const clientesExatos = clienteIdsPedidos.length
        ? (await Promise.all(clienteIdsPedidos.map(id => base44.entities.Cliente.filter({ id }, '-created_date', 1)))).flat()
        : [];
      const clientes = Array.from(new Map([...(clientesBase || []), ...(clientesExatos || [])].map(c => [c.id, c])).values());
      const clientesMap = new Map((clientes || []).map(c => [c.id, c]));
      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));

      const pedidosD1Locais = (todosPedidosLocais || []).filter(p => {
        const modelo = String(p.modelo_nota || '').toLowerCase();
        return modelo === 'd1' && p.status === 'liberado';
      });

      // Enriquecer vendas
      let vendasEnriquecidas = [];
      if (vendasRes?.data?.sucesso && vendasRes.data.pedidos?.length > 0) {
        const { data: enriq } = await base44.functions.invoke('enriquecerPedidosCarga', {
          pedidos: vendasRes.data.pedidos
        });
        vendasEnriquecidas = enriq?.pedidos || [];
      }

      // Filtrar pedidos internos D1 que ainda não foram alocados em carga
      const d1Disponiveis = (pedidosD1Locais || []).filter(p => !p.carga_id);

      const d1ComItens = await Promise.all(
        d1Disponiveis.map(async (p) => {
          const itens = await base44.entities.PedidoItem.filter({ pedido_id: p.id });
          const cliente = clientesMap.get(p.cliente_id);
          const codigoCliente = p.cliente_codigo || cliente?.codigo_interno || cliente?.codigo_integracao || cliente?.codigo || '';
          const rotaNome = p.rota_nome || (cliente?.rota_id ? rotasMap.get(cliente.rota_id) : '') || 'Sem Rota';
          return {
            codigo_pedido: `D1-${p.id}`,
            pedido_id: p.id,
            numero_pedido: p.numero_pedido,
            codigo_cliente: p.cliente_id,
            codigo_cliente_cod: codigoCliente,
            cliente_id: p.cliente_id,
            nome_cliente: p.cliente_nome || cliente?.razao_social || '',
            nome_fantasia: p.cliente_nome_fantasia || cliente?.nome_fantasia || p.cliente_nome || cliente?.razao_social || '',
            cidade: p.cliente_cidade || cliente?.cidade || '',
            rota_nome: rotaNome,
            rota_cliente: rotaNome,
            quantidade_itens: itens.length,
            valor_total_pedido: p.valor_total || 0,
            vendedor_nome: p.vendedor_nome || '',
            observacoes: p.observacoes || '',
            tipo: 'd1',
            tipo_nota: 'D1',
            modelo_nota: 'd1',
            cenario_fiscal_nome: p.cenario_local_nome || p.cenario_fiscal_nome || '',
            produtos: itens.map(i => ({
              codigo_produto: i.produto_codigo || '',
              descricao: i.produto_nome || '',
              quantidade: i.quantidade || 0,
              valor_unitario: i.valor_unitario || 0,
              valor_total: i.valor_total || 0,
              unidade: i.unidade_medida || 'UN'
            }))
          };
        })
      );

      // Filtrar trocas que ainda não foram alocadas em carga
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id);

      // Buscar itens das trocas em paralelo
      const trocasComItens = await Promise.all(
        trocasDisponiveis.map(async (t) => {
          const itens = await base44.entities.ItemPedidoTroca.filter({ pedido_troca_id: t.id });
          return {
            codigo_pedido: `TROCA-${t.id}`,
            pedido_troca_id: t.id,
            numero_pedido: t.numero_troca,
            codigo_cliente: t.cliente_id,
            cliente_id: t.cliente_id,
            nome_cliente: t.cliente_nome || '',
            nome_fantasia: t.cliente_nome || '',
            cidade: '',
            rota_nome: 'Sem Rota',
            rota_cliente: 'Sem Rota',
            quantidade_itens: itens.length,
            valor_total_pedido: t.valor_total || 0,
            vendedor_nome: t.vendedor_nome || '',
            observacoes: t.observacoes || '',
            tipo: 'troca',
            tipo_nota: '',
            produtos: itens.map(i => ({
              codigo_produto: i.produto_codigo || '',
              descricao: i.produto_nome || '',
              quantidade: i.quantidade || 0,
              valor_unitario: i.preco_unitario || 0,
              valor_total: i.valor_total || 0,
              unidade: i.unidade_medida || 'UN',
              motivo_troca_id: i.motivo_id || '',
              motivo_troca_descricao: i.motivo_descricao || ''
            }))
          };
        })
      );

      // Enriquecer trocas com dados do cliente (cidade, rota, fantasia)
      const clienteIds = [...new Set(trocasComItens.map(t => t.cliente_id).filter(Boolean))];
      if (clienteIds.length > 0) {
        const mapaCli = new Map(clientes.filter(c => clienteIds.includes(c.id)).map(c => [c.id, c]));
        const mapaRota = rotasMap;
        trocasComItens.forEach(t => {
          const c = mapaCli.get(t.cliente_id);
          if (c) {
            t.nome_fantasia = c.nome_fantasia || c.razao_social || t.nome_cliente;
            t.cidade = c.cidade || '';
            t.rota_nome = c.rota_id ? (mapaRota.get(c.rota_id) || 'Sem Rota') : 'Sem Rota';
            t.rota_cliente = t.rota_nome;
          }
        });
      }

      setPedidos([...vendasEnriquecidas, ...d1ComItens, ...trocasComItens]);
    } catch (e) {
    const msg = e?.response?.data?.error || e.message;
    toast.error('Erro ao carregar dados: ' + msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar: carregar };
}