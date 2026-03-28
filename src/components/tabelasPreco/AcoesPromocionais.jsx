import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Pencil, Trash2, Search, History, Tag, Users, Calendar } from 'lucide-react';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import AcaoFormModal from './AcaoFormModal';

export default function AcoesPromocionais() {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState('acoes');
  const [formOpen, setFormOpen] = useState(false);
  const [editingAcao, setEditingAcao] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [filtroTabela, setFiltroTabela] = useState('all');
  const [filtroStatus, setFiltroStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: acoes = [], isLoading } = useQuery({
    queryKey: ['acoesPromocionais'],
    queryFn: () => base44.entities.AcaoPromocional.list('-created_date')
  });

  const { data: logs = [] } = useQuery({
    queryKey: ['logsAcaoPromocional'],
    queryFn: () => base44.entities.LogAcaoPromocional.list('-created_date')
  });

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const registrarLog = async (acaoId, tipoOperacao, descricao, detalhes = '') => {
    await base44.entities.LogAcaoPromocional.create({
      acao_id: acaoId,
      tipo_operacao: tipoOperacao,
      descricao,
      usuario_email: currentUser?.email || '',
      usuario_nome: currentUser?.full_name || '',
      detalhes
    });
    queryClient.invalidateQueries({ queryKey: ['logsAcaoPromocional'] });
  };

  const createMutation = useMutation({
    mutationFn: async (formData) => {
      const results = [];
      for (const prod of formData.produtos) {
        const acao = await base44.entities.AcaoPromocional.create({
          tabela_id: formData.tabelaId,
          tabela_nome: formData.tabelaNome,
          produto_id: prod.produto_id,
          produto_nome: prod.produto_nome,
          produto_codigo: prod.produto_codigo,
          valor_acao: prod.valor_acao,
          data_inicio: formData.dataInicio,
          data_fim: formData.dataFim,
          clientes_ids: formData.clientes.map(c => c.cliente_id),
          clientes_detalhes: formData.clientes,
          observacoes: formData.observacoes,
          status: 'ativa'
        });
        results.push(acao);
        const clientesStr = formData.clientes.length > 0
          ? formData.clientes.map(c => c.cliente_nome).join(', ')
          : 'Todos os clientes';
        await registrarLog(
          acao.id,
          'criacao',
          `Ação criada: ${prod.produto_nome} (${formData.tabelaNome}) - R$ ${prod.valor_acao.toFixed(2)} | ${formData.dataInicio} a ${formData.dataFim} | Clientes: ${clientesStr}`
        );
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acoesPromocionais'] });
      setFormOpen(false);
      toast.success('Ação promocional criada com sucesso!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (formData) => {
      const prod = formData.produtos[0];
      const updated = await base44.entities.AcaoPromocional.update(editingAcao.id, {
        tabela_id: formData.tabelaId,
        tabela_nome: formData.tabelaNome,
        valor_acao: prod.valor_acao,
        data_inicio: formData.dataInicio,
        data_fim: formData.dataFim,
        clientes_ids: formData.clientes.map(c => c.cliente_id),
        clientes_detalhes: formData.clientes,
        observacoes: formData.observacoes
      });
      const clientesStr = formData.clientes.length > 0
        ? formData.clientes.map(c => c.cliente_nome).join(', ')
        : 'Todos os clientes';
      await registrarLog(
        editingAcao.id,
        'edicao',
        `Ação editada: ${prod.produto_nome} (${formData.tabelaNome}) - R$ ${prod.valor_acao.toFixed(2)} | ${formData.dataInicio} a ${formData.dataFim} | Clientes: ${clientesStr}`
      );
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acoesPromocionais'] });
      setFormOpen(false);
      setEditingAcao(null);
      toast.success('Ação atualizada com sucesso!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (acao) => {
      await base44.entities.AcaoPromocional.delete(acao.id);
      await registrarLog(
        acao.id,
        'exclusao',
        `Ação excluída: ${acao.produto_nome} (${acao.tabela_nome}) - R$ ${(acao.valor_acao || 0).toFixed(2)} | ${acao.data_inicio} a ${acao.data_fim}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acoesPromocionais'] });
      setDeleteOpen(false);
      setDeleteTarget(null);
      toast.success('Ação excluída com sucesso!');
    }
  });

  const acoesFiltradas = useMemo(() => {
    return acoes.filter(a => {
      if (filtroTabela !== 'all' && a.tabela_id !== filtroTabela) return false;
      if (filtroStatus !== 'all' && a.status !== filtroStatus) return false;
      if (searchText) {
        const s = searchText.toLowerCase();
        if (!a.produto_nome?.toLowerCase().includes(s) && !a.produto_codigo?.includes(s) && !a.tabela_nome?.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [acoes, filtroTabela, filtroStatus, searchText]);

  const handleNew = () => {
    setEditingAcao(null);
    setFormOpen(true);
  };

  const handleEdit = (acao) => {
    setEditingAcao(acao);
    setFormOpen(true);
  };

  const handleDelete = (acao) => {
    setDeleteTarget(acao);
    setDeleteOpen(true);
  };

  const handleSubmit = (formData) => {
    if (editingAcao) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const getStatusBadge = (acao) => {
    const hoje = new Date().toISOString().split('T')[0];
    if (acao.status === 'cancelada') return <Badge className="bg-red-100 text-red-700">Cancelada</Badge>;
    if (acao.data_fim < hoje) return <Badge className="bg-slate-100 text-slate-600">Encerrada</Badge>;
    if (acao.data_inicio > hoje) return <Badge className="bg-blue-100 text-blue-700">Futura</Badge>;
    return <Badge className="bg-green-100 text-green-700">Ativa</Badge>;
  };

  const logOperacaoBadge = (tipo) => {
    const map = {
      criacao: <Badge className="bg-green-100 text-green-700">Criação</Badge>,
      edicao: <Badge className="bg-blue-100 text-blue-700">Edição</Badge>,
      exclusao: <Badge className="bg-red-100 text-red-700">Exclusão</Badge>
    };
    return map[tipo] || <Badge>{tipo}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="acoes" className="gap-1.5"><Tag className="w-3.5 h-3.5" /> Ações</TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5"><History className="w-3.5 h-3.5" /> Histórico</TabsTrigger>
          </TabsList>
          {subTab === 'acoes' && (
            <Button onClick={handleNew} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30">
              <Plus className="w-4 h-4 mr-1" /> Nova Ação
            </Button>
          )}
        </div>

        <TabsContent value="acoes">
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar produto..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
            </div>
            <div>
              <Select value={filtroTabela} onValueChange={setFiltroTabela}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tabela" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Tabelas</SelectItem>
                  {tabelas.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="encerrada">Encerrada</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lista */}
          {acoesFiltradas.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Tag className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhuma ação promocional encontrada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {acoesFiltradas.map(acao => (
                <Card key={acao.id} className="hover:border-amber-300 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded">{acao.produto_codigo}</span>
                          <span className="font-semibold text-sm">{acao.produto_nome}</span>
                          {getStatusBadge(acao)}
                        </div>
                        <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
                          <p>Tabela: <span className="font-medium text-slate-700">{acao.tabela_nome}</span></p>
                          <p className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {acao.data_inicio} a {acao.data_fim}
                          </p>
                          <p className="text-amber-700 font-semibold text-sm">R$ {(acao.valor_acao || 0).toFixed(2).replace('.', ',')}</p>
                        </div>
                        {acao.clientes_detalhes?.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            <Users className="w-3 h-3 text-slate-400" />
                            {acao.clientes_detalhes.slice(0, 5).map(c => (
                              <Badge key={c.cliente_id} variant="outline" className="text-[10px]">{c.cliente_codigo} - {c.cliente_nome}</Badge>
                            ))}
                            {acao.clientes_detalhes.length > 5 && (
                              <Badge variant="outline" className="text-[10px]">+{acao.clientes_detalhes.length - 5}</Badge>
                            )}
                          </div>
                        )}
                        {!acao.clientes_detalhes?.length && (
                          <p className="mt-1 text-[10px] text-slate-400 italic">Todos os clientes</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="text-blue-600 hover:bg-blue-50" onClick={() => handleEdit(acao)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => handleDelete(acao)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="log">
          {logs.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <History className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum registro no histórico</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="p-3 text-left text-xs font-semibold text-slate-600">Data/Hora</th>
                      <th className="p-3 text-left text-xs font-semibold text-slate-600">Operação</th>
                      <th className="p-3 text-left text-xs font-semibold text-slate-600">Descrição</th>
                      <th className="p-3 text-left text-xs font-semibold text-slate-600">Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, idx) => (
                      <tr key={log.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="p-3 text-xs text-slate-600 whitespace-nowrap">
                          {log.created_date ? new Date(log.created_date).toLocaleString('pt-BR') : '-'}
                        </td>
                        <td className="p-3">{logOperacaoBadge(log.tipo_operacao)}</td>
                        <td className="p-3 text-xs text-slate-700">{log.descricao}</td>
                        <td className="p-3 text-xs text-slate-500">{log.usuario_nome || log.usuario_email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {formOpen && (
        <AcaoFormModal
          open={formOpen}
          onOpenChange={(v) => { setFormOpen(v); if (!v) setEditingAcao(null); }}
          onSubmit={handleSubmit}
          editingAcao={editingAcao}
          tabelas={tabelas}
          produtos={produtos}
          clientes={clientes}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      )}

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}