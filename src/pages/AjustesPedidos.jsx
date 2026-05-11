import React from 'react';
import { Wrench } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CorteTab from '@/components/ajustes/CorteTab';
import TransferenciaTab from '@/components/ajustes/TransferenciaTab';

export default function AjustesPedidos() {
  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Wrench className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Ajustes de Pedidos</h1>
          <p className="text-sm text-slate-500">Corte de produtos por carga e transferência entre cargas</p>
        </div>
      </div>

      <Tabs defaultValue="corte">
        <TabsList>
          <TabsTrigger value="corte">Corte por Carga</TabsTrigger>
          <TabsTrigger value="transferencia">Transferência</TabsTrigger>
        </TabsList>

        <TabsContent value="corte"><CorteTab /></TabsContent>
        <TabsContent value="transferencia"><TransferenciaTab /></TabsContent>
      </Tabs>
    </div>
  );
}