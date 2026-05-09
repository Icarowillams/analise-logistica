import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Activity, ArrowLeftRight, TrendingUp } from 'lucide-react';
import AnaliseVisitas from '@/components/analises/AnaliseVisitas';
import DashboardTrocas from '@/components/analises/DashboardTrocas';
import DashboardVendas from '@/components/analises/DashboardVendas';

export default function AnalisesComercial() {
  return (
    <div className="space-y-6">
      <PageHeader title="Análises Comercial" subtitle="Dashboards estratégicos de visitas, trocas e vendas" icon={BarChart3} />
      <Tabs defaultValue="vendas" className="w-full">
        <TabsList className="grid w-full md:max-w-xl grid-cols-3 mb-6">
          <TabsTrigger value="vendas"><TrendingUp className="w-4 h-4 mr-2" />Vendas</TabsTrigger>
          <TabsTrigger value="visitas"><Activity className="w-4 h-4 mr-2" />Visitas</TabsTrigger>
          <TabsTrigger value="trocas"><ArrowLeftRight className="w-4 h-4 mr-2" />Trocas</TabsTrigger>
        </TabsList>
        <TabsContent value="vendas"><DashboardVendas /></TabsContent>
        <TabsContent value="visitas"><AnaliseVisitas /></TabsContent>
        <TabsContent value="trocas"><DashboardTrocas /></TabsContent>
      </Tabs>
    </div>
  );
}