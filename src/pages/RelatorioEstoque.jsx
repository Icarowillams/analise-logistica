import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Package, Filter, Calendar, Download, Search, MapPin, User
} from 'lucide-react';

export default function RelatorioEstoque() {
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [filtroProduto, setFiltroProduto] = useState('todos');
  const [busca, setBusca] = useState('');
  const [mostrarApenasUltimo, setMostrarApenasUltimo] = useState(true);

  const { data: estoqueVisita = [], isLoading } = useQuery({
    queryKey: ['estoqueVisita'],
    queryFn: () => base44.entities.EstoqueVisita.list('-created_date', 5000)
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

  // Mapas
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Clientes com estoque registrado
  const clientesComEstoque = useMemo(() => {
    const ids = new Set(estoqueVisita.map(e => e.cliente_id).filter(Boolean));
    return Array.from(ids).map(id => clientesMap[id]).filter(Boolean).sort((a, b) => (a.razao_social || '').localeCompare(b.razao_social || ''));
  }, [estoqueVisita, clientesMap]);

  // Produtos com estoque registrado
  const produtosComEstoque = useMemo(() => {
    const ids = new Set(estoqueVisita.map(e => e.produto_id).filter(Boolean));
    return Array.from(ids).map(id => produtosMap[id]).filter(Boolean).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [estoqueVisita, produtosMap]);

  // Estoques filtrados e processados
  const estoquesFiltrados = useMemo(() => {
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

    // Se mostrar apenas último, agrupar por cliente+produto e pegar o mais recente
    if (mostrarApenasUltimo) {
      const mapa = {};
      dados.forEach(e => {
        const key = `${e.cliente_id}_${e.produto_id}`;
        if (!mapa[key] || new Date(e.created_date) > new Date(mapa[key].created_date)) {
          mapa[key] = e;
        }
      });
      dados = Object.values(mapa);
    }

    return dados.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  }, [estoqueVisita, clientesMap, produtosMap, vendedoresMap, filtroCliente, filtroProduto, busca, mostrarApenasUltimo]);

  const exportarCSV = () => {
    const linhas = ['Data;Cliente;Código Cliente;Produto;Código Produto;Quantidade;Validade;Vendedor'];
    estoquesFiltrados.forEach(e => {
      linhas.push([
        new Date(e.created_date).toLocaleDateString('pt-BR'),
        e.cliente?.razao_social || e.cliente?.nome_fantasia || '',
        e.cliente?.codigo || '',
        e.produto?.nome || '',
        e.produto?.codigo || '',
        e.quantidade || 0,
        e.data_validade ? new Date(e.data_validade).toLocaleDateString('pt-BR') : '',
        e.vendedor?.nome || ''
      ].join(';'));
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_estoque_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

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
            <p className="text-slate-500 mt-1">Último estoque informado por cliente/produto</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">Cliente</label>
              <Select value={filtroCliente} onValueChange={setFiltroCliente}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {clientesComEstoque.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.razao_social || c.nome_fantasia}</SelectItem>
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
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border bg-blue-50 border-blue-200">
                <Checkbox checked={mostrarApenasUltimo} onCheckedChange={setMostrarApenasUltimo} />
                <span className="text-sm font-medium text-blue-700">Apenas último estoque</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-cyan-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-700">{estoquesFiltrados.length}</div>
            <div className="text-sm text-blue-600">Registros</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-700">
              {estoquesFiltrados.reduce((sum, e) => sum + (e.quantidade || 0), 0)}
            </div>
            <div className="text-sm text-green-600">Quantidade Total</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-700">
              {new Set(estoquesFiltrados.map(e => e.cliente_id)).size}
            </div>
            <div className="text-sm text-purple-600">Clientes</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Registros de Estoque ({estoquesFiltrados.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-slate-500">Carregando...</div>
          ) : estoquesFiltrados.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhum registro de estoque encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Data</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Cliente</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Produto</th>
                    <th className="text-center p-4 text-sm font-semibold text-slate-700">Quantidade</th>
                    <th className="text-center p-4 text-sm font-semibold text-slate-700">Validade</th>
                    <th className="text-left p-4 text-sm font-semibold text-slate-700">Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {estoquesFiltrados.map((e, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-sm">{new Date(e.created_date).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-900">{e.cliente?.razao_social || e.cliente?.nome_fantasia || 'N/A'}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {e.cliente?.cidade || 'N/A'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-900">{e.produto?.nome || 'N/A'}</div>
                        <div className="text-xs text-slate-500">Cód: {e.produto?.codigo || 'N/A'}</div>
                      </td>
                      <td className="p-4 text-center">
                        <Badge className="bg-blue-100 text-blue-700 text-base px-3">
                          {e.quantidade || 0}
                        </Badge>
                      </td>
                      <td className="p-4 text-center">
                        {e.data_validade ? (
                          <span className="text-sm">{new Date(e.data_validade).toLocaleDateString('pt-BR')}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400" />
                          <span className="text-sm">{e.vendedor?.nome || 'N/A'}</span>
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