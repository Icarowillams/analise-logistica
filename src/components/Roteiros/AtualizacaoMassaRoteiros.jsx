import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Plus, Minus, RefreshCw, Filter, Users } from 'lucide-react';
import useBuscaClientes from '@/components/hooks/useBuscaClientes';

export default function AtualizacaoMassaRoteiros() {
  const qc = useQueryClient();

  const [filtroFuncionario, setFiltroFuncionario] = useState('');
  const [filtroDia, setFiltroDia] = useState('');
  const [filtroFuncao, setFiltroFuncao] = useState('');
  const [buscaRoteiro, setBuscaRoteiro] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [acao, setAcao] = useState('');
  const [buscaCliente, setBuscaCliente] = useState('');
  const [clientesAcao, setClientesAcao] = useState([]);
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list(), staleTime: 5 * 60 * 1000 });
  const { data: funcoes = [] } = useQuery({ queryKey: ['funcoes'], queryFn: () => base44.entities.Funcao.list(), staleTime: 5 * 60 * 1000 });

  // Busca SERVER-SIDE de clientes para a ação (não baixa a base inteira)
  const { clientes: clientesBusca } = useBuscaClientes(buscaCliente, { minChars: 2, limite: 30 });

  const roteirosFiltrados = useMemo(() => roteiros.filter(r => {
    if (filtroDia && r.dia_semana !== filtroDia) return false;
    if (filtroFuncionario && r.vendedor_id !== filtroFuncionario) return false;
    if (filtroFuncao) {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (!v || v.funcao_id !== filtroFuncao) return false;
    }
    if (buscaRoteiro) {
      const q = buscaRoteiro.toLowerCase();
      if (!r.vendedor_nome?.toLowerCase().includes(q) && !r.dia_semana?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [roteiros, filtroDia, filtroFuncionario, filtroFuncao, buscaRoteiro, vendedores]);

  const vendedoresFiltrados = useMemo(() => filtroFuncao ? vendedores.filter(v => v.funcao_id === filtroFuncao) : vendedores, [vendedores, filtroFuncao]);

  const clientesFiltradosAcao = useMemo(() => {
    return clientesBusca.filter(c => !clientesAcao.find(cs => cs.id === c.id)).slice(0, 30);
  }, [clientesBusca, clientesAcao]);

  const getDiaLabel = (d) => ({ 'segunda-feira': 'Seg', 'terca-feira': 'Ter', 'quarta-feira': 'Qua', 'quinta-feira': 'Qui', 'sexta-feira': 'Sex', 'sabado': 'Sáb', 'domingo': 'Dom' })[d] || d;

  const toggleRoteiro = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const toggleSelectAll = () => setSelectedIds(selectedIds.length === roteirosFiltrados.length ? [] : roteirosFiltrados.map(r => r.id));

  const addClienteAcao = (c) => {
    if (!clientesAcao.find(x => x.id === c.id)) {
      setClientesAcao(prev => [...prev, {
        id: c.id, nome: c.razao_social, nome_fantasia: c.nome_fantasia,
        codigo: c.codigo_interno, cidade: c.cidade, bairro: c.bairro
      }]);
    }
  };
  const removeClienteAcao = (id) => setClientesAcao(prev => prev.filter(c => c.id !== id));

  const executar = async () => {
    if (selectedIds.length === 0) { toast.error('Selecione pelo menos um roteiro'); return; }
    if (clientesAcao.length === 0) { toast.error('Selecione pelo menos um cliente'); return; }
    if (!acao) { toast.error('Selecione a ação'); return; }

    setProcessando(true);
    setResultado(null);

    let atualizados = 0, erros = 0;
    const detalhes = [];
    const lista = roteiros.filter(r => selectedIds.includes(r.id));

    for (const r of lista) {
      try {
        let novosIds = [...(r.clientes_ids || [])];
        let novosDetalhes = [...(r.clientes_detalhes || [])];

        if (acao === 'adicionar') {
          for (const c of clientesAcao) {
            if (!novosIds.includes(c.id)) {
              novosIds.push(c.id);
              novosDetalhes.push({
                cliente_id: c.id, cliente_nome: c.nome, nome_fantasia: c.nome_fantasia,
                cliente_codigo: c.codigo, cliente_cidade: c.cidade, cliente_bairro: c.bairro,
                ordem: novosDetalhes.length + 1
              });
            }
          }
        } else if (acao === 'remover') {
          const idsRemover = clientesAcao.map(c => c.id);
          novosIds = novosIds.filter(id => !idsRemover.includes(id));
          novosDetalhes = novosDetalhes.filter(d => !idsRemover.includes(d.cliente_id)).map((d, i) => ({ ...d, ordem: i + 1 }));
        }

        await base44.entities.Roteiro.update(r.id, { clientes_ids: novosIds, clientes_detalhes: novosDetalhes });
        atualizados++;
        detalhes.push({ roteiro: `${r.vendedor_nome} - ${getDiaLabel(r.dia_semana)}`, sucesso: true });
      } catch (err) {
        erros++;
        detalhes.push({ roteiro: `${r.vendedor_nome} - ${getDiaLabel(r.dia_semana)}`, sucesso: false, erro: err.message });
      }
    }

    qc.invalidateQueries(['roteiros']);
    setResultado({ atualizados, erros, detalhes });
    setProcessando(false);
    if (erros === 0) toast.success(`${atualizados} roteiro(s) atualizado(s)!`);
    else toast.warning(`${atualizados} atualizado(s), ${erros} com erro(s).`);
  };

  const limparTudo = () => { setSelectedIds([]); setClientesAcao([]); setAcao(''); setBuscaCliente(''); setResultado(null); };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Filter className="w-5 h-5 text-amber-600" />1. Selecionar Roteiros</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select value={filtroFuncao || 'all'} onValueChange={(v) => { setFiltroFuncao(v === 'all' ? '' : v); setFiltroFuncionario(''); }}>
              <SelectTrigger><SelectValue placeholder="Função" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as funções</SelectItem>
                {funcoes.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroFuncionario || 'all'} onValueChange={(v) => setFiltroFuncionario(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Funcionário" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {vendedoresFiltrados.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroDia || 'all'} onValueChange={(v) => setFiltroDia(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Dia" /></SelectTrigger>
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
            <Input placeholder="Buscar..." value={buscaRoteiro} onChange={(e) => setBuscaRoteiro(e.target.value)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox checked={selectedIds.length === roteirosFiltrados.length && roteirosFiltrados.length > 0} onCheckedChange={toggleSelectAll} />
              <span className="text-sm">Selecionar todos ({roteirosFiltrados.length})</span>
            </div>
            <Badge variant="outline" className="text-amber-700 border-amber-300">{selectedIds.length} selecionado(s)</Badge>
          </div>

          <ScrollArea className="h-[250px] border rounded-lg">
            <div className="p-2 space-y-1">
              {roteirosFiltrados.map(r => (
                <div key={r.id} onClick={() => toggleRoteiro(r.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer ${selectedIds.includes(r.id) ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50'}`}>
                  <Checkbox checked={selectedIds.includes(r.id)} onCheckedChange={() => toggleRoteiro(r.id)} />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{r.vendedor_nome}</p>
                    <p className="text-xs text-slate-500">{r.clientes_ids?.length || 0} clientes</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{getDiaLabel(r.dia_semana)}</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Users className="w-5 h-5 text-amber-600" />2. Selecionar Ação e Clientes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select value={acao || 'none'} onValueChange={(v) => setAcao(v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione a ação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Selecione</SelectItem>
                <SelectItem value="adicionar"><span className="flex items-center gap-2"><Plus className="w-4 h-4 text-green-600" />Adicionar clientes</span></SelectItem>
                <SelectItem value="remover"><span className="flex items-center gap-2"><Minus className="w-4 h-4 text-red-600" />Remover clientes</span></SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <Input placeholder="Nome, código ou CPF/CNPJ..." value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} className="pl-9" />
            </div>
          </div>

          {clientesFiltradosAcao.length > 0 && (
            <div className="border rounded-lg max-h-40 overflow-y-auto">
              <div className="p-2 space-y-1">
                {clientesFiltradosAcao.map(c => (
                  <div key={c.id} onClick={() => addClienteAcao(c)} className="flex items-center gap-2 p-2 hover:bg-green-50 cursor-pointer rounded text-sm">
                    <Plus className="w-3.5 h-3.5 text-green-600" />
                    <span className="font-medium">{c.codigo_interno}</span>
                    <span>{c.nome_fantasia || c.razao_social}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {clientesAcao.length > 0 && (
            <div className="border rounded-lg p-3 bg-slate-50">
              <p className="text-sm font-medium mb-2">Clientes selecionados ({clientesAcao.length}):</p>
              <div className="flex flex-wrap gap-2">
                {clientesAcao.map(c => (
                  <Badge key={c.id} variant="outline"
                    className={`cursor-pointer ${acao === 'remover' ? 'border-red-300 text-red-700' : 'border-green-300 text-green-700'}`}
                    onClick={() => removeClienteAcao(c.id)}>
                    {c.codigo} - {c.nome_fantasia || c.nome}<span className="ml-1 text-xs">✕</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={limparTudo} disabled={processando}>Limpar Tudo</Button>
            <Button onClick={executar} disabled={processando || selectedIds.length === 0 || clientesAcao.length === 0 || !acao}
              className={acao === 'remover' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white'}>
              {processando ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</> : <><RefreshCw className="w-4 h-4 mr-2" />Executar</>}
            </Button>
          </div>

          {resultado && (
            <div className="mt-4 border rounded-lg p-4 bg-slate-50">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-600">{resultado.atualizados}</p>
                  <p className="text-xs text-green-600">Atualizados</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-600">{resultado.erros}</p>
                  <p className="text-xs text-red-600">Erros</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}