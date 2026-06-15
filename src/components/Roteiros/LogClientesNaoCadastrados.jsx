import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, UserPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export default function LogClientesNaoCadastrados() {
  const qc = useQueryClient();
  const [processando, setProcessando] = useState({});

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logsClientesNaoCadastrados'],
    queryFn: () => base44.entities.LogClienteNaoCadastrado.filter({ status: 'pendente' }, '-created_date')
  });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list() });

  // Busca SÓ os clientes referenciados pelos logs (por código) — não a base inteira.
  const codigosLog = [...new Set(logs.map(l => l.codigo_cliente).filter(Boolean))];
  const { data: clientes = [] } = useQuery({
    queryKey: ['log-clientes-nao-cadastrados-clientes', codigosLog.join('|')],
    queryFn: async () => {
      if (codigosLog.length === 0) return [];
      const listas = await Promise.all(codigosLog.map(cod => base44.entities.Cliente.filter({ codigo_interno: cod }, '-created_date', 1).catch(() => [])));
      return listas.flat();
    },
    enabled: codigosLog.length > 0,
    staleTime: 60 * 1000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LogClienteNaoCadastrado.delete(id),
    onSuccess: () => { qc.invalidateQueries(['logsClientesNaoCadastrados']); toast.success('Log removido'); }
  });

  const verificarEAdicionar = async (log) => {
    setProcessando(prev => ({ ...prev, [log.id]: true }));
    try {
      const cliente = clientes.find(c => c.codigo_interno === log.codigo_cliente);
      if (!cliente) { toast.error(`Cliente ${log.codigo_cliente} ainda não cadastrado`); setProcessando(prev => ({ ...prev, [log.id]: false })); return; }

      const diasMap = { 'segunda': 'segunda-feira', 'terca': 'terca-feira', 'quarta': 'quarta-feira', 'quinta': 'quinta-feira', 'sexta': 'sexta-feira', 'sabado': 'sabado', 'domingo': 'domingo' };

      let adicionados = 0;
      for (const dia of log.dias_semana || []) {
        const diaCompleto = diasMap[dia] || dia;
        const existente = roteiros.find(r => r.vendedor_id === log.funcionario_id && r.dia_semana === diaCompleto);
        if (existente) {
          if (!existente.clientes_ids?.includes(cliente.id)) {
            const novosIds = [...(existente.clientes_ids || []), cliente.id];
            const novosDetalhes = [...(existente.clientes_detalhes || []), {
              cliente_id: cliente.id, cliente_nome: cliente.nome_fantasia || cliente.razao_social,
              nome_fantasia: cliente.nome_fantasia, cliente_codigo: cliente.codigo_interno,
              cliente_cidade: cliente.cidade, ordem: novosIds.length
            }];
            await base44.entities.Roteiro.update(existente.id, { clientes_ids: novosIds, clientes_detalhes: novosDetalhes });
            adicionados++;
          }
        } else {
          await base44.entities.Roteiro.create({
            vendedor_id: log.funcionario_id, vendedor_nome: log.funcionario_nome,
            dia_semana: diaCompleto, clientes_ids: [cliente.id],
            clientes_detalhes: [{
              cliente_id: cliente.id, cliente_nome: cliente.nome_fantasia || cliente.razao_social,
              nome_fantasia: cliente.nome_fantasia, cliente_codigo: cliente.codigo_interno,
              cliente_cidade: cliente.cidade, ordem: 1
            }],
            status: 'planejado'
          });
          adicionados++;
        }
      }

      await base44.entities.LogClienteNaoCadastrado.update(log.id, { status: 'resolvido', cliente_id: cliente.id });
      qc.invalidateQueries(['logsClientesNaoCadastrados']);
      qc.invalidateQueries(['roteiros']);
      toast.success(`Cliente ${cliente.codigo_interno} adicionado em ${adicionados} roteiro(s)!`);
    } catch (error) {
      toast.error('Erro: ' + error.message);
    } finally {
      setProcessando(prev => ({ ...prev, [log.id]: false }));
    }
  };

  const getDiaLabel = (d) => ({ 'segunda': 'Seg', 'terca': 'Ter', 'quarta': 'Qua', 'quinta': 'Qui', 'sexta': 'Sex', 'sabado': 'Sáb', 'domingo': 'Dom' })[d] || d;

  return (
    <Card className="border-orange-200 bg-orange-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-700">
          <AlertTriangle className="w-5 h-5" />Clientes Não Cadastrados ({logs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-center py-6 text-slate-500">Carregando...</p> : logs.length === 0 ? (
          <p className="text-center py-6 text-slate-500">Nenhum cliente pendente.</p>
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
                const cadastrado = clientes.find(c => c.codigo_interno === log.codigo_cliente);
                return (
                  <TableRow key={log.id} className={cadastrado ? 'bg-green-50' : ''}>
                    <TableCell className="font-medium">
                      {log.codigo_cliente}
                      {cadastrado && <Badge className="ml-2 bg-green-100 text-green-700">Cadastrado!</Badge>}
                    </TableCell>
                    <TableCell>{log.funcionario_nome || 'N/A'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {log.dias_semana?.map(d => <Badge key={d} variant="outline" className="text-xs">{getDiaLabel(d)}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{log.created_date ? new Date(log.created_date).toLocaleDateString('pt-BR') : '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" onClick={() => verificarEAdicionar(log)} disabled={processando[log.id] || !cadastrado}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white">
                          <UserPlus className="w-4 h-4 mr-1" />{processando[log.id] ? '...' : 'Adicionar ao Roteiro'}
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(log.id)} className="text-red-500 hover:bg-red-50 h-8 w-8">
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