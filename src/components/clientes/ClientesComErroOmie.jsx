import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { AlertTriangle, Save, Upload, RefreshCw, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ESTADOS_BRASIL = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' }
];

export default function ClientesComErroOmie({ open, onOpenChange, erros = [] }) {
  const queryClient = useQueryClient();
  const [clientesEditados, setClientesEditados] = useState({});
  const [exportando, setExportando] = useState(false);
  const [resultadosReexport, setResultadosReexport] = useState(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  // Encontrar clientes com erro
  const clientesComErro = erros.map(erro => {
    const cliente = clientes.find(c => c.id === erro.cliente_id);
    return {
      ...cliente,
      erro_mensagem: erro.mensagem
    };
  }).filter(c => c.id);

  useEffect(() => {
    // Inicializar edições com dados atuais
    const inicial = {};
    clientesComErro.forEach(c => {
      inicial[c.id] = {
        estado: c.estado || '',
        cidade: c.cidade || '',
        cpf_cnpj: c.cpf_cnpj || '',
        endereco: c.endereco || '',
        bairro: c.bairro || '',
        cep: c.cep || ''
      };
    });
    setClientesEditados(inicial);
  }, [clientesComErro.length]);

  const updateClienteMutation = useMutation({
    mutationFn: async ({ id, dados }) => {
      await base44.entities.Cliente.update(id, dados);
    }
  });

  const handleFieldChange = (clienteId, field, value) => {
    setClientesEditados(prev => ({
      ...prev,
      [clienteId]: {
        ...prev[clienteId],
        [field]: value
      }
    }));
  };

  const handleSalvarTodos = async () => {
    let salvos = 0;
    for (const clienteId of Object.keys(clientesEditados)) {
      try {
        await base44.entities.Cliente.update(clienteId, clientesEditados[clienteId]);
        salvos++;
      } catch (err) {
        console.error(`Erro ao salvar cliente ${clienteId}:`, err);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['clientes'] });
    toast.success(`${salvos} clientes atualizados!`);
  };

  const handleReexportar = async () => {
    setExportando(true);
    setResultadosReexport(null);

    try {
      // Primeiro salvar todas as alterações
      await handleSalvarTodos();

      // Depois exportar
      const idsParaExportar = clientesComErro.map(c => c.id);
      const response = await base44.functions.invoke('exportarClientesOmie', {
        cliente_ids: idsParaExportar
      });

      setResultadosReexport(response.data);
      
      if (response.data.resumo.erros === 0) {
        toast.success(`✅ Todos os ${response.data.resumo.sucessos} clientes exportados com sucesso!`);
      } else {
        toast.warning(`⚠️ ${response.data.resumo.sucessos} exportados, ${response.data.resumo.erros} ainda com erro`);
      }
    } catch (error) {
      toast.error('Erro ao reexportar: ' + error.message);
    }

    setExportando(false);
  };

  const identificarTipoErro = (mensagem) => {
    if (mensagem.includes('estado')) return 'estado';
    if (mensagem.includes('cidade')) return 'cidade';
    if (mensagem.includes('cnpj_cpf')) return 'cpf_cnpj';
    if (mensagem.includes('endereco') || mensagem.includes('Endereço')) return 'endereco';
    return 'outro';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            {resultadosReexport ? 'Resultado da Reexportação' : `${clientesComErro.length} Clientes com Erro no Omie`}
          </DialogTitle>
          <DialogDescription>
            {resultadosReexport 
              ? 'Veja o resultado da tentativa de reexportação'
              : 'Corrija os dados abaixo e clique em "Salvar e Reexportar"'
            }
          </DialogDescription>
        </DialogHeader>

        {!resultadosReexport ? (
          <>
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-4">
                {clientesComErro.map((cliente) => {
                  const tipoErro = identificarTipoErro(cliente.erro_mensagem);
                  const dadosEditados = clientesEditados[cliente.id] || {};

                  return (
                    <div key={cliente.id} className="border rounded-lg p-4 bg-red-50/50">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-slate-800">{cliente.razao_social}</h4>
                          <p className="text-xs text-red-600 mt-1">{cliente.erro_mensagem}</p>
                        </div>
                        <Badge variant="destructive" className="shrink-0">
                          {tipoErro === 'estado' && 'Estado Inválido'}
                          {tipoErro === 'cidade' && 'Cidade Inválida'}
                          {tipoErro === 'cpf_cnpj' && 'CPF/CNPJ Faltando'}
                          {tipoErro === 'endereco' && 'Endereço Incompleto'}
                          {tipoErro === 'outro' && 'Erro'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {(tipoErro === 'estado' || tipoErro === 'cidade') && (
                          <>
                            <div>
                              <Label className="text-xs">Estado *</Label>
                              <Select
                                value={dadosEditados.estado || ''}
                                onValueChange={(v) => handleFieldChange(cliente.id, 'estado', v)}
                              >
                                <SelectTrigger className="h-8 bg-white">
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ESTADOS_BRASIL.map(e => (
                                    <SelectItem key={e.sigla} value={e.sigla}>{e.sigla} - {e.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Cidade *</Label>
                              <Input
                                className="h-8 bg-white"
                                value={dadosEditados.cidade || ''}
                                onChange={(e) => handleFieldChange(cliente.id, 'cidade', e.target.value)}
                                placeholder="Nome da cidade"
                              />
                            </div>
                          </>
                        )}

                        {tipoErro === 'cpf_cnpj' && (
                          <div className="col-span-2">
                            <Label className="text-xs">CPF/CNPJ *</Label>
                            <Input
                              className="h-8 bg-white"
                              value={dadosEditados.cpf_cnpj || ''}
                              onChange={(e) => handleFieldChange(cliente.id, 'cpf_cnpj', e.target.value)}
                              placeholder="Somente números"
                            />
                          </div>
                        )}

                        {tipoErro === 'endereco' && (
                          <>
                            <div>
                              <Label className="text-xs">Endereço</Label>
                              <Input
                                className="h-8 bg-white"
                                value={dadosEditados.endereco || ''}
                                onChange={(e) => handleFieldChange(cliente.id, 'endereco', e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Bairro</Label>
                              <Input
                                className="h-8 bg-white"
                                value={dadosEditados.bairro || ''}
                                onChange={(e) => handleFieldChange(cliente.id, 'bairro', e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">CEP</Label>
                              <Input
                                className="h-8 bg-white"
                                value={dadosEditados.cep || ''}
                                onChange={(e) => handleFieldChange(cliente.id, 'cep', e.target.value)}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSalvarTodos}
                variant="secondary"
              >
                <Save className="w-4 h-4 mr-2" />
                Apenas Salvar
              </Button>
              <Button
                onClick={handleReexportar}
                disabled={exportando}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
              >
                {exportando ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Exportando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Salvar e Reexportar
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-slate-800">{resultadosReexport.resumo.total}</p>
                <p className="text-sm text-slate-500">Total</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{resultadosReexport.resumo.sucessos}</p>
                <p className="text-sm text-green-600">Sucessos</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{resultadosReexport.resumo.erros}</p>
                <p className="text-sm text-red-600">Erros</p>
              </div>
            </div>

            <ScrollArea className="h-[350px] border rounded-lg">
              <div className="p-2 space-y-2">
                {resultadosReexport.resultados.map((r, idx) => (
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
                      <p className="font-medium text-slate-800 truncate">{r.razao_social}</p>
                      <p className={`text-sm ${r.sucesso ? 'text-green-600' : 'text-red-600'}`}>
                        {r.mensagem}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              {resultadosReexport.resumo.erros > 0 && (
                <Button
                  onClick={() => setResultadosReexport(null)}
                  className="bg-gradient-to-r from-amber-500 to-orange-500"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Corrigir Restantes
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}