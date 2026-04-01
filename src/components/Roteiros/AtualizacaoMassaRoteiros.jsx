import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Plus, Minus, RefreshCw, Filter, Users, AlertTriangle } from 'lucide-react';

export default function AtualizacaoMassaRoteiros() {
  const queryClient = useQueryClient();

  // Filtros para selecionar roteiros
  const [filtroFuncionario, setFiltroFuncionario] = useState('');
  const [filtroDia, setFiltroDia] = useState('');
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [buscaRoteiro, setBuscaRoteiro] = useState('');

  // Seleção de roteiros
  const [selectedRoteiroIds, setSelectedRoteiroIds] = useState([]);

  // Ação em massa
  const [acao, setAcao] = useState(''); // 'adicionar' | 'remover'
  const [buscaCliente, setBuscaCliente] = useState('');
  const [clientesSelecionadosAcao, setClientesSelecionadosAcao] = useState([]);

  // Processamento
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const clientesMap = useMemo(() => {
    const map = {};
    clientes.forEach(c => { map[c.id] = c; });
    return map;
  }, [clientes]);

  // Filtrar roteiros
  const roteirosFiltrados = useMemo(() => {
    return roteiros.filter(r => {
      if (filtroDia && r.dia_semana !== filtroDia) return false;
      if (filtroFuncionario && r.vendedor_id !== filtroFuncionario) return false;
      if (filtroFuncao) {
        const v = vendedores.find(v => v.id === r.vendedor_id);
        if (!v || v.funcao_id !== filtroFuncao) return false;
      }
      if (buscaRoteiro) {
        const busca = buscaRoteiro.toLowerCase();
        if (!r.vendedor_nome?.toLowerCase().includes(busca) && !r.dia_semana?.toLowerCase().includes(busca)) return false;
      }
      return true;
    });
  }, [roteiros, filtroDia, filtroFuncionario, filtroFuncao, buscaRoteiro, vendedores]);

  // Filtrar vendedores por função
  const vendedoresFiltrados = useMemo(() => {
    if (!filtroFuncao) return vendedores;
    return vendedores.filter(v => v.funcao_id === filtroFuncao);
  }, [vendedores, filtroFuncao]);

  // Filtrar clientes para ação
  const clientesFiltradosAcao = useMemo(() => {
    if (!buscaCliente || buscaCliente.length < 2) return [];
    const busca = buscaCliente.toLowerCase();
    return clientes.filter(c => {
      if (clientesSelecionadosAcao.find(cs => cs.id === c.id)) return false;
      return (
        c.razao_social?.toLowerCase().includes(busca) ||
        c.nome_fantasia?.toLowerCase().includes(busca) ||
        c.codigo?.toLowerCase().includes(busca) ||
        c.cpf_cnpj?.includes(busca)
      );
    }).slice(0, 30);
  }, [clientes, buscaCliente, clientesSelecionadosAcao]);

  const getDiaLabel = (dia) => {
    const labels = {
      'segunda-feira': 'Seg', 'terca-feira': 'Ter', 'quarta-feira': 'Qua',
      'quinta-feira': 'Qui', 'sexta-feira': 'Sex', 'sabado': 'Sáb', 'domingo': 'Dom'
    };
    return labels[dia] || dia;
  };

  const toggleRoteiro = (id) => {
    setSelectedRoteiroIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedRoteiroIds.length === roteirosFiltrados.length) {
      setSelectedRoteiroIds([]);
    } else {
      setSelectedRoteiroIds(roteirosFiltrados.map(r => r.id));
    }
  };

  const addClienteAcao = (cliente) => {
    if (!clientesSelecionadosAcao.find(c => c.id === cliente.id)) {
      setClientesSelecionadosAcao(prev => [...prev, {
        id: cliente.id,
        nome: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia,
        codigo: cliente.codigo,
        cidade: cliente.cidade,
        bairro: cliente.bairro
      }]);
    }
  };

  const removeClienteAcao = (id) => {
    setClientesSelecionadosAcao(prev => prev.filter(c => c.id !== id));
  };

  const executarAcao = async () => {
    if (selectedRoteiroIds.length === 0) {
      toast.error('Selecione pelo menos um roteiro');
      return;
    }
    if (clientesSelecionadosAcao.length === 0) {
      toast.error('Selecione pelo menos um cliente');
      return;
    }
    if (!acao) {
      toast.error('Selecione a ação (adicionar ou remover)');
      return;
    }

    setProcessando(true);
    setResultado(null);

    let atualizados = 0;
    let erros = 0;
    const detalhes = [];

    const roteirosParaAtualizar = roteiros.filter(r => selectedRoteiroIds.includes(r.id));

    for (const roteiro of roteirosParaAtualizar) {
      try {
        let novosClientesIds = [...(roteiro.clientes_ids || [])];
        let novosClientesDetalhes = [...(roteiro.clientes_detalhes || [])];

        if (acao === 'adicionar') {
          for (const cliente of clientesSelecionadosAcao) {
            if (!novosClientesIds.includes(cliente.id)) {
              novosClientesIds.push(cliente.id);
              novosClientesDetalhes.push({
                cliente_id: cliente.id,
                cliente_nome: cliente.nome,
                nome_fantasia: cliente.nome_fantasia,
                cliente_codigo: cliente.codigo,
                cliente_cidade: cliente.cidade,
                cliente_bairro: cliente.bairro,
                ordem: novosClientesDetalhes.length + 1
              });
            }
          }
        } else if (acao === 'remover') {
          const idsRemover = clientesSelecionadosAcao.map(c => c.id);
          novosClientesIds = novosClientesIds.filter(id => !idsRemover.includes(id));
          novosClientesDetalhes = novosClientesDetalhes.filter(d => !idsRemover.includes(d.cliente_id));
          // Reordenar
          novosClientesDetalhes = novosClientesDetalhes.map((d, idx) => ({ ...d, ordem: idx + 1 }));
        }

        await base44.entities.Roteiro.update(roteiro.id, {
          clientes_ids: novosClientesIds,
          clientes_detalhes: novosClientesDetalhes
        });

        atualizados++;
        detalhes.push({ roteiro: `${roteiro.vendedor_nome} - ${getDiaLabel(roteiro.dia_semana)}`, sucesso: true });
      } catch (err) {
        erros++;
        detalhes.push({ roteiro: `${roteiro.vendedor_nome} - ${getDiaLabel(roteiro.dia_semana)}`, sucesso: false, erro: err.message });
      }
    }

    queryClient.invalidateQueries(['roteiros']);
    setResultado({ atualizados, erros, detalhes });
    setProcessando(false);

    if (erros === 0) {
      toast.success(`${atualizados} roteiro(s) atualizado(s) com sucesso!`);
    } else {
      toast.warning(`${atualizados} atualizado(s), ${erros} com erro(s).`);
    }
  };

  const limparTudo = () => {
    setSelectedRoteiroIds([]);
    setClientesSelecionadosAcao([]);
    setAcao('');
    setBuscaCliente('');
    setResultado(null);
  };

  return (
    <div className="space-y-6">
      {/* Passo 1: Selecionar Roteiros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="w-5 h-5 text-amber-600" />
            1. Selecionar Roteiros
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Função</Label>
              <Select value={filtroFuncao || "all"} onValueChange={(v) => {
                setFiltroFuncao(v === "all" ? "" : v);
                setFiltroFuncionario("");
              }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as funções</SelectItem>
                  {funcoes.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Funcionário</Label>
              <Select value={filtroFuncionario || "all"} onValueChange={(v) => setFiltroFuncionario(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {vendedoresFiltrados.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Dia</Label>
              <Select value={filtroDia || "all"} onValueChange={(v) => setFiltroDia(v === "all" ? "" : v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os dias</SelectItem>
                  <SelectItem value="segunda-feira">Segunda</SelectItem>
                  <SelectItem value="terca-feira">Terça</SelectItem>
                  <SelectItem value="quarta-feira">Quarta</SelectItem>
                  <SelectItem value="quinta-feira">Quinta</SelectItem>
                  <SelectItem value="sexta-feira">Sexta</SelectItem>
                  <SelectItem value="sabado">Sábado</SelectItem>
                  <SelectItem value="domingo">Domingo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar</Label>
              <Input
                placeholder="Nome do funcionário..."
                value={buscaRoteiro}
                onChange={(e) => setBuscaRoteiro(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selectedRoteiroIds.length === roteirosFiltrados.length && roteirosFiltrados.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm text-slate-600">
                Selecionar todos ({roteirosFiltrados.length})
              </span>
            </div>
            <Badge variant="outline" className="text-amber-700 border-amber-300">
              {selectedRoteiroIds.length} selecionado(s)
            </Badge>
          </div>

          <ScrollArea className="h-[250px] border rounded-lg">
            <div className="p-2 space-y-1">
              {roteirosFiltrados.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">Nenhum roteiro encontrado</p>
              ) : (
                roteirosFiltrados.map(r => (
                  <div
                    key={r.id}
                    onClick={() => toggleRoteiro(r.id)}
                    className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                      selectedRoteiroIds.includes(r.id) ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <Checkbox
                      checked={selectedRoteiroIds.includes(r.id)}
                      onCheckedChange={() => toggleRoteiro(r.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{r.vendedor_nome}</p>
                      <p className="text-xs text-slate-500">{r.clientes_ids?.length || 0} clientes</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{getDiaLabel(r.dia_semana)}</Badge>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Passo 2: Selecionar Ação e Clientes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="w-5 h-5 text-amber-600" />
            2. Selecionar Ação e Clientes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Ação</Label>
              <Select value={acao || "none"} onValueChange={(v) => setAcao(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a ação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione a ação</SelectItem>
                  <SelectItem value="adicionar">
                    <span className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-green-600" /> Adicionar clientes aos roteiros
                    </span>
                  </SelectItem>
                  <SelectItem value="remover">
                    <span className="flex items-center gap-2">
                      <Minus className="w-4 h-4 text-red-600" /> Remover clientes dos roteiros
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar cliente para {acao === 'remover' ? 'remover' : 'adicionar'}</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Nome, código ou CPF/CNPJ..."
                  value={buscaCliente}
                  onChange={(e) => setBuscaCliente(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {/* Lista de clientes encontrados */}
          {clientesFiltradosAcao.length > 0 && (
            <div className="border rounded-lg max-h-40 overflow-y-auto">
              <div className="p-2 space-y-1">
                {clientesFiltradosAcao.map(c => (
                  <div
                    key={c.id}
                    onClick={() => addClienteAcao(c)}
                    className="flex items-center gap-2 p-2 hover:bg-green-50 cursor-pointer rounded text-sm"
                  >
                    <Plus className="w-3.5 h-3.5 text-green-600 shrink-0" />
                    <span className="font-medium">{c.codigo}</span>
                    <span className="truncate">{c.nome_fantasia || c.razao_social}</span>
                    <span className="text-xs text-slate-400 ml-auto shrink-0">{c.cidade}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clientes selecionados para ação */}
          {clientesSelecionadosAcao.length > 0 && (
            <div className="border rounded-lg p-3 bg-slate-50">
              <p className="text-sm font-medium mb-2">
                Clientes selecionados para {acao === 'remover' ? 'remoção' : 'adição'} ({clientesSelecionadosAcao.length}):
              </p>
              <div className="flex flex-wrap gap-2">
                {clientesSelecionadosAcao.map(c => (
                  <Badge
                    key={c.id}
                    variant="outline"
                    className={`cursor-pointer ${acao === 'remover' ? 'border-red-300 text-red-700 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
                    onClick={() => removeClienteAcao(c.id)}
                  >
                    {c.codigo} - {c.nome_fantasia || c.nome}
                    <span className="ml-1 text-xs">✕</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Passo 3: Executar */}
      <Card>
        <CardContent className="pt-6">
          {selectedRoteiroIds.length > 0 && clientesSelecionadosAcao.length > 0 && acao && (
            <div className={`p-4 rounded-lg mb-4 ${acao === 'remover' ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${acao === 'remover' ? 'text-red-600' : 'text-green-600'}`} />
                <div>
                  <p className={`font-medium text-sm ${acao === 'remover' ? 'text-red-800' : 'text-green-800'}`}>
                    {acao === 'adicionar' ? 'Adicionar' : 'Remover'} {clientesSelecionadosAcao.length} cliente(s) 
                    {acao === 'adicionar' ? ' a ' : ' de '} {selectedRoteiroIds.length} roteiro(s)
                  </p>
                  <p className={`text-xs mt-1 ${acao === 'remover' ? 'text-red-600' : 'text-green-600'}`}>
                    Esta ação será aplicada em todos os roteiros selecionados.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={limparTudo} disabled={processando}>
              Limpar Tudo
            </Button>
            <Button
              onClick={executarAcao}
              disabled={processando || selectedRoteiroIds.length === 0 || clientesSelecionadosAcao.length === 0 || !acao}
              className={acao === 'remover'
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
              }
            >
              {processando ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" />Executar Atualização em Massa</>
              )}
            </Button>
          </div>

          {/* Resultado */}
          {resultado && (
            <div className="mt-4 border rounded-lg p-4 bg-slate-50">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{resultado.atualizados}</p>
                  <p className="text-xs text-green-600">Atualizados</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-600">{resultado.erros}</p>
                  <p className="text-xs text-red-600">Erros</p>
                </div>
              </div>
              <ScrollArea className="max-h-40">
                <div className="space-y-1">
                  {resultado.detalhes.map((d, idx) => (
                    <div key={idx} className={`text-xs p-1.5 rounded ${d.sucesso ? 'text-green-700' : 'text-red-700 bg-red-50'}`}>
                      {d.sucesso ? '✅' : '❌'} {d.roteiro} {d.erro ? `- ${d.erro}` : ''}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}