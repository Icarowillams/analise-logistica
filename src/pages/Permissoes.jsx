import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Save, Users, Lock } from 'lucide-react';
import { toast } from 'react-hot-toast';

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
  { id: 'MetasProduto', nome: 'Meta por Produto', grupo: 'metas' },
  { id: 'MetasPositivacao', nome: 'Meta por Positivação', grupo: 'metas' },
  { id: 'MetasPrecoMedio', nome: 'Meta por Preço Médio', grupo: 'metas' },
  { id: 'MetasCadastro', nome: 'Meta por Cadastro', grupo: 'metas' },
  { id: 'MetasTroca', nome: 'Meta por Troca', grupo: 'metas' },
  { id: 'PainelRodrigosM', nome: 'Painel Rodrigos', grupo: 'metas' },
  { id: 'DashboardVendedor', nome: 'Dashboard Vendedor', grupo: 'analises' },
  { id: 'DashboardTrocas', nome: 'Dashboard Trocas', grupo: 'analises' },
  { id: 'DashboardClientes', nome: 'Dashboard Clientes', grupo: 'analises' },
  { id: 'MeusRoteiros', nome: 'Meus Roteiros', grupo: 'visitas' },
  { id: 'PainelGestorVisita', nome: 'Painel de Roteiros', grupo: 'visitas' },
  { id: 'RelatoriosGestorVisita', nome: 'Relatórios de Visitas', grupo: 'visitas' },
  { id: 'Importacoes', nome: 'Importações', grupo: 'visitas' },
  { id: 'Roteiros', nome: 'Roteiros', grupo: 'cadastros' }
];

export default function Permissoes() {
  const queryClient = useQueryClient();
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState('');
  const [permissaoAtual, setPermissaoAtual] = useState(null);
  const [modoEdicao, setModoEdicao] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

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
          permissoes_visitas: { visualizar: false, iniciar_roteiro: false, finalizar_roteiro: false, importar_fotos: false, marcar_solicitou_pedido: false, importar_ultimo_estoque: false }
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
      permissoes_visitas: permissaoAtual.permissoes_visitas || {}
    };

    if (permissaoAtual.id) {
      updateMutation.mutate({ id: permissaoAtual.id, data: dataToSave });
    } else {
      createMutation.mutate(dataToSave);
    }
    setModoEdicao(false);
  };

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
          <p className="text-slate-500">Controle de acesso por usuário</p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Selecionar Funcionário
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={funcionarioSelecionado} onValueChange={setFuncionarioSelecionado}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um funcionário..." />
            </SelectTrigger>
            <SelectContent>
              {vendedores.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.nome} ({v.email || 'Sem email'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {permissaoAtual && (
        <>
          <div className="flex justify-end">
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
                    // Restaurar permissões originais
                    const perm = permissoes.find(p => p.vendedor_id === funcionarioSelecionado);
                    if (perm) setPermissaoAtual(perm);
                  }} 
                  variant="outline"
                >
                  Cancelar
                </Button>
                <Button 
                  onClick={salvarPermissoes} 
                  className="bg-gradient-to-r from-purple-500 to-indigo-600"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Salvar Permissões
                </Button>
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
                  {['visualizar', 'iniciar_roteiro', 'finalizar_roteiro', 'importar_fotos', 'marcar_solicitou_pedido', 'importar_ultimo_estoque'].map(perm => (
                    <div key={perm} className={`flex items-center space-x-2 p-2 rounded ${modoEdicao ? 'bg-slate-50' : 'bg-slate-100'}`}>
                      <Checkbox
                        id={`visitas-${perm}`}
                        checked={permissaoAtual.permissoes_visitas?.[perm] || false}
                        onCheckedChange={() => togglePermissao('permissoes_visitas', perm)}
                        disabled={!modoEdicao}
                      />
                      <Label htmlFor={`visitas-${perm}`} className={modoEdicao ? "cursor-pointer capitalize" : "capitalize text-slate-600"}>
                        {perm === 'marcar_solicitou_pedido' ? 'Marcar se Solicitou Pedido' : perm.replace(/_/g, ' ')}
                      </Label>
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