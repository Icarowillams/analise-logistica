import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Input } from '@/components/ui/input';
import { ClipboardList, Search } from 'lucide-react';
import CardClienteVisita from '@/components/MeusRoteiros/CardClienteVisita';

const DIAS = [
  { key: 'segunda-feira', curto: 'Seg' },
  { key: 'terca-feira', curto: 'Ter' },
  { key: 'quarta-feira', curto: 'Qua' },
  { key: 'quinta-feira', curto: 'Qui' },
  { key: 'sexta-feira', curto: 'Sex' },
  { key: 'sabado', curto: 'Sáb' },
  { key: 'domingo', curto: 'Dom' },
];

const diaAtualKey = () => {
  const map = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
  return map[new Date().getDay()];
};

export default function MeusRoteiros() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [diaSelecionado, setDiaSelecionado] = useState(diaAtualKey());
  const [busca, setBusca] = useState('');

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  useEffect(() => { base44.auth.me().then(setUser).catch(() => null); }, []);
  useEffect(() => {
    if (!user || !vendedores.length) return;
    setVendedorAtual(vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase()));
  }, [user, vendedores]);

  const vendedorId = vendedorAtual?.id;

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteirosVendedor', vendedorId],
    queryFn: () => base44.entities.Roteiro.filter({ vendedor_id: vendedorId }, '-updated_date', 200),
    enabled: !!vendedorId
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasVendedor', vendedorId],
    queryFn: () => base44.entities.Visita.filter({ vendedor_id: vendedorId }, '-data_visita', 1000),
    enabled: !!vendedorId
  });

  const contagensPorDia = useMemo(() => {
    const c = {};
    DIAS.forEach(d => { c[d.key] = 0; });
    roteiros.forEach(r => {
      const qtd = (r.clientes_detalhes?.length || r.clientes_ids?.length || 0);
      c[r.dia_semana] = (c[r.dia_semana] || 0) + qtd;
    });
    return c;
  }, [roteiros]);

  const roteiroDoDia = useMemo(() => roteiros.find(r => r.dia_semana === diaSelecionado), [roteiros, diaSelecionado]);

  const clientes = useMemo(() => {
    const lista = [...(roteiroDoDia?.clientes_detalhes || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    if (!busca.trim()) return lista;
    const t = busca.toLowerCase();
    return lista.filter(c =>
      (c.cliente_nome || '').toLowerCase().includes(t) ||
      (c.nome_fantasia || '').toLowerCase().includes(t) ||
      (c.cliente_codigo || '').toLowerCase().includes(t)
    );
  }, [roteiroDoDia, busca]);

  const hojeISO = new Date().toISOString().slice(0, 10);
  const visitaDoCliente = (clienteId) => visitas.find(v => v.cliente_id === clienteId && v.roteiro_id === roteiroDoDia?.id && v.data_visita === hojeISO);

  if (!user) return <div className="py-12 text-center text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-4">
      <PageHeader title="Meus Roteiros" subtitle={`Olá, ${(vendedorAtual?.nome || user?.full_name || '').toUpperCase()}`} icon={ClipboardList} />

      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[700px]">
          {DIAS.map(d => {
            const ativo = diaSelecionado === d.key;
            const qtd = contagensPorDia[d.key] || 0;
            return (
              <button key={d.key} onClick={() => setDiaSelecionado(d.key)} className={`py-3 text-center text-sm font-medium border-r last:border-r-0 transition ${ativo ? 'bg-white border-b-2 border-amber-500 text-slate-900' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                <div className="flex items-center justify-center gap-2">
                  <span>{d.curto}</span>
                  <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full ${qtd > 0 ? 'bg-amber-400 text-neutral-900' : 'bg-slate-200 text-slate-500'}`}>{qtd}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9 bg-white" placeholder="Buscar por razão social, nome fantasia ou código..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="space-y-3">
        {clientes.length === 0 && <div className="bg-white rounded-xl border p-8 text-center text-slate-400">Sem clientes para este dia.</div>}
        {clientes.map((c, i) => (
          <CardClienteVisita
            key={c.cliente_id}
            cliente={c}
            ordem={i + 1}
            roteiro={roteiroDoDia}
            vendedor={vendedorAtual}
            visitaExistente={visitaDoCliente(c.cliente_id)}
            onChange={() => queryClient.invalidateQueries({ queryKey: ['visitasVendedor'] })}
          />
        ))}
      </div>
    </div>
  );
}