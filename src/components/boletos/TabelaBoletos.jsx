import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const base64ToUint8Array = (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

export default function TabelaBoletos({ titulos, selecionados, setSelecionados }) {
  const [filtro, setFiltro] = useState('');
  const [verLoading, setVerLoading] = useState(null);

  const filtrados = useMemo(() => {
    if (!filtro) return titulos;
    const f = filtro.toLowerCase();
    return titulos.filter(t =>
      (t.nome_fantasia || '').toLowerCase().includes(f) ||
      (t.nome_cliente || '').toLowerCase().includes(f) ||
      (t.cnpj_cpf || '').toLowerCase().includes(f) ||
      (t.numero_documento || '').toLowerCase().includes(f)
    );
  }, [titulos, filtro]);

  // Sem boleto gerado no Omie — não pode imprimir
  const semBoleto = (t) => !t.boleto_gerado && !t.numero_boleto;

  // Selecionável para impressão somente se tiver boleto gerado e não estiver cancelado/liquidado
  const isElegivel = (t) => {
    const st = String(t.status_titulo || 'ABERTO').toUpperCase();
    if (st === 'CANCELADO' || st === 'PAGO' || st === 'LIQUIDADO') return false;
    if (semBoleto(t)) return false;
    return true;
  };

  const toggleAll = () => {
    const elegiveis = filtrados.filter(isElegivel);
    if (selecionados.length === elegiveis.length) setSelecionados([]);
    else setSelecionados(elegiveis.map(t => t.codigo_lancamento));
  };

  const toggle = (cod) => {
    setSelecionados(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const verBoleto = async (t) => {
    setVerLoading(t.codigo_lancamento);
    try {
      const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
        codigo_lancamento: t.codigo_lancamento,
        url_boleto: t.url_boleto || undefined
      });
      if (!data?.sucesso) {
        throw new Error(data?.error || 'Não foi possível obter o boleto');
      }
      const bytes = base64ToUint8Array(data.pdf_base64);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toast.error(e.message);
    }
    setVerLoading(null);
  };

  const totalValor = filtrados
    .filter(t => selecionados.includes(t.codigo_lancamento))
    .reduce((s, t) => s + (t.valor_documento || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>{filtrados.length} títulos | {selecionados.length} selecionados | R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          <Input className="max-w-xs" placeholder="Filtrar cliente/documento..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="p-2 w-10">
                <Checkbox
                  checked={selecionados.length > 0 && selecionados.length === filtrados.filter(isElegivel).length}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Documento</th>
              <th className="p-2 text-left">Parcela</th>
              <th className="p-2 text-left">Vencimento</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-center">Nº Boleto</th>
              <th className="p-2 text-center">Ver</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(t => (
              <tr key={t.codigo_lancamento} className={`border-t hover:bg-slate-50 ${selecionados.includes(t.codigo_lancamento) ? 'bg-amber-50' : ''}`}>
                <td className="p-2">
                  <Checkbox
                    checked={selecionados.includes(t.codigo_lancamento)}
                    onCheckedChange={() => toggle(t.codigo_lancamento)}
                    disabled={!isElegivel(t)}
                  />
                </td>
                <td className="p-2">{t.nome_fantasia || t.nome_cliente || '-'}</td>
                <td className="p-2 font-mono">{t.numero_documento}</td>
                <td className="p-2">{t.numero_parcela}</td>
                <td className="p-2">{t.data_vencimento}</td>
                <td className="p-2 text-right">R$ {Number(t.valor_documento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="p-2 text-center">
                  {(() => {
                    const st = String(t.status_titulo || 'ABERTO').toUpperCase();
                    if (st === 'PAGO' || st === 'LIQUIDADO') return <Badge className="bg-emerald-100 text-emerald-800">Liquidado</Badge>;
                    if (st === 'CANCELADO') return <Badge className="bg-red-100 text-red-800">Cancelado</Badge>;
                    if (st === 'PARCIAL') return <Badge className="bg-amber-100 text-amber-800">Parcial</Badge>;
                    if (st === 'ATRASADO' || st === 'VENCIDO') return <Badge className="bg-red-100 text-red-800">Atrasado</Badge>;
                    if (t.numero_boleto) return <Badge className="bg-blue-100 text-blue-800">Boleto Emitido</Badge>;
                    if (semBoleto(t)) return <Badge className="bg-slate-100 text-slate-600 border-slate-300">Sem boleto gerado</Badge>;
                    return <Badge variant="outline">Em Aberto</Badge>;
                  })()}
                </td>
                <td className="p-2 text-center font-mono text-xs">
                  {t.numero_boleto ? t.numero_boleto : '-'}
                </td>
                <td className="p-2 text-center">
                  {(t.boleto_gerado || t.numero_boleto) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => verBoleto(t)}
                      disabled={verLoading === t.codigo_lancamento}
                      title="Abrir boleto em nova aba"
                    >
                      {verLoading === t.codigo_lancamento
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <><Eye className="w-4 h-4 mr-1" />Ver</>}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">Sem boleto</span>
                  )}
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-500">Nenhum título encontrado</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}