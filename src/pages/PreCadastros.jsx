import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { UserPlus, Save, Ban, Pencil, Trash2, Search, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { validarDocumento, formatarDocumento, formatarCEP } from '@/components/clientes/validarCpfCnpj';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';

const INITIAL_FORM = {
  codigo: '',
  razao_social: '', nome_fantasia: '', cpf_cnpj: '', email: '',
  endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
  segmento_id: '', vendedor_id: '', supervisor_id: '',
};

export default function PreCadastros() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [supervisorNome, setSupervisorNome] = useState('');
  const [docErro, setDocErro] = useState('');
  const [search, setSearch] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-precadastro'],
    queryFn: () => base44.entities.Cliente.filter({ pre_cadastro: true })
  });

  const reservarCodigoCliente = async () => {
    const response = await base44.functions.invoke('reservarCodigoCliente', {});
    return response.data?.codigo || '';
  };

  // Detect current user and auto-fill vendedor
  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
    }).catch(() => {});
  }, []);

  const funcionarioAtual = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());

  // Auto-fill vendedor when starting new form
  useEffect(() => {
    if (isEditing && !selected && !formData.codigo) {
      reservarCodigoCliente().then((codigoReservado) => {
        setFormData(prev => ({
          ...prev,
          codigo: codigoReservado,
          vendedor_id: funcionarioAtual?.id || prev.vendedor_id
        }));
      });
      if (funcionarioAtual?.supervisor_id) {
        const sup = vendedores.find(v => v.id === funcionarioAtual.supervisor_id);
        setSupervisorNome(sup?.nome || '');
      }
    }
  }, [isEditing, selected, funcionarioAtual, vendedores, formData.codigo]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes-precadastro']);
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      toast.success('Pré-cadastro salvo com sucesso!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Cliente.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes-precadastro']);
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      toast.success('Pré-cadastro atualizado!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cliente.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes-precadastro']);
      queryClient.invalidateQueries(['clientes']);
      setDeleteOpen(false);
      setSelected(null);
      toast.success('Pré-cadastro excluído!');
    }
  });

  const resetForm = () => {
    setFormData(INITIAL_FORM);
    setSupervisorNome('');
    setDocErro('');
    setSelected(null);
    setIsEditing(false);
  };

  const handleNew = () => {
    resetForm();
    setIsEditing(true);
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      codigo: item.codigo || '',
      razao_social: item.razao_social || '',
      nome_fantasia: item.nome_fantasia || '',
      cpf_cnpj: item.cpf_cnpj || '',
      email: item.email || '',
      endereco: item.endereco || '',
      numero: item.numero || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      estado: item.estado || '',
      cep: item.cep || '',
      segmento_id: item.segmento_id || '',
      vendedor_id: item.vendedor_id || '',
      supervisor_id: item.supervisor_id || '',
    });
    if (item.vendedor_id) {
      const vend = vendedores.find(v => v.id === item.vendedor_id);
      if (vend?.supervisor_id) {
        const sup = vendedores.find(v => v.id === vend.supervisor_id);
        setSupervisorNome(sup?.nome || '');
      } else {
        setSupervisorNome('');
      }
    }
    setIsEditing(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const requiredFields = [
      { key: 'razao_social', label: 'Razão Social' },
      { key: 'nome_fantasia', label: 'Nome Fantasia' },
      { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
      { key: 'segmento_id', label: 'Segmento' },
      { key: 'endereco', label: 'Endereço' },
      { key: 'numero', label: 'Número' },
      { key: 'bairro', label: 'Bairro' },
      { key: 'cidade', label: 'Cidade' },
      { key: 'estado', label: 'Estado' },
      { key: 'cep', label: 'CEP' },
    ];
    for (const f of requiredFields) {
      if (!formData[f.key]?.trim()) {
        toast.error(`${f.label} é obrigatório(a)`);
        return;
      }
    }

    const docLimpo = formData.cpf_cnpj.replace(/\D/g, '');
    if (docLimpo.length > 0) {
      const resultado = validarDocumento(docLimpo);
      if (!resultado.valido) {
        setDocErro(resultado.erro);
        toast.error(resultado.erro);
        return;
      }
    }

    let dataToSave = { ...formData, codigo: formData.codigo };
    dataToSave.status = 'inativo';
    dataToSave.pre_cadastro = true;

    // Normalize
    if (dataToSave.cpf_cnpj) dataToSave.cpf_cnpj = dataToSave.cpf_cnpj.replace(/\D/g, '');
    if (dataToSave.estado) dataToSave.estado = dataToSave.estado.trim().toUpperCase().substring(0, 2);
    if (dataToSave.cep) dataToSave.cep = dataToSave.cep.replace(/\D/g, '').substring(0, 8);
    if (dataToSave.razao_social) dataToSave.razao_social = dataToSave.razao_social.trim().substring(0, 60);
    if (dataToSave.nome_fantasia) dataToSave.nome_fantasia = dataToSave.nome_fantasia.trim().substring(0, 100);

    // Supervisor
    if (dataToSave.vendedor_id) {
      const vend = vendedores.find(v => v.id === dataToSave.vendedor_id);
      if (vend?.supervisor_id) dataToSave.supervisor_id = vend.supervisor_id;
    }

    if (selected) {
      updateMutation.mutate({ id: selected.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  // Filter pre-cadastros created by current user's vendedor, or all for admin
  const preCadastros = clientes.filter(c => {
    // Only show clients that were likely pre-cadastros (no codigo, inativo)
    const matchSearch = !search.trim() ||
      c.razao_social?.toLowerCase().includes(search.toLowerCase()) ||
      c.nome_fantasia?.toLowerCase().includes(search.toLowerCase()) ||
      c.cpf_cnpj?.includes(search);
    return matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <UserPlus className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Pré-Cadastros</h1>
            <p className="text-neutral-500 mt-0.5">Cadastro simplificado de clientes (status inativo)</p>
          </div>
        </div>
        <Button onClick={handleNew} className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold shadow-lg">
          <UserPlus className="w-4 h-4 mr-2" />
          Novo Pré-Cadastro
        </Button>
      </div>

      {/* Form */}
      {isEditing && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <h2 className="text-lg font-semibold">{selected ? 'Editar Pré-Cadastro' : 'Novo Pré-Cadastro'}</h2>
              <Badge className="bg-red-100 text-red-700 border-red-200">Inativo</Badge>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Código</Label>
                  <Input value={formData.codigo} disabled placeholder="Gerado automaticamente" className="bg-slate-50" />
                </div>
                <div>
                  <Label>Razão Social *</Label>
                  <Input value={formData.razao_social} onChange={e => setFormData({ ...formData, razao_social: e.target.value })} required />
                </div>
                <div>
                  <Label>Nome Fantasia *</Label>
                  <Input value={formData.nome_fantasia} onChange={e => setFormData({ ...formData, nome_fantasia: e.target.value })} required />
                </div>
                <div>
                  <Label>CPF/CNPJ *</Label>
                  <Input
                    value={formData.cpf_cnpj}
                    onChange={e => {
                      const formatado = formatarDocumento(e.target.value);
                      setFormData({ ...formData, cpf_cnpj: formatado });
                      const limpo = e.target.value.replace(/\D/g, '');
                      if (limpo.length === 11 || limpo.length === 14) {
                        const res = validarDocumento(limpo);
                        setDocErro(res.valido ? '' : res.erro);
                      } else {
                        setDocErro('');
                      }
                    }}
                    placeholder="000.000.000-00 ou 00.000.000/0001-00"
                    required
                    className={docErro ? 'border-red-500' : ''}
                  />
                  {docErro && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {docErro}</p>}
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div>
                  <Label>Segmento *</Label>
                  <Select value={formData.segmento_id || '_none_'} onValueChange={v => setFormData({ ...formData, segmento_id: v === '_none_' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">Nenhum</SelectItem>
                      {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vendedor (automático)</Label>
                  <Input value={funcionarioAtual?.nome || formData.vendedor_id ? vendedores.find(v => v.id === formData.vendedor_id)?.nome || '' : ''} disabled className="bg-slate-50" />
                </div>
                <div>
                  <Label>Supervisor (automático)</Label>
                  <Input value={supervisorNome} disabled className="bg-slate-50" />
                </div>
              </div>

              {/* Endereço */}
              <div className="pt-2 border-t">
                <p className="text-sm font-medium text-slate-600 mb-3">Endereço</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label>Endereço *</Label>
                    <Textarea value={formData.endereco} onChange={e => setFormData({ ...formData, endereco: e.target.value })} rows={2} required />
                  </div>
                  <div>
                    <Label>Número *</Label>
                    <Input value={formData.numero} onChange={e => setFormData({ ...formData, numero: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Bairro *</Label>
                    <Input value={formData.bairro} onChange={e => setFormData({ ...formData, bairro: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Cidade *</Label>
                    <Input value={formData.cidade} onChange={e => setFormData({ ...formData, cidade: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Estado (UF) *</Label>
                    <Select value={formData.estado || '_none_'} onValueChange={v => setFormData({ ...formData, estado: v === '_none_' ? '' : v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none_">Nenhum</SelectItem>
                        {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                          <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>CEP *</Label>
                    <Input value={formData.cep} onChange={e => setFormData({ ...formData, cep: formatarCEP(e.target.value) })} placeholder="00000-000" required />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={resetForm}>
                  <Ban className="w-4 h-4 mr-2" /> Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Save className="w-4 h-4 mr-2" />
                  {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar Pré-Cadastro'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-700">Pré-Cadastros (Inativos)</h3>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-8 text-sm" />
            </div>
          </div>

          {preCadastros.length === 0 ? (
            <p className="text-center text-slate-400 py-8">Nenhum pré-cadastro encontrado</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {preCadastros.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border hover:border-blue-300 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{c.razao_social}</p>
                    <p className="text-xs text-slate-500">
                      {c.nome_fantasia ? `${c.nome_fantasia} • ` : ''}{c.cpf_cnpj || 'Sem doc.'} • {c.cidade || 'Sem cidade'}/{c.estado || ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Badge className="bg-red-100 text-red-600 border-red-200 text-[10px]">Inativo</Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(c)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => { setSelected(c); setDeleteOpen(true); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}