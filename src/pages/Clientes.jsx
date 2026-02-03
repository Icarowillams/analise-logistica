import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Building2, CheckCircle, XCircle, Clock, Upload, Download, Users, List, Save, Ban } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import BulkImportModal from '@/components/forms/BulkImportModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClienteConsulta from '@/components/clientes/ClienteConsulta';

export default function Clientes() {
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    codigo: '', razao_social: '', nome_fantasia: '', cpf_cnpj: '',
    endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
    latitude: '', longitude: '',
    segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', tabela_id: '',
    data_primeiro_contato: '', status: 'ativo'
  });
  const [supervisorNome, setSupervisorNome] = useState('');

  const queryClient = useQueryClient();

  // Capturar código da URL se vier do redirecionamento
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigoParam = params.get('codigo');
    
    if (codigoParam) {
      setFormData(prev => ({ ...prev, codigo: codigoParam }));
      setIsEditing(true);
      setActiveTab('cadastro');
    }
  }, []);

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: planosPagamento = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list()
  });

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Cliente.create(data),
    onSuccess: (novoCliente) => {
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Cliente criado com sucesso!');
      
      // Processar trocas em segundo plano
      processarTrocasSemCadastro(novoCliente).catch(err => {
        console.error('Erro ao processar trocas:', err);
      });
      
      // Processar logs de clientes não cadastrados (roteiros)
      processarLogsRoteiros(novoCliente).catch(err => {
        console.error('Erro ao processar logs de roteiros:', err);
      });
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar cliente: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Cliente.update(id, data),
    onSuccess: (clienteAtualizado) => {
      queryClient.invalidateQueries(['clientes']);
      resetForm();
      setIsEditing(false);
      toast.success('✅ Cliente atualizado com sucesso!');
      
      // Processar trocas em segundo plano
      processarTrocasSemCadastro(clienteAtualizado).catch(err => {
        console.error('Erro ao processar trocas:', err);
      });
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar cliente: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Cliente.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['clientes']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const processarLogsRoteiros = async (cliente) => {
    try {
      // Buscar logs pendentes com o código deste cliente
      const logs = await base44.entities.LogClienteNaoCadastrado.filter({ 
        codigo_cliente: cliente.codigo,
        status: 'pendente' 
      });

      if (logs.length === 0) return;

      const roteiros = await base44.entities.Roteiro.list();
      const diasMap = {
        'segunda': 'segunda-feira',
        'terca': 'terca-feira',
        'quarta': 'quarta-feira',
        'quinta': 'quinta-feira',
        'sexta': 'sexta-feira',
        'sabado': 'sabado',
        'domingo': 'domingo'
      };

      let totalAdicionados = 0;

      for (const log of logs) {
        for (const dia of log.dias_semana || []) {
          const diaCompleto = diasMap[dia] || dia;
          
          // Buscar roteiro existente do funcionário para este dia
          const roteiroExistente = roteiros.find(r => 
            r.vendedor_id === log.funcionario_id && 
            r.dia_semana === diaCompleto
          );

          if (roteiroExistente) {
            // Verificar se o cliente já não está no roteiro
            if (!roteiroExistente.clientes_ids?.includes(cliente.id)) {
              const novosClientesIds = [...(roteiroExistente.clientes_ids || []), cliente.id];
              const novosClientesDetalhes = [
                ...(roteiroExistente.clientes_detalhes || []),
                {
                  cliente_id: cliente.id,
                  cliente_nome: cliente.razao_social || cliente.nome_fantasia,
                  cliente_codigo: cliente.codigo,
                  cliente_cidade: cliente.cidade,
                  ordem: novosClientesIds.length
                }
              ];

              await base44.entities.Roteiro.update(roteiroExistente.id, {
                clientes_ids: novosClientesIds,
                clientes_detalhes: novosClientesDetalhes
              });
              totalAdicionados++;
            }
          } else if (log.funcionario_id) {
            // Criar novo roteiro para este funcionário/dia
            await base44.entities.Roteiro.create({
              vendedor_id: log.funcionario_id,
              vendedor_nome: log.funcionario_nome,
              dia_semana: diaCompleto,
              clientes_ids: [cliente.id],
              clientes_detalhes: [{
                cliente_id: cliente.id,
                cliente_nome: cliente.razao_social || cliente.nome_fantasia,
                cliente_codigo: cliente.codigo,
                cliente_cidade: cliente.cidade,
                ordem: 1
              }],
              status: 'planejado'
            });
            totalAdicionados++;
          }
        }

        // Marcar log como resolvido
        await base44.entities.LogClienteNaoCadastrado.update(log.id, {
          status: 'resolvido',
          cliente_id: cliente.id
        });
      }

      if (totalAdicionados > 0) {
        queryClient.invalidateQueries(['roteiros']);
        queryClient.invalidateQueries(['logsClientesNaoCadastrados']);
        toast.success(`Cliente adicionado automaticamente em ${totalAdicionados} roteiro(s)!`);
      }
    } catch (error) {
      console.error('Erro ao processar logs de roteiros:', error);
    }
  };

  const processarTrocasSemCadastro = async (cliente) => {
    try {
      // Buscar todas as trocas sem cliente cadastrado que tenham o código deste cliente
      const todasTrocas = await base44.entities.Troca.list('-data', 5000);
      const trocasParaAtualizar = todasTrocas.filter(t => 
        (!t.cliente_id || t.cliente_nome?.includes('Cliente Não Cadastrado')) &&
        t.cliente_nome?.includes(`Cliente Não Cadastrado: ${cliente.codigo}`)
      );

      if (trocasParaAtualizar.length > 0) {
        // Buscar vendedor para pegar o nome
        const vendedor = vendedores.find(v => v.id === cliente.vendedor_id);
        
        // Atualizar cada troca
        for (const troca of trocasParaAtualizar) {
          await base44.entities.Troca.update(troca.id, {
            cliente_id: cliente.id,
            cliente_nome: cliente.razao_social || cliente.nome_fantasia,
            vendedor_id: cliente.vendedor_id || '',
            vendedor_nome: vendedor?.nome || 'N/A'
          });
        }

        queryClient.invalidateQueries(['trocas']);
        queryClient.invalidateQueries(['trocas_nao_cadastradas']);

        toast.success(`${trocasParaAtualizar.length} troca(s) foram vinculadas automaticamente ao novo cliente.`);
      }
    } catch (error) {
      console.error('Erro ao processar trocas sem cadastro:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      codigo: '', razao_social: '', nome_fantasia: '', cpf_cnpj: '',
      endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
      latitude: '', longitude: '',
      segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', tabela_id: '',
      data_primeiro_contato: '', status: 'ativo'
    });
    setSupervisorNome('');
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setSelected(null);
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      codigo: item.codigo || '',
      razao_social: item.razao_social || '',
      nome_fantasia: item.nome_fantasia || '',
      cpf_cnpj: item.cpf_cnpj || item.cnpj || '',
      endereco: item.endereco || '',
      numero: item.numero || '',
      bairro: item.bairro || '',
      cidade: item.cidade || '',
      estado: item.estado || '',
      cep: item.cep || '',
      latitude: item.latitude || '',
      longitude: item.longitude || '',
      segmento_id: item.segmento_id || '',
      rede_id: item.rede_id || '',
      vendedor_id: item.vendedor_id || '',
      rota_id: item.rota_id || '',
      plano_pagamento_id: item.plano_pagamento_id || '',
      tabela_id: item.tabela_id || '',
      data_primeiro_contato: item.data_primeiro_contato || '',
      status: item.status || 'ativo'
    });
    // Buscar supervisor do vendedor
    if (item.vendedor_id) {
      const vendedor = vendedores.find(v => v.id === item.vendedor_id);
      if (vendedor && vendedor.supervisor_id) {
        const supervisor = vendedores.find(v => v.id === vendedor.supervisor_id);
        setSupervisorNome(supervisor ? supervisor.nome : '');
      } else {
        setSupervisorNome('');
      }
    } else {
      setSupervisorNome('');
    }
    setIsEditing(true);
    setActiveTab("cadastro");
  };

  const handleDelete = (item) => {
    setSelected(item);
    setDeleteOpen(true);
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Buscar supervisor_id do vendedor selecionado
    let dataToSave = { ...formData };
    if (formData.vendedor_id) {
      const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
      if (vendedor && vendedor.supervisor_id) {
        dataToSave.supervisor_id = vendedor.supervisor_id;
      }
    }
    
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
  };

  const handleBulkImport = async (data) => {
    // Validar campos importantes em branco
    const warnings = [];
    let emptyCodigoCount = 0;
    let emptyCidadeCount = 0;
    let emptyVendedorCount = 0;
    let emptySegmentoCount = 0;
    let emptyStatusCount = 0;

    data.forEach((item) => {
      if (!item.codigo || item.codigo.trim() === '') emptyCodigoCount++;
      if (!item.cidade || item.cidade.trim() === '') emptyCidadeCount++;
      if (!item.vendedor || item.vendedor.trim() === '') emptyVendedorCount++;
      if (!item.segmento || item.segmento.trim() === '') emptySegmentoCount++;
      if (!item.status || item.status.trim() === '') emptyStatusCount++;
    });

    if (emptyCodigoCount > 0) warnings.push(`${emptyCodigoCount} cliente(s) sem código`);
    if (emptyCidadeCount > 0) warnings.push(`${emptyCidadeCount} cliente(s) sem cidade`);
    if (emptyVendedorCount > 0) warnings.push(`${emptyVendedorCount} cliente(s) sem vendedor`);
    if (emptySegmentoCount > 0) warnings.push(`${emptySegmentoCount} cliente(s) sem segmento`);
    if (emptyStatusCount > 0) warnings.push(`${emptyStatusCount} cliente(s) sem status`);

    if (warnings.length > 0) {
      const confirmImport = window.confirm(
        `⚠️ ATENÇÃO: Campos importantes em branco detectados!\n\n${warnings.join('\n')}\n\nDeseja continuar mesmo assim?`
      );
      if (!confirmImport) return;
    }

    setIsImporting(true);
    
    // Buscar todos os clientes existentes para verificar duplicatas
    const existingClients = await base44.entities.Cliente.list();
    // Normalizar códigos (trim e lowercase) para garantir comparação correta
    const existingClientsMap = new Map(existingClients.map(c => [String(c.codigo || '').trim().toLowerCase(), c]));
    
    const findId = (list, name) => {
      if (!name) return null;
      const found = list.find(i => i.nome?.toLowerCase() === String(name).toLowerCase().trim());
      return found ? found.id : null;
    };

    const clientesData = data.map(item => {
      // Validate and normalize status
      const validStatuses = ['ativo', 'inativo', 'prospecto'];
      let normalizedStatus = 'ativo';
      if (item.status && typeof item.status === 'string') {
        const statusLower = item.status.toLowerCase().trim();
        if (validStatuses.includes(statusLower)) {
          normalizedStatus = statusLower;
        }
      }

      const vendedorId = findId(vendedores, item.vendedor);
      let supervisorId = null;
      
      // Buscar supervisor do vendedor
      if (vendedorId) {
        const vendedor = vendedores.find(v => v.id === vendedorId);
        if (vendedor && vendedor.supervisor_id) {
          supervisorId = vendedor.supervisor_id;
        }
      }

      // Converter latitude e longitude
      let lat = item.latitude;
      let lng = item.longitude;
      
      if (lat === '' || lat === null || lat === undefined) {
        lat = null;
      } else {
        lat = parseFloat(lat);
        if (isNaN(lat)) lat = null;
      }
      
      if (lng === '' || lng === null || lng === undefined) {
        lng = null;
      } else {
        lng = parseFloat(lng);
        if (isNaN(lng)) lng = null;
      }

      const clienteData = {
        ...item,
        latitude: lat,
        longitude: lng,
        plano_pagamento_id: findId(planosPagamento, item.plano_pagamento),
        tabela_id: findId(tabelas, item.tabela_preco),
        segmento_id: findId(segmentos, item.segmento),
        rede_id: findId(redes, item.rede),
        vendedor_id: vendedorId,
        supervisor_id: supervisorId,
        rota_id: findId(rotas, item.rota),
        status: normalizedStatus
      };

      // Remove temporary name fields
      delete clienteData.plano_pagamento;
      delete clienteData.tabela_preco;
      delete clienteData.segmento;
      delete clienteData.rede;
      delete clienteData.vendedor;
      delete clienteData.rota;

      return clienteData;
    });

    // Separar clientes para criar e atualizar
    const toCreate = [];
    const toUpdate = [];

    for (const clienteData of clientesData) {
      // Normalizar código para comparação
      const codigoNormalizado = String(clienteData.codigo || '').trim().toLowerCase();
      const existingClient = existingClientsMap.get(codigoNormalizado);
      if (existingClient) {
        toUpdate.push({ id: existingClient.id, data: clienteData });
      } else {
        toCreate.push(clienteData);
      }
    }

    console.log('Importação - Total no arquivo:', clientesData.length);
    console.log('Importação - Para criar:', toCreate.length);
    console.log('Importação - Para atualizar:', toUpdate.length);

    try {
      // Executar criações
      if (toCreate.length > 0) {
        await base44.entities.Cliente.bulkCreate(toCreate);
      }

      // Executar atualizações em massa (evita erro de rate limit)
      if (toUpdate.length > 0) {
        const updateData = toUpdate.map(item => ({
          id: item.id,
          ...item.data
        }));
        await base44.entities.Cliente.bulkUpdate(updateData);
      }
    } catch (error) {
      console.error('Erro na importação:', error);
      setIsImporting(false);
      toast.error('❌ Erro na importação: ' + error.message);
      return;
    }

    queryClient.invalidateQueries(['clientes']);
    setIsImporting(false);
    setBulkOpen(false);

    // Mensagem de sucesso
    const messages = [];
    if (toCreate.length > 0) messages.push(`${toCreate.length} novo(s) cliente(s) cadastrado(s)`);
    if (toUpdate.length > 0) messages.push(`${toUpdate.length} cliente(s) atualizado(s)`);
    toast.success(`✅ ${messages.join(' e ')}!`);
  };

  const bulkColumns = [
    { key: 'codigo', label: 'Código' },
    { key: 'razao_social', label: 'Razão Social', required: true },
    { key: 'nome_fantasia', label: 'Nome Fantasia' },
    { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
    { key: 'plano_pagamento', label: 'Plano Pagamento' },
    { key: 'tabela_preco', label: 'Tabela Preço' },
    { key: 'segmento', label: 'Segmento' },
    { key: 'rede', label: 'Rede' },
    { key: 'vendedor', label: 'Vendedor' },
    { key: 'rota', label: 'Rota' },
    { key: 'endereco', label: 'Endereço' },
    { key: 'numero', label: 'Número' },
    { key: 'bairro', label: 'Bairro' },
    { key: 'cidade', label: 'Cidade' },
    { key: 'estado', label: 'Estado' },
    { key: 'cep', label: 'CEP' },
    { key: 'latitude', label: 'Latitude', type: 'number' },
    { key: 'longitude', label: 'Longitude', type: 'number' },
    { key: 'status', label: 'Status' }
  ];

  const bulkExampleData = [
    { codigo: 'C001', razao_social: 'Empresa ABC Ltda', nome_fantasia: 'ABC Store', cpf_cnpj: '12.345.678/0001-90', tabela_preco: 'Tabela 1', vendedor: 'João Silva', cidade: 'São Paulo', estado: 'SP', latitude: '-23.5505', longitude: '-46.6333', status: 'ativo' },
    { codigo: 'C002', razao_social: 'Comércio XYZ', nome_fantasia: 'XYZ Shop', cpf_cnpj: '98.765.432/0001-10', segmento: 'Varejo', rede: 'Rede A', cidade: 'Campinas', estado: 'SP', latitude: '-22.9056', longitude: '-47.0608', status: 'ativo' }
  ];

  const handleExport = async (clientesFiltrados = null) => {
    let clientes = clientesFiltrados;
    if (!clientes || !Array.isArray(clientes)) {
      clientes = await base44.entities.Cliente.list();
    }
    
    const headers = [
      'codigo', 'razao_social', 'nome_fantasia', 'cpf_cnpj',
      'plano_pagamento', 'tabela_preco', 'segmento', 'rede', 'vendedor', 'rota',
      'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep',
      'latitude', 'longitude', 'status'
    ];

    const getName = (list, id) => {
      if (!id) return '';
      const item = list.find(i => i.id === id);
      return item ? item.nome : '';
    };

    const rows = clientes.map(c => [
      c.codigo || '',
      c.razao_social || '',
      c.nome_fantasia || '',
      c.cpf_cnpj || '',
      getName(planosPagamento, c.plano_pagamento_id),
      getName(tabelas, c.tabela_id),
      getName(segmentos, c.segmento_id),
      getName(redes, c.rede_id),
      getName(vendedores, c.vendedor_id),
      getName(rotas, c.rota_id),
      c.endereco || '',
      c.numero || '',
      c.bairro || '',
      c.cidade || '',
      c.estado || '',
      c.cep || '',
      c.latitude || '',
      c.longitude || '',
      c.status || ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clientes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    toast.success(`✅ ${clientes.length} clientes exportados com sucesso!`);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Building2 className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Clientes</h1>
            <p className="text-neutral-500 mt-0.5">Gestão de base de clientes</p>
          </div>
        </div>
        <div className="flex gap-2">
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
            Novo Cliente
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
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
                {selected ? 'Editar Cliente' : 'Novo Cliente'}
              </h2>
              {!isEditing && (
                <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
                  Modo Visualização
                </Badge>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                   <Label>Código</Label>
                   <Input
                     value={formData.codigo}
                     onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                     disabled={!isEditing}
                     placeholder="Código interno"
                   />
                </div>
                <div>
                  <Label>Razão Social *</Label>
                  <Input
                    value={formData.razao_social}
                    onChange={(e) => setFormData({ ...formData, razao_social: e.target.value })}
                    required
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Nome Fantasia</Label>
                  <Input
                    value={formData.nome_fantasia}
                    onChange={(e) => setFormData({ ...formData, nome_fantasia: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>CPF/CNPJ</Label>
                  <Input
                    value={formData.cpf_cnpj}
                    onChange={(e) => setFormData({ ...formData, cpf_cnpj: e.target.value })}
                    placeholder="CPF ou CNPJ"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Plano de Pagamento</Label>
                  <Select 
                    value={formData.plano_pagamento_id} 
                    onValueChange={(v) => setFormData({ ...formData, plano_pagamento_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {planosPagamento.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tabela de Preço</Label>
                  <Select 
                    value={formData.tabela_id} 
                    onValueChange={(v) => setFormData({ ...formData, tabela_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tabelas.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Segmento</Label>
                  <Select 
                    value={formData.segmento_id} 
                    onValueChange={(v) => setFormData({ ...formData, segmento_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {segmentos.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rede/Franquia</Label>
                  <Select 
                    value={formData.rede_id} 
                    onValueChange={(v) => setFormData({ ...formData, rede_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {redes.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vendedor</Label>
                  <Select 
                    value={formData.vendedor_id} 
                    onValueChange={(v) => {
                      setFormData({ ...formData, vendedor_id: v });
                      // Buscar supervisor do vendedor selecionado
                      const vendedor = vendedores.find(vend => vend.id === v);
                      if (vendedor && vendedor.supervisor_id) {
                        const supervisor = vendedores.find(sup => sup.id === vendedor.supervisor_id);
                        setSupervisorNome(supervisor ? supervisor.nome : '');
                      } else {
                        setSupervisorNome('');
                      }
                    }}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {vendedores.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Supervisor (automático)</Label>
                  <Input
                    value={supervisorNome}
                    disabled
                    placeholder="Selecionado automaticamente"
                    className="bg-slate-50"
                  />
                </div>
                <div>
                  <Label>Rota</Label>
                  <Select 
                    value={formData.rota_id} 
                    onValueChange={(v) => setFormData({ ...formData, rota_id: v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {rotas.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <Label>Endereço</Label>
                  <Textarea
                    value={formData.endereco}
                    onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                    rows={2}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input
                    value={formData.numero}
                    onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input
                    value={formData.bairro}
                    onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input
                    value={formData.cidade}
                    onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Estado (UF)</Label>
                  <Input
                    value={formData.estado}
                    onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                    placeholder="UF"
                    maxLength={2}
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>CEP</Label>
                  <Input
                    value={formData.cep}
                    onChange={(e) => setFormData({ ...formData, cep: e.target.value })}
                    placeholder="00000-000"
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
                  <Label>Data Primeiro Contato</Label>
                  <Input
                    type="date"
                    value={formData.data_primeiro_contato}
                    onChange={(e) => setFormData({ ...formData, data_primeiro_contato: e.target.value })}
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
                      <SelectItem value="prospecto">Prospecto</SelectItem>
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
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
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
          <ClienteConsulta onEdit={handleEdit} onDelete={handleDelete} onExport={handleExport} />
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
        title="Importar Clientes em Massa"
        description="Importe vários clientes de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
    </div>
  );
}