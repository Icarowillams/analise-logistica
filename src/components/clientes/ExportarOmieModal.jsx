import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import ClientesComErroOmie from './ClientesComErroOmie';

export default function ExportarOmieModal({ open, onOpenChange }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [resultados, setResultados] = useState(null);
  const [apenasAtivos, setApenasAtivos] = useState(true);
  const [progressoExportacao, setProgressoExportacao] = useState(0);

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

  const exportarEmLotes = async (cliente_ids) => {
    setExportando(true);
    setTotalProcessado(0);
    setTotalSucessos(0);
    setTotalErros(0);
    setTodosResultados([]);
    setProgressoExportacao(0);

    let loteAtual = 0;
    let todosRes = [];
    let sucessosTotal = 0;
    let errosTotal = 0;

    while (true) {
      try {
        const response = await base44.functions.invoke('exportarClientesOmie', { 
          cliente_ids, 
          lote_inicio: loteAtual 
        });
        const data = response.data;

        todosRes = [...todosRes, ...data.resultados];
        sucessosTotal += data.resumo.sucessos;
        errosTotal += data.resumo.erros;

        setTodosResultados(todosRes);
        setTotalSucessos(sucessosTotal);
        setTotalErros(errosTotal);
        setTotalProcessado(todosRes.length);
        setProgressoExportacao((todosRes.length / cliente_ids.length) * 100);

        if (data.concluido) {
          setResultados({
            resumo: { total: todosRes.length, sucessos: sucessosTotal, erros: errosTotal },
            resultados: todosRes
          });
          if (errosTotal === 0) {
            toast.success(`✅ ${sucessosTotal} cliente(s) exportado(s) para o Omie!`);
          } else {
            toast.warning(`⚠️ ${sucessosTotal} exportado(s), ${errosTotal} erro(s)`);
          }
          break;
        }

        loteAtual = data.proximo_lote;
      } catch (error) {
        toast.error('❌ Erro ao exportar: ' + error.message);
        break;
      }
    }

    setExportando(false);
  };

  const clientesFiltrados = clientes.filter(c => {
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

  const handleClose = () => {
    setSelectedIds([]);
    setSearchTerm('');
    setResultados(null);
    setApenasAtivos(true);
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
            Selecione os clientes que deseja enviar para o sistema Omie
          </DialogDescription>
        </DialogHeader>

        {!resultados ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="space-y-4 shrink-0">
              <Input
                placeholder="Buscar por nome, código ou CPF/CNPJ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <Checkbox
                  id="apenas-ativos"
                  checked={apenasAtivos}
                  onCheckedChange={setApenasAtivos}
                />
                <label htmlFor="apenas-ativos" className="text-sm font-medium text-amber-800 cursor-pointer">
                  Mostrar apenas clientes ativos
                </label>
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
                <Button variant="outline" onClick={handleClose}>
                  Cancelar
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
                      Exportar {selectedIds.length} cliente(s)
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
              )}
              <Button
                onClick={() => setResultados(null)}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-neutral-900"
              >
                Exportar Mais
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