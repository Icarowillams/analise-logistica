import React, { useState } from 'react';
import { Target } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetasProduto from './MetasProduto';
import MetasPositivacao from './MetasPositivacao';
import MetasPrecoMedio from './MetasPrecoMedio';
import MetasCadastro from './MetasCadastro';
import MetasTroca from './MetasTroca';

export default function CadastroMetas() {
  const [activeTab, setActiveTab] = useState('produto');

  return (
    <div className="space-y-4">
      <PageHeader title="Cadastro de Metas" subtitle="Gerencie todas as metas em um só lugar" icon={Target} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="produto">Produto</TabsTrigger>
          <TabsTrigger value="positivacao">Positivação</TabsTrigger>
          <TabsTrigger value="preco_medio">Preço Médio</TabsTrigger>
          <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          <TabsTrigger value="troca">Troca</TabsTrigger>
        </TabsList>

        <TabsContent value="produto"><MetasProduto embedded /></TabsContent>
        <TabsContent value="positivacao"><MetasPositivacao embedded /></TabsContent>
        <TabsContent value="preco_medio"><MetasPrecoMedio embedded /></TabsContent>
        <TabsContent value="cadastro"><MetasCadastro embedded /></TabsContent>
        <TabsContent value="troca"><MetasTroca embedded /></TabsContent>
      </Tabs>
    </div>
  );
}