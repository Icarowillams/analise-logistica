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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Package, Filter, Calendar, Download, Search, ChevronDown, ChevronRight, User, Clock, AlertTriangle, X
} from 'lucide-react';

// Função para obter início da semana (domingo)
function getInicioSemana(data) {
  const d = new Date(data);
  const diaSemana = d.getDay();
  d.setDate(d.getDate() - diaSemana);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function RelatorioEstoque() {
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [busca, setBusca] = useState('');
  const [clientesExpandidos, setClientesExpandidos] = useState({});
  const [visitasExpandidas, setVisitasExpandidas] = useState({});
  const [apenasUltimoEstoque, setApenasUltimoEstoque] = useState(false);
  
  // Período padrão: início da semana até hoje
  const hoje = new Date();
  const inicioSemanaAtual = getInicioSemana(hoje);
  const [dataInicio, setDataInicio] = useState(inicioSemanaAtual.toISOString().split('T')[0]);
  const [dataFim, setDataFim] = useState(hoje.toISOString().split('T')[0]);
  
  // Filtros adicionais (como em RelatorioRoteiros)
  const [filtros, setFiltros] = useState({
    vendedores_ids: [],
    redes_ids: []
  });
  const [showFiltros, setShowFiltros] = useState(true);
  const [buscaVendedor, setBuscaVendedor] = useState('');
  const [buscaRede, setBuscaRede] = useState('');

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

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

  const visitasMap = useMemo(() => visitas.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [visitas]);

  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  
  // Funções de filtro
  const limparFiltros = () => {
    setFiltros({ vendedores_ids: [], funcoes_ids: [] });
    setBuscaVendedor('');
    setBuscaFuncao('');
  };

  const toggleVendedorFiltro = (vendedorId) => {
    setFiltros(prev => ({
      ...prev,
      vendedores_ids: prev.vendedores_ids.includes(vendedorId)
        ? prev.vendedores_ids.filter(v => v !== vendedorId)
        : [...prev.vendedores_ids, vendedorId]
    }));
  };

  const toggleFuncaoFiltro = (funcaoId) => {
    setFiltros(prev => ({
      ...prev,
      funcoes_ids: prev.funcoes_ids.includes(funcaoId)
        ? prev.funcoes_ids.filter(f => f !== funcaoId)
        : [...prev.funcoes_ids, funcaoId]
    }));
  };

  const vendedoresFiltradosLista = useMemo(() => {
    if (!buscaVendedor) return vendedores.filter(v => v.status === 'ativo');
    return vendedores.filter(v => v.status === 'ativo' && v.nome?.toLowerCase().includes(buscaVendedor.toLowerCase()));
  }, [vendedores, buscaVendedor]);

  const funcoesFiltradosLista = useMemo(() => {
    if (!buscaFuncao) return funcoes.filter(f => f.status === 'ativo');
    return funcoes.filter(f => f.status === 'ativo' && f.nome?.toLowerCase().includes(buscaFuncao.toLowerCase()));
  }, [funcoes, buscaFuncao]);

  const temFiltrosAtivos = filtros.vendedores_ids.length > 0 || filtros.funcoes_ids.length > 0 || busca;
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
    let dados = estoqueVisita.map(e => {
      const visitaRelacionada = e.visita_id ? visitasMap[e.visita_id] : null;
      // Pegar vendedor do registro OU da visita vinculada
      const vendedorId = e.vendedor_id || visitaRelacionada?.vendedor_id;
      const vendedor = vendedoresMap[vendedorId];
      // Pegar data da visita vinculada OU da data de criação
      const dataVisitaCalc = visitaRelacionada?.data_visita || e.created_date?.split('T')[0];
      return {
        ...e,
        cliente: clientesMap[e.cliente_id],
        produto: produtosMap[e.produto_id],
        vendedor: vendedor,
        vendedor_id: vendedorId,
        data_visita_calc: dataVisitaCalc,
        prazoVencimento: calcularPrazoVencimento(e.data_validade)
      };
    });

    // Filtro por período - usar created_date já que EstoqueVisita não tem data_visita
    if (dataInicio) {
      dados = dados.filter(e => {
        const dataRegistro = e.created_date ? e.created_date.split('T')[0] : null;
        return dataRegistro && dataRegistro >= dataInicio;
      });
    }
    if (dataFim) {
      dados = dados.filter(e => {
        const dataRegistro = e.created_date ? e.created_date.split('T')[0] : null;
        return dataRegistro && dataRegistro <= dataFim;
      });
    }

    // Filtros
    if (filtroCliente !== 'todos') {
      dados = dados.filter(e => e.cliente_id === filtroCliente);
    }
    
    // Filtro por vendedores selecionados
    // Busca por vendedor_id no EstoqueVisita E também por visita_id vinculada a visitas do vendedor
    if (filtros.vendedores_ids.length > 0) {
      // Pegar IDs de visitas feitas pelos vendedores selecionados
      const visitasIdsDoVendedor = new Set(
        visitas
          .filter(v => filtros.vendedores_ids.includes(v.vendedor_id))
          .map(v => v.id)
      );
      dados = dados.filter(e => 
        filtros.vendedores_ids.includes(e.vendedor_id) || 
        (e.visita_id && visitasIdsDoVendedor.has(e.visita_id))
      );
    }
    
    // Filtro por funções selecionadas
    if (filtros.funcoes_ids.length > 0) {
      const nomesFuncoesSelecionadas = funcoes
        .filter(f => filtros.funcoes_ids.includes(f.id))
        .map(f => f.nome?.toLowerCase());
      
      const vendedoresDasFuncoes = vendedores.filter(v => 
        filtros.funcoes_ids.includes(v.funcao_id) || 
        nomesFuncoesSelecionadas.includes(v.funcao?.toLowerCase())
      ).map(v => v.id);
      dados = dados.filter(e => vendedoresDasFuncoes.includes(e.vendedor_id));
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
      const datasComEstoque = [...new Set(dados.map(e => e.created_date?.split('T')[0]).filter(Boolean))];
      datasComEstoque.sort((a, b) => b.localeCompare(a));
      const ultimaDataEstoque = datasComEstoque[0];
      if (ultimaDataEstoque) {
        dados = dados.filter(e => {
          const dataRegistro = e.created_date?.split('T')[0];
          return dataRegistro === ultimaDataEstoque;
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
      const dataVisita = e.data_visita_calc || e.created_date?.split('T')[0] || 'sem_data';
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
  }, [estoqueVisita, clientesMap, produtosMap, vendedoresMap, visitasMap, filtroCliente, busca, apenasUltimoEstoque, dataInicio, dataFim, filtros, funcoes, vendedores, visitas]);

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
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-xl shrink-0">
            <Package className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-3xl font-bold text-slate-900">Relatório de Estoque</h1>
            <p className="text-xs sm:text-sm text-slate-500">{totalRegistros} registros</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowFiltros(!showFiltros)} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Filter className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Filtros</span>
            {temFiltrosAtivos && <Badge className="bg-amber-500 text-white text-[10px] px-1">{filtros.vendedores_ids.length + filtros.funcoes_ids.length + (busca ? 1 : 0)}</Badge>}
          </Button>
          <Button onClick={exportarCSV} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
        </div>
      </div>

      {/* Legenda de Cores */}
      <Card className="border-0 shadow-lg">
        <CardContent className="py-2 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <span className="text-xs sm:text-sm font-medium text-slate-600">Legenda:</span>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <Badge className="bg-green-500 text-white text-[10px] sm:text-xs">≥12d</Badge>
              <Badge className="bg-amber-500 text-white text-[10px] sm:text-xs">7-11d</Badge>
              <Badge className="bg-red-500 text-white text-[10px] sm:text-xs">&lt;7d</Badge>
              <Badge className="bg-black text-white text-[10px] sm:text-xs">Venc.</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Painel de Filtros */}
      {showFiltros && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-6 gap-2 sm:gap-4">
              {/* Filtro de Período - Data Início */}
              <div>
                <Label className="text-xs mb-1 block">Data Início</Label>
                <Input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="h-9"
                />
              </div>
              
              {/* Filtro de Período - Data Fim */}
              <div>
                <Label className="text-xs mb-1 block">Data Fim</Label>
                <Input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="h-9"
                />
              </div>
              
              {/* Filtro Funcionário */}
              <div>
                <Label className="text-xs mb-1 block">Funcionário</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.vendedores_ids.length === 0 
                          ? 'Todos' 
                          : filtros.vendedores_ids.length === 1 
                            ? vendedores.find(v => v.id === filtros.vendedores_ids[0])?.nome
                            : `${filtros.vendedores_ids.length} selecionados`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <Input
                      placeholder="Buscar funcionário..."
                      value={buscaVendedor}
                      onChange={(e) => setBuscaVendedor(e.target.value)}
                      className="h-8 mb-2"
                    />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {vendedoresFiltradosLista.map(v => (
                          <div key={v.id} className="flex items-center gap-2">
                            <Checkbox 
                              id={`vend-${v.id}`}
                              checked={filtros.vendedores_ids.includes(v.id)}
                              onCheckedChange={() => toggleVendedorFiltro(v.id)}
                            />
                            <label htmlFor={`vend-${v.id}`} className="text-sm cursor-pointer flex-1 truncate">{v.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Filtro Função */}
              <div>
                <Label className="text-xs mb-1 block">Função</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.funcoes_ids.length === 0 
                          ? 'Todas' 
                          : filtros.funcoes_ids.length === 1 
                            ? funcoes.find(f => f.id === filtros.funcoes_ids[0])?.nome
                            : `${filtros.funcoes_ids.length} selecionadas`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <Input
                      placeholder="Buscar função..."
                      value={buscaFuncao}
                      onChange={(e) => setBuscaFuncao(e.target.value)}
                      className="h-8 mb-2"
                    />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {funcoesFiltradosLista.map(f => (
                          <div key={f.id} className="flex items-center gap-2">
                            <Checkbox 
                              id={`func-${f.id}`}
                              checked={filtros.funcoes_ids.includes(f.id)}
                              onCheckedChange={() => toggleFuncaoFiltro(f.id)}
                            />
                            <label htmlFor={`func-${f.id}`} className="text-sm cursor-pointer flex-1 truncate">{f.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Buscar Cliente/Produto */}
              <div>
                <Label className="text-xs mb-1 block">Buscar</Label>
                <Input
                  placeholder="Cliente ou produto..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="h-9"
                />
              </div>
              
              {/* Cliente específico */}
              <div>
                <Label className="text-xs mb-1 block">Cliente</Label>
                <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {clientesComEstoque.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center justify-between mt-3 gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="apenasUltimoEstoque"
                  checked={apenasUltimoEstoque}
                  onCheckedChange={setApenasUltimoEstoque}
                />
                <Label htmlFor="apenasUltimoEstoque" className="text-xs sm:text-sm font-medium text-slate-700 cursor-pointer">
                  Apenas último estoque
                </Label>
                {apenasUltimoEstoque && dadosAgrupados.length > 0 && dadosAgrupados[0]?.visitas[0]?.data && (
                  <Badge className="bg-blue-100 text-blue-700 text-[10px] sm:text-xs">
                    {new Date(dadosAgrupados[0].visitas[0].data + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </Badge>
                )}
              </div>
              
              {temFiltrosAtivos && (
                <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-slate-600 gap-1">
                  <X className="w-4 h-4" />
                  Limpar filtros
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
                    <div className="flex items-center justify-between p-3 sm:p-4 hover:bg-slate-50 transition-colors cursor-pointer gap-2">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        {clientesExpandidos[clienteData.clienteId] ? (
                          <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />
                        )}
                        <div className="text-left min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 text-sm sm:text-base truncate">
                            {clienteData.cliente?.nome_fantasia || clienteData.cliente?.razao_social || 'Cliente não identificado'}
                          </div>
                          <div className="text-xs sm:text-sm text-slate-500">
                            {clienteData.totalProdutos} lanç. • {clienteData.totalItens} un.
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-slate-600 text-[10px] sm:text-xs shrink-0">
                        {clienteData.visitas.length} vis.
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
                              <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 hover:bg-slate-100/50 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0 gap-2">
                                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                  {visitasExpandidas[visitaKey] ? (
                                    <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
                                  )}
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-blue-500 shrink-0" />
                                      <span className="font-medium text-slate-700 text-xs sm:text-sm">
                                        {new Date(visita.data).toLocaleDateString('pt-BR')}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-slate-500">
                                      <User className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                                      <span className="text-[10px] sm:text-sm truncate">{visita.vendedor?.nome || 'N/A'}</span>
                                    </div>
                                  </div>
                                </div>
                                <Badge className="bg-blue-100 text-blue-700 text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
                                  {visita.totalLancamentos} prod.
                                </Badge>
                              </div>
                            </CollapsibleTrigger>

                            {/* Produtos da Visita - Agrupados por Produto */}
                            <CollapsibleContent>
                              <div className="bg-white px-2 sm:px-6 py-2 sm:py-3 space-y-0">
                                {/* Cabeçalho - Desktop Only */}
                                <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 uppercase tracking-wide pb-2 border-b">
                                  <div className="col-span-4">Produto</div>
                                  <div className="col-span-1 text-center">Qtd</div>
                                  <div className="col-span-2 text-center">Validade</div>
                                  <div className="col-span-2 text-center">Prazo</div>
                                  <div className="col-span-3 text-center">Lançamento</div>
                                </div>
                                
                                {(() => {
                                  // Agrupar registros por produto_id
                                  const produtosAgrupados = {};
                                  visita.produtos.forEach(prod => {
                                    const prodId = prod.produto_id || 'sem_id';
                                    if (!produtosAgrupados[prodId]) {
                                      produtosAgrupados[prodId] = {
                                        produto: prod.produto,
                                        registros: [],
                                        totalQuantidade: 0
                                      };
                                    }
                                    produtosAgrupados[prodId].registros.push(prod);
                                    produtosAgrupados[prodId].totalQuantidade += (prod.quantidade || 0);
                                  });
                                  
                                  // Ordenar por nome do produto
                                  const gruposOrdenados = Object.values(produtosAgrupados).sort((a, b) => 
                                    (a.produto?.nome || '').localeCompare(b.produto?.nome || '')
                                  );
                                  
                                  return gruposOrdenados.map((grupo, gIdx) => (
                                    <div key={gIdx} className="border-b border-slate-100 last:border-b-0">
                                      {grupo.registros.map((prod, pIdx) => (
                                        <div key={pIdx}>
                                          {/* Mobile Layout - Card Style */}
                                          <div className="sm:hidden p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-2 my-1">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-slate-800 leading-tight">{prod.produto?.nome || 'Produto N/A'}</p>
                                                {prod.produto?.codigo && (
                                                  <p className="text-[10px] text-slate-400">Cód: {prod.produto.codigo}</p>
                                                )}
                                              </div>
                                              <Badge className="bg-blue-100 text-blue-700 text-[10px] px-1.5 shrink-0">
                                                {prod.quantidade || 0} un.
                                              </Badge>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="text-[10px] text-slate-500">
                                                <span className="font-medium">Val:</span> {prod.data_validade ? new Date(prod.data_validade).toLocaleDateString('pt-BR') : '-'}
                                              </div>
                                              <Badge className={`text-[10px] px-1.5 ${getCorPrazo(prod.prazoVencimento)}`}>
                                                {prod.prazoVencimento !== null ? (prod.prazoVencimento < 0 ? `Venc. ${Math.abs(prod.prazoVencimento)}d` : `${prod.prazoVencimento}d`) : '-'}
                                              </Badge>
                                            </div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-1 border-t border-slate-100 pt-1.5">
                                              <Clock className="w-2.5 h-2.5" />
                                              {prod.created_date ? new Date(prod.created_date).toLocaleString('pt-BR') : '-'}
                                            </div>
                                          </div>
                                          
                                          {/* Desktop Layout - Grid */}
                                          <div className="hidden sm:grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg hover:bg-slate-50">
                                            <div className="col-span-4">
                                              <span className="text-slate-700 font-medium">{prod.produto?.nome || 'Produto N/A'}</span>
                                              {prod.produto?.codigo && (
                                                <span className="text-xs text-slate-400 ml-2">({prod.produto.codigo})</span>
                                              )}
                                            </div>
                                            <div className="col-span-1 text-center">
                                              <Badge className="bg-blue-100 text-blue-700">
                                                {prod.quantidade || 0}
                                              </Badge>
                                            </div>
                                            <div className="col-span-2 text-center text-sm text-slate-600">
                                              {prod.data_validade ? new Date(prod.data_validade).toLocaleDateString('pt-BR') : '-'}
                                            </div>
                                            <div className="col-span-2 text-center">
                                              <Badge className={`text-xs ${getCorPrazo(prod.prazoVencimento)}`}>
                                                {prod.prazoVencimento !== null && prod.prazoVencimento < 7 && (
                                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                                )}
                                                {getLabelPrazo(prod.prazoVencimento)}
                                              </Badge>
                                            </div>
                                            <div className="col-span-3 text-center flex items-center justify-center gap-1 text-xs text-slate-500">
                                              <Clock className="w-3 h-3" />
                                              {prod.created_date ? new Date(prod.created_date).toLocaleString('pt-BR') : '-'}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      
                                      {/* Subtotal do produto */}
                                      <div className="sm:hidden px-2.5 py-1.5 mb-1">
                                        <div className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-200">
                                          <span className="text-[10px] font-bold text-amber-800 truncate">Total {grupo.produto?.nome || 'Produto'}</span>
                                          <Badge className="bg-amber-500 text-white text-[10px] font-bold px-2 shrink-0">{grupo.totalQuantidade} un.</Badge>
                                        </div>
                                      </div>
                                      <div className="hidden sm:grid grid-cols-12 gap-2 items-center py-1.5 px-3 bg-amber-50 rounded-lg mx-1 mb-1 border border-amber-200">
                                        <div className="col-span-4">
                                          <span className="text-amber-800 font-bold text-sm">Total: {grupo.produto?.nome || 'Produto'}</span>
                                        </div>
                                        <div className="col-span-1 text-center">
                                          <Badge className="bg-amber-500 text-white font-bold">{grupo.totalQuantidade}</Badge>
                                        </div>
                                        <div className="col-span-7"></div>
                                      </div>
                                    </div>
                                  ));
                                })()}
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