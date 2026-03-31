import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Building2, CheckCircle, XCircle, Clock, Upload, Download, Users, List, Save, Ban, Map, AlertCircle, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/ui/PageHeader';
import { validarDocumento, formatarDocumento, formatarCEP } from '@/components/clientes/validarCpfCnpj';
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
import ClienteMapa from '@/components/clientes/ClienteMapa';
import ExportarOmieModal from '@/components/clientes/ExportarOmieModal';
import ClientesComErroOmie from '@/components/clientes/ClientesComErroOmie';
import SincronizarOmieClientesModal from '@/components/clientes/SincronizarOmieClientesModal';
import { useOmiePermissao } from '@/components/hooks/useOmiePermissao';

export default function Clientes() {
  const podeOmie = useOmiePermissao();
  const [activeTab, setActiveTab] = useState("cadastro");
  const [isEditing, setIsEditing] = useState(false);
  
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [modoImportacao, setModoImportacao] = useState('cadastro'); // 'cadastro' ou 'atualizacao'
  const [omieModalOpen, setOmieModalOpen] = useState(false);
  const [sincronizarOmieOpen, setSincronizarOmieOpen] = useState(false);
  const [corrigirErrosOpen, setCorrigirErrosOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({
    codigo: '', razao_social: '', nome_fantasia: '', cpf_cnpj: '', email: 'nfe@paoemel.com.br',
    endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
    latitude: '', longitude: '',
    segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', modalidade_pagamento_id: '', tabela_id: '',
    data_primeiro_contato: '', status: 'ativo'
  });
  const [supervisorNome, setSupervisorNome] = useState('');
  const [docErro, setDocErro] = useState('');

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

  const { data: modalidadesPagamento = [] } = useQuery({
    queryKey: ['modalidadesPagamento'],
    queryFn: () => base44.entities.ModalidadePagamento.list()
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
      codigo: '', razao_social: '', nome_fantasia: '', cpf_cnpj: '', inscricao_estadual: '', email: 'nfe@paoemel.com.br',
      endereco: '', numero: '', bairro: '', cidade: '', estado: '', cep: '',
      latitude: '', longitude: '',
      segmento_id: '', rede_id: '', vendedor_id: '', rota_id: '', plano_pagamento_id: '', modalidade_pagamento_id: '', tabela_id: '',
      data_primeiro_contato: '', status: 'ativo'
    });
    setSupervisorNome('');
    setDocErro('');
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
      inscricao_estadual: item.inscricao_estadual || '',
      email: item.email || 'nfe@paoemel.com.br',
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
      modalidade_pagamento_id: item.modalidade_pagamento_id || '',
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
    
    // Validar CPF/CNPJ antes de salvar
    const docLimpo = (formData.cpf_cnpj || '').replace(/\D/g, '');
    if (docLimpo.length > 0) {
      const resultado = validarDocumento(docLimpo);
      if (!resultado.valido) {
        setDocErro(resultado.erro);
        toast.error(`❌ ${resultado.erro}. O Omie rejeita documentos inválidos.`);
        return;
      }
    }

    // Validar razão social (obrigatório Omie, max 60 chars)
    if (!formData.razao_social || formData.razao_social.trim().length === 0) {
      toast.error('❌ Razão Social é obrigatória.');
      return;
    }

    // Normalizar dados para formato Omie
    let dataToSave = { ...formData };

    // Remover aspas de todos os campos texto
    const removeQuotes = (val) => {
      if (typeof val !== 'string') return val;
      let v = val.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
      }
      return v;
    };
    for (const key of Object.keys(dataToSave)) {
      if (typeof dataToSave[key] === 'string') {
        dataToSave[key] = removeQuotes(dataToSave[key]);
      }
    }
    
    // Estado: sempre uppercase, 2 letras
    if (dataToSave.estado) {
      dataToSave.estado = dataToSave.estado.trim().toUpperCase().substring(0, 2);
    }
    
    // CEP: apenas dígitos, 8 caracteres
    if (dataToSave.cep) {
      dataToSave.cep = dataToSave.cep.replace(/\D/g, '').substring(0, 8);
    }
    
    // CPF/CNPJ: armazenar apenas dígitos (Omie rejeita formatado em alguns casos)
    if (dataToSave.cpf_cnpj) {
      dataToSave.cpf_cnpj = dataToSave.cpf_cnpj.replace(/\D/g, '');
    }
    
    // Razão social: max 60 chars (limite Omie)
    if (dataToSave.razao_social) {
      dataToSave.razao_social = dataToSave.razao_social.trim().substring(0, 60);
    }
    
    // Nome fantasia: max 100 chars (limite Omie)
    if (dataToSave.nome_fantasia) {
      dataToSave.nome_fantasia = dataToSave.nome_fantasia.trim().substring(0, 100);
    }
    
    // Endereço: max 60 chars
    if (dataToSave.endereco) {
      dataToSave.endereco = dataToSave.endereco.trim().substring(0, 60);
    }
    
    // Número: max 10 chars
    if (dataToSave.numero) {
      dataToSave.numero = dataToSave.numero.trim().substring(0, 10);
    }
    
    // Bairro: max 60 chars
    if (dataToSave.bairro) {
      dataToSave.bairro = dataToSave.bairro.trim().substring(0, 60);
    }
    
    // Cidade: max 60 chars
    if (dataToSave.cidade) {
      dataToSave.cidade = dataToSave.cidade.trim().substring(0, 60);
    }

    // Buscar supervisor_id do vendedor selecionado
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
    // Evitar chamadas duplicadas
    if (isImporting) return;
    
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

    // Se for modo atualização, código é obrigatório
    if (modoImportacao === 'atualizacao' && emptyCodigoCount > 0) {
      toast.error(`❌ Para atualização cadastral, todos os registros precisam ter código. ${emptyCodigoCount} registro(s) sem código.`);
      return;
    }

    if (warnings.length > 0 && modoImportacao === 'cadastro') {
      if (emptyCodigoCount > 0) warnings.push(`${emptyCodigoCount} cliente(s) sem código`);
      if (emptyCidadeCount > 0) warnings.push(`${emptyCidadeCount} cliente(s) sem cidade`);
      if (emptyVendedorCount > 0) warnings.push(`${emptyVendedorCount} cliente(s) sem vendedor`);
      if (emptySegmentoCount > 0) warnings.push(`${emptySegmentoCount} cliente(s) sem segmento`);
      if (emptyStatusCount > 0) warnings.push(`${emptyStatusCount} cliente(s) sem status`);
      
      const confirmImport = window.confirm(
        `⚠️ ATENÇÃO: Campos importantes em branco detectados!\n\n${warnings.join('\n')}\n\nDeseja continuar mesmo assim?`
      );
      if (!confirmImport) return;
    }

    setIsImporting(true);
    
    // Buscar todos os clientes existentes para verificar duplicatas
    const existingClients = await base44.entities.Cliente.list();
    // Normalizar códigos (trim e lowercase) para garantir comparação correta
    const existingClientsMap = {};
    existingClients.forEach(c => {
      const key = String(c.codigo || '').trim().toLowerCase();
      existingClientsMap[key] = c;
    });
    
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

      // Normalizar estado: converter nome completo para sigla UF
      const estadoUfMap = {
        'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
        'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
        'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
        'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
        'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
        'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO',
        'roraima': 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE',
        'tocantins': 'TO'
      };
      let estadoNormalizado = item.estado || '';
      if (estadoNormalizado) {
        const estadoLower = estadoNormalizado.toLowerCase().trim()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (estadoUfMap[estadoLower]) {
          estadoNormalizado = estadoUfMap[estadoLower];
        } else {
          // Já pode ser sigla, manter como está (uppercase)
          estadoNormalizado = estadoNormalizado.trim().toUpperCase();
        }
      }

      const clienteData = {
        ...item,
        latitude: lat,
        longitude: lng,
        estado: estadoNormalizado || item.estado || '',
        inscricao_estadual: item.inscricao_estadual != null ? String(item.inscricao_estadual).trim() : '',
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

    // Separar clientes para criar e atualizar baseado no modo de importação
    const toCreate = [];
    const toUpdate = [];
    let naoEncontrados = 0;

    for (const clienteData of clientesData) {
      // Normalizar código para comparação
      const codigoNormalizado = String(clienteData.codigo || '').trim().toLowerCase();
      const existingClient = existingClientsMap[codigoNormalizado];
      
      if (modoImportacao === 'atualizacao') {
        // Modo atualização: só atualiza clientes existentes
        if (existingClient) {
          toUpdate.push({ id: existingClient.id, data: clienteData });
        } else {
          naoEncontrados++;
        }
      } else {
        // Modo cadastro: cria novos e atualiza existentes
        if (existingClient) {
          toUpdate.push({ id: existingClient.id, data: clienteData });
        } else {
          toCreate.push(clienteData);
        }
      }
    }

    console.log('Importação - Modo:', modoImportacao);
    console.log('Importação - Total no arquivo:', clientesData.length);
    console.log('Importação - Para criar:', toCreate.length);
    console.log('Importação - Para atualizar:', toUpdate.length);
    console.log('Importação - Não encontrados:', naoEncontrados);
    if (clientesData.length > 0) {
      console.log('Importação - Campos do primeiro registro:', JSON.stringify(Object.keys(clientesData[0])));
      console.log('Importação - Primeiro registro estado:', clientesData[0].estado, '| inscricao_estadual:', clientesData[0].inscricao_estadual);
      // Log primeiros 3 registros para debug
      clientesData.slice(0, 3).forEach((c, i) => {
        console.log(`Importação - Registro ${i+1}: codigo=${c.codigo}, estado=${c.estado}, ie=${c.inscricao_estadual}`);
      });
    }
    if (toUpdate.length > 0) {
      console.log('Importação - Campos do primeiro update:', JSON.stringify(Object.keys(toUpdate[0].data)));
      console.log('Importação - Primeiro update estado:', toUpdate[0].data.estado, '| ie:', toUpdate[0].data.inscricao_estadual);
    }

    // Se modo atualização e nenhum cliente foi encontrado
    if (modoImportacao === 'atualizacao' && toUpdate.length === 0) {
      setIsImporting(false);
      toast.error(`❌ Nenhum cliente encontrado para atualização. Verifique se os códigos estão corretos.`);
      return;
    }

    try {
      // Executar criações em lotes de 100
      const batchSize = 100;
      
      if (toCreate.length > 0) {
        console.log('Iniciando criação de', toCreate.length, 'clientes...');
        const totalLotesCriacao = Math.ceil(toCreate.length / batchSize);
        for (let i = 0; i < toCreate.length; i += batchSize) {
          const batch = toCreate.slice(i, i + batchSize);
          const loteNum = Math.floor(i / batchSize) + 1;
          toast.info(`Criando lote ${loteNum}/${totalLotesCriacao} (${batch.length} clientes)...`);
          
          // Retry com backoff para criação
          let tentativa = 0;
          while (tentativa < 4) {
            try {
              await base44.entities.Cliente.bulkCreate(batch);
              break;
            } catch (err) {
              tentativa++;
              if (tentativa >= 4) throw err;
              const delay = 1000 * Math.pow(2, tentativa);
              console.log(`Retry criação lote ${loteNum} (tentativa ${tentativa}, aguardando ${delay}ms)`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
          
          if (i + batchSize < toCreate.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        console.log('Criação concluída!');
      }

      // Executar atualizações via backend function em lotes pequenos para garantir 100%
      if (toUpdate.length > 0) {
        console.log('Enviando', toUpdate.length, 'clientes para atualização via backend...');
        
        // Lotes de 50 para dar mais tempo ao backend processar com retries
        const LOTE_SIZE = 50;
        let totalAtualizados = 0;
        let errosAcumulados = [];
        const totalLotes = Math.ceil(toUpdate.length / LOTE_SIZE);

        for (let i = 0; i < toUpdate.length; i += LOTE_SIZE) {
          const lote = toUpdate.slice(i, i + LOTE_SIZE);
          const loteNum = Math.floor(i / LOTE_SIZE) + 1;
          toast.info(`Atualizando lote ${loteNum}/${totalLotes} (${lote.length} clientes)... ${totalAtualizados}/${toUpdate.length} concluídos`);
          
          // Retry com backoff para cada chamada ao backend
          let tentativa = 0;
          let response;
          while (tentativa < 5) {
            try {
              response = await base44.functions.invoke('bulkUpdateClientes', {
                clientes: lote
              });
              break;
            } catch (err) {
              tentativa++;
              if (tentativa >= 5) throw err;
              const delay = 3000 * Math.pow(2, tentativa);
              console.log(`Retry lote ${loteNum} (tentativa ${tentativa}, aguardando ${delay}ms)`);
              toast.warning(`Lote ${loteNum} falhou, tentando novamente (${tentativa}/4)...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
          
          const data = response.data;
          
          if (data?.error) {
            throw new Error(data.error);
          }

          totalAtualizados += data.atualizados || 0;
          if (data.detalhesErros?.length > 0) {
            errosAcumulados = [...errosAcumulados, ...data.detalhesErros];
          }
          
          // Delay entre lotes para não sobrecarregar
          if (i + LOTE_SIZE < toUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // REPROCESSAMENTO: se houver erros, tenta novamente os que falharam
        if (errosAcumulados.length > 0) {
          console.log(`Reprocessando ${errosAcumulados.length} clientes que falharam...`);
          toast.info(`Reprocessando ${errosAcumulados.length} clientes que falharam...`);
          
          // Montar lista dos que falharam
          const idsComErro = new Set(errosAcumulados.map(e => e.id));
          const clientesParaRetry = toUpdate.filter(c => idsComErro.has(c.id));
          
          // Enviar em lotes de 20 com delay maior
          const RETRY_LOTE = 20;
          let retryAtualizados = 0;
          let retryErros = [];
          
          for (let i = 0; i < clientesParaRetry.length; i += RETRY_LOTE) {
            const lote = clientesParaRetry.slice(i, i + RETRY_LOTE);
            const loteNum = Math.floor(i / RETRY_LOTE) + 1;
            const totalRetryLotes = Math.ceil(clientesParaRetry.length / RETRY_LOTE);
            toast.info(`Reprocessando lote ${loteNum}/${totalRetryLotes}...`);
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
              const response = await base44.functions.invoke('bulkUpdateClientes', {
                clientes: lote
              });
              const data = response.data;
              retryAtualizados += data.atualizados || 0;
              if (data.detalhesErros?.length > 0) {
                retryErros = [...retryErros, ...data.detalhesErros];
              }
            } catch (err) {
              console.error('Erro no reprocessamento:', err);
              retryErros.push(...lote.map(c => ({ id: c.id, error: err.message })));
            }
          }
          
          totalAtualizados += retryAtualizados;
          errosAcumulados = retryErros;
          console.log(`Reprocessamento: +${retryAtualizados} atualizados, ${retryErros.length} erros restantes`);
        }
        
        console.log(`Atualização final: ${totalAtualizados}/${toUpdate.length} atualizados`);
        
        if (errosAcumulados.length > 0) {
          console.error('Erros finais:', JSON.stringify(errosAcumulados));
          toast.error(`${errosAcumulados.length} clientes não puderam ser atualizados. IDs: ${errosAcumulados.slice(0, 5).map(e => e.id).join(', ')}${errosAcumulados.length > 5 ? '...' : ''}`);
        }
      }
    } catch (error) {
      console.error('Erro na importação:', error);
      setIsImporting(false);
      toast.error('❌ Erro na importação: ' + error.message);
      return;
    }

    queryClient.invalidateQueries(['clientes']);
    
    // Mensagem de sucesso
    const messages = [];
    if (toCreate.length > 0) messages.push(`${toCreate.length} novo(s) cliente(s) cadastrado(s)`);
    if (toUpdate.length > 0) messages.push(`${toUpdate.length} cliente(s) atualizado(s)`);
    if (naoEncontrados > 0 && modoImportacao === 'atualizacao') {
      messages.push(`${naoEncontrados} código(s) não encontrado(s)`);
    }
    toast.success(`✅ ${messages.join(' | ')}!`);
    
    // Fechar modal e resetar estado APÓS sucesso
    setIsImporting(false);
    setBulkOpen(false);
  };

  const bulkColumns = [
    { key: 'codigo', label: 'Código' },
    { key: 'razao_social', label: 'Razão Social', required: true },
    { key: 'nome_fantasia', label: 'Nome Fantasia' },
    { key: 'cpf_cnpj', label: 'CPF/CNPJ' },
    { key: 'inscricao_estadual', label: 'Inscrição Estadual' },
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
    { codigo: 'C001', razao_social: 'Empresa ABC Ltda', nome_fantasia: 'ABC Store', cpf_cnpj: '12.345.678/0001-90', inscricao_estadual: '123456789', tabela_preco: 'Tabela 1', vendedor: 'João Silva', cidade: 'São Paulo', estado: 'SP', latitude: '-23.5505', longitude: '-46.6333', status: 'ativo' },
    { codigo: 'C002', razao_social: 'Comércio XYZ', nome_fantasia: 'XYZ Shop', cpf_cnpj: '98.765.432/0001-10', inscricao_estadual: '987654321', segmento: 'Varejo', rede: 'Rede A', cidade: 'Campinas', estado: 'SP', latitude: '-22.9056', longitude: '-47.0608', status: 'ativo' }
  ];

  const handleExport = async (clientesFiltrados = null) => {
    let clientes = clientesFiltrados;
    if (!clientes || !Array.isArray(clientes)) {
      clientes = await base44.entities.Cliente.list();
    }
    
    const headers = [
      'codigo', 'razao_social', 'nome_fantasia', 'cpf_cnpj', 'inscricao_estadual',
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
      c.inscricao_estadual || '',
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
          {podeOmie && (
            <>
              <Button
                onClick={() => setCorrigirErrosOpen(true)}
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
              >
                <Ban className="w-4 h-4 mr-2" />
                Corrigir Erros Omie
              </Button>
              <Button
                onClick={() => setSincronizarOmieOpen(true)}
                variant="outline"
                className="border-green-200 text-green-700 hover:bg-green-50"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Sincronizar Omie
              </Button>
              <Button
                onClick={() => setOmieModalOpen(true)}
                variant="outline"
                className="border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                Exportar Omie
              </Button>
            </>
          )}
          <Link to="/sincronizarclientescsv">
            <Button
              variant="outline"
              className="border-purple-200 text-purple-700 hover:bg-purple-50"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Sincronizar CSV
            </Button>
          </Link>
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
        <TabsList className="grid w-full max-w-[500px] grid-cols-3 mb-6">
          <TabsTrigger value="cadastro" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Cadastro
          </TabsTrigger>
          <TabsTrigger value="consulta" className="flex items-center gap-2">
            <List className="w-4 h-4" />
            Consulta
          </TabsTrigger>
          <TabsTrigger value="mapa" className="flex items-center gap-2">
            <Map className="w-4 h-4" />
            Mapa
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
                  <Label>CPF/CNPJ *</Label>
                  <Input
                    value={formData.cpf_cnpj}
                    onChange={(e) => {
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
                    disabled={!isEditing}
                    className={docErro ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {docErro && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {docErro} — Omie rejeitará este documento
                    </p>
                  )}
                </div>
                <div>
                  <Label>Inscrição Estadual</Label>
                  <Input
                    value={formData.inscricao_estadual}
                    onChange={(e) => setFormData({ ...formData, inscricao_estadual: e.target.value })}
                    placeholder="Ex: 123456789"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="nfe@paoemel.com.br"
                    disabled={!isEditing}
                  />
                </div>
                <div>
                  <Label>Modalidade de Pagamento</Label>
                  <Select
                    value={formData.modalidade_pagamento_id || '_none_'}
                    onValueChange={(v) => setFormData({ ...formData, modalidade_pagamento_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhuma</SelectItem>
                      {modalidadesPagamento.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Plano de Pagamento</Label>
                  <Select 
                    value={formData.plano_pagamento_id || '_none_'} 
                    onValueChange={(v) => setFormData({ ...formData, plano_pagamento_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhum</SelectItem>
                      {planosPagamento.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tabela de Preço</Label>
                  <Select 
                    value={formData.tabela_id || '_none_'} 
                    onValueChange={(v) => setFormData({ ...formData, tabela_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhuma</SelectItem>
                      {tabelas.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Segmento</Label>
                  <Select 
                    value={formData.segmento_id || '_none_'} 
                    onValueChange={(v) => setFormData({ ...formData, segmento_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhum</SelectItem>
                      {segmentos.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Rede/Franquia</Label>
                  <Select 
                    value={formData.rede_id || '_none_'} 
                    onValueChange={(v) => setFormData({ ...formData, rede_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Sem Rede</SelectItem>
                      {redes.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vendedor</Label>
                  <Select 
                    value={formData.vendedor_id || '_none_'} 
                    onValueChange={(v) => {
                      const vendedorId = v === '_none_' ? '' : v;
                      setFormData({ ...formData, vendedor_id: vendedorId });
                      // Buscar supervisor do vendedor selecionado
                      if (vendedorId) {
                        const vendedor = vendedores.find(vend => vend.id === vendedorId);
                        if (vendedor && vendedor.supervisor_id) {
                          const supervisor = vendedores.find(sup => sup.id === vendedor.supervisor_id);
                          setSupervisorNome(supervisor ? supervisor.nome : '');
                        } else {
                          setSupervisorNome('');
                        }
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
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhum</SelectItem>
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
                    value={formData.rota_id || '_none_'} 
                    onValueChange={(v) => setFormData({ ...formData, rota_id: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhuma</SelectItem>
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
                  <Select
                    value={formData.estado ? formData.estado.toUpperCase() : '_none_'}
                    onValueChange={(v) => setFormData({ ...formData, estado: v === '_none_' ? '' : v })}
                    disabled={!isEditing}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Nenhum</SelectItem>
                      {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(uf => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>CEP</Label>
                  <Input
                    value={formData.cep}
                    onChange={(e) => setFormData({ ...formData, cep: formatarCEP(e.target.value) })}
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

        <TabsContent value="mapa" className="animate-in fade-in-50 duration-300">
          <ClienteMapa />
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
        onOpenChange={(v) => {
          setBulkOpen(v);
          if (!v) setModoImportacao('cadastro');
        }}
        title="Importar Clientes em Massa"
        description="Importe vários clientes de uma vez usando CSV ou colando dados do Excel"
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
        modoCliente={modoImportacao}
        onModoClienteChange={setModoImportacao}
      />

      <ExportarOmieModal
        open={omieModalOpen}
        onOpenChange={setOmieModalOpen}
      />

      <SincronizarOmieClientesModal
        open={sincronizarOmieOpen}
        onOpenChange={setSincronizarOmieOpen}
      />

      <ClientesComErroOmie
        open={corrigirErrosOpen}
        onOpenChange={setCorrigirErrosOpen}
        erros={[]}
      />
    </div>
  );
}