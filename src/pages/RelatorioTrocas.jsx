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
  ArrowLeftRight, Filter, Calendar, Download, Search, ChevronDown, ChevronRight, User, Clock, AlertTriangle, X
} from 'lucide-react';

function getInicioSemana(data) {
  const d = new Date(data);
  const diaSemana = d.getDay();
  d.setDate(d.getDate() - diaSemana);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function RelatorioTrocas() {
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [busca, setBusca] = useState('');
  const [clientesExpandidos, setClientesExpandidos] = useState({});
  const [visitasExpandidas, setVisitasExpandidas] = useState({});
  const [apenasUltimaTroca, setApenasUltimaTroca] = useState(false);

  const hoje = new Date();
  const inicioSemanaAtual = getInicioSemana(hoje);
  const [dataInicio, setDataInicio] = useState(inicioSemanaAtual.toISOString().split('T')[0]);
  const [dataFim, setDataFim] = useState(hoje.toISOString().split('T')[0]);

  const [filtros, setFiltros] = useState({
    funcionarios_ids: [],
    vendedores_ids: [],
    redes_ids: []
  });
  const [showFiltros, setShowFiltros] = useState(true);
  const [buscaFuncionario, setBuscaFuncionario] = useState('');
  const [buscaVendedor, setBuscaVendedor] = useState('');
  const [buscaRede, setBuscaRede] = useState('');

  const { data: trocasVisitaAll = [], isLoading } = useQuery({
    queryKey: ['trocasVisita'],
    queryFn: () => base44.entities.TrocaVisita.list('-created_date', 5000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { filtrarClientes, filtrarPorCliente } = useClientesPermissao();
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const trocasVisita = useMemo(() => filtrarPorCliente(trocasVisitaAll), [trocasVisitaAll, filtrarPorCliente]);

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

  const visitasMap = useMemo(() => visitas.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [visitas]);
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Filtros helpers
  const limparFiltros = () => {
    setFiltros({ funcionarios_ids: [], vendedores_ids: [], redes_ids: [] });
    setBuscaFuncionario('');
    setBuscaVendedor('');
    setBuscaRede('');
  };

  const toggleFuncionarioFiltro = (id) => {
    setFiltros(prev => ({
      ...prev,
      funcionarios_ids: prev.funcionarios_ids.includes(id)
        ? prev.funcionarios_ids.filter(v => v !== id)
        : [...prev.funcionarios_ids, id]
    }));
  };

  const toggleVendedorFiltro = (id) => {
    setFiltros(prev => ({
      ...prev,
      vendedores_ids: prev.vendedores_ids.includes(id)
        ? prev.vendedores_ids.filter(v => v !== id)
        : [...prev.vendedores_ids, id]
    }));
  };

  const toggleRedeFiltro = (redeId) => {
    setFiltros(prev => ({
      ...prev,
      redes_ids: prev.redes_ids.includes(redeId)
        ? prev.redes_ids.filter(r => r !== redeId)
        : [...prev.redes_ids, redeId]
    }));
  };

  const funcionariosFiltradosLista = useMemo(() => {
    const lista = vendedores.filter(v => v.status === 'ativo');
    if (!buscaFuncionario) return lista;
    return lista.filter(v => v.nome?.toLowerCase().includes(buscaFuncionario.toLowerCase()));
  }, [vendedores, buscaFuncionario]);

  const vendedoresFiltradosLista = useMemo(() => {
    const lista = vendedores.filter(v => v.status === 'ativo');
    if (!buscaVendedor) return lista;
    return lista.filter(v => v.nome?.toLowerCase().includes(buscaVendedor.toLowerCase()));
  }, [vendedores, buscaVendedor]);

  const redesFiltradosLista = useMemo(() => {
    const ativas = redes.filter(r => r.status !== 'inativo');
    if (!buscaRede) return ativas;
    return ativas.filter(r => r.nome?.toLowerCase().includes(buscaRede.toLowerCase()));
  }, [redes, buscaRede]);

  const temFiltrosAtivos = filtros.funcionarios_ids.length > 0 || filtros.vendedores_ids.length > 0 || filtros.redes_ids.length > 0 || busca;

  const clientesComTrocas = useMemo(() => {
    const ids = new Set(trocasVisita.map(t => t.cliente_id).filter(Boolean));
    return Array.from(ids).map(id => clientesMap[id]).filter(Boolean).sort((a, b) => (a.nome_fantasia || a.razao_social || '').localeCompare(b.nome_fantasia || b.razao_social || ''));
  }, [trocasVisita, clientesMap]);

  // Dados agrupados por cliente > visita > produtos
  const dadosAgrupados = useMemo(() => {
    let dados = trocasVisita.map(t => {
      const visitaRelacionada = t.visita_id ? visitasMap[t.visita_id] : null;
      const vendedorId = t.vendedor_id || visitaRelacionada?.vendedor_id;
      const vendedor = vendedoresMap[vendedorId];
      const dataVisitaCalc = visitaRelacionada?.data_visita || t.created_date?.split('T')[0];
      // Se o cliente não está no mapa, criar objeto com nome salvo na troca
      const clienteObj = clientesMap[t.cliente_id] || (t.cliente_nome ? { nome_fantasia: t.cliente_nome, razao_social: t.cliente_nome } : null);
      return {
        ...t,
        cliente: clienteObj,
        produto: produtosMap[t.produto_id] || { nome: t.produto_nome, codigo: t.produto_codigo },
        vendedor,
        vendedor_id_calc: vendedorId,
        data_visita_calc: dataVisitaCalc
      };
    });

    // Filtro por período
    if (dataInicio) {
      dados = dados.filter(t => {
        const dr = t.created_date ? t.created_date.split('T')[0] : null;
        return dr && dr >= dataInicio;
      });
    }
    if (dataFim) {
      dados = dados.filter(t => {
        const dr = t.created_date ? t.created_date.split('T')[0] : null;
        return dr && dr <= dataFim;
      });
    }

    // Filtro por cliente
    if (filtroCliente !== 'todos') {
      dados = dados.filter(t => t.cliente_id === filtroCliente);
    }

    // Filtro por funcionário (quem lançou a troca)
    if (filtros.funcionarios_ids.length > 0) {
      const visitasIdsFuncionario = new Set(
        visitas.filter(v => filtros.funcionarios_ids.includes(v.vendedor_id)).map(v => v.id)
      );
      dados = dados.filter(t =>
        filtros.funcionarios_ids.includes(t.vendedor_id_calc) ||
        (t.visita_id && visitasIdsFuncionario.has(t.visita_id))
      );
    }

    // Filtro por vendedor (vendedor do cadastro do cliente)
    if (filtros.vendedores_ids.length > 0) {
      const clientesDoVendedor = new Set(
        clientes.filter(c => filtros.vendedores_ids.includes(c.vendedor_id)).map(c => c.id)
      );
      dados = dados.filter(t => clientesDoVendedor.has(t.cliente_id));
    }

    // Filtro por redes
    if (filtros.redes_ids.length > 0) {
      const clientesDasRedes = new Set(
        clientes.filter(c => filtros.redes_ids.includes(c.rede_id)).map(c => c.id)
      );
      dados = dados.filter(t => clientesDasRedes.has(t.cliente_id));
    }

    // Busca
    if (busca) {
      const termo = busca.toLowerCase();
      dados = dados.filter(t =>
        t.cliente?.razao_social?.toLowerCase().includes(termo) ||
        t.cliente?.nome_fantasia?.toLowerCase().includes(termo) ||
        t.produto?.nome?.toLowerCase().includes(termo) ||
        t.produto?.codigo?.toLowerCase().includes(termo) ||
        t.motivo_troca?.toLowerCase().includes(termo)
      );
    }

    // "Apenas última troca" = para cada cliente, retornar todos os lançamentos da última visita
    if (apenasUltimaTroca && dados.length > 0) {
      // Para cada cliente, achar a data da última visita com trocas
      const ultimaVisitaPorCliente = {};
      dados.forEach(t => {
        const cId = t.cliente_id || 'sem_cliente';
        const dataReg = t.data_visita_calc || t.created_date?.split('T')[0] || '';
        if (!ultimaVisitaPorCliente[cId] || dataReg > ultimaVisitaPorCliente[cId]) {
          ultimaVisitaPorCliente[cId] = dataReg;
        }
      });
      // Manter todos os registros dessa última data para cada cliente
      dados = dados.filter(t => {
        const cId = t.cliente_id || 'sem_cliente';
        const dataReg = t.data_visita_calc || t.created_date?.split('T')[0] || '';
        return dataReg === ultimaVisitaPorCliente[cId];
      });
    }

    // Agrupar por cliente
    const porCliente = {};
    dados.forEach(t => {
      const clienteId = t.cliente_id || 'sem_cliente';
      if (!porCliente[clienteId]) {
        porCliente[clienteId] = {
          cliente: t.cliente,
          clienteId,
          visitas: {},
          totalProdutos: 0,
          totalItens: 0
        };
      }

      const dataVisita = t.data_visita_calc || t.created_date?.split('T')[0] || 'sem_data';
      const vendedorId = t.vendedor_id_calc || 'sem_vendedor';
      const visitaKey = `${dataVisita}_${vendedorId}`;

      if (!porCliente[clienteId].visitas[visitaKey]) {
        porCliente[clienteId].visitas[visitaKey] = {
          data: dataVisita,
          vendedor: t.vendedor,
          vendedorId,
          produtos: [],
          totalLancamentos: 0
        };
      }

      porCliente[clienteId].visitas[visitaKey].produtos.push(t);
      porCliente[clienteId].visitas[visitaKey].totalLancamentos++;
      porCliente[clienteId].totalProdutos++;
      porCliente[clienteId].totalItens += t.quantidade || 0;
    });

    return Object.values(porCliente)
      .map(c => ({
        ...c,
        visitas: Object.values(c.visitas).sort((a, b) => b.data.localeCompare(a.data))
      }))
      .sort((a, b) => (a.cliente?.nome_fantasia || a.cliente?.razao_social || '').localeCompare(b.cliente?.nome_fantasia || b.cliente?.razao_social || ''));
  }, [trocasVisita, clientesMap, produtosMap, vendedoresMap, visitasMap, filtroCliente, busca, apenasUltimaTroca, dataInicio, dataFim, filtros, clientes, vendedores, visitas]);

  const toggleCliente = (clienteId) => {
    setClientesExpandidos(prev => ({ ...prev, [clienteId]: !prev[clienteId] }));
  };

  const toggleVisita = (key) => {
    setVisitasExpandidas(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const exportarCSV = () => {
    const linhas = ['Data;Cliente;Produto;Código;Motivo;Quantidade;Validade;Fabricação;Promotor'];
    dadosAgrupados.forEach(cliente => {
      cliente.visitas.forEach(visita => {
        visita.produtos.forEach(t => {
          linhas.push([
            t.created_date ? new Date(t.created_date).toLocaleString('pt-BR') : '',
            t.cliente?.nome_fantasia || t.cliente?.razao_social || '',
            t.produto?.nome || '',
            t.produto?.codigo || '',
            t.motivo_troca || '',
            t.quantidade || 0,
            t.data_validade ? new Date(t.data_validade).toLocaleDateString('pt-BR') : '',
            t.data_fabricacao ? new Date(t.data_fabricacao).toLocaleDateString('pt-BR') : '',
            t.vendedor?.nome || ''
          ].join(';'));
        });
      });
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_trocas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

  const totalRegistros = dadosAgrupados.reduce((sum, c) => sum + c.totalProdutos, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-xl shrink-0">
            <ArrowLeftRight className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-3xl font-bold text-slate-900">Relatório de Trocas</h1>
            <p className="text-xs sm:text-sm text-slate-500">{totalRegistros} registros</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowFiltros(!showFiltros)} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Filter className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Filtros</span>
            {temFiltrosAtivos && <Badge className="bg-amber-500 text-white text-[10px] px-1">{filtros.funcionarios_ids.length + filtros.vendedores_ids.length + filtros.redes_ids.length + (busca ? 1 : 0)}</Badge>}
          </Button>
          <Button onClick={exportarCSV} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>
        </div>
      </div>

      {/* Card informativo */}
      <div className="p-4 rounded-lg border bg-orange-50 border-orange-200">
        <h3 className="font-semibold mb-1 text-orange-900">Trocas de Visitas</h3>
        <p className="text-sm text-orange-800">
          Registros de trocas coletados durante visitas pelos promotores nos formulários dos roteiros.
        </p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-red-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-700">{totalRegistros}</div>
            <div className="text-sm text-orange-600">Registros</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-700">
              {dadosAgrupados.reduce((sum, c) => sum + c.totalItens, 0)}
            </div>
            <div className="text-sm text-red-600">Quantidade Total</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-700">{dadosAgrupados.length}</div>
            <div className="text-sm text-purple-600">Clientes</div>
          </CardContent>
        </Card>
      </div>

      {/* Painel de Filtros */}
      {showFiltros && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-7 gap-2 sm:gap-4">
              {/* Data Início */}
              <div>
                <Label className="text-xs mb-1 block">Data Início</Label>
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-9" />
              </div>
              {/* Data Fim */}
              <div>
                <Label className="text-xs mb-1 block">Data Fim</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-9" />
              </div>
              {/* Filtro Funcionário (lançamento) */}
              <div>
                <Label className="text-xs mb-1 block">Func. Lançamento</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.funcionarios_ids.length === 0 ? 'Todos' : filtros.funcionarios_ids.length === 1 ? vendedores.find(v => v.id === filtros.funcionarios_ids[0])?.nome : `${filtros.funcionarios_ids.length} selecionados`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <Input placeholder="Buscar funcionário..." value={buscaFuncionario} onChange={(e) => setBuscaFuncionario(e.target.value)} className="h-8 mb-2" />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {funcionariosFiltradosLista.map(v => (
                          <div key={v.id} className="flex items-center gap-2">
                            <Checkbox id={`func-${v.id}`} checked={filtros.funcionarios_ids.includes(v.id)} onCheckedChange={() => toggleFuncionarioFiltro(v.id)} />
                            <label htmlFor={`func-${v.id}`} className="text-sm cursor-pointer flex-1 truncate">{v.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Filtro Vendedor (do cadastro do cliente) */}
              <div>
                <Label className="text-xs mb-1 block">Vendedor</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.vendedores_ids.length === 0 ? 'Todos' : filtros.vendedores_ids.length === 1 ? vendedores.find(v => v.id === filtros.vendedores_ids[0])?.nome : `${filtros.vendedores_ids.length} selecionados`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <Input placeholder="Buscar vendedor..." value={buscaVendedor} onChange={(e) => setBuscaVendedor(e.target.value)} className="h-8 mb-2" />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {vendedoresFiltradosLista.map(v => (
                          <div key={v.id} className="flex items-center gap-2">
                            <Checkbox id={`vend-${v.id}`} checked={filtros.vendedores_ids.includes(v.id)} onCheckedChange={() => toggleVendedorFiltro(v.id)} />
                            <label htmlFor={`vend-${v.id}`} className="text-sm cursor-pointer flex-1 truncate">{v.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Filtro Rede */}
              <div>
                <Label className="text-xs mb-1 block">Rede</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.redes_ids.length === 0 ? 'Todas' : filtros.redes_ids.length === 1 ? redes.find(r => r.id === filtros.redes_ids[0])?.nome : `${filtros.redes_ids.length} selecionadas`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <Input placeholder="Buscar rede..." value={buscaRede} onChange={(e) => setBuscaRede(e.target.value)} className="h-8 mb-2" />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {redesFiltradosLista.map(r => (
                          <div key={r.id} className="flex items-center gap-2">
                            <Checkbox id={`rede-${r.id}`} checked={filtros.redes_ids.includes(r.id)} onCheckedChange={() => toggleRedeFiltro(r.id)} />
                            <label htmlFor={`rede-${r.id}`} className="text-sm cursor-pointer flex-1 truncate">{r.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Buscar */}
              <div>
                <Label className="text-xs mb-1 block">Buscar</Label>
                <Input placeholder="Produto, motivo..." value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9" />
              </div>
              {/* Cliente */}
              <div>
                <Label className="text-xs mb-1 block">Cliente</Label>
                <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {clientesComTrocas.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between mt-3 gap-2">
              <div className="flex items-center gap-2">
                <Checkbox id="apenasUltimaTroca" checked={apenasUltimaTroca} onCheckedChange={setApenasUltimaTroca} />
                <Label htmlFor="apenasUltimaTroca" className="text-xs sm:text-sm font-medium text-slate-700 cursor-pointer">
                  Apenas última troca
                </Label>
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
              <ArrowLeftRight className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhuma troca encontrada</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {dadosAgrupados.map((clienteData) => (
                <Collapsible
                  key={clienteData.clienteId}
                  open={clientesExpandidos[clienteData.clienteId]}
                  onOpenChange={() => toggleCliente(clienteData.clienteId)}
                >
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between p-3 sm:p-4 hover:bg-slate-50 transition-colors cursor-pointer gap-2">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        {clientesExpandidos[clienteData.clienteId] ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 shrink-0" />}
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

                  <CollapsibleContent>
                    <div className="border-t border-slate-100 bg-slate-50/50">
                      {clienteData.visitas.map((visita, idx) => {
                        const visitaKey = `${clienteData.clienteId}_${visita.data}_${visita.vendedorId}`;
                        return (
                          <Collapsible key={idx} open={visitasExpandidas[visitaKey]} onOpenChange={() => toggleVisita(visitaKey)}>
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 hover:bg-slate-100/50 transition-colors cursor-pointer border-b border-slate-100 last:border-b-0 gap-2">
                                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                  {visitasExpandidas[visitaKey] ? <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 text-slate-400 shrink-0" />}
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <Calendar className="w-3 h-3 sm:w-4 sm:h-4 text-orange-500 shrink-0" />
                                      <span className="font-medium text-slate-700 text-xs sm:text-sm">
                                        {new Date(visita.data + 'T12:00:00').toLocaleDateString('pt-BR')}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-slate-500">
                                      <User className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                                      <span className="text-[10px] sm:text-sm truncate">{visita.vendedor?.nome || 'N/A'}</span>
                                    </div>
                                  </div>
                                </div>
                                <Badge className="bg-orange-100 text-orange-700 text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
                                  {visita.totalLancamentos} prod.
                                </Badge>
                              </div>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="bg-white px-2 sm:px-6 py-2 sm:py-3 space-y-0">
                                {/* Cabeçalho Desktop */}
                                <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 uppercase tracking-wide pb-2 border-b">
                                  <div className="col-span-4">Produto</div>
                                  <div className="col-span-2">Motivo</div>
                                  <div className="col-span-1 text-center">Qtd</div>
                                  <div className="col-span-2 text-center">Validade</div>
                                  <div className="col-span-3 text-center">Fabricação</div>
                                </div>

                                {(() => {
                                  const produtosAgrupados = {};
                                  visita.produtos.forEach(prod => {
                                    const prodId = prod.produto_id || 'sem_id';
                                    if (!produtosAgrupados[prodId]) {
                                      produtosAgrupados[prodId] = { produto: prod.produto, registros: [], totalQuantidade: 0 };
                                    }
                                    produtosAgrupados[prodId].registros.push(prod);
                                    produtosAgrupados[prodId].totalQuantidade += (prod.quantidade || 0);
                                  });

                                  const gruposOrdenados = Object.values(produtosAgrupados).sort((a, b) =>
                                    (a.produto?.nome || '').localeCompare(b.produto?.nome || '')
                                  );

                                  return gruposOrdenados.map((grupo, gIdx) => (
                                    <div key={gIdx} className="border-b border-slate-100 last:border-b-0">
                                      {grupo.registros.map((prod, pIdx) => (
                                        <div key={pIdx}>
                                          {/* Mobile */}
                                          <div className="sm:hidden p-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-2 my-1">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-slate-800 leading-tight">{prod.produto?.nome || 'N/A'}</p>
                                                {prod.produto?.codigo && <p className="text-[10px] text-slate-400">Cód: {prod.produto.codigo}</p>}
                                              </div>
                                              <Badge className="bg-orange-100 text-orange-700 text-[10px] px-1.5 shrink-0">{prod.quantidade || 0} un.</Badge>
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                              <AlertTriangle className="w-3 h-3 text-orange-500" />
                                              <span>{prod.motivo_troca || '-'}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-100 pt-1.5">
                                              <span>Val: {prod.data_validade ? new Date(prod.data_validade + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                                              <span>Fab: {prod.data_fabricacao ? new Date(prod.data_fabricacao + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</span>
                                            </div>
                                          </div>

                                          {/* Desktop */}
                                          <div className="hidden sm:grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg hover:bg-slate-50">
                                            <div className="col-span-4">
                                              <span className="text-slate-700 font-medium">{prod.produto?.nome || 'N/A'}</span>
                                              {prod.produto?.codigo && <span className="text-xs text-slate-400 ml-2">({prod.produto.codigo})</span>}
                                            </div>
                                            <div className="col-span-2 flex items-center gap-1">
                                              <AlertTriangle className="w-3 h-3 text-orange-500" />
                                              <span className="text-sm text-slate-600">{prod.motivo_troca || '-'}</span>
                                            </div>
                                            <div className="col-span-1 text-center">
                                              <Badge className="bg-orange-100 text-orange-700">{prod.quantidade || 0}</Badge>
                                            </div>
                                            <div className="col-span-2 text-center text-sm text-slate-600">
                                              {prod.data_validade ? new Date(prod.data_validade + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                            </div>
                                            <div className="col-span-3 text-center text-sm text-slate-600">
                                              {prod.data_fabricacao ? new Date(prod.data_fabricacao + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                                            </div>
                                          </div>
                                        </div>
                                      ))}

                                      {/* Subtotal do produto */}
                                      <div className="sm:hidden px-2.5 py-1.5 mb-1">
                                        <div className="flex items-center justify-between bg-orange-50 rounded-lg px-3 py-1.5 border border-orange-200">
                                          <span className="text-[10px] font-bold text-orange-800 truncate">Total {grupo.produto?.nome || 'Produto'}</span>
                                          <Badge className="bg-orange-500 text-white text-[10px] font-bold px-2 shrink-0">{grupo.totalQuantidade} un.</Badge>
                                        </div>
                                      </div>
                                      <div className="hidden sm:grid grid-cols-12 gap-2 items-center py-1.5 px-3 bg-orange-50 rounded-lg mx-1 mb-1 border border-orange-200">
                                        <div className="col-span-4">
                                          <span className="text-orange-800 font-bold text-sm">Total: {grupo.produto?.nome || 'Produto'}</span>
                                        </div>
                                        <div className="col-span-2"></div>
                                        <div className="col-span-1 text-center">
                                          <Badge className="bg-orange-500 text-white font-bold">{grupo.totalQuantidade}</Badge>
                                        </div>
                                        <div className="col-span-5"></div>
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