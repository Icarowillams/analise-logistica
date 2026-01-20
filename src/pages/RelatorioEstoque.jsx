import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Package, Filter, Calendar, Download, Search, MapPin, ChevronDown, ChevronRight, Eye
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function RelatorioEstoque() {
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [busca, setBusca] = useState('');
  const [clientesExpandidos, setClientesExpandidos] = useState({});
  const [visitasExpandidas, setVisitasExpandidas] = useState({});
  const [modalUltimoEstoque, setModalUltimoEstoque] = useState({ open: false, produto: null, dados: [] });

  const { data: estoqueVisitaAll = [], isLoading } = useQuery({
    queryKey: ['estoqueVisita'],
    queryFn: () => base44.entities.EstoqueVisita.list('-created_date', 5000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  // Permissões de visibilidade de clientes
  const { filtrarClientes, filtrarPorCliente } = useClientesPermissao();

  // Dados filtrados por permissão
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const estoqueVisita = useMemo(() => filtrarPorCliente(estoqueVisitaAll), [estoqueVisitaAll, filtrarPorCliente]);

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  // Mapas
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Clientes com estoque registrado
  const clientesComEstoque = useMemo(() => {
    const ids = new Set(estoqueVisita.map(e => e.cliente_id).filter(Boolean));
    return Array.from(ids).map(id => clientesMap[id]).filter(Boolean).sort((a, b) => (a.nome_fantasia || a.razao_social || '').localeCompare(b.nome_fantasia || b.razao_social || ''));
  }, [estoqueVisita, clientesMap]);

  // Produtos com estoque registrado
  const produtosComEstoque = useMemo(() => {
    const ids = new Set(estoqueVisita.map(e => e.produto_id).filter(Boolean));
    return Array.from(ids).map(id => produtosMap[id]).filter(Boolean).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [estoqueVisita, produtosMap]);

  // Dados agrupados por cliente > visita > produtos
  const dadosAgrupados = useMemo(() => {
    let dados = estoqueVisita.map(e => ({
      ...e,
      cliente: clientesMap[e.cliente_id],
      produto: produtosMap[e.produto_id],
      vendedor: vendedoresMap[e.vendedor_id]
    }));

    // Filtros
    if (filtroCliente !== 'todos') {
      dados = dados.filter(e => e.cliente_id === filtroCliente);
    }
    if (filtroProduto !== 'todos') {
      dados = dados.filter(e => e.produto_id === filtroProduto);
    }
    if (busca) {
      const termo = busca.toLowerCase();
      dados = dados.filter(e => 
        e.cliente?.razao_social?.toLowerCase().includes(termo) ||
        e.cliente?.nome_fantasia?.toLowerCase().includes(termo) ||
        e.produto?.nome?.toLowerCase().includes(termo) ||
        e.produto?.codigo?.toLowerCase().includes(termo)
      );
    }

    // Agrupar por cliente
    const porCliente = {};
    dados.forEach(e => {
      const clienteId = e.cliente_id || 'sem_cliente';
      if (!porCliente[clienteId]) {
        porCliente[clienteId] = {
          cliente: e.cliente,
          clienteId,
          visitas: {},
          totalProdutos: 0,
          totalItens: 0
        };
      }
      
      // Agrupar por data de visita
      const dataVisita = e.data_visita || e.created_date?.split('T')[0] || 'sem_data';
      if (!porCliente[clienteId].visitas[dataVisita]) {
        porCliente[clienteId].visitas[dataVisita] = {
          data: dataVisita,
          vendedor: e.vendedor,
          produtos: [],
          totalLancamentos: 0
        };
      }
      
      porCliente[clienteId].visitas[dataVisita].produtos.push(e);
      porCliente[clienteId].visitas[dataVisita].totalLancamentos++;
      porCliente[clienteId].totalProdutos++;
      porCliente[clienteId].totalItens += e.quantidade || 0;
    });

    // Converter para array e ordenar visitas por data desc
    return Object.values(porCliente)
      .map(cliente => ({
        ...cliente,
        visitas: Object.values(cliente.visitas).sort((a, b) => b.data.localeCompare(a.data))
      }))
      .sort((a, b) => (a.cliente?.nome_fantasia || a.cliente?.razao_social || '').localeCompare(b.cliente?.nome_fantasia || b.cliente?.razao_social || ''));
  }, [estoqueVisita, clientesMap, produtosMap, vendedoresMap, filtroCliente, filtroProduto, busca]);

  const toggleCliente = (clienteId) => {
    setClientesExpandidos(prev => ({ ...prev, [clienteId]: !prev[clienteId] }));
  };

  const toggleVisita = (key) => {
    setVisitasExpandidas(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Buscar último estoque de um produto específico em todos os clientes
  const verUltimoEstoque = (produto) => {
    const registros = estoqueVisita
      .filter(e => e.produto_id === produto.id)
      .map(e => ({
        ...e,
        cliente: clientesMap[e.cliente_id],
        vendedor: vendedoresMap[e.vendedor_id]
      }))
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

    // Pegar o mais recente por cliente
    const porCliente = {};
    registros.forEach(r => {
      if (!porCliente[r.cliente_id]) {
        porCliente[r.cliente_id] = r;
      }
    });

    setModalUltimoEstoque({
      open: true,
      produto,
      dados: Object.values(porCliente).sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    });
  };

  const exportarCSV = () => {
    const linhas = ['Data;Cliente;Código Cliente;Produto;Código Produto;Quantidade;Validade;Vendedor'];
    dadosAgrupados.forEach(cliente => {
      cliente.visitas.forEach(visita => {
        visita.produtos.forEach(e => {
          linhas.push([
            new Date(e.created_date).toLocaleDateString('pt-BR'),
            e.cliente?.nome_fantasia || e.cliente?.razao_social || '',
            e.cliente?.codigo || '',
            e.produto?.nome || '',
            e.produto?.codigo || '',
            e.quantidade || 0,
            e.data_validade ? new Date(e.data_validade).toLocaleDateString('pt-BR') : '',
            e.vendedor?.nome || ''
          ].join(';'));
        });
      });
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_estoque_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

  const totalRegistros = dadosAgrupados.reduce((sum, c) => sum + c.totalProdutos, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-xl">
            <Package className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Relatório de Estoque</h1>
            <p className="text-slate-500 mt-1">{totalRegistros} registros encontrados</p>
          </div>
        </div>
        <Button onClick={exportarCSV} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-600" />
            <CardTitle className="text-base">Filtros</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Cliente</label>
              <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {clientesComEstoque.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Produto</label>
              <Select value={filtroProduto} onValueChange={setFiltroProduto}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {produtosComEstoque.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Cliente ou produto..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista Agrupada por Cliente */}
      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-8 text-slate-500">Carregando...</div>
          ) : dadosAgrupados.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhum registro de estoque encontrado</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dadosAgrupados.map((clienteData) => (
                <div key={clienteData.clienteId} className="bg-white">
                  {/* Header do Cliente */}
                  <button
                    onClick={() => toggleCliente(clienteData.clienteId)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {clientesExpandidos[clienteData.clienteId] ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      )}
                      <div className="text-left">
                        <div className="font-semibold text-slate-900">
                          {clienteData.cliente?.nome_fantasia || clienteData.cliente?.razao_social || 'Cliente não identificado'}
                        </div>
                        <div className="text-sm text-slate-500">
                          {clienteData.totalProdutos} produtos • {clienteData.totalItens} itens total
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-slate-600">
                      {clienteData.visitas.length} visitas
                    </Badge>
                  </button>

                  {/* Visitas do Cliente */}
                  {clientesExpandidos[clienteData.clienteId] && (
                    <div className="border-t border-slate-100 bg-slate-50/50">
                      {clienteData.visitas.map((visita, idx) => {
                        const visitaKey = `${clienteData.clienteId}_${visita.data}`;
                        return (
                          <div key={idx} className="border-b border-slate-100 last:border-b-0">
                            {/* Header da Visita */}
                            <button
                              onClick={() => toggleVisita(visitaKey)}
                              className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-100/50 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                {visitasExpandidas[visitaKey] ? (
                                  <ChevronDown className="w-4 h-4 text-slate-400" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-slate-400" />
                                )}
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4 text-blue-500" />
                                  <span className="font-medium text-slate-700">
                                    Visita em {new Date(visita.data).toLocaleDateString('pt-BR')}
                                  </span>
                                </div>
                              </div>
                              <span className="text-sm text-slate-500">
                                {visita.vendedor?.nome || 'N/A'} • {visita.totalLancamentos} lançamento(s)
                              </span>
                            </button>

                            {/* Produtos da Visita */}
                            {visitasExpandidas[visitaKey] && (
                              <div className="bg-white px-8 py-3 space-y-1">
                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                                  Produto
                                </div>
                                {visita.produtos.map((prod, pIdx) => (
                                  <div 
                                    key={pIdx} 
                                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 group"
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-slate-700">{prod.produto?.nome || 'Produto N/A'}</span>
                                      {prod.quantidade !== undefined && (
                                        <Badge className="bg-blue-100 text-blue-700">
                                          Qtd: {prod.quantidade}
                                        </Badge>
                                      )}
                                      {prod.data_validade && (
                                        <Badge variant="outline" className="text-xs">
                                          Val: {new Date(prod.data_validade).toLocaleDateString('pt-BR')}
                                        </Badge>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        verUltimoEstoque(prod.produto);
                                      }}
                                    >
                                      <Eye className="w-4 h-4 mr-1" />
                                      Ver Último Estoque
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Último Estoque */}
      <Dialog open={modalUltimoEstoque.open} onOpenChange={(open) => setModalUltimoEstoque({ ...modalUltimoEstoque, open })}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              Último Estoque - {modalUltimoEstoque.produto?.nome}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {modalUltimoEstoque.dados.length === 0 ? (
              <p className="text-center text-slate-500 py-4">Nenhum registro encontrado</p>
            ) : (
              modalUltimoEstoque.dados.map((registro, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium text-slate-900">
                      {registro.cliente?.nome_fantasia || registro.cliente?.razao_social || 'Cliente N/A'}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <MapPin className="w-3 h-3" />
                      {registro.cliente?.cidade || 'N/A'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {registro.vendedor?.nome || 'N/A'} • {new Date(registro.created_date).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-blue-100 text-blue-700 text-lg px-3">
                      {registro.quantidade || 0}
                    </Badge>
                    {registro.data_validade && (
                      <div className="text-xs text-slate-500 mt-1">
                        Val: {new Date(registro.data_validade).toLocaleDateString('pt-BR')}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}