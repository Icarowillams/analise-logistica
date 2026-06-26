import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, ShoppingCart, MapPin, Filter, Loader2 } from 'lucide-react';
import PedidoFormulario from './PedidoFormulario';
import BuscarClienteModal from './BuscarClienteModal';
import useBuscaClientes from '@/components/hooks/useBuscaClientes';

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
    // Busca o pedido DIRETO por id (sem baixar o banco inteiro de pedidos).
    queryFn: () => base44.entities.Pedido.get(editingPedidoId),
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

  // BUSCA SERVER-SIDE (na digitação) — não depende mais de baixar a base inteira de
  // clientes no navegador antes de pesquisar (isso falhava silenciosamente em conexões
  // lentas/celular, deixando a busca "sem resultados"). A partir de 2 caracteres, consulta
  // o servidor por código, razão social e nome fantasia.
  const termo = (searchCodigo || searchFantasia).trim();
  const { clientes: clientesFiltrados, isFetching: buscando, termoAtivo } = useBuscaClientes(termo, { minChars: 2, limite: 50 });

  // Lista inicial: clientes ativos já exibidos ao abrir a aba (sem precisar pesquisar).
  // Só carrega quando a aba está ativa e não há nenhum termo de busca digitado.
  const semBusca = termo.length < 2;
  // Todos os vendedores veem TODOS os clientes ativos no Pedido Avulso (sem filtro por carteira).
  const { data: clientesIniciais = [], isFetching: carregandoIniciais } = useQuery({
    queryKey: ['clientes-iniciais-avulso'],
    queryFn: () => base44.entities.Cliente.filter({ status: 'ativo' }, 'razao_social', 500),
    enabled: activeTab === 'avulso' && !selectedCliente && semBusca,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // O que a lista exibe: resultados da busca (com termo) ou a lista inicial (sem termo).
  const clientesExibidos = semBusca ? clientesIniciais : clientesFiltrados;

  // Ao selecionar, garante o registro completo (se vier enxuto) antes de abrir o form.
  const handleSelectCliente = async (cli) => {
    let completo = cli;
    if (!cli.cnpj_cpf || !cli.endereco) {
      const r = await base44.entities.Cliente.filter({ id: cli.id }, '-created_date', 1).catch(() => []);
      if (r[0]) completo = r[0];
    }
    setSelectedCliente(completo);
    setTipoPedido('venda');
  };

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
                placeholder="Código"
                value={searchCodigo}
                onChange={(e) => setSearchCodigo(e.target.value)}
                className="text-base"
                autoFocus
              />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Razão social ou nome fantasia"
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

          {((termoAtivo && buscando) || (semBusca && carregandoIniciais)) && (
            <div className="text-center text-slate-500 py-12">
              <Loader2 className="w-8 h-8 mx-auto mb-3 text-amber-500 animate-spin" />
              <p>Carregando clientes...</p>
            </div>
          )}

          {!buscando && !carregandoIniciais && clientesExibidos.length === 0 && (
            <div className="text-center text-slate-500 py-12">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum cliente encontrado</p>
              <p className="text-xs mt-1">Tente outro termo ou o botão "Pesquisar" para filtros detalhados</p>
            </div>
          )}

          {clientesExibidos.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                {semBusca ? `${clientesExibidos.length} cliente(s) ativo(s)` : `${clientesExibidos.length} cliente(s) encontrado(s)`}
              </p>
              {clientesExibidos.map(cli => (
                <Card
                  key={cli.id}
                  className="cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
                  onClick={() => handleSelectCliente(cli)}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded font-bold">{getCodigo(cli)}</span>
                        <span className="font-medium text-sm truncate">{cli.razao_social}</span>
                      </div>
                      {cli.nome_fantasia && (
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {cli.nome_fantasia}
                          {cli.cnpj_cpf && <span className="ml-2 text-slate-400">• {cli.cnpj_cpf}</span>}
                        </p>
                      )}
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