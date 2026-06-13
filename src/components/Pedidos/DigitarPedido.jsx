import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, ShoppingCart, ArrowLeftRight } from 'lucide-react';
import PedidoFormulario from './PedidoFormulario';

export default function DigitarPedido({ vendedor, editingPedidoId, onClearEdit, permissaoCenariosFiscais }) {
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [tipoPedido, setTipoPedido] = useState(null);
  const [searchCliente, setSearchCliente] = useState('');
  const [selectedDia, setSelectedDia] = useState(() => {
    const diaMap = { 0: 'domingo', 1: 'segunda-feira', 2: 'terca-feira', 3: 'quarta-feira', 4: 'quinta-feira', 5: 'sexta-feira', 6: 'sabado' };
    return diaMap[new Date().getDay()];
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros', vendedor.id],
    queryFn: () => base44.entities.Roteiro.filter({ vendedor_id: vendedor.id }),
    enabled: !!vendedor
  });

  // Carrega TODOS os clientes do vendedor (list ignora limite padrao de 50)
  const { data: clientesVendedor = [] } = useQuery({
    queryKey: ['clientes-vendedor', vendedor.id],
    queryFn: async () => {
      const todos = await base44.entities.Cliente.list('-created_date', 5000);
      return todos.filter(c => c.vendedor_id === vendedor.id && c.status === 'ativo');
    },
    enabled: !!vendedor?.id
  });

  const clientes = useMemo(() => clientesVendedor, [clientesVendedor]);

  // If editing, load pedido and jump to form
  const { data: editingPedido } = useQuery({
    queryKey: ['pedido-edit', editingPedidoId],
    queryFn: async () => {
      const allPedidos = await base44.entities.Pedido.list('-created_date', 5000);
      return allPedidos.find(p => p.id === editingPedidoId);
    },
    enabled: !!editingPedidoId
  });

  useEffect(() => {
    if (editingPedido && editingPedidoId) {
      const cli = clientes.find(c => c.id === editingPedido.cliente_id);
      if (cli) {
        setSelectedCliente(cli);
        setTipoPedido(editingPedido.tipo);
      }
    }
  }, [editingPedido, editingPedidoId, clientes]);

  const diasSemana = [
    { valor: 'segunda-feira', label: 'Seg' },
    { valor: 'terca-feira', label: 'Ter' },
    { valor: 'quarta-feira', label: 'Qua' },
    { valor: 'quinta-feira', label: 'Qui' },
    { valor: 'sexta-feira', label: 'Sex' },
    { valor: 'sabado', label: 'Sáb' },
    { valor: 'domingo', label: 'Dom' }
  ];

  // Resolve a lista de clientes de um dia a partir do roteiro (deduplicando por cliente)
  const resolverClientesDoDia = (dia) => {
    const roteiroDia = roteiros.find(r => r.dia_semana === dia);
    if (!roteiroDia || !roteiroDia.clientes_detalhes) return [];
    const vistos = new Set();
    return roteiroDia.clientes_detalhes.map(cd => {
      // Prioriza busca por código interno (campo estável) em vez de cliente_id (pode mudar)
      const clienteCompleto = clientes.find(c => cd.cliente_codigo && (c.codigo_interno === cd.cliente_codigo || c.codigo_integracao === cd.cliente_codigo))
        || clientes.find(c => cd.cliente_id && c.id === cd.cliente_id);
      if (!clienteCompleto || vistos.has(clienteCompleto.id)) return null;
      vistos.add(clienteCompleto.id);
      return { ...clienteCompleto, ordem: cd.ordem };
    }).filter(Boolean);
  };

  const clientesDoDia = useMemo(() => resolverClientesDoDia(selectedDia), [roteiros, selectedDia, clientes]);

  // Contagem real por dia (igual à lista exibida) — usada no badge das abas
  const contagemPorDia = useMemo(() => {
    const m = {};
    roteiros.forEach(r => { m[r.dia_semana] = resolverClientesDoDia(r.dia_semana).length; });
    return m;
  }, [roteiros, clientes]);

  const clientesFiltrados = clientesDoDia.filter(c => {
    const s = searchCliente.toLowerCase();
    return !s || c.razao_social?.toLowerCase().includes(s) || c.nome_fantasia?.toLowerCase().includes(s) || c.codigo_interno?.toLowerCase().includes(s);
  });

  return (
    <div>
      {/* Formulário do pedido - mantém montado enquanto cliente selecionado */}
      {selectedCliente && (
        <div style={{ display: selectedCliente ? 'block' : 'none' }}>
          <PedidoFormulario
            key={selectedCliente.id + (editingPedidoId || '')}
            cliente={selectedCliente}
            tipo={tipoPedido || 'venda'}
            vendedor={vendedor}
            editingPedidoId={editingPedidoId}
            permissaoCenariosFiscais={permissaoCenariosFiscais}
            onVoltar={() => {
              setSelectedCliente(null);
              setTipoPedido(null);
              onClearEdit();
            }}
          />
        </div>
      )}

      {/* Lista de clientes - esconde quando formulário aberto */}
      <div style={{ display: selectedCliente ? 'none' : 'block' }} className="space-y-4">
        {/* Day tabs */}
        <Tabs value={selectedDia} onValueChange={setSelectedDia}>
          <TabsList className="flex flex-wrap w-full gap-1 h-auto p-1">
            {diasSemana.map(dia => {
              const count = contagemPorDia[dia.valor] || 0;
              return (
                <TabsTrigger key={dia.valor} value={dia.valor} className="text-xs flex-1 min-w-[40px] px-1 py-1.5">
                  {dia.label}
                  {count > 0 && <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1">{count}</Badge>}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar cliente por código ou nome..."
            value={searchCliente}
            onChange={(e) => setSearchCliente(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Client list */}
        {clientesFiltrados.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>Nenhum cliente encontrado para este dia</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clientesFiltrados.map((cli) => (
              <Card key={cli.id} className="cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition-colors" onClick={() => setSelectedCliente(cli)}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{cli.codigo_interno || cli.codigo} - {cli.nome_fantasia || cli.razao_social}</p>
                    <p className="text-xs text-slate-500 truncate">{cli.cidade}{cli.bairro ? `, ${cli.bairro}` : ''}</p>
                  </div>
                  <ShoppingCart className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}