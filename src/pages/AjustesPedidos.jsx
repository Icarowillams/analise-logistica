import React from 'react';
import { Wrench } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CorteTab from '@/components/ajustes/CorteTab';
import TransferenciaTab from '@/components/ajustes/TransferenciaTab';
import LogCortesView from '@/components/ajustes/LogCortesView';
import LogTransferenciasView from '@/components/ajustes/LogTransferenciasView';

export default function AjustesPedidos() {
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Wrench className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Ajustes de Pedidos</h1>
          <p className="text-sm text-slate-500">Corte de produtos por carga, transferência entre cargas e logs de auditoria</p>
        </div>
      </div>

      <Tabs defaultValue="corte">
        <TabsList>
          <TabsTrigger value="corte">Corte por Carga</TabsTrigger>
          <TabsTrigger value="transferencia">Transferência</TabsTrigger>
          <TabsTrigger value="log-corte">Log de Cortes</TabsTrigger>
          <TabsTrigger value="log-transferencia">Log de Transferências</TabsTrigger>
        </TabsList>

        <TabsContent value="corte"><CorteTab /></TabsContent>
        <TabsContent value="transferencia"><TransferenciaTab /></TabsContent>
        <TabsContent value="log-corte"><LogCortesView /></TabsContent>
        <TabsContent value="log-transferencia"><LogTransferenciasView /></TabsContent>
      </Tabs>
    </div>
  );
}