import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollText, Info } from 'lucide-react';
import AbaHistorico from '@/components/logGerencial/AbaHistorico';
import AbaTiposAcao from '@/components/logGerencial/AbaTiposAcao';

export default function LogGerencial() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Log Gerencial"
        subtitle="Auditoria completa de todas as ações realizadas no sistema — quem, quando, o quê e como"
        icon={ScrollText}
      />
      <Tabs defaultValue="historico" className="w-full">
        <TabsList className="grid w-full md:max-w-md grid-cols-2 mb-4">
          <TabsTrigger value="historico"><ScrollText className="w-4 h-4 mr-2" />Histórico</TabsTrigger>
          <TabsTrigger value="tipos"><Info className="w-4 h-4 mr-2" />Tipos de Alteração</TabsTrigger>
        </TabsList>
        <TabsContent value="historico"><AbaHistorico /></TabsContent>
        <TabsContent value="tipos"><AbaTiposAcao /></TabsContent>
      </Tabs>
    </div>
  );
}