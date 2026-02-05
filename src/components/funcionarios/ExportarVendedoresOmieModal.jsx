import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export default function ExportarVendedoresOmieModal({ open, onOpenChange }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [resultados, setResultados] = useState(null);
  const [apenasAtivos, setApenasAtivos] = useState(true);
  const [progressoExportacao, setProgressoExportacao] = useState(0);

  const { data: funcionarios = [], isLoading } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const [exportando, setExportando] = useState(false);
  const [totalProcessado, setTotalProcessado] = useState(0);
  const [totalSucessos, setTotalSucessos] = useState(0);
  const [totalErros, setTotalErros] = useState(0);
  const [todosResultados, setTodosResultados] = useState([]);

  // Filtrar apenas funcionários com função "Vendedor" (case insensitive)
  const vendedores = funcionarios.filter(f => 
    f.funcao?.toLowerCase().includes('vendedor')
  );

  const exportarEmLotes = async (vendedor_ids) => {
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
        const response = await base44.functions.invoke('exportarVendedoresOmie', { 
          vendedor_ids, 
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
        setProgressoExportacao((todosRes.length / vendedor_ids.length) * 100);

        if (data.concluido) {
          setResultados({
            resumo: { total: todosRes.length, sucessos: sucessosTotal, erros: errosTotal },
            resultados: todosRes
          });
          if (errosTotal === 0) {
            toast.success(`✅ ${sucessosTotal} vendedor(es) exportado(s) para o Omie!`);
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

  const vendedoresFiltrados = vendedores.filter(v => {
    const termo = searchTerm.toLowerCase();
    const matchSearch = (
      v.nome?.toLowerCase().includes(termo) ||
      v.email?.toLowerCase().includes(termo) ||
      v.cpf?.includes(termo)
    );
    const matchStatus = apenasAtivos ? v.status === 'ativo' : true;
    return matchSearch && matchStatus;
  });

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === vendedoresFiltrados.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(vendedoresFiltrados.map(v => v.id));
    }
  };

  const handleExportar = () => {
    if (selectedIds.length === 0) {
      toast.error('Selecione pelo menos um vendedor para exportar');
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img 
              src="https://www.omie.com.br/wp-content/themes/flavor-flavor-flavor/lib/assets/img/logo-omie.svg" 
              alt="Omie" 
              className="h-6"
            />
            Exportar Vendedores para Omie
          </DialogTitle>
          <DialogDescription>
            Selecione os vendedores que deseja enviar para o sistema Omie.
            <span className="block mt-1 text-amber-600 font-medium">
              Apenas funcionários com função "Vendedor" são exibidos.
            </span>
          </DialogDescription>
        </DialogHeader>

        {!resultados ? (
          <>
            <div className="space-y-4">
              <Input
                placeholder="Buscar por nome, email ou CPF..."
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
                  Mostrar apenas vendedores ativos
                </label>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedIds.length === vendedoresFiltrados.length && vendedoresFiltrados.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm text-slate-600">
                    Selecionar todos ({vendedoresFiltrados.length})
                  </span>
                </div>
                <Badge variant="outline">
                  {selectedIds.length} selecionado(s)
                </Badge>
              </div>

              <ScrollArea className="h-[300px] border rounded-lg">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : vendedoresFiltrados.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4">
                    <p>Nenhum vendedor encontrado</p>
                    <p className="text-xs mt-1">Certifique-se de que o funcionário possui a função "Vendedor"</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {vendedoresFiltrados.map(vendedor => (
                      <div
                        key={vendedor.id}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedIds.includes(vendedor.id)
                            ? 'bg-amber-50 border border-amber-200'
                            : 'hover:bg-slate-50 border border-transparent'
                        }`}
                        onClick={() => toggleSelect(vendedor.id)}
                      >
                        <Checkbox
                          checked={selectedIds.includes(vendedor.id)}
                          onCheckedChange={() => toggleSelect(vendedor.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 truncate">
                            {vendedor.nome}
                          </p>
                          <p className="text-sm text-slate-500 truncate">
                            {vendedor.email || 'Sem email'} | {vendedor.funcao}
                          </p>
                        </div>
                        <Badge variant={vendedor.status === 'ativo' ? 'default' : 'secondary'} className="shrink-0">
                          {vendedor.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <div className="flex flex-col gap-2">
                {exportando && (
                  <div className="flex flex-col gap-2 w-full min-w-[300px]">
                    <div className="flex items-center gap-3">
                      <Progress value={progressoExportacao} className="h-3 flex-1" />
                      <span className="text-sm font-medium text-slate-700 whitespace-nowrap">{Math.round(progressoExportacao)}%</span>
                    </div>
                    <div className="text-xs text-slate-500 text-center">
                      {totalProcessado} de {selectedIds.length} | ✅ {totalSucessos} | ❌ {totalErros}
                    </div>
                  </div>
                )}
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
                      Exportar {selectedIds.length} vendedor(es)
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
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

            <ScrollArea className="h-[250px] border rounded-lg">
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
                        {r.nome}
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

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
              <Button
                onClick={() => setResultados(null)}
                className="bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-neutral-900"
              >
                Exportar Mais
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}