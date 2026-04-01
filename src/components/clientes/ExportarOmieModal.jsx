import React, { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, Loader2, AlertTriangle, Search, Download } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ClientesComErroOmie from './ClientesComErroOmie';

export default function ExportarOmieModal({ open, onOpenChange }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [resultados, setResultados] = useState(null);
  const [apenasAtivos, setApenasAtivos] = useState(false);
  const [modoExportacao, setModoExportacao] = useState('upsert');
  const [progressoExportacao, setProgressoExportacao] = useState(0);
  const [verificando, setVerificando] = useState(false);
  const [comparacaoOmie, setComparacaoOmie] = useState(null);

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const [exportando, setExportando] = useState(false);
  const [totalProcessado, setTotalProcessado] = useState(0);
  const [totalSucessos, setTotalSucessos] = useState(0);
  const [totalErros, setTotalErros] = useState(0);
  const [todosResultados, setTodosResultados] = useState([]);
  const [modalErrosAberto, setModalErrosAberto] = useState(false);
  const [errosParaCorrigir, setErrosParaCorrigir] = useState([]);
  const canceladoRef = useRef(false);

  const exportarEmLotes = async (cliente_ids) => {
    canceladoRef.current = false;
    setExportando(true);
    setTotalProcessado(0);
    setTotalSucessos(0);
    setTotalErros(0);
    setTodosResultados([]);
    setProgressoExportacao(0);

    // Montar dados completos dos clientes a partir da lista já carregada no frontend
    const clientesSelecionados = baseClientes.filter(c => cliente_ids.includes(c.id));
    const LOTE_SIZE = 5; // 5 por chamada (backend envia sequencialmente com 1.5s cada = ~7.5s por lote)
    let todosRes = [];
    let sucessosTotal = 0;
    let errosTotal = 0;

    for (let i = 0; i < clientesSelecionados.length; i += LOTE_SIZE) {
      if (canceladoRef.current) {
        toast.info(`Exportação cancelada. ${todosRes.length} de ${clientesSelecionados.length} processados.`);
        setResultados({
          resumo: { total: todosRes.length, sucessos: sucessosTotal, erros: errosTotal },
          resultados: todosRes
        });
        break;
      }

      const lote = clientesSelecionados.slice(i, i + LOTE_SIZE);

      try {
        const response = await base44.functions.invoke('exportarClientesOmie', { 
          clientes_data: lote,
          modo: modoExportacao
        });
        const data = response.data;

        todosRes = [...todosRes, ...data.resultados];
        sucessosTotal += data.resumo.sucessos;
        errosTotal += data.resumo.erros;

        setTodosResultados(todosRes);
        setTotalSucessos(sucessosTotal);
        setTotalErros(errosTotal);
        setTotalProcessado(todosRes.length);
        setProgressoExportacao((todosRes.length / clientesSelecionados.length) * 100);
      } catch (error) {
        toast.error('❌ Erro no lote: ' + error.message);
        // Marcar clientes do lote como erro
        const errosLote = lote.map(c => ({
          cliente_id: c.id, razao_social: c.razao_social, nome_fantasia: c.nome_fantasia,
          sucesso: false, codigo_omie: null, mensagem: error.message
        }));
        todosRes = [...todosRes, ...errosLote];
        errosTotal += lote.length;
        setTodosResultados(todosRes);
        setTotalErros(errosTotal);
        setTotalProcessado(todosRes.length);
        setProgressoExportacao((todosRes.length / clientesSelecionados.length) * 100);
      }

      // Verificar se terminou
      if (i + LOTE_SIZE >= clientesSelecionados.length && !canceladoRef.current) {
        setResultados({
          resumo: { total: todosRes.length, sucessos: sucessosTotal, erros: errosTotal },
          resultados: todosRes
        });
        if (errosTotal === 0) {
          toast.success(`✅ ${sucessosTotal} cliente(s) exportado(s) para o Omie!`);
        } else {
          toast.warning(`⚠️ ${sucessosTotal} exportado(s), ${errosTotal} erro(s)`);
        }
      }
    }

    setExportando(false);
  };

  const handleCancelar = () => {
    if (exportando) {
      canceladoRef.current = true;
      toast.info('Cancelando... aguarde o lote atual terminar.');
    } else {
      handleClose();
    }
  };

  const baseClientes = comparacaoOmie?.clientes_faltando || clientes;

  const clientesFiltrados = baseClientes.filter(c => {
    const termo = searchTerm.toLowerCase();
    const matchSearch = (
      c.razao_social?.toLowerCase().includes(termo) ||
      c.nome_fantasia?.toLowerCase().includes(termo) ||
      c.codigo?.toLowerCase().includes(termo) ||
      c.cpf_cnpj?.includes(termo)
    );
    const matchStatus = apenasAtivos ? c.status === 'ativo' : true;
    return matchSearch && matchStatus;
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === clientesFiltrados.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(clientesFiltrados.map(c => c.id));
    }
  };

  const handleExportar = () => {
    if (selectedIds.length === 0) {
      toast.error('Selecione pelo menos um cliente para exportar');
      return;
    }
    setResultados(null);
    exportarEmLotes(selectedIds);
  };

  const handleVerificarFaltantes = async () => {
    setVerificando(true);
    setComparacaoOmie(null);
    setSelectedIds([]);

    try {
      let paginaBase44 = 1;
      let clientesBase44 = [];

      while (true) {
        const resBase44 = await base44.functions.invoke('sincronizarClientesOmie', {
          modo: 'listar_base44',
          pagina_base44: paginaBase44
        });

        const lote = resBase44.data?.clientes || [];
        clientesBase44 = [...clientesBase44, ...lote];

        if (resBase44.data?.concluido) break;
        paginaBase44 += 1;
      }

      let paginaOmie = 1;
      let clientesOmie = [];

      while (true) {
        const resOmie = await base44.functions.invoke('sincronizarClientesOmie', {
          modo: 'listar_omie',
          pagina_omie: paginaOmie
        });

        const lote = resOmie.data?.clientes || [];
        clientesOmie = [...clientesOmie, ...lote];

        if (resOmie.data?.concluido) break;
        paginaOmie += 1;
      }

      const resComparacao = await base44.functions.invoke('sincronizarClientesOmie', {
        modo: 'comparar',
        clientes_base44: clientesBase44,
        clientes_omie: clientesOmie
      });

      setComparacaoOmie(resComparacao.data);
      toast.success(`Verificação concluída: ${resComparacao.data.faltando_no_omie} cliente(s) faltando no Omie.`);
    } catch (error) {
      toast.error('Erro ao verificar faltantes: ' + error.message);
    }

    setVerificando(false);
  };

  const baixarCsvErros = () => {
    if (!resultados?.resultados?.length) return;

    const erros = resultados.resultados.filter(item => !item.sucesso);
    if (erros.length === 0) {
      toast.success('Não há erros para exportar em CSV.');
      return;
    }

    const headers = ['codigo', 'razao_social', 'cpf_cnpj', 'motivo'];
    const rows = erros.map(item => {
      const cliente = baseClientes.find(c => c.id === item.cliente_id) || {};
      return [
        cliente.codigo || '',
        item.razao_social || '',
        cliente.cpf_cnpj || '',
        item.mensagem || ''
      ];
    });

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clientes-com-erro-omie-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleClose = () => {
    setSelectedIds([]);
    setSearchTerm('');
    setResultados(null);
    setApenasAtivos(false);
    setModoExportacao('upsert');
    setComparacaoOmie(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) handleClose();
    }}>
    <DialogContent className="max-w-2xl h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img 
              src="https://www.omie.com.br/wp-content/themes/flavor-flavor-flavor/lib/assets/img/logo-omie.svg" 
              alt="Omie" 
              className="h-6"
            />
            Exportar Clientes para Omie
          </DialogTitle>
          <DialogDescription>
            Verifique quais clientes ainda não existem no Omie e envie apenas os faltantes.
          </DialogDescription>
        </DialogHeader>

        {!resultados ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="space-y-4 shrink-0">
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={handleVerificarFaltantes}
                  disabled={verificando}
                  className="w-full sm:w-auto"
                >
                  {verificando ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verificando Base44 x Omie...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-2" />
                      Verificar faltantes no Omie
                    </>
                  )}
                </Button>

                {comparacaoOmie && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Badge variant="outline">Base44: {comparacaoOmie.total_base44}</Badge>
                    <Badge variant="outline">Omie: {comparacaoOmie.total_omie}</Badge>
                    <Badge className="bg-red-100 text-red-700">Faltando: {comparacaoOmie.faltando_no_omie}</Badge>
                  </div>
                )}
              </div>

              <Input
                placeholder="Buscar por nome, código ou CPF/CNPJ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200 flex-1">
                  <Checkbox
                    id="apenas-ativos"
                    checked={apenasAtivos}
                    onCheckedChange={setApenasAtivos}
                  />
                  <label htmlFor="apenas-ativos" className="text-sm font-medium text-amber-800 cursor-pointer">
                    Apenas ativos
                  </label>
                </div>
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200 flex-1">
                  <label className="text-sm font-medium text-blue-800 whitespace-nowrap">Modo:</label>
                  <Select value={modoExportacao} onValueChange={setModoExportacao}>
                    <SelectTrigger className="h-7 text-xs border-blue-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upsert">UpsertCliente (criar/atualizar)</SelectItem>
                      <SelectItem value="incluir">IncluirCliente (apenas criar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Checkbox
                    checked={selectedIds.length === clientesFiltrados.length && clientesFiltrados.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm text-slate-600 truncate">
                    Selecionar todos ({clientesFiltrados.length})
                  </span>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {selectedIds.length} selecionado(s)
                </Badge>
              </div>
            </div>

            <div className="flex-1 min-h-0 py-4 overflow-hidden">
              <ScrollArea className="h-full border rounded-lg">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full min-h-[220px]">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : clientesFiltrados.length === 0 ? (
                  <div className="flex items-center justify-center h-full min-h-[220px] text-slate-500">
                    Nenhum cliente encontrado
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {clientesFiltrados.map(cliente => (
                      <div
                        key={cliente.id}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedIds.includes(cliente.id)
                            ? 'bg-amber-50 border border-amber-200'
                            : 'hover:bg-slate-50 border border-transparent'
                        }`}
                        onClick={() => toggleSelect(cliente.id)}
                      >
                        <Checkbox
                          checked={selectedIds.includes(cliente.id)}
                          onCheckedChange={() => toggleSelect(cliente.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 truncate">
                            {cliente.razao_social || cliente.nome_fantasia}
                          </p>
                          <p className="text-sm text-slate-500 truncate">
                            {cliente.codigo && `Cód: ${cliente.codigo} | `}
                            {cliente.cpf_cnpj || 'Sem CPF/CNPJ'}
                          </p>
                        </div>
                        <Badge variant={cliente.status === 'ativo' ? 'default' : 'secondary'} className="shrink-0">
                          {cliente.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-end gap-3 pt-4 border-t bg-white shrink-0">
              {exportando && (
                <div className="flex flex-col gap-2 w-full sm:min-w-[300px] sm:max-w-[360px]">
                  <div className="flex items-center gap-3">
                    <Progress value={progressoExportacao} className="h-3 flex-1" />
                    <span className="text-sm font-medium text-slate-700 whitespace-nowrap">{Math.round(progressoExportacao)}%</span>
                  </div>
                  <div className="text-xs text-slate-500 text-center sm:text-left">
                    {totalProcessado} de {selectedIds.length} | ✅ {totalSucessos} | ❌ {totalErros}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <Button
                  variant={exportando ? "destructive" : "outline"}
                  onClick={handleCancelar}
                >
                  {exportando ? '⛔ Parar Exportação' : 'Cancelar'}
                </Button>
                <Button
                  onClick={handleExportar}
                  disabled={selectedIds.length === 0 || exportando}
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                >
                  {exportando ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Exportando {totalProcessado}/{selectedIds.length}...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Enviar {selectedIds.length} cliente(s)
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 flex-1 min-h-0 overflow-hidden">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-slate-800">{resultados.resumo.total}</p>
                <p className="text-sm text-slate-500">Total</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{resultados.resumo.sucessos}</p>
                <p className="text-sm text-green-600">Sucessos</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{resultados.resumo.erros}</p>
                <p className="text-sm text-red-600">Erros</p>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0 border rounded-lg">
              <div className="p-2 space-y-2">
                {resultados.resultados.map((r, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      r.sucesso ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    {r.sucesso ? (
                      <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">
                        {r.razao_social}
                      </p>
                      <p className={`text-sm ${r.sucesso ? 'text-green-600' : 'text-red-600'}`}>
                        {r.mensagem}
                      </p>
                      {r.codigo_omie && (
                        <p className="text-xs text-slate-500 mt-1">
                          Código Omie: {r.codigo_omie}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-3 pt-4 border-t bg-white shrink-0">
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
              {resultados.resumo.erros > 0 && (
                <>
                  <Button variant="outline" onClick={baixarCsvErros}>
                    <Download className="w-4 h-4 mr-2" />
                    Baixar CSV dos erros
                  </Button>
                  <Button
                    onClick={() => {
                      const erros = resultados.resultados.filter(r => !r.sucesso);
                      setErrosParaCorrigir(erros);
                      setModalErrosAberto(true);
                    }}
                    className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Corrigir {resultados.resumo.erros} Erros
                  </Button>
                </>
              )}
              <Button
                onClick={() => setResultados(null)}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-neutral-900"
              >
                Nova verificação
              </Button>
            </div>
          </div>
        )}

        <ClientesComErroOmie
          open={modalErrosAberto}
          onOpenChange={setModalErrosAberto}
          erros={errosParaCorrigir}
        />
      </DialogContent>
    </Dialog>
  );
}