import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Activity, ArrowLeftRight, TrendingUp, User, Users } from 'lucide-react';
import AnaliseVisitas from '@/components/analises/AnaliseVisitas';
import DashboardTrocas from '@/components/analises/DashboardTrocas';
import DashboardVendas from '@/components/analises/DashboardVendas';
import DashboardVendedor from '@/components/analises/DashboardVendedor';
import DashboardClientes from '@/components/analises/DashboardClientes';

// Mapa de rota → tab
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

  // Atualiza a tab se o usuário navegar via menu lateral para outra rota
  useEffect(() => {
    const t = ROTA_TAB[location.pathname];
    if (t) setTab(t);
  }, [location.pathname]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análises Comercial"
        subtitle="Dashboards estratégicos de vendas, trocas, visitas, vendedores e clientes"
        icon={BarChart3}
      />
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto mb-6 bg-slate-100 p-1 rounded-lg">
          <TabsTrigger value="vendas" className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" />Vendas
          </TabsTrigger>
          <TabsTrigger value="trocas" className="flex items-center gap-1.5">
            <ArrowLeftRight className="w-4 h-4" />Trocas
          </TabsTrigger>
          <TabsTrigger value="visitas" className="flex items-center gap-1.5">
            <Activity className="w-4 h-4" />Visitas
          </TabsTrigger>
          <TabsTrigger value="vendedor" className="flex items-center gap-1.5">
            <User className="w-4 h-4" />Por vendedor
          </TabsTrigger>
          <TabsTrigger value="clientes" className="flex items-center gap-1.5">
            <Users className="w-4 h-4" />Clientes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vendas"><DashboardVendas /></TabsContent>
        <TabsContent value="trocas"><DashboardTrocas /></TabsContent>
        <TabsContent value="visitas"><AnaliseVisitas /></TabsContent>
        <TabsContent value="vendedor"><DashboardVendedor /></TabsContent>
        <TabsContent value="clientes"><DashboardClientes /></TabsContent>
      </Tabs>
    </div>
  );
}
