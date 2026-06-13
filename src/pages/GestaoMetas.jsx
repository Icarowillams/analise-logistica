import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Target, Plus, Trash2, Pencil, ChevronRight, ChevronDown,
  Users, User, Crown, GitBranch, AlertTriangle, CheckCircle2
} from 'lucide-react';
import { MetaProgressoBar, SemaforoBadge } from '@/components/metas/MetaProgressoBar';
import DistribuirMetaModal from '@/components/metas/DistribuirMetaModal';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const NIVEL_LABELS = { gerente: 'Gerente', supervisor: 'Supervisor', vendedor: 'Vendedor' };
const NIVEL_ICONS = { gerente: Crown, supervisor: Users, vendedor: User };
const NIVEL_COLORS = { gerente: 'bg-purple-100 text-purple-800', supervisor: 'bg-blue-100 text-blue-800', vendedor: 'bg-slate-100 text-slate-700' };

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const periodoDoMes = (mesRef) => {
  if (!mesRef) return { inicio: '', fim: '' };
  const [ano, mes] = mesRef.split('-').map(Number);
  const fim = new Date(ano, mes, 0).getDate();
  return {
    inicio: `${mesRef}-01`,
    fim: `${mesRef}-${String(fim).padStart(2, '0')}`,
  };
};

const formInicial = {
  titulo: '',
  nivel: 'gerente',
  mes_referencia: mesAtual(),
  valor_meta: '',
  volume_pacotes_meta: '',
  gerente_id: '',
  gerente_nome: '',
  tipo: 'vendas',
  premiacao: '',
  observacoes: '',
};

export default function GestaoMetas() {
  const queryClient = useQueryClient();
  const [mesFiltro, setMesFiltro] = useState(mesAtual());
  const [openForm, setOpenForm] = useState(false);
  const [editMeta, setEditMeta] = useState(null);
  const [form, setForm] = useState(formInicial);
  const [expandido, setExpandido] = useState({});
  const [distribuirMeta, setDistribuirMeta] = useState(null); // meta pai para distribuir
  const [nivelDistribuir, setNivelDistribuir] = useState('supervisor');

  const { data: metas = [], isLoading } = useQuery({
    queryKey: ['metas'],
    queryFn: () => base44.entities.Meta.list('-periodo_inicio', 500),
    staleTime: 60 * 1000,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({ status: 'ativo' }),
    staleTime: 5 * 60 * 1000,
  });

  // Filtrar metas do mês selecionado
  const metasDoMes = useMemo(() => {
    return metas.filter(m => m.mes_referencia === mesFiltro || m.periodo_inicio?.slice(0, 7) === mesFiltro);
  }, [metas, mesFiltro]);

  // Árvore hierárquica
  const arvore = useMemo(() => {
    const raizes = metasDoMes.filter(m => m.nivel === 'gerente' || !m.meta_pai_id);
    return raizes.map(raiz => ({
      ...raiz,
      filhos: metasDoMes.filter(m => m.meta_pai_id === raiz.id && m.nivel === 'supervisor').map(sup => ({
        ...sup,
        filhos: metasDoMes.filter(m => m.meta_pai_id === sup.id && m.nivel === 'vendedor'),
      })),
    }));
  }, [metasDoMes]);

  // Supervisores e vendedores para distribuição
  const supervisores = vendedores.filter(v => v.papeis?.includes('supervisor') || v.funcao?.toLowerCase().includes('supervisor'));
  const gerentes = vendedores.filter(v => v.papeis?.includes('gerente') || v.funcao?.toLowerCase().includes('gerente'));

  const salvar = useMutation({
    mutationFn: async (data) => {
      const { inicio, fim } = periodoDoMes(data.mes_referencia);
      const payload = {
        ...data,
        periodo_inicio: inicio,
        periodo_fim: fim,
        valor_meta: Number(data.valor_meta || 0),
        volume_pacotes_meta: Number(data.volume_pacotes_meta || 0),
      };
      if (!payload.titulo) {
        const nivelLabel = NIVEL_LABELS[payload.nivel] || payload.nivel;
        payload.titulo = `Meta ${nivelLabel} — ${payload.mes_referencia}`;
      }
      return editMeta
        ? base44.entities.Meta.update(editMeta.id, payload)
        : base44.entities.Meta.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metas'] });
      toast.success(editMeta ? 'Meta atualizada!' : 'Meta criada com sucesso!');
      setOpenForm(false);
      setEditMeta(null);
      setForm(formInicial);
    },
    onError: (e) => toast.error('Erro: ' + e.message),
  });

  const excluir = useMutation({
    mutationFn: (id) => base44.entities.Meta.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['metas'] }); toast.success('Meta excluída'); },
  });

  const abrirNova = () => { setEditMeta(null); setForm(formInicial); setOpenForm(true); };
  const abrirEditar = (m) => { setEditMeta(m); setForm({ ...formInicial, ...m }); setOpenForm(true); };

  const toggle = (id) => setExpandido(prev => ({ ...prev, [id]: !prev[id] }));

  const abrirDistribuir = (meta, nivel) => {
    setDistribuirMeta(meta);
    setNivelDistribuir(nivel);
  };

  // Vendedores de um supervisor específico
  const vendedoresDoSupervisor = (supervisorId) => {
    return vendedores.filter(v =>
      v.supervisor_id === supervisorId ||
      v.supervisor_ids?.includes(supervisorId)
    );
  };

  // Meses para filtro
  const mesesOpcoes = useMemo(() => {
    const hoje = new Date();
    const opts = [];
    for (let i = -2; i <= 3; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      opts.push({ val, label });
    }
    return opts;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-3">
        <PageHeader
          title="Gestão de Metas"
          subtitle="Cascata hierárquica: Gerente → Supervisores → Vendedores"
          icon={GitBranch}
        />
        <Button onClick={abrirNova} className="bg-amber-500 hover:bg-amber-600 text-neutral-900">
          <Plus className="w-4 h-4 mr-1" />Nova Meta (Raiz)
        </Button>
      </div>

      {/* Filtro de mês */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={mesFiltro} onValueChange={setMesFiltro}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mesesOpcoes.map(o => (
              <SelectItem key={o.val} value={o.val}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{metasDoMes.length} metas no período</span>
      </div>

      {/* Legenda rápida */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge className="bg-purple-100 text-purple-800"><Crown className="w-3 h-3 mr-1" />Gerente</Badge>
        <Badge className="bg-blue-100 text-blue-800"><Users className="w-3 h-3 mr-1" />Supervisor</Badge>
        <Badge className="bg-slate-100 text-slate-700"><User className="w-3 h-3 mr-1" />Vendedor</Badge>
      </div>

      {/* Árvore de metas */}
      {isLoading && <p className="text-sm text-slate-400 py-8 text-center">Carregando...</p>}

      {!isLoading && arvore.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-slate-400">
            <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhuma meta cadastrada para {mesFiltro}</p>
            <p className="text-xs mt-1">Clique em "Nova Meta (Raiz)" para criar a meta do gerente</p>
          </CardContent>
        </Card>
      )}

      {arvore.map(metaGerente => {
        const totalSupervisores = metaGerente.filhos.reduce((s, f) => s + Number(f.valor_meta || 0), 0);
        const pctDistribuido = metaGerente.valor_meta > 0 ? (totalSupervisores / metaGerente.valor_meta) * 100 : 0;
        const aberto = expandido[metaGerente.id] !== false; // aberto por padrão

        return (
          <Card key={metaGerente.id} className="border-purple-200">
            {/* Header da meta gerente */}
            <CardHeader className="pb-2 bg-purple-50 rounded-t-xl">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-1">
                  <button onClick={() => toggle(metaGerente.id)} className="text-purple-600 hover:text-purple-800">
                    {aberto ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>
                  <Crown className="w-4 h-4 text-purple-600" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-purple-900">{metaGerente.titulo}</span>
                      <Badge className="bg-purple-100 text-purple-800 text-xs">Gerente</Badge>
                      {metaGerente.gerente_nome && <span className="text-xs text-purple-600">{metaGerente.gerente_nome}</span>}
                    </div>
                    <div className="text-xs text-purple-700 mt-0.5">
                      Meta: <strong>{fmt(metaGerente.valor_meta)}</strong>
                      {metaGerente.volume_pacotes_meta > 0 && ` | ${metaGerente.volume_pacotes_meta.toLocaleString('pt-BR')} pacotes`}
                      {' '} | {metaGerente.periodo_inicio} → {metaGerente.periodo_fim}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-right">
                    <div className="text-xs text-purple-600">Distribuído supervisores</div>
                    <div className="text-sm font-bold text-purple-800">{fmt(totalSupervisores)} ({fmtN(pctDistribuido)}%)</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-purple-300 text-purple-700 hover:bg-purple-50 text-xs"
                    onClick={() => abrirDistribuir(metaGerente, 'supervisor')}
                  >
                    <GitBranch className="w-3.5 h-3.5 mr-1" />Distribuir p/ Supervisores
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => abrirEditar(metaGerente)}><Pencil className="w-3.5 h-3.5 text-slate-500" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm('Excluir esta meta e todos os filhos?')) excluir.mutate(metaGerente.id); }}><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
                </div>
              </div>
              <MetaProgressoBar realizado={totalSupervisores} meta={metaGerente.valor_meta} className="mt-2" />
            </CardHeader>

            {/* Supervisores */}
            {aberto && (
              <CardContent className="pt-3 space-y-3">
                {metaGerente.filhos.length === 0 && (
                  <p className="text-xs text-slate-400 italic pl-6">Nenhum supervisor com meta. Use "Distribuir p/ Supervisores" acima.</p>
                )}

                {metaGerente.filhos.map(metaSup => {
                  const totalVendedores = metaSup.filhos.reduce((s, f) => s + Number(f.valor_meta || 0), 0);
                  const pctDistSup = metaSup.valor_meta > 0 ? (totalVendedores / metaSup.valor_meta) * 100 : 0;
                  const abertoSup = expandido[metaSup.id] !== false;
                  const pctSup = metaGerente.valor_meta > 0 ? (metaSup.valor_meta / metaGerente.valor_meta) * 100 : 0;

                  return (
                    <div key={metaSup.id} className="ml-6 border border-blue-200 rounded-lg bg-blue-50">
                      {/* Header supervisor */}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-1">
                            <button onClick={() => toggle(metaSup.id)} className="text-blue-600 hover:text-blue-800">
                              {abertoSup ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <Users className="w-4 h-4 text-blue-600" />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-blue-900 text-sm">{metaSup.supervisor_nome || metaSup.titulo}</span>
                                <Badge className="bg-blue-100 text-blue-800 text-xs">Supervisor</Badge>
                                <span className="text-xs text-blue-500">{fmtN(pctSup)}% da meta geral</span>
                              </div>
                              <div className="text-xs text-blue-700">
                                Meta: <strong>{fmt(metaSup.valor_meta)}</strong>
                                {metaSup.volume_pacotes_meta > 0 && ` | ${metaSup.volume_pacotes_meta.toLocaleString('pt-BR')} pacotes`}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-right">
                              <div className="text-xs text-blue-600">Dist. vendedores</div>
                              <div className="text-xs font-bold text-blue-800">{fmt(totalVendedores)} ({fmtN(pctDistSup)}%)</div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-blue-300 text-blue-700 hover:bg-blue-50 text-xs"
                              onClick={() => abrirDistribuir(metaSup, 'vendedor')}
                            >
                              <GitBranch className="w-3 h-3 mr-1" />Distribuir p/ Vendedores
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => abrirEditar(metaSup)}><Pencil className="w-3 h-3 text-slate-400" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => { if (confirm('Excluir?')) excluir.mutate(metaSup.id); }}><Trash2 className="w-3 h-3 text-red-400" /></Button>
                          </div>
                        </div>
                        <MetaProgressoBar realizado={totalVendedores} meta={metaSup.valor_meta} className="mt-2" />
                      </div>

                      {/* Vendedores */}
                      {abertoSup && (
                        <div className="border-t border-blue-200 p-3 space-y-2">
                          {metaSup.filhos.length === 0 && (
                            <p className="text-xs text-slate-400 italic pl-4">Nenhum vendedor com meta. Use "Distribuir p/ Vendedores" acima.</p>
                          )}
                          {metaSup.filhos.map(metaVend => {
                            const pctVend = metaSup.valor_meta > 0 ? (metaVend.valor_meta / metaSup.valor_meta) * 100 : 0;
                            return (
                              <div key={metaVend.id} className="ml-4 flex items-center justify-between gap-2 p-2 rounded-lg bg-white border border-slate-200">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-sm font-medium truncate">{metaVend.vendedor_nome || metaVend.titulo}</span>
                                      <Badge className="bg-slate-100 text-slate-600 text-xs">Vendedor</Badge>
                                      <span className="text-xs text-slate-400">{fmtN(pctVend)}% do supervisor</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-xs text-slate-600">Meta: <strong>{fmt(metaVend.valor_meta)}</strong></span>
                                      {metaVend.volume_pacotes_meta > 0 && <span className="text-xs text-slate-500">| {metaVend.volume_pacotes_meta.toLocaleString('pt-BR')} pcts</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => abrirEditar(metaVend)}><Pencil className="w-3 h-3 text-slate-400" /></Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm('Excluir?')) excluir.mutate(metaVend.id); }}><Trash2 className="w-3 h-3 text-red-400" /></Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* Dialog de criação/edição de meta raiz */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editMeta ? 'Editar Meta' : 'Nova Meta'}</DialogTitle>
            <p className="text-xs text-slate-500">Use este formulário para criar/editar qualquer meta. Para distribuição em cascata, use os botões na árvore.</p>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nível</Label>
                <Select value={form.nivel} onValueChange={v => setForm(f => ({ ...f, nivel: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gerente">Gerente (Raiz)</SelectItem>
                    <SelectItem value="supervisor">Supervisor</SelectItem>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Mês de Referência</Label>
                <Input
                  type="month"
                  className="h-9"
                  value={form.mes_referencia}
                  onChange={e => setForm(f => ({ ...f, mes_referencia: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Título (opcional — será gerado automaticamente)</Label>
              <Input
                className="h-9"
                placeholder={`Meta ${NIVEL_LABELS[form.nivel]} — ${form.mes_referencia}`}
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              />
            </div>

            {form.nivel === 'gerente' && (
              <div>
                <Label className="text-xs">Gerente Responsável</Label>
                <Select value={form.gerente_id || '_'} onValueChange={v => {
                  const g = vendedores.find(x => x.id === v);
                  setForm(f => ({ ...f, gerente_id: v === '_' ? '' : v, gerente_nome: g?.nome || '' }));
                }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar gerente..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_">— Nenhum —</SelectItem>
                    {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">R$ Meta</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-9"
                  value={form.valor_meta}
                  onChange={e => setForm(f => ({ ...f, valor_meta: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Volume (Pacotes)</Label>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  className="h-9"
                  value={form.volume_pacotes_meta}
                  onChange={e => setForm(f => ({ ...f, volume_pacotes_meta: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Premiação</Label>
              <Input
                className="h-9"
                value={form.premiacao}
                onChange={e => setForm(f => ({ ...f, premiacao: e.target.value }))}
                placeholder="Premiação por atingimento..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancelar</Button>
            <Button
              onClick={() => salvar.mutate(form)}
              disabled={salvar.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-neutral-900"
            >
              {salvar.isPending ? 'Salvando...' : 'Salvar Meta'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de distribuição */}
      {distribuirMeta && (
        <DistribuirMetaModal
          open={!!distribuirMeta}
          onClose={() => setDistribuirMeta(null)}
          metaPai={distribuirMeta}
          nivelFilho={nivelDistribuir}
          destinatarios={
            nivelDistribuir === 'supervisor'
              ? supervisores.map(s => ({ id: s.id, nome: s.nome }))
              : vendedoresDoSupervisor(distribuirMeta.supervisor_id).map(v => ({ id: v.id, nome: v.nome }))
          }
          metasExistentes={
            metasDoMes.filter(m => m.meta_pai_id === distribuirMeta.id && m.nivel === nivelDistribuir)
          }
        />
      )}
    </div>
  );
}