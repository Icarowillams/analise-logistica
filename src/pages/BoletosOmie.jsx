import React, { useState } from 'react';
import { Receipt, Printer, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FiltrosBoletos from '@/components/boletos/FiltrosBoletos';
import TabelaBoletos from '@/components/boletos/TabelaBoletos';
import BoletosImpressaoDialog from '@/components/boletos/BoletosImpressaoDialog';

import { toast } from 'sonner';

export default function BoletosOmie() {
  const [titulos, setTitulos] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [imprimirOpen, setImprimirOpen] = useState(false);
  const [modoImpressao, setModoImpressao] = useState('individual');

  const titulosSelecionados = titulos.filter(t => selecionados.includes(t.codigo_lancamento));
  const titulosComBoleto = titulosSelecionados.filter(t => t.boleto_gerado || t.numero_boleto);

  const abrirImpressao = (modo) => {
    if (titulosSelecionados.length === 0) {
      toast.error('Selecione ao menos um título');
      return;
    }
    const semBoleto = titulosSelecionados.length - titulosComBoleto.length;
    if (semBoleto > 0) {
      toast.warning(`${semBoleto} título(s) ainda não têm boleto gerado no Omie e serão ignorados na impressão.`);
    }
    if (titulosComBoleto.length === 0) {
      toast.error('Nenhum dos títulos selecionados tem boleto gerado. Emita primeiro na aba "Emissão de Boletos".');
      return;
    }
    setModoImpressao(modo);
    setImprimirOpen(true);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Boletos Omie</h1>
            <p className="text-sm text-slate-500">Consulta e impressão de boletos (2ª via)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => abrirImpressao('individual')} disabled={titulosSelecionados.length === 0}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
          <Button variant="outline" className="bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100" onClick={() => abrirImpressao('agrupado')} disabled={titulosSelecionados.length === 0}>
            <Layers className="w-4 h-4 mr-2" />
            Imprimir Agrupado
          </Button>
        </div>
      </div>

      <BoletosImpressaoDialog
        open={imprimirOpen}
        onOpenChange={setImprimirOpen}
        titulos={titulosComBoleto}
        modo={modoImpressao}
      />

      <FiltrosBoletos onResultado={(t) => { setTitulos(t); setSelecionados([]); }} />

      {titulos.length > 0 && (
        <TabelaBoletos titulos={titulos} selecionados={selecionados} setSelecionados={setSelecionados} />
      )}
    </div>
  );
}