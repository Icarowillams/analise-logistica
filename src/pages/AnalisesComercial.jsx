import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Activity, ArrowLeftRight, TrendingUp, User, Users, Target, Map } from 'lucide-react';
import AnaliseVisitas from '@/components/analises/AnaliseVisitas';
import DashboardTrocas from '@/components/analises/DashboardTrocas';
import DashboardVendas from '@/components/analises/DashboardVendas';
import DashboardVendedor from '@/components/analises/DashboardVendedor';
import DashboardClientes from '@/components/analises/DashboardClientes';
import DashboardMetas from '@/components/analises/DashboardMetas';
import MapaVisitas from '@/components/analises/MapaVisitas';

// Mapa rota → tab
const ROTA_TAB = {
  '/DashboardVendas': 'vendas',
  '/dashboardvendas': 'vendas',
  '/DashboardTrocas': 'trocas',
  '/dashboardtrocas': 'trocas',
  '/DashboardVendedor': 'vendedor',
  '/dashboardvendedor': 'vendedor',
  '/DashboardClientes': 'clientes',
  '/dashboardclientes': 'clientes',
};

export default function AnalisesComercial() {
  const location = useLocation();
  const tabInicial = ROTA_TAB[location.pathname] || 'vendas';
  const [tab, setTab] = useState(tabInicial);

  useEffect(() => {
    const t = ROTA_TAB[location.pathname];
    if (t) setTab(t);
  }, [location.pathname]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análises Comercial"
        subtitle="Dashboards estratégicos de vendas, trocas, visitas, vendedores, clientes, metas e mapa"
        icon={BarChart3}
      />
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto mb-6 bg-slate-100 p-1 rounded-lg w-full">
          <TabsTrigger value="vendas" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="w-3.5 h-3.5" />Vendas
          </TabsTrigger>
          <TabsTrigger value="trocas" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <ArrowLeftRight className="w-3.5 h-3.5" />Trocas
          </TabsTrigger>
          <TabsTrigger value="visitas" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Activity className="w-3.5 h-3.5" />Visitas
          </TabsTrigger>
          <TabsTrigger value="vendedor" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <User className="w-3.5 h-3.5" />Vendedor
          </TabsTrigger>
          <TabsTrigger value="clientes" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Users className="w-3.5 h-3.5" />Clientes
          </TabsTrigger>
          <TabsTrigger value="metas" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Target className="w-3.5 h-3.5" />Metas
          </TabsTrigger>
          <TabsTrigger value="mapa" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Map className="w-3.5 h-3.5" />Mapa
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vendas"><DashboardVendas /></TabsContent>
        <TabsContent value="trocas"><DashboardTrocas /></TabsContent>
        <TabsContent value="visitas"><AnaliseVisitas /></TabsContent>
        <TabsContent value="vendedor"><DashboardVendedor /></TabsContent>
        <TabsContent value="clientes"><DashboardClientes /></TabsContent>
        <TabsContent value="metas"><DashboardMetas /></TabsContent>
        <TabsContent value="mapa"><MapaVisitas /></TabsContent>
      </Tabs>
    </div>
  );
}
