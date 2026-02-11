import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, ShoppingCart, ArrowLeftRight } from 'lucide-react';
import PedidoFormulario from './PedidoFormulario';

export default function DigitarPedido({ vendedor, editingPedidoId, onClearEdit }) {
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

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  // If editing, load pedido and jump to form
  const { data: editingPedido } = useQuery({
    queryKey: ['pedido-edit', editingPedidoId],
    queryFn: async () => {
      const pedidos = await base44.entities.Pedido.filter({ id: editingPedidoId });
      return pedidos[0];
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

  const clientesDoDia = useMemo(() => {
    const roteiroDia = roteiros.find(r => r.dia_semana === selectedDia);
    if (!roteiroDia || !roteiroDia.clientes_detalhes) return [];
    return roteiroDia.clientes_detalhes.map(cd => {
      const clienteCompleto = clientes.find(c => c.id === cd.cliente_id);
      return clienteCompleto ? { ...clienteCompleto, ordem: cd.ordem } : null;
    }).filter(Boolean);
  }, [roteiros, selectedDia, clientes]);

  const clientesFiltrados = clientesDoDia.filter(c => {
    const s = searchCliente.toLowerCase();
    return !s || c.razao_social?.toLowerCase().includes(s) || c.nome_fantasia?.toLowerCase().includes(s) || c.codigo?.includes(s);
  });

  if (selectedCliente && tipoPedido) {
    return (
      <PedidoFormulario
        cliente={selectedCliente}
        tipo={tipoPedido}
        vendedor={vendedor}
        editingPedidoId={editingPedidoId}
        onVoltar={() => {
          setSelectedCliente(null);
          setTipoPedido(null);
          onClearEdit();
        }}
      />
    );
  }

  if (selectedCliente && !tipoPedido) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedCliente(null)} className="text-sm text-blue-600 hover:underline">← Voltar</button>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{selectedCliente.codigo} - {selectedCliente.nome_fantasia || selectedCliente.razao_social}</CardTitle>
            <p className="text-sm text-slate-500">{selectedCliente.cidade}{selectedCliente.bairro ? `, ${selectedCliente.bairro}` : ''}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Selecione o tipo de pedido:</p>
            <div className="grid grid-cols-2 gap-3">
              <Card className="cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors" onClick={() => setTipoPedido('venda')}>
                <CardContent className="pt-6 flex flex-col items-center gap-2">
                  <ShoppingCart className="w-8 h-8 text-green-600" />
                  <span className="font-semibold text-green-700">Venda</span>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-colors" onClick={() => setTipoPedido('troca')}>
                <CardContent className="pt-6 flex flex-col items-center gap-2">
                  <ArrowLeftRight className="w-8 h-8 text-orange-600" />
                  <span className="font-semibold text-orange-700">Troca</span>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Day tabs */}
      <Tabs value={selectedDia} onValueChange={setSelectedDia}>
        <TabsList className="flex flex-wrap w-full gap-1 h-auto p-1">
          {diasSemana.map(dia => {
            const roteiroDia = roteiros.find(r => r.dia_semana === dia.valor);
            const count = roteiroDia?.clientes_ids?.length || 0;
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
                  <p className="font-medium text-sm truncate">{cli.codigo} - {cli.nome_fantasia || cli.razao_social}</p>
                  <p className="text-xs text-slate-500 truncate">{cli.cidade}{cli.bairro ? `, ${cli.bairro}` : ''}</p>
                </div>
                <ShoppingCart className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}