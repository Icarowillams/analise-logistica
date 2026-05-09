import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Package, ArrowLeftRight } from 'lucide-react';
import EstoqueForm from '@/components/MeusRoteiros/EstoqueForm';
import TrocasForm from '@/components/MeusRoteiros/TrocasForm';

export default function EstoqueSupervisorForm({ visitaId, clienteId, clienteNome }) {
  return (
    <div className="p-3 bg-orange-50 rounded-lg border border-orange-200 space-y-3">
      <Label className="text-sm font-semibold text-orange-800">Informar Estoque</Label>
      <Tabs defaultValue="estoque" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="estoque" className="gap-1 text-xs"><Package className="w-3 h-3" />Estoque</TabsTrigger>
          <TabsTrigger value="trocas" className="gap-1 text-xs"><ArrowLeftRight className="w-3 h-3" />Trocas</TabsTrigger>
        </TabsList>
        <TabsContent value="estoque">
          <EstoqueForm visitaId={visitaId} clienteId={clienteId} clienteNome={clienteNome} />
        </TabsContent>
        <TabsContent value="trocas">
          <TrocasForm visitaId={visitaId} clienteId={clienteId} clienteNome={clienteNome} />
        </TabsContent>
      </Tabs>
    </div>
  );
}