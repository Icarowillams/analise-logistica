import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, Upload, Download, Filter, MoreVertical, Edit, Trash2, Eye, Copy } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import CriarRoteiroModal from '@/components/Roteiros/CriarRoteiroModal';
import VisualizarRoteiroModal from '@/components/Roteiros/VisualizarRoteiroModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import LogClientesNaoCadastrados from '@/components/Roteiros/LogClientesNaoCadastrados';
import AtualizacaoMassaRoteiros from '@/components/Roteiros/AtualizacaoMassaRoteiros';
import RemoverClienteRoteiros from '@/components/Roteiros/RemoverClienteRoteiros';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

export default function GestaoRoteiros() {
  const [activeTab, setActiveTab] = useState('busca');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [duplicateDia, setDuplicateDia] = useState('');
  const [duplicateVendedor, setDuplicateVendedor] = useState('');

  const [filters, setFilters] = useState({ dia: '', vendedor: '', funcao: '', busca: '' });

  const queryClient = useQueryClient();

  const { data: roteiros = [], isLoading } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: funcoes = [] } = useQuery({ queryKey: ['funcoes'], queryFn: () => base44.entities.Funcao.list() });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Roteiro.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['roteiros']); setDeleteOpen(false); setSelected(null); }
  });

  const toggleAtivoMutation = useMutation({
    mutationFn: ({ id, ativo }) => base44.entities.Roteiro.update(id, { ativo }),
    onSuccess: () => queryClient.invalidateQueries(['roteiros'])
  });

  const duplicateMutation = useMutation({
    mutationFn: async ({ roteiro, novoDia, novoVendedorId, novoVendedorNome }) => {
      return base44.entities.Roteiro.create({
        vendedor_id: novoVendedorId,
        vendedor_nome: novoVendedorNome,
        dia_semana: novoDia,
        clientes_ids: roteiro.clientes_ids || [],
        clientes_detalhes: roteiro.clientes_detalhes || [],
        status: 'planejado',
        observacoes: roteiro.observacoes || ''
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      setDuplicateModalOpen(false); setSelected(null); setDuplicateDia(''); setDuplicateVendedor('');
    }
  });

  const handleDuplicate = (r) => {
    setSelected(r);
    setDuplicateDia('');
    setDuplicateVendedor(r.vendedor_id || '');
    setDuplicateModalOpen(true);
  };

  const confirmDuplicate = () => {
    if (!duplicateDia) { alert('Selecione o dia da semana'); return; }
    if (!duplicateVendedor) { alert('Selecione o funcionário'); return; }

    const v = vendedores.find(x => x.id === duplicateVendedor);
    const mesmoFunc = duplicateVendedor === selected?.vendedor_id;

    if (mesmoFunc) {
      const existente = roteiros.find(r => r.vendedor_id === duplicateVendedor && r.dia_semana === duplicateDia);
      if (existente) { alert(`O funcionário "${v?.nome}" já possui um roteiro para ${getDiaLabel(duplicateDia)}.`); return; }
    }

    duplicateMutation.mutate({
      roteiro: selected, novoDia: duplicateDia,
      novoVendedorId: duplicateVendedor, novoVendedorNome: v?.nome || ''
    });
  };

  const handleExport = () => {
    const headers = ['cod', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
    const map = new Map();

    roteiros.forEach(r => {
      r.clientes_detalhes?.forEach(c => {
        if (!map.has(c.cliente_codigo)) {
          map.set(c.cliente_codigo, { cod: c.cliente_codigo, segunda: '', terca: '', quarta: '', quinta: '', sexta: '', sabado: '', domingo: '' });
        }
        const diaMap = {
          'segunda-feira': 'segunda', 'terca-feira': 'terca', 'quarta-feira': 'quarta',
          'quinta-feira': 'quinta', 'sexta-feira': 'sexta', 'sabado': 'sabado', 'domingo': 'domingo'
        };
        const k = diaMap[r.dia_semana];
        if (k) map.get(c.cliente_codigo)[k] = 'sim';
      });
    });

    const rows = Array.from(map.values());
    const csv = [headers.join(';'), ...rows.map(row => headers.map(h => row[h] || '').join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `roteiros_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleView = (r) => { setSelected(r); setIsEditing(false); setViewModalOpen(true); };
  const handleEdit = (r) => { setSelected(r); setIsEditing(true); setCreateModalOpen(true); };
  const handleDelete = (r) => { setSelected(r); setDeleteOpen(true); };

  const ordemDias = { 'segunda-feira': 1, 'terca-feira': 2, 'quarta-feira': 3, 'quinta-feira': 4, 'sexta-feira': 5, 'sabado': 6, 'domingo': 7 };

  const filteredRoteiros = roteiros.filter(r => {
    if (filters.dia && r.dia_semana !== filters.dia) return false;
    if (filters.vendedor && r.vendedor_id !== filters.vendedor) return false;
    if (filters.funcao) {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (!v || v.funcao_id !== filters.funcao) return false;
    }
    if (filters.busca) {
      const q = filters.busca.toLowerCase();
      const matchNome = r.vendedor_nome?.toLowerCase().includes(q);
      const matchDia = r.dia_semana?.toLowerCase().includes(q);
      const matchCli = r.clientes_detalhes?.some(c =>
        c.cliente_codigo?.toLowerCase().includes(q) || c.cliente_nome?.toLowerCase().includes(q) || c.nome_fantasia?.toLowerCase().includes(q)
      );
      return matchNome || matchDia || matchCli;
    }
    return true;
  }).sort((a, b) => (ordemDias[a.dia_semana] || 99) - (ordemDias[b.dia_semana] || 99));

  const getDiaLabel = (d) => ({
    'segunda-feira': 'Segunda-feira', 'terca-feira': 'Terça-feira', 'quarta-feira': 'Quarta-feira',
    'quinta-feira': 'Quinta-feira', 'sexta-feira': 'Sexta-feira', 'sabado': 'Sábado', 'domingo': 'Domingo'
  })[d] || d;

  const getStatusBadge = (s) => {
    const config = {
      planejado: { className: 'bg-blue-100 text-blue-700', label: 'Planejado' },
      ativo: { className: 'bg-green-100 text-green-700', label: 'Ativo' },
      pausado: { className: 'bg-yellow-100 text-yellow-700', label: 'Pausado' },
      concluido: { className: 'bg-slate-100 text-slate-700', label: 'Concluído' }
    };
    const { className, label } = config[s] || config.planejado;
    return <Badge className={className}>{label}</Badge>;
  };

  return (
    <div>
      <PageHeader title="Gestão de Roteiros" subtitle="Planejamento de visitas e rotas de vendedores" icon={Route} />

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6">
        <Button onClick={handleExport} variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50 w-full sm:w-auto">
          <Download className="w-4 h-4 mr-2" />Exportar Roteiros ({roteiros.length})
        </Button>
        <Button onClick={() => { setSelected(null); setIsEditing(true); setCreateModalOpen(true); }}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30 w-full sm:w-auto">
          Novo Roteiro
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-nowrap sm:grid w-full max-w-[1100px] sm:grid-cols-6 mb-6 overflow-x-auto [-webkit-overflow-scrolling:touch] justify-start [&>button]:shrink-0 sm:[&>button]:shrink-0">
          <TabsTrigger value="busca">Busca de Roteiros</TabsTrigger>
          <TabsTrigger value="importar">Criação em Massa</TabsTrigger>
          <TabsTrigger value="atualizacao">Atualização em Massa</TabsTrigger>
          <TabsTrigger value="remover">Remover Cliente</TabsTrigger>
          <TabsTrigger value="pendentes">Clientes Pendentes</TabsTrigger>
          <TabsTrigger value="visualizar">Visualizar Roteiro</TabsTrigger>
        </TabsList>

        <TabsContent value="busca" className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Filter className="w-5 h-5" />Filtros</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label>Filtrar por dia</Label>
                  <Select value={filters.dia || 'all'} onValueChange={(v) => setFilters({ ...filters, dia: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Todos os dias" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os dias</SelectItem>
                      <SelectItem value="segunda-feira">Segunda-feira</SelectItem>
                      <SelectItem value="terca-feira">Terça-feira</SelectItem>
                      <SelectItem value="quarta-feira">Quarta-feira</SelectItem>
                      <SelectItem value="quinta-feira">Quinta-feira</SelectItem>
                      <SelectItem value="sexta-feira">Sexta-feira</SelectItem>
                      <SelectItem value="sabado">Sábado</SelectItem>
                      <SelectItem value="domingo">Domingo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Filtrar por funcionário</Label>
                  <Select value={filters.vendedor || 'all'} onValueChange={(v) => setFilters({ ...filters, vendedor: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Todos os funcionários" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os funcionários</SelectItem>
                      {vendedores.filter(v => !filters.funcao || v.funcao_id === filters.funcao).map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Filtrar por função</Label>
                  <Select value={filters.funcao || 'all'} onValueChange={(v) => setFilters({ ...filters, funcao: v === 'all' ? '' : v, vendedor: '' })}>
                    <SelectTrigger><SelectValue placeholder="Todas as funções" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as funções</SelectItem>
                      {funcoes.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Buscar</Label>
                  <Input placeholder="Buscar roteiro..." value={filters.busca} onChange={(e) => setFilters({ ...filters, busca: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Roteiros Encontrados ({filteredRoteiros.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia da Semana</TableHead>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Clientes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
                  ) : filteredRoteiros.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Nenhum roteiro encontrado</TableCell></TableRow>
                  ) : (
                    filteredRoteiros.map((r) => (
                      <TableRow key={r.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium">{getDiaLabel(r.dia_semana)}</TableCell>
                        <TableCell>{r.vendedor_nome}</TableCell>
                        <TableCell><Badge variant="outline">{r.clientes_ids?.length || 0} clientes</Badge></TableCell>
                        <TableCell>{getStatusBadge(r.status)}</TableCell>
                        <TableCell>
                          <Switch checked={r.ativo !== false}
                            onCheckedChange={(checked) => toggleAtivoMutation.mutate({ id: r.id, ativo: checked })} />
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleView(r)}><Eye className="w-4 h-4 mr-2" />Visualizar</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(r)}><Edit className="w-4 h-4 mr-2" />Editar</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(r)}><Copy className="w-4 h-4 mr-2" />Duplicar</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(r)} className="text-red-600"><Trash2 className="w-4 h-4 mr-2" />Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="importar" className="space-y-6"><ImportarTab /></TabsContent>
        <TabsContent value="atualizacao" className="space-y-6"><AtualizacaoMassaRoteiros /></TabsContent>
        <TabsContent value="remover" className="space-y-6"><RemoverClienteRoteiros /></TabsContent>
        <TabsContent value="pendentes" className="space-y-6"><LogClientesNaoCadastrados /></TabsContent>
        <TabsContent value="visualizar">
          <Card><CardContent className="pt-6"><p className="text-center text-slate-500">Selecione um roteiro na aba "Busca" e clique em "Visualizar"</p></CardContent></Card>
        </TabsContent>
      </Tabs>

      <CriarRoteiroModal open={createModalOpen} onOpenChange={setCreateModalOpen} roteiro={selected} isEditing={isEditing} />
      <VisualizarRoteiroModal open={viewModalOpen} onOpenChange={setViewModalOpen} roteiro={selected} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} isDeleting={deleteMutation.isPending} />

      <Dialog open={duplicateModalOpen} onOpenChange={setDuplicateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Copy className="w-5 h-5 text-blue-600" />Duplicar Roteiro</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600">Roteiro original:</p>
              <p className="font-semibold">{selected?.vendedor_nome}</p>
              <p className="text-sm text-slate-500">{getDiaLabel(selected?.dia_semana)} - {selected?.clientes_ids?.length || 0} clientes</p>
            </div>
            <div>
              <Label>Selecione o funcionário *</Label>
              <Select value={duplicateVendedor} onValueChange={setDuplicateVendedor}>
                <SelectTrigger><SelectValue placeholder="Selecione o funcionário" /></SelectTrigger>
                <SelectContent>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Selecione o novo dia da semana *</Label>
              <Select value={duplicateDia} onValueChange={setDuplicateDia}>
                <SelectTrigger><SelectValue placeholder="Selecione o dia" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="segunda-feira">Segunda-feira</SelectItem>
                  <SelectItem value="terca-feira">Terça-feira</SelectItem>
                  <SelectItem value="quarta-feira">Quarta-feira</SelectItem>
                  <SelectItem value="quinta-feira">Quinta-feira</SelectItem>
                  <SelectItem value="sexta-feira">Sexta-feira</SelectItem>
                  <SelectItem value="sabado">Sábado</SelectItem>
                  <SelectItem value="domingo">Domingo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateModalOpen(false)}>Cancelar</Button>
            <Button onClick={confirmDuplicate} disabled={duplicateMutation.isPending || !duplicateDia || !duplicateVendedor} className="bg-blue-600 hover:bg-blue-700">
              {duplicateMutation.isPending ? 'Duplicando...' : 'Duplicar Roteiro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportarTab() {
  const [importData, setImportData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importMode, setImportMode] = useState('paste');
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef(null);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  const handleDownloadTemplate = () => {
    const headers = ['cod_cliente', 'funcionario', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
    const exampleRows = [
      ['CLI001', 'João Silva', 'sim', '', 'sim', '', 'sim', '', ''],
      ['CLI002', 'Maria Santos', '', 'sim', '', 'sim', '', '', '']
    ];
    const csv = [headers.join(';'), ...exampleRows.map(row => row.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao_roteiros.csv';
    link.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setImportData(event.target.result);
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importData.trim()) { alert('Cole os dados ou faça upload'); return; }
    setIsImporting(true);
    try {
      const lines = importData.split('\n').filter(l => l.trim());
      const headers = lines[0].split(/[;\t,]/).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

      if (!headers.includes('cod_cliente') && !headers.includes('cod')) {
        alert('Formato inválido: falta a coluna "cod_cliente"');
        setIsImporting(false);
        return;
      }

      const codColumn = headers.includes('cod_cliente') ? 'cod_cliente' : 'cod';
      const hasFuncionarioCol = headers.includes('funcionario');
      const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
      const diasMap = {
        'segunda': 'segunda-feira', 'terca': 'terca-feira', 'quarta': 'quarta-feira',
        'quinta': 'quinta-feira', 'sexta': 'sexta-feira', 'sabado': 'sabado', 'domingo': 'domingo'
      };

      const roteirosMap = new Map();
      const erros = [];
      const naoEncontrados = new Map();

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(/[;\t,]/).map(v => v.trim().replace(/['"]/g, ''));
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx]?.trim() || ''; });

        const codigo = row[codColumn];
        if (!codigo) continue;

        const cliente = clientes.find(c => c.codigo_interno === codigo);
        if (!cliente) {
          if (!naoEncontrados.has(codigo)) {
            naoEncontrados.set(codigo, { funcionario: row.funcionario || '', funcionario_id: null, dias: [] });
          }
          dias.forEach(dia => {
            const v = row[dia]?.toLowerCase();
            if (['sim', 's', 'x', '1'].includes(v)) {
              if (!naoEncontrados.get(codigo).dias.includes(dia)) naoEncontrados.get(codigo).dias.push(dia);
            }
          });
          if (row.funcionario) {
            const f = vendedores.find(v => v.nome?.toLowerCase().trim() === row.funcionario.toLowerCase().trim());
            if (f) naoEncontrados.get(codigo).funcionario_id = f.id;
          }
          erros.push(`Linha ${i + 1}: Cliente "${codigo}" não encontrado`);
          continue;
        }

        let vendedorId = null, vendedorNome = null;
        if (hasFuncionarioCol && row.funcionario) {
          const f = vendedores.find(v => v.nome?.toLowerCase().trim() === row.funcionario.toLowerCase().trim());
          if (f) { vendedorId = f.id; vendedorNome = f.nome; }
          else { erros.push(`Linha ${i + 1}: Funcionário "${row.funcionario}" não encontrado`); continue; }
        } else {
          vendedorId = cliente.vendedor_id;
          const v = vendedores.find(v => v.id === vendedorId);
          vendedorNome = v?.nome || 'N/A';
        }

        if (!vendedorId) { erros.push(`Linha ${i + 1}: Cliente "${codigo}" sem funcionário`); continue; }

        dias.forEach(dia => {
          const v = row[dia]?.toLowerCase();
          if (['sim', 's', 'x', '1'].includes(v)) {
            const diaCompleto = diasMap[dia];
            const key = `${vendedorId}-${diaCompleto}`;
            if (!roteirosMap.has(key)) {
              roteirosMap.set(key, { vendedor_id: vendedorId, vendedor_nome: vendedorNome, dia_semana: diaCompleto, clientes: [] });
            }
            roteirosMap.get(key).clientes.push(cliente);
          }
        });
      }

      if (naoEncontrados.size > 0) {
        const logs = [];
        for (const [codigo, data] of naoEncontrados.entries()) {
          if (data.dias.length > 0) {
            logs.push({ codigo_cliente: codigo, funcionario_nome: data.funcionario, funcionario_id: data.funcionario_id, dias_semana: data.dias, status: 'pendente' });
          }
        }
        if (logs.length > 0) {
          await base44.entities.LogClienteNaoCadastrado.bulkCreate(logs);
          queryClient.invalidateQueries(['logsClientesNaoCadastrados']);
        }
      }

      const roteirosParaImportar = [];
      for (const [, data] of roteirosMap.entries()) {
        roteirosParaImportar.push({
          vendedor_id: data.vendedor_id, vendedor_nome: data.vendedor_nome, dia_semana: data.dia_semana,
          clientes_ids: data.clientes.map(c => c.id),
          clientes_detalhes: data.clientes.map((c, idx) => ({
            cliente_id: c.id, cliente_nome: c.razao_social || c.nome_fantasia,
            nome_fantasia: c.nome_fantasia, cliente_codigo: c.codigo_interno,
            cliente_cidade: c.cidade, ordem: idx + 1
          })),
          status: 'planejado'
        });
      }

      if (roteirosParaImportar.length > 0) {
        const response = await base44.functions.invoke('bulkImportRoteiros', { roteiros: roteirosParaImportar });
        const resultado = response.data;
        queryClient.invalidateQueries(['roteiros']);
        let msg = `✅ Importação concluída!\n\n${resultado.criados || 0} criados\n${resultado.atualizados || 0} atualizados`;
        if (naoEncontrados.size > 0) msg += `\n\n${naoEncontrados.size} cliente(s) não cadastrado(s) salvos no log.`;
        alert(msg);
      }
      setImportData('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      alert('Erro ao importar: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Importar Roteiros em Massa</CardTitle>
          <Button onClick={handleDownloadTemplate} variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50">
            <Download className="w-4 h-4 mr-2" />Baixar Modelo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="font-semibold text-amber-900 mb-2">Formato Esperado</h3>
          <p className="font-mono text-sm bg-white p-2 rounded border mb-2">
            cod_cliente | funcionario | segunda | terca | quarta | quinta | sexta | sabado | domingo
          </p>
          <ul className="text-sm text-amber-800 list-disc list-inside">
            <li><strong>cod_cliente:</strong> Código do cliente (obrigatório)</li>
            <li><strong>funcionario:</strong> Nome do funcionário responsável</li>
            <li><strong>Dias:</strong> Use "sim", "s", "x" ou "1" para marcar atendimento</li>
          </ul>
        </div>

        <div className="flex gap-4">
          <Button variant={importMode === 'paste' ? 'default' : 'outline'} onClick={() => setImportMode('paste')}
            className={importMode === 'paste' ? 'bg-amber-500 hover:bg-amber-600' : ''}>Colar Dados</Button>
          <Button variant={importMode === 'file' ? 'default' : 'outline'} onClick={() => setImportMode('file')}
            className={importMode === 'file' ? 'bg-amber-500 hover:bg-amber-600' : ''}>Upload de Arquivo</Button>
        </div>

        {importMode === 'file' ? (
          <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 text-center">
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleFileUpload} className="hidden" id="file-upload" />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-12 h-12 mx-auto text-amber-400 mb-2" />
              <p className="text-amber-700 font-medium">Clique para selecionar um arquivo</p>
              <p className="text-sm text-amber-500">CSV, TXT ou Excel</p>
            </label>
            {importData && <p className="mt-4 text-green-600 font-medium">✓ Arquivo carregado!</p>}
          </div>
        ) : (
          <div>
            <Label>Cole os dados aqui...</Label>
            <Textarea value={importData} onChange={(e) => setImportData(e.target.value)}
              placeholder="cod_cliente;funcionario;segunda;terca;quarta;quinta;sexta;sabado;domingo"
              rows={12} className="font-mono text-sm" />
          </div>
        )}

        <Button onClick={handleImport} disabled={isImporting || !importData.trim()}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600">
          <Upload className="w-4 h-4 mr-2" />{isImporting ? 'Importando...' : 'Importar Roteiros'}
        </Button>
      </CardContent>
    </Card>
  );
}