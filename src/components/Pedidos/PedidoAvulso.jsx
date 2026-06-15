import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, ShoppingCart, MapPin, Filter } from 'lucide-react';
import PedidoFormulario from './PedidoFormulario';
import BuscarClienteModal from './BuscarClienteModal';
import useDebounce from '@/hooks/useDebounce';

export default function PedidoAvulso({ vendedor, activeTab, editingPedidoId, onClearEdit, permissaoCenariosFiscais }) {
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [tipoPedido, setTipoPedido] = useState(null);
  const [searchCodigo, setSearchCodigo] = useState('');
  const [searchFantasia, setSearchFantasia] = useState('');
  const [modalBuscaOpen, setModalBuscaOpen] = useState(false);

  const getCodigo = (c) => c?.codigo_interno || c?.codigo_integracao || c?.codigo || c?.codigo_omie || '';

  // If editing, load pedido and jump to form
  const { data: editingPedido } = useQuery({
    queryKey: ['pedido-edit-avulso', editingPedidoId],
    queryFn: async () => {
      const allPedidos = await base44.entities.Pedido.list('-created_date', 5000);
      return allPedidos.find(p => p.id === editingPedidoId);
    },
    enabled: !!editingPedidoId
  });

  // Em edição: busca SÓ o cliente do pedido (por id), não a base inteira.
  useEffect(() => {
    if (editingPedido && editingPedidoId && editingPedido.cliente_id) {
      base44.entities.Cliente.filter({ id: editingPedido.cliente_id }, '-created_date', 1).then(r => {
        if (r[0]) {
          setSelectedCliente(r[0]);
          setTipoPedido(editingPedido.tipo);
        }
      }).catch(() => {});
    }
  }, [editingPedido, editingPedidoId]);

  // Debounce (~350ms) — evita 1 chamada por tecla digitada.
  const codigoDebounced = useDebounce(searchCodigo.trim(), 350);
  const fantasiaDebounced = useDebounce(searchFantasia.trim(), 350);

  // Busca SERVER-SIDE exata por código OU nome fantasia — nada antes de digitar.
  const buscaTermo = codigoDebounced || fantasiaDebounced;
  const { data: clientesFiltrados = [] } = useQuery({
    queryKey: ['avulso-busca-cliente', codigoDebounced, fantasiaDebounced],
    queryFn: async () => {
      const cod = codigoDebounced;
      const fan = fantasiaDebounced;
      let resultado = [];
      if (cod) {
        const listas = await Promise.all([
          base44.entities.Cliente.filter({ codigo_interno: cod, status: 'ativo' }, '-created_date', 10).catch(() => []),
          base44.entities.Cliente.filter({ codigo_integracao: cod, status: 'ativo' }, '-created_date', 10).catch(() => []),
        ]);
        resultado = listas.flat();
      } else if (fan) {
        resultado = await base44.entities.Cliente.filter({ nome_fantasia: fan, status: 'ativo' }, '-created_date', 10).catch(() => []);
      }
      const mapa = new Map();
      resultado.forEach(c => { if (c && !mapa.has(c.id)) mapa.set(c.id, c); });
      return Array.from(mapa.values()).slice(0, 50);
    },
    enabled: !!buscaTermo,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const handleConfirmModal = (codigo, cliente) => {
    if (cliente) {
      setSelectedCliente(cliente);
      setTipoPedido('venda');
    }
  };

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
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative sm:w-40">
              <Input
                placeholder="Código (exato)"
                value={searchCodigo}
                onChange={(e) => setSearchCodigo(e.target.value)}
                className="text-base"
                autoFocus
              />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Nome fantasia (exato)"
                value={searchFantasia}
                onChange={(e) => setSearchFantasia(e.target.value)}
                className="pl-10 text-base"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setModalBuscaOpen(true)}
              className="gap-2 shrink-0"
              title="Busca detalhada com filtros (vendedor, segmento, rota...)"
            >
              <Filter className="w-4 h-4" />
              Pesquisar
            </Button>
          </div>

          {!searchCodigo.trim() && !searchFantasia.trim() && (
            <div className="text-center text-slate-500 py-16">
              <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">Digite para buscar um cliente</p>
              <p className="text-xs mt-1">Código ou nome fantasia exatos — ou use Pesquisar para filtros detalhados</p>
            </div>
          )}

          {(searchCodigo.trim() || searchFantasia.trim()) && clientesFiltrados.length === 0 && (
            <div className="text-center text-slate-500 py-12">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum cliente encontrado com correspondência exata</p>
              <p className="text-xs mt-1">Tente o botão "Pesquisar" para uma busca mais ampla</p>
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
                        <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded font-bold">{getCodigo(cli)}</span>
                        <span className="font-medium text-sm truncate">{cli.nome_fantasia || cli.razao_social}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {cli.razao_social}
                        {cli.cnpj_cpf && <span className="ml-2 text-slate-400">• {cli.cnpj_cpf}</span>}
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

      <BuscarClienteModal
        open={modalBuscaOpen}
        onOpenChange={setModalBuscaOpen}
        onConfirm={handleConfirmModal}
      />
    </div>
  );
}