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

  const toggleAll = () => {
    // Exclui títulos que já têm boleto e os skippáveis
    const elegiveis = filtrados.filter(t => !t.numero_boleto);
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
                  checked={selecionados.length > 0 && selecionados.length === filtrados.filter(t => !t.numero_boleto).length}
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
                    disabled={!!t.numero_boleto}
                  />
                </td>
                <td className="p-2">{t.nome_cliente || '-'}</td>
                <td className="p-2 font-mono">{t.numero_documento}</td>
                <td className="p-2">{t.numero_parcela}</td>
                <td className="p-2">{t.data_vencimento}</td>
                <td className="p-2 text-right">R$ {Number(t.valor_documento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="p-2 text-center">
                  {t.numero_boleto
                    ? <Badge className="bg-green-100 text-green-800">Emitido</Badge>
                    : <Badge variant="outline">Pendente</Badge>}
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