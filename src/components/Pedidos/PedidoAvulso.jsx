import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, ShoppingCart, MapPin } from 'lucide-react';
import PedidoFormulario from './PedidoFormulario';

export default function PedidoAvulso({ vendedor, editingPedidoId, onClearEdit, permissaoCenariosFiscais }) {
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [tipoPedido, setTipoPedido] = useState(null);
  const [searchText, setSearchText] = useState('');

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  // If editing, load pedido and jump to form
  const { data: editingPedido } = useQuery({
    queryKey: ['pedido-edit-avulso', editingPedidoId],
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

  const clientesFiltrados = useMemo(() => {
    const s = searchText.trim().toLowerCase();
    if (!s) return [];
    return clientes.filter(c =>
      c.status === 'ativo' && (
        c.codigo?.toLowerCase().includes(s) ||
        c.razao_social?.toLowerCase().includes(s) ||
        c.nome_fantasia?.toLowerCase().includes(s) ||
        c.cpf_cnpj?.includes(s)
      )
    ).slice(0, 50);
  }, [clientes, searchText]);

  return (
    <div>
      {/* Formulário do pedido */}
      {selectedCliente && (
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
      )}

      {/* Busca de clientes */}
      {!selectedCliente && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar cliente por código, nome, fantasia ou CNPJ..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10 text-base"
              autoFocus
            />
          </div>

          {!searchText.trim() && (
            <div className="text-center text-slate-500 py-16">
              <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">Digite para buscar um cliente</p>
              <p className="text-xs mt-1">Busque por código, razão social, nome fantasia ou CNPJ</p>
            </div>
          )}

          {searchText.trim() && clientesFiltrados.length === 0 && (
            <div className="text-center text-slate-500 py-12">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum cliente encontrado</p>
            </div>
          )}

          {clientesFiltrados.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{clientesFiltrados.length} cliente(s) encontrado(s)</p>
              {clientesFiltrados.map(cli => (
                <Card
                  key={cli.id}
                  className="cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
                  onClick={() => { setSelectedCliente(cli); setTipoPedido('venda'); }}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded font-bold">{cli.codigo}</span>
                        <span className="font-medium text-sm truncate">{cli.nome_fantasia || cli.razao_social}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {cli.razao_social}
                        {cli.cpf_cnpj && <span className="ml-2 text-slate-400">• {cli.cpf_cnpj}</span>}
                      </p>
                      {(cli.cidade || cli.bairro) && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {cli.cidade}{cli.bairro ? `, ${cli.bairro}` : ''}
                        </p>
                      )}
                    </div>
                    <ShoppingCart className="w-4 h-4 text-amber-500 shrink-0 ml-2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}