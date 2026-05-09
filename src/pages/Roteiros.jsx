import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { ClipboardList } from 'lucide-react';
import MeusRoteiros from '@/components/roteiros/MeusRoteiros';
import RotaSupervisores from '@/components/roteiros/RotaSupervisores';
import PainelRoteiros from '@/components/roteiros/PainelRoteiros';

export default function Roteiros() {
  const [user, setUser] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const sub = location.pathname.toLowerCase();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  useEffect(() => { base44.auth.me().then(setUser).catch(() => null); }, []);

  const vendedorAtual = useMemo(() => vendedores.find(v => v.email?.toLowerCase() === user?.email?.toLowerCase()), [vendedores, user]);
  const supervisores = useMemo(() => vendedores.filter(v => v.papeis?.includes('supervisor') || vendedores.some(x => x.supervisor_id === v.id)), [vendedores]);

  if (!user) return <div className="py-12 text-center text-slate-500">Carregando...</div>;

  if (sub.includes('rotasupervisores')) return wrap(<><PageHeader title="Rota Supervisores" subtitle="Acompanhamento da equipe" icon={ClipboardList} /><RotaSupervisores supervisor={vendedorAtual} vendedores={vendedores} /></>);
  if (sub.includes('paineld') || sub.includes('painelroteiros') || sub.includes('painel-roteiros')) return wrap(<><PageHeader title="Painel de Roteiros" subtitle="Gestão e acompanhamento de roteiros e visitas" icon={ClipboardList} /><PainelRoteiros vendedores={vendedores} supervisores={supervisores} /></>);

  return wrap(<>
    <PageHeader title="Meus Roteiros" subtitle={`Olá, ${(vendedorAtual?.nome || user?.full_name || '').toUpperCase()}`} icon={ClipboardList} />
    <MeusRoteiros vendedor={vendedorAtual || { id: user?.id, nome: user?.full_name, email: user?.email }} />
  </>);
}

const wrap = (children) => <div className="space-y-6">{children}</div>;