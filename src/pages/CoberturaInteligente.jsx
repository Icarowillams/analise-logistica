import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutDashboard, Bell, CalendarDays, Route, Trophy, FileBarChart, Settings } from 'lucide-react';
import PainelCobertura from '@/components/cobertura/PainelCobertura';
import AlertasCobertura from '@/components/cobertura/AlertasCobertura';
import AgendaMensal from '@/components/cobertura/AgendaMensal';
import RoteiroDoDia from '@/components/cobertura/RoteiroDoDia';
import RankingCobertura from '@/components/cobertura/RankingCobertura';
import RelatoriosCobertura from '@/components/cobertura/RelatoriosCobertura';
import ParametrosCobertura from '@/components/cobertura/ParametrosCobertura';

export default function CoberturaInteligente() {
  const [tab, setTab] = useState('painel');

  return (
    <div className="max-w-[1500px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Cobertura Inteligente de Carteira</h1>
        <p className="text-slate-500 text-sm mt-1">
          Cobertura por papel, alertas em cascata, agenda mensal, roteiro do dia, ranking e relatórios de visita/reposição.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-nowrap sm:flex-wrap h-auto gap-1 bg-slate-100 p-1 w-full overflow-x-auto [-webkit-overflow-scrolling:touch] justify-start [&>button]:shrink-0 sm:[&>button]:shrink">
          <TabsTrigger value="painel" className="gap-2"><LayoutDashboard className="w-4 h-4" /> Painel</TabsTrigger>
          <TabsTrigger value="alertas" className="gap-2"><Bell className="w-4 h-4" /> Alertas</TabsTrigger>
          <TabsTrigger value="agenda" className="gap-2"><CalendarDays className="w-4 h-4" /> Agenda Mensal</TabsTrigger>
          <TabsTrigger value="roteiro" className="gap-2"><Route className="w-4 h-4" /> Roteiro do Dia</TabsTrigger>
          <TabsTrigger value="ranking" className="gap-2"><Trophy className="w-4 h-4" /> Ranking</TabsTrigger>
          <TabsTrigger value="relatorios" className="gap-2"><FileBarChart className="w-4 h-4" /> Relatórios</TabsTrigger>
          <TabsTrigger value="parametros" className="gap-2"><Settings className="w-4 h-4" /> Parâmetros</TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="mt-4"><PainelCobertura /></TabsContent>
        <TabsContent value="alertas" className="mt-4"><AlertasCobertura /></TabsContent>
        <TabsContent value="agenda" className="mt-4"><AgendaMensal /></TabsContent>
        <TabsContent value="roteiro" className="mt-4"><RoteiroDoDia /></TabsContent>
        <TabsContent value="ranking" className="mt-4"><RankingCobertura /></TabsContent>
        <TabsContent value="relatorios" className="mt-4"><RelatoriosCobertura /></TabsContent>
        <TabsContent value="parametros" className="mt-4"><ParametrosCobertura /></TabsContent>
      </Tabs>
    </div>
  );
}