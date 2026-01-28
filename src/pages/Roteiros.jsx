import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, Upload, Download, Filter, Search, MoreVertical, Edit, Trash2, Eye, Copy } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import CriarRoteiroModal from '@/components/Roteiros/CriarRoteiroModal';
import VisualizarRoteiroModal from '@/components/Roteiros/VisualizarRoteiroModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import LogClientesNaoCadastrados from '@/components/Roteiros/LogClientesNaoCadastrados';

export default function Roteiros() {
  const [activeTab, setActiveTab] = useState("busca");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [duplicateDia, setDuplicateDia] = useState('');
  
  const [filters, setFilters] = useState({
    dia: '',
    vendedor: '',
    busca: ''
  });

  const queryClient = useQueryClient();

  const { data: roteiros = [], isLoading } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Roteiro.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async ({ roteiro, novoDia }) => {
      const novoRoteiro = {
        vendedor_id: roteiro.vendedor_id,
        vendedor_nome: roteiro.vendedor_nome,
        dia_semana: novoDia,
        clientes_ids: roteiro.clientes_ids || [],
        clientes_detalhes: roteiro.clientes_detalhes || [],
        status: 'planejado',
        observacoes: roteiro.observacoes || ''
      };
      return base44.entities.Roteiro.create(novoRoteiro);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      setDuplicateModalOpen(false);
      setSelected(null);
      setDuplicateDia('');
    }
  });

  const handleDuplicate = (roteiro) => {
    setSelected(roteiro);
    setDuplicateDia('');
    setDuplicateModalOpen(true);
  };

  const confirmDuplicate = () => {
    if (!duplicateDia) {
      alert('Selecione o dia da semana para o novo roteiro');
      return;
    }
    duplicateMutation.mutate({ roteiro: selected, novoDia: duplicateDia });
  };

  const handleExport = () => {
    const headers = ['cod', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
    
    // Agrupar roteiros por cliente
    const clientesMap = new Map();
    
    roteiros.forEach(roteiro => {
      roteiro.clientes_detalhes?.forEach(cliente => {
        if (!clientesMap.has(cliente.cliente_codigo)) {
          clientesMap.set(cliente.cliente_codigo, {
            cod: cliente.cliente_codigo,
            segunda: '',
            terca: '',
            quarta: '',
            quinta: '',
            sexta: '',
            sabado: '',
            domingo: ''
          });
        }
        
        const diaMap = {
          'segunda-feira': 'segunda',
          'terca-feira': 'terca',
          'quarta-feira': 'quarta',
          'quinta-feira': 'quinta',
          'sexta-feira': 'sexta',
          'sabado': 'sabado',
          'domingo': 'domingo'
        };
        
        const diaKey = diaMap[roteiro.dia_semana];
        if (diaKey) {
          clientesMap.get(cliente.cliente_codigo)[diaKey] = 'sim';
        }
      });
    });

    const rows = Array.from(clientesMap.values());
    const csvContent = [
      headers.join(';'),
      ...rows.map(row => headers.map(h => row[h] || '').join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `roteiros_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleView = (roteiro) => {
    setSelected(roteiro);
    setIsEditing(false);
    setViewModalOpen(true);
  };

  const handleEdit = (roteiro) => {
    setSelected(roteiro);
    setIsEditing(true);
    setCreateModalOpen(true);
  };

  const handleDelete = (roteiro) => {
    setSelected(roteiro);
    setDeleteOpen(true);
  };

  const filteredRoteiros = roteiros.filter(r => {
    if (filters.dia && r.dia_semana !== filters.dia) return false;
    if (filters.vendedor && r.vendedor_id !== filters.vendedor) return false;
    if (filters.busca) {
      const busca = filters.busca.toLowerCase();
      return r.vendedor_nome?.toLowerCase().includes(busca) ||
             r.dia_semana?.toLowerCase().includes(busca);
    }
    return true;
  });

  const getDiaLabel = (dia) => {
    const labels = {
      'segunda-feira': 'Segunda-feira',
      'terca-feira': 'Terça-feira',
      'quarta-feira': 'Quarta-feira',
      'quinta-feira': 'Quinta-feira',
      'sexta-feira': 'Sexta-feira',
      'sabado': 'Sábado',
      'domingo': 'Domingo'
    };
    return labels[dia] || dia;
  };

  const getStatusBadge = (status) => {
    const config = {
      planejado: { className: 'bg-blue-100 text-blue-700', label: 'Planejado' },
      ativo: { className: 'bg-green-100 text-green-700', label: 'Ativo' },
      pausado: { className: 'bg-yellow-100 text-yellow-700', label: 'Pausado' },
      concluido: { className: 'bg-slate-100 text-slate-700', label: 'Concluído' }
    };
    const { className, label } = config[status] || config.planejado;
    return <Badge className={className}>{label}</Badge>;
  };

  return (
    <div>
      <PageHeader 
        title="Gestão de Roteiros" 
        subtitle="Planejamento de visitas e rotas de vendedores"
        icon={Route}
      />

      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-2">
          <Button
            onClick={handleExport}
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar Roteiros ({roteiros.length})
          </Button>
        </div>
        <Button
          onClick={() => {
            setSelected(null);
            setIsEditing(true);
            setCreateModalOpen(true);
          }}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          Novo Roteiro
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[800px] grid-cols-4 mb-6">
          <TabsTrigger value="busca">Busca de Roteiros</TabsTrigger>
          <TabsTrigger value="importar">Criação em Massa</TabsTrigger>
          <TabsTrigger value="pendentes">Clientes Pendentes</TabsTrigger>
          <TabsTrigger value="visualizar">Visualizar Roteiro</TabsTrigger>
        </TabsList>

        <TabsContent value="busca" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5" />
                Filtros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Filtrar por dia</Label>
                  <Select value={filters.dia} onValueChange={(v) => setFilters({...filters, dia: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os dias" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>Todos os dias</SelectItem>
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
                  <Select value={filters.vendedor} onValueChange={(v) => setFilters({...filters, vendedor: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Todos os funcionários" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>Todos os funcionários</SelectItem>
                      {vendedores.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Buscar</Label>
                  <Input
                    placeholder="Buscar roteiro..."
                    value={filters.busca}
                    onChange={(e) => setFilters({...filters, busca: e.target.value})}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Roteiros Encontrados ({filteredRoteiros.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia da Semana</TableHead>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>IDs de Depuração</TableHead>
                    <TableHead>Clientes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell>
                    </TableRow>
                  ) : filteredRoteiros.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                        Nenhum roteiro encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRoteiros.map((roteiro) => (
                      <TableRow key={roteiro.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium">{getDiaLabel(roteiro.dia_semana)}</TableCell>
                        <TableCell>{roteiro.vendedor_nome}</TableCell>
                        <TableCell className="text-xs text-slate-500">
                          <div>Func ID: {roteiro.vendedor_id?.substring(0, 20)}...</div>
                          <div>Roteiro User ID: {roteiro.created_by || 'N/A'}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{roteiro.clientes_ids?.length || 0} clientes</Badge>
                        </TableCell>
                        <TableCell>{getStatusBadge(roteiro.status)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleView(roteiro)}>
                                <Eye className="w-4 h-4 mr-2" />
                                Visualizar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(roteiro)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(roteiro)} className="text-red-600">
                                <Trash2 className="w-4 h-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
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

        <TabsContent value="importar" className="space-y-6">
          <ImportarTab />
        </TabsContent>

        <TabsContent value="pendentes" className="space-y-6">
          <LogClientesNaoCadastrados />
        </TabsContent>

        <TabsContent value="visualizar">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-slate-500">
                Selecione um roteiro na aba "Busca de Roteiros" e clique em "Visualizar"
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CriarRoteiroModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        roteiro={selected}
        isEditing={isEditing}
      />

      <VisualizarRoteiroModal
        open={viewModalOpen}
        onOpenChange={setViewModalOpen}
        roteiro={selected}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function ImportarTab() {
  const [importData, setImportData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importMode, setImportMode] = useState('paste'); // 'paste' ou 'file'
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const handleDownloadTemplate = () => {
    const headers = ['cod_cliente', 'funcionario', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
    const exampleRows = [
      ['CLI001', 'João Silva', 'sim', '', 'sim', '', 'sim', '', ''],
      ['CLI002', 'Maria Santos', '', 'sim', '', 'sim', '', '', ''],
      ['CLI003', 'João Silva', 'sim', 'sim', 'sim', 'sim', 'sim', '', '']
    ];
    
    const csvContent = [
      headers.join(';'),
      ...exampleRows.map(row => row.join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao_roteiros.csv';
    link.click();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImportData(event.target.result);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importData.trim()) {
      alert('Cole os dados ou faça upload de um arquivo para importar');
      return;
    }

    setIsImporting(true);
    try {
      const lines = importData.split('\n').filter(l => l.trim());
      const headers = lines[0].split(/[;\t,]/).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      
      // Validar cabeçalho
      if (!headers.includes('cod_cliente') && !headers.includes('cod')) {
        alert('Formato inválido: falta a coluna "cod_cliente" ou "cod"');
        setIsImporting(false);
        return;
      }

      const codColumn = headers.includes('cod_cliente') ? 'cod_cliente' : 'cod';
      const hasFuncionarioColumn = headers.includes('funcionario');

      const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
      const diasMap = {
        'segunda': 'segunda-feira',
        'terca': 'terca-feira',
        'quarta': 'quarta-feira',
        'quinta': 'quinta-feira',
        'sexta': 'sexta-feira',
        'sabado': 'sabado',
        'domingo': 'domingo'
      };

      // Processar dados
      const roteirosMap = new Map();
      const erros = [];
      const clientesNaoEncontrados = new Map(); // codigo -> { funcionario, dias }

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(/[;\t,]/).map(v => v.trim().replace(/['"]/g, ''));
        const row = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx]?.trim() || '';
        });

        const codigo = row[codColumn];
        if (!codigo) continue;

        const cliente = clientes.find(c => c.codigo === codigo);
        if (!cliente) {
          // Registrar cliente não encontrado com seus dias e funcionário
          if (!clientesNaoEncontrados.has(codigo)) {
            clientesNaoEncontrados.set(codigo, {
              funcionario: row.funcionario || '',
              funcionario_id: null,
              dias: []
            });
          }
          // Identificar quais dias estavam marcados
          const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
          dias.forEach(dia => {
            const valor = row[dia]?.toLowerCase();
            if (valor === 'sim' || valor === 's' || valor === 'x' || valor === '1') {
              if (!clientesNaoEncontrados.get(codigo).dias.includes(dia)) {
                clientesNaoEncontrados.get(codigo).dias.push(dia);
              }
            }
          });
          // Buscar ID do funcionário
          if (row.funcionario) {
            const func = vendedores.find(v => v.nome?.toLowerCase().trim() === row.funcionario.toLowerCase().trim());
            if (func) {
              clientesNaoEncontrados.get(codigo).funcionario_id = func.id;
            }
          }
          erros.push(`Linha ${i + 1}: Cliente com código "${codigo}" não encontrado`);
          continue;
        }

        // Determinar o funcionário responsável
        let vendedorId = null;
        let vendedorNome = null;

        if (hasFuncionarioColumn && row.funcionario) {
          // Buscar funcionário pelo nome informado
          const funcionario = vendedores.find(v => 
            v.nome?.toLowerCase().trim() === row.funcionario.toLowerCase().trim()
          );
          if (funcionario) {
            vendedorId = funcionario.id;
            vendedorNome = funcionario.nome;
          } else {
            erros.push(`Linha ${i + 1}: Funcionário "${row.funcionario}" não encontrado`);
            continue;
          }
        } else {
          // Usar o vendedor do cliente como fallback
          vendedorId = cliente.vendedor_id;
          const vendedor = vendedores.find(v => v.id === vendedorId);
          vendedorNome = vendedor?.nome || 'N/A';
        }

        if (!vendedorId) {
          erros.push(`Linha ${i + 1}: Cliente "${codigo}" sem funcionário associado`);
          continue;
        }

        // Para cada dia da semana
        dias.forEach(dia => {
          const valor = row[dia]?.toLowerCase();
          if (valor === 'sim' || valor === 's' || valor === 'x' || valor === '1') {
            const diaCompleto = diasMap[dia];

            const key = `${vendedorId}-${diaCompleto}`;
            if (!roteirosMap.has(key)) {
              roteirosMap.set(key, {
                vendedor_id: vendedorId,
                vendedor_nome: vendedorNome,
                dia_semana: diaCompleto,
                clientes: []
              });
            }
            
            roteirosMap.get(key).clientes.push(cliente);
          }
        });
      }

      // Salvar logs de clientes não cadastrados
      if (clientesNaoEncontrados.size > 0) {
        const logsParaCriar = [];
        for (const [codigo, data] of clientesNaoEncontrados.entries()) {
          if (data.dias.length > 0) {
            logsParaCriar.push({
              codigo_cliente: codigo,
              funcionario_nome: data.funcionario,
              funcionario_id: data.funcionario_id,
              dias_semana: data.dias,
              status: 'pendente'
            });
          }
        }
        if (logsParaCriar.length > 0) {
          await base44.entities.LogClienteNaoCadastrado.bulkCreate(logsParaCriar);
          queryClient.invalidateQueries(['logsClientesNaoCadastrados']);
        }
      }

      if (erros.length > 0 && roteirosMap.size === 0) {
        alert('Erros encontrados:\n' + erros.slice(0, 10).join('\n') + (erros.length > 10 ? `\n... e mais ${erros.length - 10} erros` : '') + '\n\nOs clientes não cadastrados foram salvos no log.');
        setIsImporting(false);
        return;
      }

      // Criar roteiros em massa
      const roteirosParaCriar = [];
      for (const [key, data] of roteirosMap.entries()) {
        roteirosParaCriar.push({
          vendedor_id: data.vendedor_id,
          vendedor_nome: data.vendedor_nome,
          dia_semana: data.dia_semana,
          clientes_ids: data.clientes.map(c => c.id),
          clientes_detalhes: data.clientes.map((c, idx) => ({
            cliente_id: c.id,
            cliente_nome: c.razao_social || c.nome_fantasia,
            cliente_codigo: c.codigo,
            cliente_cidade: c.cidade,
            ordem: idx + 1
          })),
          status: 'planejado'
        });
      }

      if (roteirosParaCriar.length > 0) {
        await base44.entities.Roteiro.bulkCreate(roteirosParaCriar);
      }

      queryClient.invalidateQueries(['roteiros']);
      
      let msg = `✅ ${roteirosParaCriar.length} roteiros criados com sucesso!`;
      if (clientesNaoEncontrados.size > 0) {
        msg += `\n\n⚠️ ${clientesNaoEncontrados.size} cliente(s) não cadastrado(s) foram salvos no log.`;
      }
      if (erros.length > clientesNaoEncontrados.size) {
        msg += `\n\n⚠️ ${erros.length - clientesNaoEncontrados.size} outras linhas com erros foram ignoradas.`;
      }
      alert(msg);
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
          <Button
            onClick={handleDownloadTemplate}
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            <Download className="w-4 h-4 mr-2" />
            Baixar Modelo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="font-semibold text-amber-900 mb-2">Formato Esperado</h3>
          <p className="text-sm text-amber-800 mb-2">
            A primeira linha deve ser o cabeçalho com as seguintes colunas:
          </p>
          <p className="font-mono text-sm bg-white p-2 rounded border mb-2">
            cod_cliente | funcionario | segunda | terca | quarta | quinta | sexta | sabado | domingo
          </p>
          <ul className="text-sm text-amber-800 list-disc list-inside space-y-1">
            <li><strong>cod_cliente:</strong> Código do cliente (obrigatório)</li>
            <li><strong>funcionario:</strong> Nome do funcionário responsável (promotor ou vendedor)</li>
            <li><strong>Dias:</strong> Use "sim", "s", "x" ou "1" para indicar atendimento no dia</li>
          </ul>
          <p className="text-sm text-amber-700 mt-2 italic">
            💡 Um mesmo cliente pode ter roteiros diferentes para promotor e vendedor!
          </p>
        </div>

        <div className="flex gap-4">
          <Button
            variant={importMode === 'paste' ? 'default' : 'outline'}
            onClick={() => setImportMode('paste')}
            className={importMode === 'paste' ? 'bg-amber-500 hover:bg-amber-600' : ''}
          >
            Colar Dados
          </Button>
          <Button
            variant={importMode === 'file' ? 'default' : 'outline'}
            onClick={() => setImportMode('file')}
            className={importMode === 'file' ? 'bg-amber-500 hover:bg-amber-600' : ''}
          >
            Upload de Arquivo
          </Button>
        </div>

        {importMode === 'file' ? (
          <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-12 h-12 mx-auto text-amber-400 mb-2" />
              <p className="text-amber-700 font-medium">Clique para selecionar um arquivo</p>
              <p className="text-sm text-amber-500">CSV, TXT ou Excel</p>
            </label>
            {importData && (
              <p className="mt-4 text-green-600 font-medium">✓ Arquivo carregado com sucesso!</p>
            )}
          </div>
        ) : (
          <div>
            <Label>Cole os dados aqui (copie do Excel e cole)...</Label>
            <Textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder="cod_cliente;funcionario;segunda;terca;quarta;quinta;sexta;sabado;domingo"
              rows={12}
              className="font-mono text-sm"
            />
          </div>
        )}

        <Button
          onClick={handleImport}
          disabled={isImporting || !importData.trim()}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600"
        >
          <Upload className="w-4 h-4 mr-2" />
          {isImporting ? 'Importando...' : 'Importar Roteiros'}
        </Button>
      </CardContent>
    </Card>
  );
}