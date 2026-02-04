import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Upload, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

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

  const exportMutation = useMutation({
    mutationFn: async (cliente_ids) => {
      const response = await base44.functions.invoke('exportarClientesOmie', { cliente_ids });
      return response.data;
    },
    onSuccess: (data) => {
      setResultados(data);
      if (data.resumo.erros === 0) {
        toast.success(`✅ ${data.resumo.sucessos} cliente(s) exportado(s) para o Omie!`);
      } else {
        toast.warning(`⚠️ ${data.resumo.sucessos} exportado(s), ${data.resumo.erros} erro(s)`);
      }
    },
    onError: (error) => {
      toast.error('❌ Erro ao exportar: ' + error.message);
    }
  });

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
    exportMutation.mutate(selectedIds);
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
            Exportar Clientes para Omie
          </DialogTitle>
          <DialogDescription>
            Selecione os clientes que deseja enviar para o sistema Omie
          </DialogDescription>
        </DialogHeader>

        {!resultados ? (
          <>
            <div className="space-y-4">
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

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedIds.length === clientesFiltrados.length && clientesFiltrados.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-sm text-slate-600">
                    Selecionar todos ({clientesFiltrados.length})
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
                ) : clientesFiltrados.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-500">
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

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleExportar}
                disabled={selectedIds.length === 0 || exportMutation.isPending}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
              >
                {exportMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Exportando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Exportar {selectedIds.length} cliente(s)
                  </>
                )}
              </Button>
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