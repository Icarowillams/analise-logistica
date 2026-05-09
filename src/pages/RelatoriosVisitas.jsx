import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, ClipboardList, Package, ArrowLeftRight, Users } from 'lucide-react';
import RelatorioRoteiros from '@/components/relatorios/RelatorioRoteiros';
import RelatorioEstoque from '@/components/relatorios/RelatorioEstoque';
import RelatorioTrocas from '@/components/relatorios/RelatorioTrocas';
import RotinaSupervisores from '@/components/relatorios/RotinaSupervisores';

export default function RelatoriosVisitas() {
  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios Visitas" subtitle="Auditoria, controle e detalhamento das operações em campo" icon={FileText} />
      <Tabs defaultValue="roteiros" className="w-full">
        <TabsList className="grid w-full md:max-w-3xl grid-cols-2 md:grid-cols-4 mb-6">
          <TabsTrigger value="roteiros"><ClipboardList className="w-4 h-4 mr-2" />Roteiros/Visitas</TabsTrigger>
          <TabsTrigger value="estoque"><Package className="w-4 h-4 mr-2" />Estoque</TabsTrigger>
          <TabsTrigger value="trocas"><ArrowLeftRight className="w-4 h-4 mr-2" />Trocas</TabsTrigger>
          <TabsTrigger value="supervisores"><Users className="w-4 h-4 mr-2" />Rotina Supervisores</TabsTrigger>
        </TabsList>
        <TabsContent value="roteiros"><RelatorioRoteiros /></TabsContent>
        <TabsContent value="estoque"><RelatorioEstoque /></TabsContent>
        <TabsContent value="trocas"><RelatorioTrocas /></TabsContent>
        <TabsContent value="supervisores"><RotinaSupervisores /></TabsContent>
      </Tabs>
    </div>
  );
}