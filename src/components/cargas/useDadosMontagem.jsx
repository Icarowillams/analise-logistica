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

      // Paralelo: pedidos Omie etapa 20 + pedidos de troca aprovados (em cargas ainda não atribuídas)
      const [vendasRes, trocasAprovadas] = await Promise.all([
        base44.functions.invoke('buscarPedidosOmie', { etapa: '20', registros_por_pagina: 100, buscar_todas_paginas: true, max_paginas: 8 }),
        base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500)
      ]);

      // Enriquecer vendas
      let vendasEnriquecidas = [];
      if (vendasRes?.data?.sucesso && vendasRes.data.pedidos.length > 0) {
        const { data: enriq } = await base44.functions.invoke('enriquecerPedidosCarga', {
          pedidos: vendasRes.data.pedidos
        });
        vendasEnriquecidas = enriq?.pedidos || [];
      }

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
        const clientes = await base44.entities.Cliente.filter({ id: { $in: clienteIds } }, '-created_date', 500);
        const mapaCli = new Map(clientes.map(c => [c.id, c]));
        const rotas = await base44.entities.Rota.list('-created_date', 500);
        const mapaRota = new Map(rotas.map(r => [r.id, r.nome]));
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

      setPedidos([...vendasEnriquecidas, ...trocasComItens]);
    } catch (e) {
    const msg = e?.response?.data?.error || e.message;
    toast.error('Erro ao carregar dados: ' + msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar: carregar };
}