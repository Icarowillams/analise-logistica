import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Receipt, Loader2, FileDown, Printer, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import FiltrosBoletos from '@/components/boletos/FiltrosBoletos';
import TabelaBoletos from '@/components/boletos/TabelaBoletos';
import BoletosImpressaoDialog from '@/components/boletos/BoletosImpressaoDialog';
import { toast } from 'sonner';

export default function BoletosOmie() {
  const [titulos, setTitulos] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [gerando, setGerando] = useState(false);
  const [resultadoLote, setResultadoLote] = useState(null);
  const [imprimirOpen, setImprimirOpen] = useState(false);
  const [modoImpressao, setModoImpressao] = useState('individual');

  const titulosSelecionados = titulos.filter(t => selecionados.includes(t.codigo_lancamento));
  const titulosComBoleto = titulosSelecionados.filter(t => t.numero_boleto || t.url_boleto);

  const abrirImpressao = (modo) => {
    if (titulosComBoleto.length === 0) {
      toast.error('Selecione títulos que já possuem boleto emitido');
      return;
    }
    setModoImpressao(modo);
    setImprimirOpen(true);
  };

  const gerarBoletos = async () => {
    if (selecionados.length === 0) return;
    if (!confirm(`Gerar ${selecionados.length} boletos?`)) return;

    setGerando(true);
    setResultadoLote(null);
    try {
      const { data } = await base44.functions.invoke('gerarBoletosOmie', {
        titulos: selecionados
      });
      if (data?.sucesso) {
        setResultadoLote(data);
        toast.success(`${data.sucessos} boletos gerados | ${data.erros} erros | ${data.skips} liquidados/cancelados`);
        // Recarrega titulos para atualizar status
        setTitulos(prev => prev.map(t => {
          const r = (data.resultados || []).find(r => String(r.codigo_lancamento) === String(t.codigo_lancamento));
          if (r?.sucesso) return { ...t, numero_boleto: r.numero_boleto, linha_digitavel: r.linha_digitavel };
          return t;
        }));
        setSelecionados([]);
      } else {
        toast.error(data?.error || 'Erro no lote');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setGerando(false);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Boletos Omie</h1>
            <p className="text-sm text-slate-500">Contas a receber em aberto e geração em lote</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => abrirImpressao('individual')} disabled={titulosComBoleto.length === 0}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
          <Button variant="outline" className="bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100" onClick={() => abrirImpressao('agrupado')} disabled={titulosComBoleto.length === 0}>
            <Layers className="w-4 h-4 mr-2" />
            Imprimir Agrupado
          </Button>
          <Button onClick={gerarBoletos} disabled={selecionados.length === 0 || gerando}>
            {gerando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileDown className="w-4 h-4 mr-2" />}
            Gerar {selecionados.length} boletos
          </Button>
        </div>
      </div>

      <BoletosImpressaoDialog
        open={imprimirOpen}
        onOpenChange={setImprimirOpen}
        titulos={titulosComBoleto}
        modo={modoImpressao}
      />

      <FiltrosBoletos onResultado={(t) => { setTitulos(t); setSelecionados([]); setResultadoLote(null); }} />

      {resultadoLote && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado do lote</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-sm mb-3">
              <div className="p-3 bg-green-50 rounded"><b>{resultadoLote.sucessos}</b> gerados</div>
              <div className="p-3 bg-red-50 rounded"><b>{resultadoLote.erros}</b> erros</div>
              <div className="p-3 bg-slate-50 rounded"><b>{resultadoLote.skips}</b> liquidados/cancelados</div>
            </div>
            {resultadoLote.erros > 0 && (
              <div className="max-h-40 overflow-auto text-xs space-y-1">
                {(resultadoLote.resultados || []).filter(r => !r.sucesso && !r.skip).map(r => (
                  <div key={r.codigo_lancamento} className="p-2 bg-red-50 rounded">
                    <b>#{r.codigo_lancamento}</b>: {r.mensagem}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {titulos.length > 0 && (
        <TabelaBoletos titulos={titulos} selecionados={selecionados} setSelecionados={setSelecionados} />
      )}
    </div>
  );
}