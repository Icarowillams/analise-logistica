import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Wrench, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

// Saneamento sob demanda de pedidos travados em etapas intermediárias (20/50).
// Consulta o Omie sequencialmente (com throttle, respeitando o circuit breaker),
// reconcilia espelho/pedido local e reporta a etapa real de cada um.
export default function SaneamentoTravados() {
  const [texto, setTexto] = useState('');
  const [rodando, setRodando] = useState(false);
  const [resultados, setResultados] = useState([]);

  const sanear = async () => {
    const codigos = [...new Set(texto.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
    if (codigos.length === 0) {
      toast.info('Informe os números dos pedidos travados (separados por vírgula ou espaço).');
      return;
    }
    setRodando(true);
    setResultados([]);
    try {
      // Processa em lotes de 6 (o backend faz consultas sequenciais com ~8s entre cada).
      const acumulado = [];
      for (let i = 0; i < codigos.length; i += 6) {
        const lote = codigos.slice(i, i + 6);
        const resp = await base44.functions.invoke('sanearPedidosTravados', { codigos_pedido: lote });
        const r = resp?.data || {};
        acumulado.push(...(r.resultados || []));
        setResultados([...acumulado]);
        if (r.abortado) {
          toast.info('Omie pediu para aguardar. Tente o restante em ~1 min.');
          break;
        }
      }
      const avancaram = acumulado.filter(x => x.acao === 'avancou_para_NF').length;
      const travados = acumulado.filter(x => x.acao === 'ainda_travado').length;
      toast.success(`Saneamento concluído: ${avancaram} avançaram, ${travados} ainda travados.`);
    } catch (e) {
      toast.error('Erro no saneamento: ' + (e?.response?.data?.error || e.message));
    } finally {
      setRodando(false);
    }
  };

  const iconePara = (r) => {
    if (!r.sucesso) return <XCircle className="w-4 h-4 text-amber-500" />;
    if (r.acao === 'avancou_para_NF') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    return <AlertTriangle className="w-4 h-4 text-orange-500" />;
  };

  return (
    <Card className="border-orange-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="w-5 h-5 text-orange-500" />
          Saneamento de Pedidos Travados
        </CardTitle>
        <p className="text-sm text-slate-500">
          Pedidos presos em etapas intermediárias (Liberado/Em faturamento). Consulta o Omie ao vivo,
          reconcilia o status local e mostra a etapa real. Use os <strong>números dos pedidos</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Ex: 446, 453, 448, 450, 455, 482, 1235, 1325, 1478, 1480, 1481, 1490"
          value={texto}
          onChange={e => setTexto(e.target.value)}
          rows={2}
          className="text-sm"
        />
        <Button onClick={sanear} disabled={rodando} className="bg-orange-500 hover:bg-orange-600 text-white">
          {rodando ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
          {rodando ? 'Sanando…' : 'Sanear travados'}
        </Button>

        {resultados.length > 0 && (
          <div className="border rounded-lg overflow-hidden mt-2">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Pedido</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Etapa Omie</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-2 font-mono text-xs">{r.numero_pedido || r.codigo_pedido}</td>
                    <td className="p-2">
                      {r.etapa_label ? <Badge className="bg-slate-100 text-slate-700 border-slate-300">{r.etapa_label}</Badge> : '—'}
                    </td>
                    <td className="p-2 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5">{iconePara(r)} {r.mensagem}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}