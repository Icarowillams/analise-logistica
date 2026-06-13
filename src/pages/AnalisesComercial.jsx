import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Activity, ArrowLeftRight, TrendingUp, User, Users, Target, Map, Zap, CreditCard, MapPin } from 'lucide-react';
import AnaliseVisitas from '@/components/analises/AnaliseVisitas';
import DashboardTrocas from '@/components/analises/DashboardTrocas';
import DashboardVendas from '@/components/analises/DashboardVendas';
import DashboardVendedor from '@/components/analises/DashboardVendedor';
import DashboardClientes from '@/components/analises/DashboardClientes';
import DashboardMetas from '@/components/analises/DashboardMetas';
import MapaVisitas from '@/components/analises/MapaVisitas';
import PainelMetas from '@/components/analises/PainelMetas';
import AtingimentoDiario from '@/components/analises/AtingimentoDiario';
import PainelCobrancas from '@/components/analises/PainelCobrancas';
import CoberturaVisitas from '@/components/analises/CoberturaVisitas';

// Mapa rota → tab
const ROTA_TAB = {
  '/PainelMetas': 'painel',
  '/painelmetas': 'painel',
  '/AtingimentoDiario': 'atingimento',
  '/atingimentodiario': 'atingimento',
  '/Cobrancas': 'cobrancas',
  '/cobrancas': 'cobrancas',
  '/CoberturaVisitas': 'cobertura',
  '/coberturavisitas': 'cobertura',
  '/DashboardVendas': 'vendas',
  '/dashboardvendas': 'vendas',
  '/DashboardTrocas': 'trocas',
  '/dashboardtrocas': 'trocas',
  '/DashboardVendedor': 'vendedor',
  '/dashboardvendedor': 'vendedor',
  '/DashboardClientes': 'clientes',
  '/dashboardclientes': 'clientes',
  '/AnaliseDeVisitas': 'visitas',
  '/analisedevisitas': 'visitas',
  '/MapaDeVisitas': 'mapa',
  '/mapadevisitas': 'mapa',
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
          <TabsTrigger value="painel" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Target className="w-3.5 h-3.5" />Painel de Metas
          </TabsTrigger>
          <TabsTrigger value="atingimento" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Zap className="w-3.5 h-3.5" />Ating. Diário
          </TabsTrigger>
          <TabsTrigger value="cobrancas" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CreditCard className="w-3.5 h-3.5" />Cobranças
          </TabsTrigger>
          <TabsTrigger value="cobertura" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <MapPin className="w-3.5 h-3.5" />Cobertura
          </TabsTrigger>
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

        <TabsContent value="painel"><PainelMetas /></TabsContent>
        <TabsContent value="atingimento"><AtingimentoDiario /></TabsContent>
        <TabsContent value="cobrancas"><PainelCobrancas /></TabsContent>
        <TabsContent value="cobertura"><CoberturaVisitas /></TabsContent>
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