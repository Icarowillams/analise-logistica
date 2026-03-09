import React from 'react';
import { Package } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import GrupoMixForm from '@/components/MixProdutos/GrupoMixForm';
import MixClienteForm from '@/components/MixProdutos/MixClienteForm';

export default function MixProdutos() {
  return (
    <div>
      <PageHeader
        title="Mix de Produtos"
        subtitle="Gerencie os produtos disponíveis por cliente"
        icon={Package}
      />

      <Tabs defaultValue="clientes" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="clientes">Mix por Cliente</TabsTrigger>
          <TabsTrigger value="grupos">Grupos de Mix</TabsTrigger>
        </TabsList>

        <TabsContent value="clientes">
          <MixClienteForm />
        </TabsContent>

        <TabsContent value="grupos">
          <GrupoMixForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}