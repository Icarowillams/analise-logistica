import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Users, CheckCircle, XCircle, Upload, List, Ban, Save, Send } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import ExportarVendedoresOmieModal from '@/components/funcionarios/ExportarVendedoresOmieModal';
import FuncionariosConsulta from '@/components/funcionarios/FuncionariosConsulta';
import { useOmiePermissao } from '@/components/hooks/useOmiePermissao';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Funcionarios() {
  const podeOmie = useOmiePermissao();
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exportarOmieOpen, setExportarOmieOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [consultaFilters, setConsultaFilters] = useState({
    search: '', funcao: '', departamento_id: '', supervisor_id: '', status: ''
  });
  const [formData, setFormData] = useState({
    nome: '', 
    cpf: '', 
    email: '', 
    funcao: '', 
    departamento_id: '',
    supervisor_id: '',
    supervisor_ids: [],
    telefone: '',
    latitude: '',
    longitude: '',
    status: 'ativo'
  });

  const queryClient = useQueryClient();

  const { data: funcionarios = [], isLoading } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: departamentos = [] } = useQuery({
    queryKey: ['departamentos'],
    queryFn: () => base44.entities.Departamento.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Vendedor.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Funcionário criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar funcionário: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Vendedor.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Funcionário atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar funcionário: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Vendedor.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['vendedores']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ 
      nome: '', 
      cpf: '', 
      email: '', 
      funcao: '', 
      departamento_id: '',
      supervisor_id: '',
      supervisor_ids: [],
      telefone: '',
      latitude: '',
      longitude: '',
      status: 'ativo' 
    });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    // Migrar supervisor_id legado para supervisor_ids se necessário
    let supervisorIds = item.supervisor_ids || [];
    if (supervisorIds.length === 0 && item.supervisor_id) {
      supervisorIds = [item.supervisor_id];
    }
    setFormData({
      nome: item.nome || '',
      cpf: item.cpf || '',
      email: item.email || '',
      funcao: item.funcao || '',
      departamento_id: item.departamento_id || '',
      supervisor_id: item.supervisor_id || '',
      supervisor_ids: supervisorIds,
      telefone: item.telefone || '',
      latitude: item.latitude || '',
      longitude: item.longitude || '',
      status: item.status || 'ativo'
    });
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const handleDelete = (item) => {
    setSelected(item);
    setDeleteOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Preparar dados convertendo latitude e longitude
    const dataToSave = { ...formData };
    
    // Converter latitude para número ou null
    if (dataToSave.latitude === '' || dataToSave.latitude === null) {
      dataToSave.latitude = null;
    } else {
      dataToSave.latitude = parseFloat(dataToSave.latitude);
      if (isNaN(dataToSave.latitude)) {
        toast.error('❌ Latitude deve ser um número válido.');
        return;
      }
    }
    
    // Converter longitude para número ou null
    if (dataToSave.longitude === '' || dataToSave.longitude === null) {
      dataToSave.longitude = null;
    } else {
      dataToSave.longitude = parseFloat(dataToSave.longitude);
      if (isNaN(dataToSave.longitude)) {
        toast.error('❌ Longitude deve ser um número válido.');
        return;
      }
    }
    
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    for (const item of data) {
      await base44.entities.Vendedor.create({
        ...item,
        status: item.status || 'ativo'
      });
    }
    queryClient.invalidateQueries(['vendedores']);
    setIsImporting(false);
    setBulkOpen(false);
  };

  const getSupervisorNames = (item) => {
    const ids = item.supervisor_ids?.length > 0 ? item.supervisor_ids : (item.supervisor_id ? [item.supervisor_id] : []);
    if (ids.length === 0) return '-';
    return ids.map(id => {
      const sup = funcionarios.find(f => f.id === id);
      return sup?.nome || '-';
    }).join(', ');
  };

  const getDepartmentName = (id) => {
    if (!id) return '-';
    const dept = departamentos.find(d => d.id === id);
    return dept ? dept.nome : '-';
  };

  const bulkColumns = [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'cpf', label: 'CPF' },
    { key: 'email', label: 'Email', required: true },
    { key: 'funcao', label: 'Função' },
    { key: 'departamento_id', label: 'ID Departamento' },
    { key: 'supervisor_id', label: 'ID Supervisor' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { nome: 'João Silva', cpf: '123.456.789-00', email: 'joao@empresa.com', funcao: 'Vendedor', supervisor_id: '', status: 'ativo' },
    { nome: 'Maria Santos', cpf: '987.654.321-00', email: 'maria@empresa.com', funcao: 'Gerente', supervisor_id: '', status: 'ativo' }
  ];

  const columns = [
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'cpf', label: 'CPF' },
    { key: 'email', label: 'Email' },
    { key: 'funcao', label: 'Função' },
    { key: 'departamento_id', label: 'Departamento', render: (val) => getDepartmentName(val) },
    { 
      key: 'supervisor_ids', 
      label: 'Supervisor(es)',
      render: (val, row) => getSupervisorNames(row)
    },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' 
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200' 
          : 'bg-slate-100 text-slate-600 border-slate-200'
        }>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  // Filter for supervisors: exclude self AND check for 'supervisor' or 'gerente' in function name
  const potentialSupervisors = funcionarios.filter(f => 
    f.id !== selected?.id && 
    (f.funcao?.toLowerCase().includes('supervisor') || f.funcao?.toLowerCase().includes('gerente'))
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader 
          title="Funcionários" 
          subtitle="Gerencie sua equipe"
          icon={Users}
        />
        <div className="flex gap-2">
          {podeOmie && (
            <Button
              onClick={() => setExportarOmieOpen(true)}
              variant="outline"
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              <Send className="w-4 h-4 mr-2" />
              Exportar Omie
            </Button>
          )}
          <Button
            onClick={() => setBulkOpen(true)}
            variant="outline"
            className="border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            Importar em Massa
          </Button>
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
          >
            Novo Funcionário
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Cadastro
          </TabsTrigger>
          <TabsTrigger value="consulta" className="flex items-center gap-2">
            <List className="w-4 h-4" />
            Consulta
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="cadastro" className="space-y-6 animate-in fade-in-50 duration-300">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">
                {selected ? 'Editar Funcionário' : 'Novo Funcionário'}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Nome *</Label>
                  <Input
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>CPF</Label>
                  <Input
                    value={formData.cpf}
                    onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                    placeholder="000.000.000-00"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Função</Label>
                  <Select 
                    value={formData.funcao} 
                    onValueChange={(v) => setFormData({ ...formData, funcao: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a função..." />
                    </SelectTrigger>
                    <SelectContent>
                      {funcoes.map(f => (
                        <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Departamento</Label>
                  <Select 
                    value={formData.departamento_id} 
                    onValueChange={(v) => setFormData({ ...formData, departamento_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o departamento..." />
                    </SelectTrigger>
                    <SelectContent>
                      {departamentos.map(d => (
                        <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>Supervisores</Label>
                  {isEditing ? (
                    <div className="space-y-2">
                      <Select 
                        value=""
                        onValueChange={(v) => {
                          if (v && !formData.supervisor_ids.includes(v)) {
                            const newIds = [...formData.supervisor_ids, v];
                            setFormData({ ...formData, supervisor_ids: newIds, supervisor_id: newIds[0] || '' });
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Adicionar supervisor..." />
                        </SelectTrigger>
                        <SelectContent>
                          {potentialSupervisors
                            .filter(s => !formData.supervisor_ids.includes(s.id))
                            .map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {formData.supervisor_ids.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {formData.supervisor_ids.map(sid => {
                            const sup = funcionarios.find(f => f.id === sid);
                            return (
                              <Badge key={sid} className="bg-amber-100 text-amber-800 border-amber-200 gap-1 pr-1">
                                {sup?.nome || sid}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newIds = formData.supervisor_ids.filter(id => id !== sid);
                                    setFormData({ ...formData, supervisor_ids: newIds, supervisor_id: newIds[0] || '' });
                                  }}
                                  className="ml-1 hover:bg-amber-200 rounded-full p-0.5"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-1 min-h-[36px] items-center">
                      {(formData.supervisor_ids?.length > 0 ? formData.supervisor_ids : (formData.supervisor_id ? [formData.supervisor_id] : [])).map(sid => {
                        const sup = funcionarios.find(f => f.id === sid);
                        return (
                          <Badge key={sid} variant="outline" className="bg-slate-50">
                            {sup?.nome || sid}
                          </Badge>
                        );
                      })}
                      {(!formData.supervisor_ids || formData.supervisor_ids.length === 0) && !formData.supervisor_id && (
                        <span className="text-sm text-slate-400">Nenhum supervisor</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <Label>Telefone</Label>
                  <Input
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    placeholder="-23.5505"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    step="any"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    placeholder="-46.6333"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isEditing && (
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <Button type="button" variant="outline" onClick={handleCancel}>
                    <Ban className="w-4 h-4 mr-2" />
                    Cancelar
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </TabsContent>
        
        <TabsContent value="consulta" className="animate-in fade-in-50 duration-300">
          <DataTable
            data={funcionarios}
            columns={columns}
            searchFields={['nome', 'email', 'cpf', 'funcao']}
            pageSize={1000}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isLoading={isLoading}
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />

      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Funcionários em Massa"
        description="Importe vários funcionários de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />

      <ExportarVendedoresOmieModal
        open={exportarOmieOpen}
        onOpenChange={setExportarOmieOpen}
      />
    </div>
  );
}