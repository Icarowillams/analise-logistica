import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileText, FileWarning } from 'lucide-react';
import NotasNF55Tab from '@/components/notasOmie/NotasNF55Tab';
import NotasD1Tab from '@/components/notasOmie/NotasD1Tab';

export default function NotasOmie() {
  const [tab, setTab] = useState('nf55');
  const [cargaFiltro, setCargaFiltro] = useState(null);
  const [cargaFiltroId, setCargaFiltroId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cargaId = params.get('carga_id');
    const tabParam = params.get('tab');
    if (tabParam === 'd1' || tabParam === 'nf55') setTab(tabParam);
    if (!cargaId) return;

    setCargaFiltroId(cargaId);
    (async () => {
      const cargas = await base44.entities.Carga.filter({ id: cargaId }, '-created_date', 1);
      const carga = cargas?.[0];
      if (carga) setCargaFiltro(carga);
    })();
  }, []);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <FileText className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Notas Fiscais</h1>
          <p className="text-sm text-slate-500">Consulta de NF-e (Omie) e Notas D1 (vendas internas)</p>
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
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="nf55" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Nota 55 (NF-e)
          </TabsTrigger>
          <TabsTrigger value="d1" className="flex items-center gap-2">
            <FileWarning className="w-4 h-4" /> Nota D1 (Interna)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nf55" className="mt-4">
          <NotasNF55Tab cargaFiltro={cargaFiltro} />
        </TabsContent>

        <TabsContent value="d1" className="mt-4">
          <NotasD1Tab cargaFiltroId={cargaFiltroId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}