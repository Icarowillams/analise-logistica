import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { FileText, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import AbaNaturezasOmie from '@/components/cenariosFiscais/AbaNaturezasOmie';
import AbaEtapasOmie from '@/components/cenariosFiscais/AbaEtapasOmie';
import AbaCenariosLocais from '@/components/cenariosFiscais/AbaCenariosLocais';

export default function CenariosFiscais() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('naturezas');
  const [sincronizando, setSincronizando] = useState(false);

  const { data: cenarios = [] } = useQuery({
    queryKey: ['cenariosFiscais'],
    queryFn: () => base44.entities.CenarioFiscal.list('-created_date', 500)
  });

  const naturezas = useMemo(
    () => cenarios.filter(c => (c.tipo_registro || 'cenario') === 'cenario'),
    [cenarios]
  );
  const etapas = useMemo(
    () => cenarios.filter(c => c.tipo_registro === 'etapa'),
    [cenarios]
  );

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const { data } = await base44.functions.invoke('importarCenariosFiscaisOmie', {});
      if (data?.sucesso) {
        const partes = [];
        const totalC = (data.cenarios?.criados || 0) + (data.cenarios?.atualizados || 0);
        const totalE = (data.etapas?.criadas || 0) + (data.etapas?.atualizadas || 0);
        if (totalC > 0) partes.push(`${totalC} naturezas`);
        if (totalE > 0) partes.push(`${totalE} etapas`);
        toast.success(`Sincronizado: ${partes.join(' + ') || 'nada novo'}`);
        if (data.cenarios?.aviso) toast.warning(data.cenarios.aviso, { duration: 8000 });
        qc.invalidateQueries({ queryKey: ['cenariosFiscais'] });
      } else {
        toast.error(data?.error || 'Erro ao sincronizar');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shrink-0">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-neutral-900" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-neutral-900">Cenários Fiscais</h1>
            <p className="text-xs sm:text-sm text-neutral-500">Espelho somente leitura do Omie — Naturezas e Etapas</p>
          </div>
        </div>
        <Button
          onClick={sincronizar}
          disabled={sincronizando}
          variant="outline"
          className="border-blue-300 text-blue-700 hover:bg-blue-50 w-full sm:w-auto justify-center"
        >
          {sincronizando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Importar do Omie
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-nowrap max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch] justify-start [&>button]:shrink-0">
          <TabsTrigger value="locais">Cenários Locais</TabsTrigger>
          <TabsTrigger value="naturezas">Naturezas Omie ({naturezas.length})</TabsTrigger>
          <TabsTrigger value="etapas">Etapas Omie ({etapas.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="locais" className="mt-4">
          <AbaCenariosLocais naturezasOmie={naturezas} />
        </TabsContent>

        <TabsContent value="naturezas" className="mt-4">
          <AbaNaturezasOmie naturezas={naturezas} />
        </TabsContent>

        <TabsContent value="etapas" className="mt-4">
          <AbaEtapasOmie etapas={etapas} />
        </TabsContent>
      </Tabs>
    </div>
  );
}