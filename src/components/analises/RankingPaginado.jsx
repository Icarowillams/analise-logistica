import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { formatarMoeda, formatarNumero } from './utilsAnalises';

export default function RankingPaginado({ ranking, pagina, setPagina, porPagina }) {
  const total = ranking.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const fim = Math.min(inicio + porPagina, total);
  const itens = ranking.slice(inicio, fim);

  const irPara = (p) => setPagina(Math.max(1, Math.min(p, totalPaginas)));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50">
            <tr className="text-slate-600">
              <th className="p-2 text-left w-8">#</th>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Cidade</th>
              <th className="p-2 text-left">Vendedor</th>
              <th className="p-2 text-right">R$</th>
              <th className="p-2 text-right">Nº Ped.</th>
              <th className="p-2 text-right">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((r, i) => (
              <tr key={r.cliente_id} className="border-t hover:bg-slate-50">
                <td className="p-2 text-slate-400 font-bold">{inicio + i + 1}</td>
                <td className="p-2 font-medium max-w-[200px] truncate" title={r.nome}>{r.nome}</td>
                <td className="p-2 text-slate-600 max-w-[140px] truncate" title={r.cidade}>{r.cidade}</td>
                <td className="p-2 text-slate-600 max-w-[160px] truncate" title={r.vendedor_nome}>{r.vendedor_nome}</td>
                <td className="p-2 text-right font-semibold text-emerald-700 whitespace-nowrap">{formatarMoeda(r.valor)}</td>
                <td className="p-2 text-right">{formatarNumero(r.pedidos)}</td>
                <td className="p-2 text-right text-slate-600 whitespace-nowrap">{formatarMoeda(r.ticket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Controles de paginação */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-500">
          {formatarNumero(total)} clientes · {formatarNumero(inicio + 1)}–{formatarNumero(fim)}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => irPara(1)} disabled={paginaAtual === 1}>
            <ChevronsLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => irPara(paginaAtual - 1)} disabled={paginaAtual === 1}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-slate-600 px-2 whitespace-nowrap">
            Página <strong>{paginaAtual}</strong> de <strong>{totalPaginas}</strong>
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => irPara(paginaAtual + 1)} disabled={paginaAtual === totalPaginas}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => irPara(totalPaginas)} disabled={paginaAtual === totalPaginas}>
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}