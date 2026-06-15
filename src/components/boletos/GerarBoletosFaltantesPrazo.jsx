import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, FileWarning, CheckCircle2 } from 'lucide-react';

// Rotina: gera boletos faltantes APENAS de pedidos a prazo com NF autorizada sem boleto.
// Itera as levas do backend (5 pedidos por leva, com delay) até concluir.
export default function GerarBoletosFaltantesPrazo() {
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const [resumo, setResumo] = useState(null);

  const executar = async () => {
    if (!confirm('Gerar boletos faltantes de todos os pedidos a prazo com NF autorizada e sem boleto? Pode levar alguns minutos (ritmo controlado para não bloquear o Omie).')) return;
    setRodando(true);
    setResumo(null);
    setProgresso({ feitos: 0, total: 0 });

    let skip = 0;
    let concluida = false;
    let guarda = 0;
    const acc = { gerados: 0, ja_tinham: 0, sem_titulo: 0, falhas: 0, total: 0 };

    try {
      while (!concluida && guarda < 1000) {
        guarda++;
        const { data } = await base44.functions.invoke('gerarBoletosFaltantesPrazo', { skip, max_pedidos: 5 });
        if (!data?.sucesso) {
          toast.error('Falha: ' + (data?.error || 'erro desconhecido'));
          break;
        }
        acc.gerados += data.gerados || 0;
        acc.ja_tinham += data.ja_tinham || 0;
        acc.sem_titulo += data.sem_titulo || 0;
        acc.falhas += data.falhas || 0;
        acc.total = data.total_candidatos || acc.total;
        skip = data.proximo_skip;
        concluida = !!data.concluida;
        setProgresso({ feitos: Math.min(skip, acc.total), total: acc.total });
        if (!concluida) await new Promise(r => setTimeout(r, 800));
      }
      setResumo(acc);
      if (acc.gerados > 0) toast.success(`${acc.gerados} boleto(s) gerado(s).`);
      if (acc.ja_tinham > 0) toast.info(`${acc.ja_tinham} já tinham boleto no Omie (flag atualizado).`);
      if (acc.gerados === 0 && acc.ja_tinham === 0) toast.info('Nenhum boleto faltante para gerar.');
    } catch (e) {
      toast.error('Falha: ' + e.message);
    }
    setRodando(false);
  };

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileWarning className="w-5 h-5 text-amber-500" />
          Gerar boletos faltantes (a prazo)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-600">
          Busca pedidos <b>a prazo</b> com NF autorizada e <b>sem boleto</b>, confirma no Omie
          (alguns podem já ter boleto) e gera os faltantes em ritmo controlado. Pedidos à vista são ignorados.
        </p>
        <Button onClick={executar} disabled={rodando} className="bg-amber-600 hover:bg-amber-700 text-white">
          {rodando
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando {progresso.feitos}/{progresso.total || '…'}...</>
            : <><FileWarning className="w-4 h-4 mr-2" /> Gerar boletos faltantes</>}
        </Button>

        {rodando && progresso.total > 0 && (
          <div className="w-full bg-slate-200 rounded-full h-1.5">
            <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${(progresso.feitos / progresso.total) * 100}%` }} />
          </div>
        )}

        {resumo && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge className="bg-green-100 text-green-800 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" /> {resumo.gerados} gerados</Badge>
            <Badge variant="outline">{resumo.ja_tinham} já tinham</Badge>
            <Badge variant="outline">{resumo.sem_titulo} sem título</Badge>
            {resumo.falhas > 0 && <Badge className="bg-red-100 text-red-800 border-red-300">{resumo.falhas} falhas</Badge>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}