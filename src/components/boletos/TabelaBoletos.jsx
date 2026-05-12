import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function TabelaBoletos({ titulos, selecionados, setSelecionados }) {
  const [filtro, setFiltro] = useState('');

  const filtrados = useMemo(() => {
    if (!filtro) return titulos;
    const f = filtro.toLowerCase();
    return titulos.filter(t =>
      (t.nome_cliente || '').toLowerCase().includes(f) ||
      (t.cnpj_cpf || '').toLowerCase().includes(f) ||
      (t.numero_documento || '').toLowerCase().includes(f)
    );
  }, [titulos, filtro]);

  // Selecionável se: em aberto (para gerar boleto) OU já tem boleto emitido (para imprimir)
  const isElegivel = (t) => {
    const st = String(t.status_titulo || 'ABERTO').toUpperCase();
    if (st === 'CANCELADO' || st === 'PAGO' || st === 'LIQUIDADO' || st === 'RECEBIDO') return false;
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
              <th className="p-2 text-center">Boleto</th>
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
                <td className="p-2">{t.nome_cliente || '-'}</td>
                <td className="p-2 font-mono">{t.numero_documento}</td>
                <td className="p-2">{t.numero_parcela}</td>
                <td className="p-2">{t.data_vencimento}</td>
                <td className="p-2 text-right">R$ {Number(t.valor_documento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="p-2 text-center">
                  {(() => {
                    // Status DINÂMICO do Omie: status_titulo (ABERTO/PAGO/LIQUIDADO/CANCELADO/PARCIAL) + boleto emitido
                    const st = String(t.status_titulo || 'ABERTO').toUpperCase();
                    if (st === 'PAGO' || st === 'LIQUIDADO' || st === 'RECEBIDO') return <Badge className="bg-emerald-100 text-emerald-800">Liquidado</Badge>;
                    if (st === 'CANCELADO') return <Badge className="bg-red-100 text-red-800">Cancelado</Badge>;
                    if (st === 'PARCIAL') return <Badge className="bg-amber-100 text-amber-800">Parcial</Badge>;
                    if (t.numero_boleto) return <Badge className="bg-blue-100 text-blue-800">Boleto Emitido</Badge>;
                    return <Badge variant="outline">Em Aberto</Badge>;
                  })()}
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-slate-500">Nenhum título encontrado</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}