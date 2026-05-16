import React, { useState } from 'react';
import { Receipt, Printer, Layers, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import FiltrosBoletos from '@/components/boletos/FiltrosBoletos';
import TabelaBoletos from '@/components/boletos/TabelaBoletos';
import BoletosImpressaoDialog from '@/components/boletos/BoletosImpressaoDialog';
import DiagnosticoClientesSemModalidade from '@/components/boletos/DiagnosticoClientesSemModalidade';
import { toast } from 'sonner';

export default function BoletosOmie() {
  const [titulos, setTitulos] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [imprimirOpen, setImprimirOpen] = useState(false);
  const [modoImpressao, setModoImpressao] = useState('individual');

  const titulosSelecionados = titulos.filter(t => selecionados.includes(t.codigo_lancamento));

  const abrirImpressao = (modo) => {
    if (titulosSelecionados.length === 0) {
      toast.error('Selecione ao menos um título');
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

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 flex items-start gap-2 text-sm text-blue-800">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Os boletos são gerados <b>automaticamente</b> assim que a nota fiscal é emitida no Omie. Esta tela é apenas para consulta e 2ª via.</span>
        </CardContent>
      </Card>

      <BoletosImpressaoDialog
        open={imprimirOpen}
        onOpenChange={setImprimirOpen}
        titulos={titulosSelecionados}
        modo={modoImpressao}
      />

      <DiagnosticoClientesSemModalidade />

      <FiltrosBoletos onResultado={(t) => { setTitulos(t); setSelecionados([]); }} />

      {titulos.length > 0 && (
        <TabelaBoletos titulos={titulos} selecionados={selecionados} setSelecionados={setSelecionados} />
      )}
    </div>
  );
}