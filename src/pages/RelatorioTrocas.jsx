import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeftRight, Filter, Calendar, Download, Search, MapPin, User, AlertTriangle, Package, FileSpreadsheet
} from 'lucide-react';

export default function RelatorioTrocas() {
  const [mainTab, setMainTab] = useState('importadas');
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [busca, setBusca] = useState('');
  const [mostrarApenasUltima, setMostrarApenasUltima] = useState(false);

  // Buscar trocas de visitas (TrocaVisita) - Estoque
  const { data: trocasVisita = [], isLoading: loadingVisita } = useQuery({
    queryKey: ['trocasVisita'],
    queryFn: () => base44.entities.TrocaVisita.list('-created_date', 5000)
  });

  // Buscar trocas importadas (Troca)
  const { data: trocasImportadas = [], isLoading: loadingImportadas } = useQuery({
    queryKey: ['trocas'],
    queryFn: () => base44.entities.Troca.list('-data', 5000)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: motivosTroca = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  // Mapas
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);
  const motivosMap = useMemo(() => motivosTroca.reduce((acc, m) => { acc[m.id] = m; return acc; }, {}), [motivosTroca]);

  // Trocas de Estoque (Visita)
  const trocasEstoque = useMemo(() => {
    return trocasVisita.map(t => ({
      id: t.id,
      data: t.created_date?.split('T')[0],
      cliente_id: t.cliente_id,
      cliente: clientesMap[t.cliente_id] || { razao_social: t.cliente_nome },
      produto_id: t.produto_id,
      produto: produtosMap[t.produto_id] || { nome: t.produto_nome, codigo: t.produto_codigo },
      vendedor_id: t.vendedor_id,
      vendedor: vendedoresMap[t.vendedor_id] || { nome: t.vendedor_nome },
      quantidade: t.quantidade || 1,
      motivo: t.motivo_troca || '',
      data_validade: t.data_validade,
      data_fabricacao: t.data_fabricacao,
      foto_url: t.foto_url,
      created_date: t.created_date
    }));
  }, [trocasVisita, clientesMap, produtosMap, vendedoresMap]);

  // Trocas Importadas
  const trocasImport = useMemo(() => {
    return trocasImportadas.map(t => ({
      id: t.id,
      data: t.data,
      cliente_id: t.cliente_id,
      cliente: clientesMap[t.cliente_id] || { razao_social: t.cliente_nome },
      produto_id: t.produto_original_id,
      produto: produtosMap[t.produto_original_id] || { nome: t.produto_original_nome },
      vendedor_id: t.vendedor_id,
      vendedor: vendedoresMap[t.vendedor_id] || { nome: t.vendedor_nome },
      quantidade: t.quantidade || 1,
      motivo: motivosMap[t.motivo_id]?.descricao || t.motivo_descricao || '',
      created_date: t.created_date || t.data
    }));
  }, [trocasImportadas, clientesMap, produtosMap, vendedoresMap, motivosMap]);

  // Dados atuais baseado na aba
  const dadosAtuais = mainTab === 'importadas' ? trocasImport : trocasEstoque;
  const isLoading = mainTab === 'importadas' ? loadingImportadas : loadingVisita;

  // Clientes com trocas
  const clientesComTrocas = useMemo(() => {
    const ids = new Set(dadosAtuais.map(t => t.cliente_id).filter(Boolean));
    return Array.from(ids).map(id => clientesMap[id]).filter(Boolean).sort((a, b) => (a.razao_social || '').localeCompare(b.razao_social || ''));
  }, [dadosAtuais, clientesMap]);

  // Trocas filtradas
  const trocasFiltradas = useMemo(() => {
    let dados = [...dadosAtuais];

    if (filtroCliente !== 'todos') {
      dados = dados.filter(t => t.cliente_id === filtroCliente);
    }

    if (dataInicio) {
      dados = dados.filter(t => t.data >= dataInicio);
    }
    if (dataFim) {
      dados = dados.filter(t => t.data <= dataFim);
    }

    if (busca) {
      const termo = busca.toLowerCase();
      dados = dados.filter(t =>
        t.cliente?.razao_social?.toLowerCase().includes(termo) ||
        t.cliente?.nome_fantasia?.toLowerCase().includes(termo) ||
        t.produto?.nome?.toLowerCase().includes(termo) ||
        t.motivo?.toLowerCase().includes(termo)
      );
    }

    if (mostrarApenasUltima) {
      const mapa = {};
      dados.forEach(t => {
        const key = t.cliente_id || 'sem_cliente';
        if (!mapa[key] || new Date(t.created_date) > new Date(mapa[key].created_date)) {
          mapa[key] = t;
        }
      });
      dados = Object.values(mapa);
    }

    return dados.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  }, [dadosAtuais, filtroCliente, dataInicio, dataFim, busca, mostrarApenasUltima]);

  const handleTabChange = (tab) => {
    setMainTab(tab);
    setFiltroCliente('todos');
    setDataInicio('');
    setDataFim('');
    setBusca('');
    setMostrarApenasUltima(false);
  };

  const exportarCSV = () => {
    const tipoRelatorio = mainTab === 'importadas' ? 'importadas' : 'estoque';
    const linhas = mainTab === 'importadas' 
      ? ['Data;Cliente;Produto;Quantidade;Motivo;Vendedor']
      : ['Data;Cliente;Produto;Quantidade;Motivo;Validade;Fabricação;Vendedor'];
    
    trocasFiltradas.forEach(t => {
      if (mainTab === 'importadas') {
        linhas.push([
          t.data ? new Date(t.data).toLocaleDateString('pt-BR') : '',
          t.cliente?.razao_social || t.cliente?.nome_fantasia || '',
          t.produto?.nome || '',
          t.quantidade || 0,
          t.motivo || '',
          t.vendedor?.nome || ''
        ].join(';'));
      } else {
        linhas.push([
          t.data ? new Date(t.data).toLocaleDateString('pt-BR') : '',
          t.cliente?.razao_social || t.cliente?.nome_fantasia || '',
          t.produto?.nome || '',
          t.quantidade || 0,
          t.motivo || '',
          t.data_validade ? new Date(t.data_validade).toLocaleDateString('pt-BR') : '',
          t.data_fabricacao ? new Date(t.data_fabricacao).toLocaleDateString('pt-BR') : '',
          t.vendedor?.nome || ''
        ].join(';'));
      }
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_trocas_${tipoRelatorio}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-xl">
            <ArrowLeftRight className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Relatório de Trocas</h1>
            <p className="text-slate-500 mt-1">
              {mainTab === 'importadas' ? 'Trocas importadas do sistema' : 'Trocas registradas em visitas de estoque'}
            </p>
          </div>
        </div>
        <Button onClick={exportarCSV} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Abas principais */}
      <Tabs value={mainTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-[500px] grid-cols-2">
          <TabsTrigger value="importadas" className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            Trocas Importadas
          </TabsTrigger>
          <TabsTrigger value="estoque" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Trocas de Estoque
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Card informativo */}
      <div className={`p-4 rounded-lg border ${mainTab === 'importadas' ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-200'}`}>
        <h3 className={`font-semibold mb-1 ${mainTab === 'importadas' ? 'text-purple-900' : 'text-blue-900'}`}>
          {mainTab === 'importadas' ? 'Trocas Importadas' : 'Trocas de Estoque (Visitas)'}
        </h3>
        <p className={`text-sm ${mainTab === 'importadas' ? 'text-purple-800' : 'text-blue-800'}`}>
          {mainTab === 'importadas' 
            ? 'Registros de trocas importados via planilha ou sistema externo.'
            : 'Registros de trocas coletados durante visitas de estoque pelos promotores.'}
        </p>
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Cliente</label>
              <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os clientes</SelectItem>
                  {clientesComTrocas.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.razao_social || c.nome_fantasia}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Início</label>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Data Fim</label>
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Produto, motivo..."
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border bg-orange-50 border-orange-200">
                <Checkbox checked={mostrarApenasUltima} onCheckedChange={setMostrarApenasUltima} />
                <span className="text-sm font-medium text-orange-700">Apenas última troca</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-red-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-700">{trocasFiltradas.length}</div>
            <div className="text-sm text-orange-600">Registros</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-red-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-700">
              {trocasFiltradas.reduce((sum, t) => sum + (t.quantidade || 0), 0)}
            </div>
            <div className="text-sm text-red-600">Quantidade Total</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-700">
              {new Set(trocasFiltradas.map(t => t.cliente_id)).size}
            </div>
            <div className="text-sm text-purple-600">Clientes</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>
            {mainTab === 'importadas' ? 'Trocas Importadas' : 'Trocas de Estoque'} ({trocasFiltradas.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-slate-500">Carregando...</div>
          ) : trocasFiltradas.length === 0 ? (
            <div className="text-center py-12">
              <ArrowLeftRight className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhuma troca encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Data</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Cliente</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Produto</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Motivo</th>
                    <th className="text-center p-4 text-sm font-semibold text-slate-700">Qtd</th>
                    {mainTab === 'estoque' && (
                      <>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Validade</th>
                        <th className="text-left p-4 text-sm font-semibold text-slate-700">Fabricação</th>
                      </>
                    )}
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trocasFiltradas.map((t, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-sm">
                            {t.data ? new Date(t.data).toLocaleDateString('pt-BR') : '-'}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-900">
                          {t.cliente?.razao_social || t.cliente?.nome_fantasia || 'N/A'}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {t.cliente?.cidade || 'N/A'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-900">{t.produto?.nome || 'N/A'}</div>
                        <div className="text-xs text-slate-500">Cód: {t.produto?.codigo || 'N/A'}</div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span className="text-sm">{t.motivo || '-'}</span>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <Badge className="bg-orange-100 text-orange-700 text-base px-3">
                          {t.quantidade || 0}
                        </Badge>
                      </td>
                      {mainTab === 'estoque' && (
                        <>
                          <td className="p-4">
                            <span className="text-sm">
                              {t.data_validade ? new Date(t.data_validade).toLocaleDateString('pt-BR') : '-'}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className="text-sm">
                              {t.data_fabricacao ? new Date(t.data_fabricacao).toLocaleDateString('pt-BR') : '-'}
                            </span>
                          </td>
                        </>
                      )}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400" />
                          <span className="text-sm">{t.vendedor?.nome || 'N/A'}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}