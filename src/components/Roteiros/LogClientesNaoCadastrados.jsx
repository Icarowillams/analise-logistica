import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../../utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, UserPlus, Check, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function LogClientesNaoCadastrados() {
  const queryClient = useQueryClient();
  const [processando, setProcessando] = useState({});

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logsClientesNaoCadastrados'],
    queryFn: () => base44.entities.LogClienteNaoCadastrado.filter({ status: 'pendente' }, '-created_date')
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LogClienteNaoCadastrado.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['logsClientesNaoCadastrados']);
      toast.success('Log removido');
    }
  });

  const verificarEAdicionarCliente = async (log) => {
    setProcessando(prev => ({ ...prev, [log.id]: true }));
    
    try {
      // Verificar se o cliente já foi cadastrado
      const cliente = clientes.find(c => c.codigo === log.codigo_cliente);
      
      if (!cliente) {
        toast.error(`Cliente ${log.codigo_cliente} ainda não foi cadastrado`);
        setProcessando(prev => ({ ...prev, [log.id]: false }));
        return;
      }

      // Para cada dia da semana que estava faltando, adicionar ao roteiro
      const diasMap = {
        'segunda': 'segunda-feira',
        'terca': 'terca-feira',
        'quarta': 'quarta-feira',
        'quinta': 'quinta-feira',
        'sexta': 'sexta-feira',
        'sabado': 'sabado',
        'domingo': 'domingo'
      };

      let adicionados = 0;
      
      for (const dia of log.dias_semana) {
        const diaCompleto = diasMap[dia] || dia;
        
        // Buscar roteiro existente do funcionário para este dia
        const roteiroExistente = roteiros.find(r => 
          r.vendedor_id === log.funcionario_id && 
          r.dia_semana === diaCompleto
        );

        if (roteiroExistente) {
          // Verificar se o cliente já não está no roteiro
          if (!roteiroExistente.clientes_ids?.includes(cliente.id)) {
            // Adicionar cliente ao roteiro existente
            const novosClientesIds = [...(roteiroExistente.clientes_ids || []), cliente.id];
            const novosClientesDetalhes = [
              ...(roteiroExistente.clientes_detalhes || []),
              {
                cliente_id: cliente.id,
                cliente_nome: cliente.nome_fantasia || cliente.razao_social,
                cliente_codigo: cliente.codigo,
                cliente_cidade: cliente.cidade,
                ordem: novosClientesIds.length
              }
            ];

            await base44.entities.Roteiro.update(roteiroExistente.id, {
              clientes_ids: novosClientesIds,
              clientes_detalhes: novosClientesDetalhes
            });
            adicionados++;
          }
        } else {
          // Criar novo roteiro para este funcionário/dia
          await base44.entities.Roteiro.create({
            vendedor_id: log.funcionario_id,
            vendedor_nome: log.funcionario_nome,
            dia_semana: diaCompleto,
            clientes_ids: [cliente.id],
            clientes_detalhes: [{
              cliente_id: cliente.id,
              cliente_nome: cliente.nome_fantasia || cliente.razao_social,
              cliente_codigo: cliente.codigo,
              cliente_cidade: cliente.cidade,
              ordem: 1
            }],
            status: 'planejado'
          });
          adicionados++;
        }
      }

      // Marcar log como resolvido
      await base44.entities.LogClienteNaoCadastrado.update(log.id, {
        status: 'resolvido',
        cliente_id: cliente.id
      });

      queryClient.invalidateQueries(['logsClientesNaoCadastrados']);
      queryClient.invalidateQueries(['roteiros']);
      
      toast.success(`Cliente ${cliente.codigo} adicionado em ${adicionados} roteiro(s)!`);
    } catch (error) {
      toast.error('Erro ao processar: ' + error.message);
    } finally {
      setProcessando(prev => ({ ...prev, [log.id]: false }));
    }
  };

  const getDiaLabel = (dia) => {
    const labels = {
      'segunda': 'Seg',
      'terca': 'Ter',
      'quarta': 'Qua',
      'quinta': 'Qui',
      'sexta': 'Sex',
      'sabado': 'Sáb',
      'domingo': 'Dom'
    };
    return labels[dia] || dia;
  };

  if (logs.length === 0 && !isLoading) {
    return null;
  }

  return (
    <Card className="border-orange-200 bg-orange-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-700">
          <AlertTriangle className="w-5 h-5" />
          Clientes Não Cadastrados ({logs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-center text-slate-500 py-4">Carregando...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Funcionário</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Data do Log</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => {
                const clienteJaCadastrado = clientes.find(c => c.codigo === log.codigo_cliente);
                return (
                  <TableRow key={log.id} className={clienteJaCadastrado ? 'bg-green-50' : ''}>
                    <TableCell className="font-medium">
                      {log.codigo_cliente}
                      {clienteJaCadastrado && (
                        <Badge className="ml-2 bg-green-100 text-green-700">Cadastrado!</Badge>
                      )}
                    </TableCell>
                    <TableCell>{log.funcionario_nome || 'N/A'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {log.dias_semana?.map(dia => (
                          <Badge key={dia} variant="outline" className="text-xs">
                            {getDiaLabel(dia)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {new Date(log.created_date).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        {clienteJaCadastrado ? (
                          <Button
                            size="sm"
                            onClick={() => verificarEAdicionarCliente(log)}
                            disabled={processando[log.id]}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {processando[log.id] ? (
                              <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4 mr-1" />
                            )}
                            Adicionar ao Roteiro
                          </Button>
                        ) : (
                          <Link to={`${createPageUrl('Clientes')}?codigo=${log.codigo_cliente}`}>
                            <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100">
                              <UserPlus className="w-4 h-4 mr-1" />
                              Cadastrar Cliente
                            </Button>
                          </Link>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(log.id)}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}