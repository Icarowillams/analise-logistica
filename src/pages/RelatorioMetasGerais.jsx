import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MetasProduto from './MetasProduto';
import MetasPositivacao from './MetasPositivacao';
import MetasPrecoMedio from './MetasPrecoMedio';
import MetasCadastro from './MetasCadastro';
import MetasTroca from './MetasTroca';
import CompiladoMetas from '@/components/metas/CompiladoMetas';

export default function RelatorioMetasGerais() {
  const [activeTab, setActiveTab] = useState('compilado');

  return (
    <div className="space-y-4">
      <PageHeader title="Relatório de Metas Gerais" subtitle="Acompanhe o desempenho das metas" icon={BarChart3} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="compilado">Compilado</TabsTrigger>
          <TabsTrigger value="produto">Produto</TabsTrigger>
          <TabsTrigger value="positivacao">Positivação</TabsTrigger>
          <TabsTrigger value="preco_medio">Preço Médio</TabsTrigger>
          <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          <TabsTrigger value="troca">Troca</TabsTrigger>
        </TabsList>

        <TabsContent value="compilado"><CompiladoMetas /></TabsContent>
        <TabsContent value="produto"><MetasProduto embedded /></TabsContent>
        <TabsContent value="positivacao"><MetasPositivacao embedded /></TabsContent>
        <TabsContent value="preco_medio"><MetasPrecoMedio embedded /></TabsContent>
        <TabsContent value="cadastro"><MetasCadastro embedded /></TabsContent>
        <TabsContent value="troca"><MetasTroca embedded /></TabsContent>
      </Tabs>
    </div>
  );
}