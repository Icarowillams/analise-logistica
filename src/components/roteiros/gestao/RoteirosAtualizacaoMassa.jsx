import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Filter, Users, Play, Eraser } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { DIAS_SEMANA, diaCurto } from './gestaoUtils';

export default function RoteirosAtualizacaoMassa({ roteiros, vendedores, funcoes, clientes, onRecarregar }) {
  const [filtroFuncao, setFiltroFuncao] = useState('todas');
  const [filtroFunc, setFiltroFunc] = useState('todos');
  const [filtroDia, setFiltroDia] = useState('todos');
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [acao, setAcao] = useState('');
  const [valorAcao, setValorAcao] = useState('');
  const [buscaCliente, setBuscaCliente] = useState('');
  const [clientesSelecionados, setClientesSelecionados] = useState([]);
  const [executando, setExecutando] = useState(false);

  const filtrados = useMemo(() => roteiros.filter(r => {
    if (filtroDia !== 'todos' && !(r.dia_semana || '').includes(filtroDia)) return false;
    if (filtroFunc !== 'todos' && r.vendedor_id !== filtroFunc) return false;
    if (filtroFuncao !== 'todas') {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (v?.funcao_id !== filtroFuncao) return false;
    }
    if (busca) {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (!(r.vendedor_nome || v?.nome || '').toLowerCase().includes(busca.toLowerCase())) return false;
    }
    return true;
  }), [roteiros, vendedores, filtroDia, filtroFunc, filtroFuncao, busca]);

  const todosSelec = filtrados.length > 0 && filtrados.every(r => selecionados.has(r.id));

  const toggleTodos = () => {
    const novo = new Set(selecionados);
    if (todosSelec) filtrados.forEach(r => novo.delete(r.id));
    else filtrados.forEach(r => novo.add(r.id));
    setSelecionados(novo);
  };

  const toggleUm = (id) => {
    const novo = new Set(selecionados);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    setSelecionados(novo);
  };

  const limparTudo = () => {
    setSelecionados(new Set()); setAcao(''); setValorAcao(''); setClientesSelecionados([]); setBuscaCliente('');
  };

  const clientesEncontrados = buscaCliente ? clientes.filter(c => {
    const q = buscaCliente.toLowerCase();
    return (c.razao_social || '').toLowerCase().includes(q) || (c.codigo_interno || '').includes(buscaCliente) || (c.cnpj_cpf || '').includes(buscaCliente);
  }).slice(0, 10) : [];

  const executar = async () => {
    if (selecionados.size === 0) { toast.error('Selecione ao menos um roteiro.'); return; }
    if (!acao) { toast.error('Selecione uma ação.'); return; }
    setExecutando(true);

    const ids = Array.from(selecionados);
    for (const id of ids) {
      const r = roteiros.find(x => x.id === id);
      if (!r) continue;
      const update = {};

      if (acao === 'mudar_status') update.status = valorAcao;
      else if (acao === 'mudar_dia') update.dia_semana = valorAcao;
      else if (acao === 'mudar_funcionario') {
        const v = vendedores.find(x => x.id === valorAcao);
        update.vendedor_id = valorAcao; update.vendedor_nome = v?.nome || '';
      } else if (acao === 'adicionar_clientes' && clientesSelecionados.length > 0) {
        const idsAtuais = r.clientes_ids || [];
        const detalhesAtuais = r.clientes_detalhes || [];
        const novosIds = clientesSelecionados.filter(c => !idsAtuais.includes(c.id)).map(c => c.id);
        const novosDetalhes = clientesSelecionados.filter(c => !idsAtuais.includes(c.id)).map((c, i) => ({
          cliente_id: c.id, cliente_nome: c.razao_social, cliente_codigo: c.codigo_interno,
          cliente_cidade: c.cidade, cliente_endereco: c.endereco, cliente_telefone: c.telefone, ordem: detalhesAtuais.length + i + 1
        }));
        update.clientes_ids = [...idsAtuais, ...novosIds];
        update.clientes_detalhes = [...detalhesAtuais, ...novosDetalhes];
      } else if (acao === 'remover_clientes' && clientesSelecionados.length > 0) {
        const idsRemover = new Set(clientesSelecionados.map(c => c.id));
        update.clientes_ids = (r.clientes_ids || []).filter(x => !idsRemover.has(x));
        update.clientes_detalhes = (r.clientes_detalhes || []).filter(d => !idsRemover.has(d.cliente_id));
      }

      if (Object.keys(update).length > 0) await base44.entities.Roteiro.update(id, update);
    }

    toast.success(`${ids.length} roteiros atualizados.`);
    setExecutando(false);
    limparTudo();
    onRecarregar();
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Filter className="w-4 h-4" />1. Selecionar Roteiros</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <div><Label className="text-xs">Função</Label>
              <Select value={filtroFuncao} onValueChange={setFiltroFuncao}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as funções</SelectItem>
                  {funcoes.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Funcionário</Label>
              <Select value={filtroFunc} onValueChange={setFiltroFunc}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="todos">Todos</SelectItem>
                  {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Dia</Label>
              <Select value={filtroDia} onValueChange={setFiltroDia}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os dias</SelectItem>
                  {DIAS_SEMANA.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Buscar</Label>
              <Input placeholder="Nome do funcionário..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={todosSelec} onCheckedChange={toggleTodos} />
              Selecionar todos ({filtrados.length})
            </label>
            <Badge variant="outline" className="border-amber-300 text-amber-800">{selecionados.size} selecionado(s)</Badge>
          </div>

          <div className="border rounded-lg max-h-80 overflow-auto divide-y">
            {filtrados.map(r => {
              const v = vendedores.find(x => x.id === r.vendedor_id);
              return (
                <label key={r.id} className="flex items-center gap-3 p-3 hover:bg-amber-50 cursor-pointer">
                  <Checkbox checked={selecionados.has(r.id)} onCheckedChange={() => toggleUm(r.id)} />
                  <div className="flex-1">
                    <div className="font-medium">{r.vendedor_nome || v?.nome || '-'}</div>
                    <div className="text-xs text-slate-500">{r.clientes_ids?.length || 0} clientes</div>
                  </div>
                  <Badge variant="outline">{diaCurto(r.dia_semana)}</Badge>
                </label>
              );
            })}
            {filtrados.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nenhum roteiro.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="w-4 h-4" />2. Selecionar Ação e Clientes</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div><Label className="text-xs">Ação</Label>
            <Select value={acao} onValueChange={setAcao}>
              <SelectTrigger><SelectValue placeholder="Selecione a ação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mudar_status">Mudar status</SelectItem>
                <SelectItem value="mudar_dia">Mudar dia da semana</SelectItem>
                <SelectItem value="mudar_funcionario">Transferir para outro funcionário</SelectItem>
                <SelectItem value="adicionar_clientes">Adicionar clientes</SelectItem>
                <SelectItem value="remover_clientes">Remover clientes</SelectItem>
              </SelectContent>
            </Select>

            {acao === 'mudar_status' && (
              <Select value={valorAcao} onValueChange={setValorAcao}><SelectTrigger className="mt-2"><SelectValue placeholder="Novo status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem><SelectItem value="planejado">Planejado</SelectItem>
                  <SelectItem value="pausado">Pausado</SelectItem><SelectItem value="concluido">Concluído</SelectItem>
                </SelectContent>
              </Select>
            )}
            {acao === 'mudar_dia' && (
              <Select value={valorAcao} onValueChange={setValorAcao}><SelectTrigger className="mt-2"><SelectValue placeholder="Novo dia" /></SelectTrigger>
                <SelectContent>{DIAS_SEMANA.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {acao === 'mudar_funcionario' && (
              <Select value={valorAcao} onValueChange={setValorAcao}><SelectTrigger className="mt-2"><SelectValue placeholder="Novo funcionário" /></SelectTrigger>
                <SelectContent className="max-h-72">{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>

          {(acao === 'adicionar_clientes' || acao === 'remover_clientes') && (
            <div>
              <Label className="text-xs">Buscar cliente para {acao === 'adicionar_clientes' ? 'adicionar' : 'remover'}</Label>
              <Input placeholder="Nome, código ou CPF/CNPJ..." value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} />
              {clientesEncontrados.length > 0 && (
                <div className="mt-2 border rounded-md max-h-40 overflow-auto">
                  {clientesEncontrados.map(c => (
                    <button key={c.id} type="button" onClick={() => { setClientesSelecionados(prev => prev.find(x => x.id === c.id) ? prev : [...prev, c]); setBuscaCliente(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-amber-50 text-sm border-b last:border-0">
                      <span className="font-medium">{c.razao_social}</span> <span className="text-xs text-slate-500">· {c.codigo_interno}</span>
                    </button>
                  ))}
                </div>
              )}
              {clientesSelecionados.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {clientesSelecionados.map(c => (
                    <Badge key={c.id} variant="outline" className="cursor-pointer" onClick={() => setClientesSelecionados(prev => prev.filter(x => x.id !== c.id))}>
                      {c.razao_social} ✕
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={limparTudo}><Eraser className="w-4 h-4 mr-2" />Limpar Tudo</Button>
        <Button onClick={executar} disabled={executando || selecionados.size === 0 || !acao} className="bg-emerald-500 hover:bg-emerald-600 text-white">
          <Play className="w-4 h-4 mr-2" />{executando ? 'Executando...' : 'Executar Atualização em Massa'}
        </Button>
      </div>
    </div>
  );
}