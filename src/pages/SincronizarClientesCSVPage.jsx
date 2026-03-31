import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, ArrowLeftRight, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, RefreshCw, Database, Cloud, Download, Upload, Copy } from 'lucide-react';
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

  // Espelhar
  const [espelhando, setEspelhando] = useState(false);
  const [espelharProgresso, setEspelharProgresso] = useState({ atual: 0, total: 0, ok: 0, erros: 0 });
  const [espelharErros, setEspelharErros] = useState([]);
  const cancelRef = useRef(false);

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

  const exportarCSV = () => {
    if (!comparacao) return;
    const linhas = [['Tipo', 'ID', 'Código', 'Razão Social', 'Nome Fantasia', 'CNPJ/CPF', 'Campo', 'Valor Base44', 'Valor Omie'].join(';')];
    
    for (const item of (comparacao.lista_diferentes || [])) {
      for (const diff of item.diffs) {
        linhas.push([
          'DIFERENTE', item.id, item.codigo || '', item.razao_social || '', item.nome_fantasia || '', '',
          diff.campo, diff.base44 || '', diff.omie || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
      }
    }
    for (const item of (comparacao.lista_so_base44 || [])) {
      linhas.push([
        'SÓ NO BASE44', item.id, item.codigo || '', item.razao_social || '', item.nome_fantasia || '', item.cpf_cnpj || '',
        '', '', ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }
    for (const item of (comparacao.lista_so_omie || [])) {
      linhas.push([
        'SÓ NO OMIE', item.codigo_integracao || '', item.codigo_omie || '', item.razao_social || '', item.nome_fantasia || '', item.cnpj_cpf || '',
        '', '', ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }

    const csvContent = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `comparacao_omie_base44_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const espelharParaOmie = async () => {
    if (!comparacao) return;
    const idsParaEnviar = [
      ...(comparacao.lista_diferentes || []).map(d => d.id),
      ...(comparacao.lista_so_base44 || []).map(d => d.id),
    ];
    if (idsParaEnviar.length === 0) {
      setError('Nenhum cliente para enviar. Rode a comparação primeiro.');
      return;
    }
    const confirmar = window.confirm(
      `Isso vai enviar ${idsParaEnviar.length} clientes do Base44 para o Omie (UpsertCliente), sobrescrevendo os dados no Omie.\n\nDeseja continuar?`
    );
    if (!confirmar) return;

    setEspelhando(true);
    cancelRef.current = false;
    setEspelharErros([]);
    const LOTE = 20;
    const total = idsParaEnviar.length;
    let totalOk = 0, totalErros = 0;
    setEspelharProgresso({ atual: 0, total, ok: 0, erros: 0 });

    for (let i = 0; i < total && !cancelRef.current; i += LOTE) {
      const loteIds = idsParaEnviar.slice(i, i + LOTE);
      try {
        const res = await base44.functions.invoke('espelharBase44ParaOmie', { ids: loteIds });
        const d = res.data;
        totalOk += d.enviados || 0;
        totalErros += d.erros || 0;
        if (d.erros_detalhes?.length) {
          setEspelharErros(prev => [...prev, ...d.erros_detalhes]);
        }
      } catch (e) {
        totalErros += loteIds.length;
        setEspelharErros(prev => [...prev, `Lote ${i}: ${e.message}`]);
      }
      setEspelharProgresso({ atual: Math.min(i + LOTE, total), total, ok: totalOk, erros: totalErros });
      if (i + LOTE < total && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    setEspelhando(false);
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
        <Button onClick={() => consultarOmie(1)} disabled={loading || espelhando} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Cloud className="w-4 h-4 mr-2" />
          Consultar Omie
        </Button>
        <Button onClick={compararTudo} disabled={loading || espelhando} className="bg-purple-600 hover:bg-purple-700 text-white">
          <ArrowLeftRight className="w-4 h-4 mr-2" />
          Comparar Omie × Base44
        </Button>
        {comparacao && (comparacao.diferentes > 0 || comparacao.so_no_base44 > 0 || comparacao.so_no_omie > 0) && (
          <Button onClick={exportarCSV} variant="outline" className="border-green-300 text-green-700 hover:bg-green-50">
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
        )}
        {comparacao && (comparacao.diferentes > 0 || comparacao.so_no_base44 > 0) && !espelhando && (
          <Button onClick={espelharParaOmie} disabled={loading} className="bg-red-600 hover:bg-red-700 text-white">
            <Copy className="w-4 h-4 mr-2" />
            Espelhar Base44 → Omie ({(comparacao.diferentes || 0) + (comparacao.so_no_base44 || 0)})
          </Button>
        )}
        {espelhando && (
          <Button variant="outline" onClick={() => { cancelRef.current = true; }}>
            Cancelar
          </Button>
        )}
      </div>

      {/* Progresso Espelhar */}
      {(espelhando || espelharProgresso.total > 0) && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Copy className="w-4 h-4" />
              Espelhando Base44 → Omie
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{espelharProgresso.atual}/{espelharProgresso.total}</span>
              <span className="flex gap-3">
                <span className="text-green-600">{espelharProgresso.ok} ok</span>
                <span className="text-red-600">{espelharProgresso.erros} erros</span>
              </span>
            </div>
            <Progress value={espelharProgresso.total > 0 ? (espelharProgresso.atual / espelharProgresso.total) * 100 : 0} />
            {!espelhando && espelharProgresso.atual >= espelharProgresso.total && espelharProgresso.total > 0 && (
              <p className="text-sm text-green-700 font-medium flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Concluído!
              </p>
            )}
            {espelharErros.length > 0 && (
              <div className="max-h-40 overflow-y-auto bg-red-50 border border-red-200 rounded p-2 mt-2 space-y-1">
                {espelharErros.map((e, i) => (
                  <p key={i} className="text-xs text-red-700">{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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