import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileText, FileWarning, Printer, FileSignature, ScrollText } from 'lucide-react';
import NotasNF55Tab from '@/components/notasOmie/NotasNF55Tab';
import NotasD1Tab from '@/components/notasOmie/NotasD1Tab';
import EmissaoNFTab from '@/components/notasOmie/EmissaoNFTab';
import LogEmissaoNFTab from '@/components/notasOmie/LogEmissaoNFTab';

export default function NotasOmie() {
  // Abas:
  // - impressao_nf55  → consulta/impressão de NF-e (NF 55) já emitidas no Omie
  // - impressao_d1    → consulta/impressão de notas internas D1
  // - emissao         → emitir NF-e (individual ou em lote) para pedidos em etapa 50
  const [tab, setTab] = useState('impressao_nf55');
  const [cargaFiltro, setCargaFiltro] = useState(null);
  const [cargaFiltroId, setCargaFiltroId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cargaId = params.get('carga_id');
    const tabParam = params.get('tab');
    // Aceita os valores legacy (nf55 / d1) e os novos (impressao_nf55 / impressao_d1 / emissao)
    if (tabParam === 'd1' || tabParam === 'impressao_d1') setTab('impressao_d1');
    else if (tabParam === 'nf55' || tabParam === 'impressao_nf55') setTab('impressao_nf55');
    else if (tabParam === 'emissao') setTab('emissao');
    else if (tabParam === 'log' || tabParam === 'log_emissao') setTab('log_emissao');

    if (!cargaId) return;

    setCargaFiltroId(cargaId);
    // Delay pequeno para não competir com queries do Layout/Cargas que acabaram de disparar (evita 429)
    const timer = setTimeout(async () => {
      try {
        const carga = await base44.entities.Carga.get(cargaId);
        if (carga) setCargaFiltro(carga);
      } catch (e) {
        console.warn('Falha ao carregar carga', e);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <FileText className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Notas Fiscais</h1>
          <p className="text-sm text-slate-500">Emissão, consulta e impressão de NF-e (Omie) e notas D1 internas</p>
        </div>
      </div>

      {cargaFiltro && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 text-sm text-blue-800">
            Exibindo notas filtradas pela carga <b>{cargaFiltro.numero_carga}</b>.
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-3xl">
          <TabsTrigger value="emissao" className="flex items-center gap-2">
            <FileSignature className="w-4 h-4" /> Emissão
          </TabsTrigger>
          <TabsTrigger value="log_emissao" className="flex items-center gap-2">
            <ScrollText className="w-4 h-4" /> Log de Emissão
          </TabsTrigger>
          <TabsTrigger value="impressao_nf55" className="flex items-center gap-2">
            <Printer className="w-4 h-4" /> Impressão NF 55
          </TabsTrigger>
          <TabsTrigger value="impressao_d1" className="flex items-center gap-2">
            <FileWarning className="w-4 h-4" /> Impressão D1
          </TabsTrigger>
        </TabsList>

        <TabsContent value="emissao" className="mt-4">
          <EmissaoNFTab cargaFiltro={cargaFiltro} ativa={tab === 'emissao'} />
        </TabsContent>

        <TabsContent value="log_emissao" className="mt-4">
          <LogEmissaoNFTab ativa={tab === 'log_emissao'} />
        </TabsContent>

        <TabsContent value="impressao_nf55" className="mt-4">
          <NotasNF55Tab cargaFiltro={cargaFiltro} ativa={tab === 'impressao_nf55'} />
        </TabsContent>

        <TabsContent value="impressao_d1" className="mt-4">
          <NotasD1Tab cargaFiltroId={cargaFiltroId} ativa={tab === 'impressao_d1'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}