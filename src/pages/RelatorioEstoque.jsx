import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { 
  Package, Filter, Calendar, Download, Search, ChevronDown, ChevronRight, User, Clock, AlertTriangle
} from 'lucide-react';

export default function RelatorioEstoque() {
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [busca, setBusca] = useState('');
  const [clientesExpandidos, setClientesExpandidos] = useState({});
  const [visitasExpandidas, setVisitasExpandidas] = useState({});
  const [apenasUltimoEstoque, setApenasUltimoEstoque] = useState(false);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  const { data: estoqueVisitaAll = [], isLoading } = useQuery({
    queryKey: ['estoqueVisita'],
    queryFn: () => base44.entities.EstoqueVisita.list('-created_date', 5000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { filtrarClientes, filtrarPorCliente } = useClientesPermissao();

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

  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Clientes com estoque registrado
  const clientesComEstoque = useMemo(() => {
    const ids = new Set(estoqueVisita.map(e => e.cliente_id).filter(Boolean));
    return Array.from(ids).map(id => clientesMap[id]).filter(Boolean).sort((a, b) => (a.nome_fantasia || a.razao_social || '').localeCompare(b.nome_fantasia || b.razao_social || ''));
  }, [estoqueVisita, clientesMap]);

  // Calcular prazo de vencimento
  const calcularPrazoVencimento = (dataValidade) => {
    if (!dataValidade) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const validade = new Date(dataValidade);
    validade.setHours(0, 0, 0, 0);
    const diffTime = validade - hoje;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getCorPrazo = (diasRestantes) => {
    if (diasRestantes === null) return 'bg-slate-100 text-slate-600';
    if (diasRestantes < 0) return 'bg-black text-white'; // Vencido
    if (diasRestantes < 7) return 'bg-red-500 text-white'; // Crítico
    if (diasRestantes < 12) return 'bg-amber-500 text-white'; // Atenção
    return 'bg-green-500 text-white'; // Normal
  };

  const getLabelPrazo = (diasRestantes) => {
    if (diasRestantes === null) return 'Sem validade';
    if (diasRestantes < 0) return `Vencido há ${Math.abs(diasRestantes)} dias`;
    if (diasRestantes === 0) return 'Vence hoje';
    if (diasRestantes === 1) return '1 dia para vencer';
    return `${diasRestantes} dias para vencer`;
  };

  // Dados agrupados por cliente > visita (data + usuário) > produtos
  const dadosAgrupados = useMemo(() => {
    let dados = estoqueVisita.map(e => ({
      ...e,
      cliente: clientesMap[e.cliente_id],
      produto: produtosMap[e.produto_id],
      vendedor: vendedoresMap[e.vendedor_id],
      prazoVencimento: calcularPrazoVencimento(e.data_validade)
    }));

    // Filtro por período
    if (dataInicio) {
      dados = dados.filter(e => {
        const dataVisita = e.data_visita || e.created_date?.split('T')[0];
        return dataVisita >= dataInicio;
      });
    }
    if (dataFim) {
      dados = dados.filter(e => {
        const dataVisita = e.data_visita || e.created_date?.split('T')[0];
        return dataVisita <= dataFim;
      });
    }

    // Filtros
    if (filtroCliente !== 'todos') {
      dados = dados.filter(e => e.cliente_id === filtroCliente);
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

    // Se "apenas último estoque" estiver marcado, filtrar para mostrar apenas a última data com estoque lançado
    if (apenasUltimoEstoque && dados.length > 0) {
      // Encontrar todas as datas únicas de lançamento de estoque
      const datasComEstoque = [...new Set(dados.map(e => e.data_visita || e.created_date?.split('T')[0]).filter(Boolean))];
      // Ordenar datas do mais recente para o mais antigo
      datasComEstoque.sort((a, b) => b.localeCompare(a));
      // Pegar a última data (mais recente)
      const ultimaDataEstoque = datasComEstoque[0];
      // Filtrar apenas registros desta data
      if (ultimaDataEstoque) {
        dados = dados.filter(e => {
          const dataVisita = e.data_visita || e.created_date?.split('T')[0];
          return dataVisita === ultimaDataEstoque;
        });
      }
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
      
      // Agrupar por data de visita + vendedor
      const dataVisita = e.data_visita || e.created_date?.split('T')[0] || 'sem_data';
      const vendedorId = e.vendedor_id || 'sem_vendedor';
      const visitaKey = `${dataVisita}_${vendedorId}`;
      
      if (!porCliente[clienteId].visitas[visitaKey]) {
        porCliente[clienteId].visitas[visitaKey] = {
          data: dataVisita,
          vendedor: e.vendedor,
          vendedorId,
          produtos: [],
          totalLancamentos: 0
        };
      }
      
      porCliente[clienteId].visitas[visitaKey].produtos.push(e);
      porCliente[clienteId].visitas[visitaKey].totalLancamentos++;
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
  }, [estoqueVisita, clientesMap, produtosMap, vendedoresMap, filtroCliente, busca, apenasUltimoEstoque, dataInicio, dataFim]);

  const toggleCliente = (clienteId) => {
    setClientesExpandidos(prev => ({ ...prev, [clienteId]: !prev[clienteId] }));
  };

  const toggleVisita = (key) => {
    setVisitasExpandidas(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const exportarCSV = () => {
    const linhas = ['Data Lançamento;Cliente;Código Cliente;Produto;Código Produto;Quantidade;Data Validade;Prazo Vencimento;Vendedor'];
    dadosAgrupados.forEach(cliente => {
      cliente.visitas.forEach(visita => {
        visita.produtos.forEach(e => {
          const prazo = e.prazoVencimento !== null ? `${e.prazoVencimento} dias` : '';
          linhas.push([
            e.created_date ? new Date(e.created_date).toLocaleString('pt-BR') : '',
            e.cliente?.nome_fantasia || e.cliente?.razao_social || '',
            e.cliente?.codigo || '',
            e.produto?.nome || '',
            e.produto?.codigo || '',
            e.quantidade || 0,
            e.data_validade ? new Date(e.data_validade).toLocaleDateString('pt-BR') : '',
            prazo,
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

      {/* Legenda de Cores */}
      <Card className="border-0 shadow-lg">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-slate-600">Prazo de Vencimento:</span>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-green-500 text-white">Normal (≥12 dias)</Badge>
              <Badge className="bg-amber-500 text-white">Atenção (7-11 dias)</Badge>
              <Badge className="bg-red-500 text-white">Crítico (&lt;7 dias)</Badge>
              <Badge className="bg-black text-white">Vencido</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-slate-600" />
            <CardTitle className="text-base">Filtros</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Início</label>
              <Input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Fim</label>
              <Input
                type="date"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Cliente</label>
              <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os Clientes</SelectItem>
                  {clientesComEstoque.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>
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
          <div className="mt-4 flex items-center gap-2">
            <Checkbox
              id="apenasUltimoEstoque"
              checked={apenasUltimoEstoque}
              onCheckedChange={setApenasUltimoEstoque}
            />
            <Label htmlFor="apenasUltimoEstoque" className="text-sm font-medium text-slate-700 cursor-pointer">
              Apenas último estoque lançado
            </Label>
            {apenasUltimoEstoque && dadosAgrupados.length > 0 && dadosAgrupados[0]?.visitas[0]?.data && (
              <Badge className="bg-blue-100 text-blue-700 ml-2">
                Data: {new Date(dadosAgrupados[0].visitas[0].data + 'T12:00:00').toLocaleDateString('pt-BR')}
              </Badge>
            )}
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
                <Collapsible 
                  key={clienteData.clienteId} 
                  open={clientesExpandidos[clienteData.clienteId]}
                  onOpenChange={() => toggleCliente(clienteData.clienteId)}
                >
                  {/* Header do Cliente */}
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors cursor-pointer">
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
                            {clienteData.totalProdutos} lançamentos • {clienteData.totalItens} unidades
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-slate-600">
                        {clienteData.visitas.length} visitas
                      </Badge>
                    </div>
                  </CollapsibleTrigger>

                  {/* Visitas do Cliente */}
                  <CollapsibleContent>
                    <div className="border-t border-slate-100 bg-slate-50/50">
                      {clienteData.visitas.map((visita, idx) => {
                        const visitaKey = `${clienteData.clienteId}_${visita.data}_${visita.vendedorId}`;
                        return (
                          <Collapsible 
                            key={idx} 
                            open={visitasExpandidas[visitaKey]}
                            onOpenChange={() => toggleVisita(visitaKey)}
                          >
                            {/* Header da Visita */}
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between px-6 py-3 hover:bg-slate-100/50 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0">
                                <div className="flex items-center gap-3">
                                  {visitasExpandidas[visitaKey] ? (
                                    <ChevronDown className="w-4 h-4 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-slate-400" />
                                  )}
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                      <Calendar className="w-4 h-4 text-blue-500" />
                                      <span className="font-medium text-slate-700">
                                        {new Date(visita.data).toLocaleDateString('pt-BR')}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-slate-500">
                                      <User className="w-4 h-4" />
                                      <span className="text-sm">{visita.vendedor?.nome || 'N/A'}</span>
                                    </div>
                                  </div>
                                </div>
                                <Badge className="bg-blue-100 text-blue-700">
                                  {visita.totalLancamentos} produtos
                                </Badge>
                              </div>
                            </CollapsibleTrigger>

                            {/* Produtos da Visita */}
                            <CollapsibleContent>
                              <div className="bg-white px-8 py-3 space-y-2">
                                {/* Cabeçalho */}
                                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 uppercase tracking-wide pb-2 border-b">
                                  <div className="col-span-4">Produto</div>
                                  <div className="col-span-1 text-center">Qtd</div>
                                  <div className="col-span-2 text-center">Validade</div>
                                  <div className="col-span-2 text-center">Prazo</div>
                                  <div className="col-span-3 text-center">Lançamento</div>
                                </div>
                                
                                {visita.produtos.map((prod, pIdx) => (
                                  <div 
                                    key={pIdx} 
                                    className="grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg hover:bg-slate-50"
                                  >
                                    {/* Produto */}
                                    <div className="col-span-4">
                                      <span className="text-slate-700 font-medium">{prod.produto?.nome || 'Produto N/A'}</span>
                                      {prod.produto?.codigo && (
                                        <span className="text-xs text-slate-400 ml-2">({prod.produto.codigo})</span>
                                      )}
                                    </div>
                                    
                                    {/* Quantidade */}
                                    <div className="col-span-1 text-center">
                                      <Badge className="bg-blue-100 text-blue-700">
                                        {prod.quantidade || 0}
                                      </Badge>
                                    </div>
                                    
                                    {/* Data de Validade */}
                                    <div className="col-span-2 text-center text-sm text-slate-600">
                                      {prod.data_validade ? new Date(prod.data_validade).toLocaleDateString('pt-BR') : '-'}
                                    </div>
                                    
                                    {/* Prazo de Vencimento */}
                                    <div className="col-span-2 text-center">
                                      <Badge className={`text-xs ${getCorPrazo(prod.prazoVencimento)}`}>
                                        {prod.prazoVencimento !== null && prod.prazoVencimento < 7 && (
                                          <AlertTriangle className="w-3 h-3 mr-1" />
                                        )}
                                        {getLabelPrazo(prod.prazoVencimento)}
                                      </Badge>
                                    </div>
                                    
                                    {/* Data e Hora de Lançamento */}
                                    <div className="col-span-3 text-center flex items-center justify-center gap-1 text-xs text-slate-500">
                                      <Clock className="w-3 h-3" />
                                      {prod.created_date ? new Date(prod.created_date).toLocaleString('pt-BR') : '-'}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}