import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Route, Users, BarChart3 } from 'lucide-react';
import MeusRoteiros from '@/components/roteiros/MeusRoteiros';
import RotaSupervisores from '@/components/roteiros/RotaSupervisores';
import PainelGestorRoteiros from '@/components/roteiros/PainelGestorRoteiros';

export default function Roteiros() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 10000) });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => base44.entities.Pedido.list('-updated_date', 10000) });

  useEffect(() => { base44.auth.me().then(setUser).catch(() => null); }, []);
  useEffect(() => {
    const unsub = base44.entities.VisitaRoteiro.subscribe(() => queryClient.invalidateQueries({ queryKey: ['visitasRoteiro'] }));
    return unsub;
  }, [queryClient]);

  const vendedorAtual = useMemo(() => vendedores.find(v => v.email?.toLowerCase() === user?.email?.toLowerCase()), [vendedores, user]);
  const isAdmin = user?.role === 'admin';
  const isSupervisor = isAdmin || vendedores.some(v => v.supervisor_id === vendedorAtual?.id || v.supervisor_ids?.includes(vendedorAtual?.id));

  if (!user) return <div className="py-12 text-center text-slate-500">Carregando roteiros...</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Roteiros" subtitle="Planejamento, execução e acompanhamento das visitas comerciais" icon={Route} />

      {!vendedorAtual && !isAdmin && <Alert><AlertDescription>Seu usuário ainda não está vinculado a um funcionário/vendedor.</AlertDescription></Alert>}

      <Tabs defaultValue="meus" className="w-full">
        <TabsList className={`grid w-full ${isSupervisor || isAdmin ? 'grid-cols-3' : 'grid-cols-1'} mb-6`}>
          <TabsTrigger value="meus"><Route className="w-4 h-4 mr-2" />Meus Roteiros</TabsTrigger>
          {(isSupervisor || isAdmin) && <TabsTrigger value="supervisor"><Users className="w-4 h-4 mr-2" />Rota Supervisores</TabsTrigger>}
          {(isSupervisor || isAdmin) && <TabsTrigger value="gestor"><BarChart3 className="w-4 h-4 mr-2" />Painel Gestor</TabsTrigger>}
        </TabsList>
        <TabsContent value="meus"><MeusRoteiros vendedor={vendedorAtual || { id: null }} roteiros={roteiros} visitas={visitas} pedidos={pedidos} onRefresh={() => queryClient.invalidateQueries({ queryKey: ['visitasRoteiro'] })} /></TabsContent>
        {(isSupervisor || isAdmin) && <TabsContent value="supervisor"><RotaSupervisores vendedores={vendedores} supervisor={vendedorAtual} roteiros={roteiros} visitas={visitas} pedidos={pedidos} onRefresh={() => queryClient.invalidateQueries({ queryKey: ['roteiros'] })} /></TabsContent>}
        {(isSupervisor || isAdmin) && <TabsContent value="gestor"><PainelGestorRoteiros roteiros={roteiros} visitas={visitas} vendedores={vendedores} /></TabsContent>}
      </Tabs>
    </div>
  );
}