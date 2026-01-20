import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Save, Users, Lock, Briefcase, Copy, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const ABAS_SISTEMA = [
  { id: 'Dashboard', nome: 'Dashboard', grupo: 'dashboard' },
  { id: 'ImportarVendas', nome: 'Importar Vendas', grupo: 'importacoes' },
  { id: 'Funcionarios', nome: 'Funcionários', grupo: 'cadastros' },
  { id: 'Funcoes', nome: 'Funções/Departamentos', grupo: 'cadastros' },
  { id: 'Produtos', nome: 'Produtos', grupo: 'cadastros' },
  { id: 'Categorias', nome: 'Categorias', grupo: 'cadastros' },
  { id: 'TabelasPreco', nome: 'Tabelas de Preço', grupo: 'cadastros' },
  { id: 'Clientes', nome: 'Clientes', grupo: 'cadastros' },
  { id: 'Segmentos', nome: 'Segmentos', grupo: 'cadastros' },
  { id: 'Redes', nome: 'Redes', grupo: 'cadastros' },
  { id: 'MotivosTroca', nome: 'Ocorrência de Troca', grupo: 'cadastros' },
  { id: 'PlanosPagamento', nome: 'Planos de Pagamento', grupo: 'cadastros' },
  { id: 'UnidadesMedida', nome: 'Unidades de Medida', grupo: 'cadastros' },
  { id: 'Rotas', nome: 'Rotas', grupo: 'cadastros' },
  { id: 'Roteiros', nome: 'Roteiros', grupo: 'cadastros' },
  { id: 'MetasProduto', nome: 'Meta por Produto', grupo: 'metas' },
  { id: 'MetasPositivacao', nome: 'Meta por Positivação', grupo: 'metas' },
  { id: 'MetasPrecoMedio', nome: 'Meta por Preço Médio', grupo: 'metas' },
  { id: 'MetasCadastro', nome: 'Meta por Cadastro', grupo: 'metas' },
  { id: 'MetasTroca', nome: 'Meta por Troca', grupo: 'metas' },
  { id: 'PainelRodrigosM', nome: 'Painel Rodrigos', grupo: 'metas' },
  { id: 'DashboardVendedor', nome: 'Dashboard Vendedor', grupo: 'analises' },
  { id: 'DashboardTrocas', nome: 'Dashboard Trocas', grupo: 'analises' },
  { id: 'DashboardClientes', nome: 'Dashboard Clientes', grupo: 'analises' },
  { id: 'AnaliseVisitas', nome: 'Análise de Visitas', grupo: 'analises' },
  { id: 'MeusRoteiros', nome: 'Meus Roteiros', grupo: 'visitas' },
  { id: 'PainelGestorVisita', nome: 'Painel de Roteiros', grupo: 'visitas' },
  { id: 'RelatorioRoteiros', nome: 'Roteiros/Visitas', grupo: 'relatorios' },
  { id: 'RelatorioEstoque', nome: 'Estoque', grupo: 'relatorios' },
  { id: 'RelatorioTrocas', nome: 'Trocas', grupo: 'relatorios' }
];

const RELATORIOS_PERMISSOES = [
  { id: 'rel_roteiros', nome: 'Relatório Roteiros/Visitas', pagina: 'RelatorioRoteiros' },
  { id: 'rel_estoque', nome: 'Relatório Estoque', pagina: 'RelatorioEstoque' },
  { id: 'rel_trocas', nome: 'Relatório Trocas', pagina: 'RelatorioTrocas' },
  { id: 'analise_visitas', nome: 'Análise de Visitas', pagina: 'AnaliseVisitas' }
];

export default function Permissoes() {
  const queryClient = useQueryClient();
  const [modoSelecao, setModoSelecao] = useState('funcionario'); // 'funcionario' ou 'funcao'
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState('');
  const [funcaoSelecionada, setFuncaoSelecionada] = useState('');
  const [permissaoAtual, setPermissaoAtual] = useState(null);
  const [modoEdicao, setModoEdicao] = useState(false);
  const [aplicandoEmMassa, setAplicandoEmMassa] = useState(false);
  const [funcionariosSelecionados, setFuncionariosSelecionados] = useState([]);
  const [listaFuncionariosAberta, setListaFuncionariosAberta] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  // Funcionários filtrados por função selecionada
  const funcionariosDaFuncao = useMemo(() => {
    if (!funcaoSelecionada) return [];
    const funcaoSel = funcoes.find(f => f.id === funcaoSelecionada);
    if (!funcaoSel) return [];
    // Filtrar por funcao_id OU pelo nome da função (campo texto legado)
    return vendedores.filter(v => 
      v.funcao_id === funcaoSelecionada || 
      v.funcao?.toLowerCase() === funcaoSel.nome?.toLowerCase()
    );
  }, [vendedores, funcaoSelecionada, funcoes]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Permissao.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissoes'] });
      toast.success('Permissões salvas com sucesso!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Permissao.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissoes'] });
      toast.success('Permissões atualizadas com sucesso!');
    }
  });

  useEffect(() => {
    if (funcionarioSelecionado) {
      setModoEdicao(false);
      const perm = permissoes.find(p => p.vendedor_id === funcionarioSelecionado);
      if (perm) {
        setPermissaoAtual(perm);
      } else {
        const vendedor = vendedores.find(v => v.id === funcionarioSelecionado);
        setPermissaoAtual({
          vendedor_id: funcionarioSelecionado,
          vendedor_email: vendedor?.email || '',
          abas_visiveis: [],
          permissoes_metas: { visualizar: false, criar: false, alterar: false, excluir: false, exportar: false },
          permissoes_cadastros: { criar: false, editar: false, excluir: false, importar_massa: false, visualizar: false, exportar: false },
          permissoes_importar: { visualizar: false, importar: false, importar_massa: false, excluir_lancamento: false },
          permissoes_analises: { visualizar: false, utilizar_filtros: false, exportar: false },
          permissoes_visitas: { visualizar: false, iniciar_roteiro: false, finalizar_roteiro: false, importar_fotos: false, marcar_solicitou_pedido: false, importar_ultimo_estoque: false, informar_estoque: false, informar_trocas: false },
          permissoes_relatorios: { 
            rel_roteiros_visualizar: false, rel_roteiros_filtros: false, rel_roteiros_exportar: false,
            rel_estoque_visualizar: false, rel_estoque_filtros: false, rel_estoque_exportar: false,
            rel_trocas_visualizar: false, rel_trocas_filtros: false, rel_trocas_exportar: false,
            analise_visitas_visualizar: false, analise_visitas_filtros: false, analise_visitas_exportar: false
          }
        });
      }
    }
  }, [funcionarioSelecionado, permissoes, vendedores]);

  const toggleAba = (abaId) => {
    if (!permissaoAtual || !modoEdicao) return;
    const atual = permissaoAtual.abas_visiveis || [];
    const nova = atual.includes(abaId) 
      ? atual.filter(id => id !== abaId)
      : [...atual, abaId];
    setPermissaoAtual({ ...permissaoAtual, abas_visiveis: nova });
  };

  const togglePermissao = (grupo, campo) => {
    if (!permissaoAtual || !modoEdicao) return;
    setPermissaoAtual({
      ...permissaoAtual,
      [grupo]: {
        ...permissaoAtual[grupo],
        [campo]: !permissaoAtual[grupo]?.[campo]
      }
    });
  };

  const salvarPermissoes = () => {
    if (!permissaoAtual || !modoEdicao) return;

    const dataToSave = {
      vendedor_id: permissaoAtual.vendedor_id,
      vendedor_email: permissaoAtual.vendedor_email,
      abas_visiveis: permissaoAtual.abas_visiveis || [],
      permissoes_metas: permissaoAtual.permissoes_metas || {},
      permissoes_cadastros: permissaoAtual.permissoes_cadastros || {},
      permissoes_importar: permissaoAtual.permissoes_importar || {},
      permissoes_analises: permissaoAtual.permissoes_analises || {},
      permissoes_visitas: permissaoAtual.permissoes_visitas || {},
      permissoes_relatorios: permissaoAtual.permissoes_relatorios || {}
    };

    if (permissaoAtual.id) {
      updateMutation.mutate({ id: permissaoAtual.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
    setModoEdicao(false);
  };

  // Aplicar permissões em massa para funcionários selecionados ou todos da função
  const aplicarPermissoesEmMassa = async () => {
    if (!permissaoAtual || !funcaoSelecionada || funcionariosDaFuncao.length === 0) return;

    setAplicandoEmMassa(true);

    const permissoesBase = {
      abas_visiveis: permissaoAtual.abas_visiveis || [],
      permissoes_metas: permissaoAtual.permissoes_metas || {},
      permissoes_cadastros: permissaoAtual.permissoes_cadastros || {},
      permissoes_importar: permissaoAtual.permissoes_importar || {},
      permissoes_analises: permissaoAtual.permissoes_analises || {},
      permissoes_visitas: permissaoAtual.permissoes_visitas || {},
      permissoes_relatorios: permissaoAtual.permissoes_relatorios || {}
    };

    let atualizados = 0;
    let criados = 0;

    // Se nenhum funcionário foi selecionado, aplica para todos da função
    const funcionariosParaAplicar = funcionariosSelecionados.length > 0 
      ? funcionariosDaFuncao.filter(f => funcionariosSelecionados.includes(f.id))
      : funcionariosDaFuncao;

    for (const funcionario of funcionariosParaAplicar) {
      const permExistente = permissoes.find(p => p.vendedor_id === funcionario.id);
      
      const dataToSave = {
        vendedor_id: funcionario.id,
        vendedor_email: funcionario.email || '',
        ...permissoesBase
      };

      if (permExistente) {
        await base44.entities.Permissao.update(permExistente.id, dataToSave);
        atualizados++;
      } else {
        await base44.entities.Permissao.create(dataToSave);
        criados++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['permissoes'] });
    setAplicandoEmMassa(false);
    setModoEdicao(false);
    setFuncionariosSelecionados([]);
    toast.success(`Permissões aplicadas! ${criados} criadas, ${atualizados} atualizadas.`);
  };

  // Toggle seleção de funcionário individual
  const toggleFuncionarioSelecionado = (funcionarioId) => {
    setFuncionariosSelecionados(prev => 
      prev.includes(funcionarioId)
        ? prev.filter(id => id !== funcionarioId)
        : [...prev, funcionarioId]
    );
  };

  // Selecionar/Desselecionar todos
  const toggleTodosFuncionarios = () => {
    if (funcionariosSelecionados.length === funcionariosDaFuncao.length) {
      setFuncionariosSelecionados([]);
    } else {
      setFuncionariosSelecionados(funcionariosDaFuncao.map(f => f.id));
    }
  };

  // Gerar permissão modelo para edição por função
  const gerarPermissaoModelo = () => {
    setPermissaoAtual({
      vendedor_id: 'modelo_funcao',
      vendedor_email: '',
      abas_visiveis: [],
      permissoes_metas: { visualizar: false, criar: false, alterar: false, excluir: false, exportar: false },
      permissoes_cadastros: { criar: false, editar: false, excluir: false, importar_massa: false, visualizar: false, exportar: false },
      permissoes_importar: { visualizar: false, importar: false, importar_massa: false, excluir_lancamento: false },
      permissoes_analises: { visualizar: false, utilizar_filtros: false, exportar: false },
      permissoes_visitas: { visualizar: false, iniciar_roteiro: false, finalizar_roteiro: false, importar_fotos: false, marcar_solicitou_pedido: false, importar_ultimo_estoque: false, informar_estoque: false, informar_trocas: false },
      permissoes_relatorios: { 
        rel_roteiros_visualizar: false, rel_roteiros_filtros: false, rel_roteiros_exportar: false,
        rel_estoque_visualizar: false, rel_estoque_filtros: false, rel_estoque_exportar: false,
        rel_trocas_visualizar: false, rel_trocas_filtros: false, rel_trocas_exportar: false,
        analise_visitas_visualizar: false, analise_visitas_filtros: false, analise_visitas_exportar: false
      }
    });
  };

  // Quando muda a função, gerar permissão modelo e limpar seleção
  useEffect(() => {
    if (modoSelecao === 'funcao' && funcaoSelecionada) {
      gerarPermissaoModelo();
      setModoEdicao(false);
      setFuncionariosSelecionados([]);
    }
  }, [funcaoSelecionada, modoSelecao]);

  const abasPorGrupo = useMemo(() => {
    return ABAS_SISTEMA.reduce((acc, aba) => {
      if (!acc[aba.grupo]) acc[aba.grupo] = [];
      acc[aba.grupo].push(aba);
      return acc;
    }, {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
          <Shield className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gerenciar Permissões</h1>
          <p className="text-slate-500">Controle de acesso por usuário ou por função</p>
        </div>
      </div>

      {/* Seletor de modo: Por Funcionário ou Por Função */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Modo de Seleção
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={modoSelecao} onValueChange={(v) => {
            setModoSelecao(v);
            setFuncionarioSelecionado('');
            setFuncaoSelecionada('');
            setPermissaoAtual(null);
            setModoEdicao(false);
          }}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="funcionario" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Por Funcionário
              </TabsTrigger>
              <TabsTrigger value="funcao" className="flex items-center gap-2">
                <Briefcase className="w-4 h-4" />
                Por Função
              </TabsTrigger>
            </TabsList>

            <TabsContent value="funcionario" className="mt-4">
              <Select value={funcionarioSelecionado} onValueChange={setFuncionarioSelecionado}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione um funcionário..." />
                </SelectTrigger>
                <SelectContent>
                  {vendedores.map(v => {
                    const funcao = funcoes.find(f => f.id === v.funcao_id);
                    return (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome} {funcao ? `(${funcao.nome})` : ''} - {v.email || 'Sem email'}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </TabsContent>

            <TabsContent value="funcao" className="mt-4 space-y-4">
              <Select value={funcaoSelecionada} onValueChange={setFuncaoSelecionada}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione uma função..." />
                </SelectTrigger>
                <SelectContent>
                  {funcoes.map(f => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {funcaoSelecionada && funcionariosDaFuncao.length > 0 && (
                <Collapsible open={listaFuncionariosAberta} onOpenChange={setListaFuncionariosAberta}>
                  <div className="border rounded-lg bg-slate-50">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-4 h-auto">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          <span>
                            <strong>{funcionariosDaFuncao.length}</strong> funcionário(s) com esta função
                            {funcionariosSelecionados.length > 0 && (
                              <span className="ml-2 text-amber-600">
                                ({funcionariosSelecionados.length} selecionado(s))
                              </span>
                            )}
                          </span>
                        </div>
                        {listaFuncionariosAberta ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-2">
                        <div className="flex items-center justify-between border-b pb-2 mb-2">
                          <span className="text-sm text-slate-600">
                            Selecione os funcionários específicos ou deixe em branco para aplicar a todos
                          </span>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={toggleTodosFuncionarios}
                          >
                            {funcionariosSelecionados.length === funcionariosDaFuncao.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                          {funcionariosDaFuncao.map(func => (
                            <div 
                              key={func.id} 
                              className={`flex items-center space-x-2 p-2 rounded cursor-pointer hover:bg-slate-100 ${
                                funcionariosSelecionados.includes(func.id) ? 'bg-amber-50 border border-amber-200' : 'bg-white border'
                              }`}
                              onClick={() => toggleFuncionarioSelecionado(func.id)}
                            >
                              <Checkbox
                                checked={funcionariosSelecionados.includes(func.id)}
                                onCheckedChange={() => toggleFuncionarioSelecionado(func.id)}
                              />
                              <Label className="cursor-pointer text-sm flex-1">
                                {func.nome}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}

              {funcaoSelecionada && funcionariosDaFuncao.length === 0 && (
                <Alert className="bg-amber-50 border-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">
                    Nenhum funcionário encontrado com esta função.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {permissaoAtual && (
        <>
          <div className="flex justify-end gap-2">
            {!modoEdicao ? (
              <Button 
                onClick={() => setModoEdicao(true)} 
                className="bg-gradient-to-r from-blue-500 to-blue-600"
              >
                <Lock className="w-4 h-4 mr-2" />
                Alterar Permissões
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    setModoEdicao(false);
                    if (modoSelecao === 'funcionario') {
                      const perm = permissoes.find(p => p.vendedor_id === funcionarioSelecionado);
                      if (perm) setPermissaoAtual(perm);
                    } else {
                      gerarPermissaoModelo();
                    }
                  }} 
                  variant="outline"
                >
                  Cancelar
                </Button>
                
                {modoSelecao === 'funcionario' ? (
                  <Button 
                    onClick={salvarPermissoes} 
                    className="bg-gradient-to-r from-purple-500 to-indigo-600"
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Salvar Permissões
                  </Button>
                ) : (
                  <Button 
                    onClick={aplicarPermissoesEmMassa} 
                    className="bg-gradient-to-r from-amber-500 to-orange-600"
                    disabled={aplicandoEmMassa || funcionariosDaFuncao.length === 0}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {aplicandoEmMassa 
                      ? 'Aplicando...' 
                      : funcionariosSelecionados.length > 0 
                        ? `Aplicar para ${funcionariosSelecionados.length} Funcionário(s) Selecionado(s)`
                        : `Aplicar para Todos (${funcionariosDaFuncao.length})`
                    }
                  </Button>
                )}
              </div>
            )}
          </div>

        <Tabs defaultValue="abas" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="abas">Abas Visíveis</TabsTrigger>
            <TabsTrigger value="niveis">Níveis de Acesso</TabsTrigger>
          </TabsList>

          <TabsContent value="abas" className="space-y-4">
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle>Selecione as Abas Visíveis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {Object.entries(abasPorGrupo).map(([grupo, abas]) => (
                  <div key={grupo} className="space-y-3">
                    <h3 className="font-semibold text-slate-800 capitalize border-b pb-2">
                      {grupo === 'metas' && 'Metas'}
                      {grupo === 'cadastros' && 'Cadastros'}
                      {grupo === 'importacoes' && 'Importações'}
                      {grupo === 'analises' && 'Análises'}
                      {grupo === 'dashboard' && 'Dashboard'}
                      {grupo === 'visitas' && 'Visitas'}
                      {grupo === 'relatorios' && 'Relatórios'}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {abas.map(aba => (
                        <div key={aba.id} className={`flex items-center space-x-2 p-3 rounded-lg ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                          <Checkbox
                            id={aba.id}
                            checked={permissaoAtual.abas_visiveis?.includes(aba.id)}
                            onCheckedChange={() => toggleAba(aba.id)}
                            disabled={!modoEdicao}
                          />
                          <Label htmlFor={aba.id} className={modoEdicao ? "cursor-pointer text-sm" : "text-sm text-slate-600"}>
                            {aba.nome}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="niveis" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Metas */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Metas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['visualizar', 'criar', 'alterar', 'excluir', 'exportar'].map(perm => (
                    <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                      <Checkbox
                        id={`metas-${perm}`}
                        checked={permissaoAtual.permissoes_metas?.[perm] || false}
                        onCheckedChange={() => togglePermissao('permissoes_metas', perm)}
                        disabled={!modoEdicao}
                      />
                      <Label htmlFor={`metas-${perm}`} className={modoEdicao ? "cursor-pointer capitalize" : "capitalize text-slate-600"}>
                        {perm.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Cadastros */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Cadastros</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['criar', 'editar', 'excluir', 'importar_massa', 'visualizar', 'exportar'].map(perm => (
                    <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                      <Checkbox
                        id={`cadastros-${perm}`}
                        checked={permissaoAtual.permissoes_cadastros?.[perm] || false}
                        onCheckedChange={() => togglePermissao('permissoes_cadastros', perm)}
                        disabled={!modoEdicao}
                      />
                      <Label htmlFor={`cadastros-${perm}`} className={modoEdicao ? "cursor-pointer capitalize" : "capitalize text-slate-600"}>
                        {perm.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Importar */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Importações</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['visualizar', 'importar', 'importar_massa', 'excluir_lancamento'].map(perm => (
                    <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                      <Checkbox
                        id={`importar-${perm}`}
                        checked={permissaoAtual.permissoes_importar?.[perm] || false}
                        onCheckedChange={() => togglePermissao('permissoes_importar', perm)}
                        disabled={!modoEdicao}
                      />
                      <Label htmlFor={`importar-${perm}`} className={modoEdicao ? "cursor-pointer capitalize" : "capitalize text-slate-600"}>
                        {perm.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Análises */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Análises</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['visualizar', 'utilizar_filtros', 'exportar'].map(perm => (
                    <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                      <Checkbox
                        id={`analises-${perm}`}
                        checked={permissaoAtual.permissoes_analises?.[perm] || false}
                        onCheckedChange={() => togglePermissao('permissoes_analises', perm)}
                        disabled={!modoEdicao}
                      />
                      <Label htmlFor={`analises-${perm}`} className={modoEdicao ? "cursor-pointer capitalize" : "capitalize text-slate-600"}>
                        {perm.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Visitas */}
              <Card className="border-0 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Visitas</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['visualizar', 'iniciar_roteiro', 'finalizar_roteiro', 'importar_fotos', 'marcar_solicitou_pedido', 'importar_ultimo_estoque', 'informar_estoque', 'informar_trocas'].map(perm => {
                    const labels = {
                      visualizar: 'Visualizar',
                      iniciar_roteiro: 'Iniciar Roteiro',
                      finalizar_roteiro: 'Finalizar Roteiro',
                      importar_fotos: 'Importar Fotos',
                      marcar_solicitou_pedido: 'Marcar se Solicitou Pedido',
                      importar_ultimo_estoque: 'Importar Último Estoque',
                      informar_estoque: 'Informar Estoque',
                      informar_trocas: 'Informar Trocas'
                    };
                    return (
                      <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                        <Checkbox
                          id={`visitas-${perm}`}
                          checked={permissaoAtual.permissoes_visitas?.[perm] || false}
                          onCheckedChange={() => togglePermissao('permissoes_visitas', perm)}
                          disabled={!modoEdicao}
                        />
                        <Label htmlFor={`visitas-${perm}`} className={modoEdicao ? "cursor-pointer" : "text-slate-600"}>
                          {labels[perm]}
                        </Label>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* Relatórios */}
              <Card className="border-0 shadow-lg lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Permissões - Relatórios</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {RELATORIOS_PERMISSOES.map(rel => (
                    <div key={rel.id} className="border rounded-lg p-3 bg-slate-50">
                      <h4 className="font-medium text-slate-800 mb-2 text-sm">{rel.nome}</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {['visualizar', 'filtros', 'exportar'].map(tipo => {
                          const permKey = `${rel.id}_${tipo}`;
                          const labels = {
                            visualizar: 'Visualizar',
                            filtros: 'Filtros',
                            exportar: 'Exportar'
                          };
                          return (
                            <div key={tipo} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-white' : 'bg-slate-100'}`}>
                              <Checkbox
                                id={`rel-${permKey}`}
                                checked={permissaoAtual.permissoes_relatorios?.[permKey] || false}
                                onCheckedChange={() => togglePermissao('permissoes_relatorios', permKey)}
                                disabled={!modoEdicao}
                              />
                              <Label htmlFor={`rel-${permKey}`} className={modoEdicao ? "cursor-pointer text-sm" : "text-slate-600 text-sm"}>
                                {labels[tipo]}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        </>
      )}
    </div>
  );
}