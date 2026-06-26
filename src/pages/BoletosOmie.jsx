import React, { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Receipt, FileSignature, Printer, History } from 'lucide-react';
import EmissaoBoletosConteudo from '@/components/boletos/EmissaoBoletosConteudo';
import BoletosConsultaTab from '@/components/boletos/BoletosConsultaTab';
import LogEmissaoBoletoTab from '@/components/boletos/LogEmissaoBoletoTab';

export default function BoletosOmie() {
  // Abas:
  // - emissao    → seleciona carga, escolhe títulos e gera boletos no Omie (+ gerar faltantes por prazo)
  // - impressao  → consulta e impressão de boletos (2ª via): individual ou agrupado
  const [tab, setTab] = useState('emissao');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'impressao' || tabParam === 'consulta') setTab('impressao');
    else if (tabParam === 'historico') setTab('historico');
    else if (tabParam === 'emissao') setTab('emissao');
  }, []);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Receipt className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 shrink-0" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Boletos Omie</h1>
          <p className="text-sm text-slate-500">Emissão de boletos por carga e consulta/impressão (2ª via)</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="emissao" className="flex items-center gap-1.5 px-1.5">
            <FileSignature className="w-4 h-4 shrink-0" /> Emissão
          </TabsTrigger>
          <TabsTrigger value="historico" className="flex items-center gap-1.5 px-1.5">
            <History className="w-4 h-4 shrink-0" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="impressao" className="flex items-center gap-1.5 px-1.5">
            <Printer className="w-4 h-4 shrink-0" /> <span className="hidden sm:inline">Consulta / </span>Impressão
          </TabsTrigger>
        </TabsList>

        <TabsContent value="emissao" className="mt-4">
          <EmissaoBoletosConteudo ativa={tab === 'emissao'} />
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <LogEmissaoBoletoTab />
        </TabsContent>

        <TabsContent value="impressao" className="mt-4">
          <BoletosConsultaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}