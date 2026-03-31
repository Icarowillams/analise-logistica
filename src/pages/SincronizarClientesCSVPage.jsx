import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, ArrowLeftRight, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, RefreshCw, Database, Cloud } from 'lucide-react';
import ComparacaoLadoALado from '@/components/sincronizarCSV/ComparacaoLadoALado';
import ListaClientesFaltantes from '@/components/sincronizarCSV/ListaClientesFaltantes';

export default function SincronizarClientesCSVPage() {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');

  // Consulta paginada Omie
  const [clientesOmie, setClientesOmie] = useState([]);
  const [paginaOmie, setPaginaOmie] = useState(1);
  const [totalPaginasOmie, setTotalPaginasOmie] = useState(1);
  const [totalRegistrosOmie, setTotalRegistrosOmie] = useState(0);
  const [buscaOmie, setBuscaOmie] = useState('');

  // Comparação
  const [comparacao, setComparacao] = useState(null);
  const [buscaComparacao, setBuscaComparacao] = useState('');
  const [activeTab, setActiveTab] = useState('consulta');

  const consultarOmie = async (pag = 1) => {
    setLoading(true);
    setError('');
    setLoadingMsg('Consultando clientes no Omie...');
    try {
      const res = await base44.functions.invoke('consultarClientesOmie', { acao: 'listar_omie', pagina_omie: pag });
      const d = res.data;
      if (d.error) { setError(d.error); return; }
      setClientesOmie(d.clientes || []);
      setPaginaOmie(d.pagina);
      setTotalPaginasOmie(d.total_paginas);
      setTotalRegistrosOmie(d.total_registros);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const compararTudo = async () => {
    setLoading(true);
    setError('');
    setLoadingMsg('Buscando todos os clientes do Omie e comparando com Base44... Pode levar alguns segundos.');
    try {
      const res = await base44.functions.invoke('consultarClientesOmie', { acao: 'comparar' });
      const d = res.data;
      if (d.error) { setError(d.error); return; }
      setComparacao(d);
      setActiveTab('comparacao');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const clientesOmieFiltrados = clientesOmie.filter(c => {
    if (!buscaOmie) return true;
    const q = buscaOmie.toLowerCase();
    return (c.razao_social || '').toLowerCase().includes(q)
      || (c.nome_fantasia || '').toLowerCase().includes(q)
      || (c.cnpj_cpf || '').includes(q)
      || (c.codigo_omie || '').toString().includes(q)
      || (c.codigo_integracao || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sincronizar Clientes — Omie x Base44</h1>
          <p className="text-sm text-slate-500 mt-1">Consulte clientes direto do Omie e compare com o sistema</p>
        </div>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-3 flex items-center gap-2 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-4 flex items-center gap-3 text-blue-700">
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            <span className="text-sm">{loadingMsg}</span>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => consultarOmie(1)} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Cloud className="w-4 h-4 mr-2" />
          Consultar Omie
        </Button>
        <Button onClick={compararTudo} disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-white">
          <ArrowLeftRight className="w-4 h-4 mr-2" />
          Comparar Omie × Base44
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="consulta" className="flex items-center gap-2">
            <Cloud className="w-4 h-4" /> Clientes Omie
          </TabsTrigger>
          <TabsTrigger value="comparacao" className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" /> Comparação
            {comparacao && <Badge className="ml-1 bg-purple-500 text-white text-xs">{comparacao.diferentes}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consulta" className="space-y-4 mt-4">
          {totalRegistrosOmie > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-base px-3 py-1">
                  <Database className="w-4 h-4 mr-2" />
                  {totalRegistrosOmie.toLocaleString()} clientes no Omie
                </Badge>
                <span className="text-sm text-slate-500">Página {paginaOmie}/{totalPaginasOmie}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => consultarOmie(paginaOmie - 1)} disabled={loading || paginaOmie <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => consultarOmie(paginaOmie + 1)} disabled={loading || paginaOmie >= totalPaginasOmie}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {clientesOmie.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={buscaOmie}
                onChange={e => setBuscaOmie(e.target.value)}
                placeholder="Filtrar por nome, CNPJ, código..."
                className="pl-10"
              />
            </div>
          )}

          {clientesOmie.length === 0 && !loading && (
            <Card>
              <CardContent className="py-12 text-center text-slate-500">
                <Cloud className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>Clique em <strong>"Consultar Omie"</strong> para buscar os clientes direto da API do Omie</p>
              </CardContent>
            </Card>
          )}

          {clientesOmieFiltrados.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Cód. Omie</th>
                    <th className="px-3 py-2 text-left font-medium">Razão Social</th>
                    <th className="px-3 py-2 text-left font-medium">Nome Fantasia</th>
                    <th className="px-3 py-2 text-left font-medium">CNPJ/CPF</th>
                    <th className="px-3 py-2 text-left font-medium">Cidade</th>
                    <th className="px-3 py-2 text-left font-medium">UF</th>
                    <th className="px-3 py-2 text-left font-medium">Tags</th>
                    <th className="px-3 py-2 text-left font-medium">Inativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clientesOmieFiltrados.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">{c.codigo_omie}</td>
                      <td className="px-3 py-2 font-medium">{c.razao_social}</td>
                      <td className="px-3 py-2 text-slate-600">{c.nome_fantasia}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.cnpj_cpf}</td>
                      <td className="px-3 py-2">{c.cidade}</td>
                      <td className="px-3 py-2">{c.estado}</td>
                      <td className="px-3 py-2">
                        {c.tags && <Badge variant="outline" className="text-xs">{c.tags}</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        {c.inativo === 'S' ? (
                          <Badge className="bg-red-100 text-red-700 text-xs">Inativo</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 text-xs">Ativo</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="comparacao" className="space-y-4 mt-4">
          {!comparacao && !loading && (
            <Card>
              <CardContent className="py-12 text-center text-slate-500">
                <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>Clique em <strong>"Comparar Omie × Base44"</strong> para ver as diferenças lado a lado</p>
              </CardContent>
            </Card>
          )}

          {comparacao && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card className="border-blue-200">
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">{comparacao.total_omie?.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Total Omie</p>
                  </CardContent>
                </Card>
                <Card className="border-green-200">
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-bold text-green-600">{comparacao.total_base44?.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Total Base44</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200">
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-bold text-amber-600">{comparacao.diferentes}</p>
                    <p className="text-xs text-slate-500">Diferentes</p>
                  </CardContent>
                </Card>
                <Card className="border-purple-200">
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-bold text-purple-600">{comparacao.so_no_base44}</p>
                    <p className="text-xs text-slate-500">Só no Base44</p>
                  </CardContent>
                </Card>
                <Card className="border-orange-200">
                  <CardContent className="py-3 text-center">
                    <p className="text-2xl font-bold text-orange-600">{comparacao.so_no_omie}</p>
                    <p className="text-xs text-slate-500">Só no Omie</p>
                  </CardContent>
                </Card>
              </div>

              {/* Filtro */}
              {comparacao.diferentes > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={buscaComparacao}
                    onChange={e => setBuscaComparacao(e.target.value)}
                    placeholder="Filtrar diferenças por nome ou código..."
                    className="pl-10"
                  />
                </div>
              )}

              {/* Diferentes — lado a lado */}
              {comparacao.lista_diferentes?.length > 0 && (
                <ComparacaoLadoALado 
                  items={comparacao.lista_diferentes} 
                  busca={buscaComparacao}
                />
              )}

              {/* Só no Base44 */}
              {comparacao.lista_so_base44?.length > 0 && (
                <ListaClientesFaltantes
                  titulo="Clientes só no Base44 (não encontrados no Omie)"
                  items={comparacao.lista_so_base44}
                  cor="purple"
                  icon={<Database className="w-4 h-4" />}
                />
              )}

              {/* Só no Omie */}
              {comparacao.lista_so_omie?.length > 0 && (
                <ListaClientesFaltantes
                  titulo="Clientes só no Omie (não encontrados no Base44)"
                  items={comparacao.lista_so_omie}
                  cor="orange"
                  icon={<Cloud className="w-4 h-4" />}
                />
              )}

              {comparacao.diferentes === 0 && comparacao.so_no_base44 === 0 && comparacao.so_no_omie === 0 && (
                <Card className="border-green-300 bg-green-50">
                  <CardContent className="py-8 text-center">
                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
                    <p className="text-green-700 font-semibold text-lg">Tudo sincronizado!</p>
                    <p className="text-green-600 text-sm">Nenhuma diferença encontrada entre Omie e Base44.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}