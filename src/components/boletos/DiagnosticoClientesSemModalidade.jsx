import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RefreshCw, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

/**
 * Diagnóstico P3 (16/05): clientes que tiveram NF emitida nos últimos 7 dias
 * mas NÃO têm modalidade BOLETO BANCARIO no cadastro → boleto automático NÃO foi gerado.
 *
 * Esta tela existe APENAS para mostrar quais clientes precisam ter a modalidade
 * preenchida no Base44 para que a próxima emissão dispare o boleto automaticamente.
 */
export default function DiagnosticoClientesSemModalidade() {
  const [aberto, setAberto] = useState(false);

  const { data: diag, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['diag-clientes-sem-modalidade'],
    queryFn: async () => {
      // Pega logs de emissão dos últimos 7 dias com status autorizada
      const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();
      const logs = await base44.entities.LogEmissaoNF.filter(
        { status: 'autorizada' },
        '-created_date',
        500
      );
      const logsRecentes = logs.filter(l => l.created_date >= seteDiasAtras);

      // Para cada log, busca cliente e modalidade
      const clientesIds = [...new Set(logsRecentes.map(l => l.cliente_id).filter(Boolean))];
      if (clientesIds.length === 0) return { sem_modalidade: [], com_modalidade: 0 };

      const clientes = await base44.entities.Cliente.filter({ id: { $in: clientesIds } }, '-created_date', 500);
      const clientesMap = new Map(clientes.map(c => [c.id, c]));

      const modalidadesIds = [...new Set(clientes.map(c => c.modalidade_pagamento_id).filter(Boolean))];
      const modalidades = modalidadesIds.length > 0
        ? await base44.entities.ModalidadePagamento.filter({ id: { $in: modalidadesIds } })
        : [];
      const modalidadesMap = new Map(modalidades.map(m => [m.id, m]));

      const semModalidade = [];
      let comModalidade = 0;

      // Agrupa por cliente: 1 linha por cliente (com qtd de NFs no período)
      const porCliente = new Map();
      for (const log of logsRecentes) {
        if (!log.cliente_id) continue;
        const cliente = clientesMap.get(log.cliente_id);
        if (!cliente) continue;

        const modalidade = cliente.modalidade_pagamento_id
          ? modalidadesMap.get(cliente.modalidade_pagamento_id)
          : null;
        const nome = String(modalidade?.nome || '').toUpperCase();
        const usaBoleto = nome.includes('BOLETO');

        if (usaBoleto) {
          comModalidade++;
          continue;
        }

        const existente = porCliente.get(log.cliente_id);
        if (existente) {
          existente.qtd_nfs++;
          existente.ultima_nf = log.created_date;
        } else {
          porCliente.set(log.cliente_id, {
            cliente_id: log.cliente_id,
            cliente_nome: cliente.razao_social || cliente.nome_fantasia || log.cliente_nome,
            modalidade_atual: modalidade?.nome || '(nenhuma definida)',
            qtd_nfs: 1,
            ultima_nf: log.created_date
          });
        }
      }

      return {
        sem_modalidade: Array.from(porCliente.values()).sort((a, b) => b.qtd_nfs - a.qtd_nfs),
        com_modalidade: comModalidade
      };
    },
    staleTime: 60000
  });

  const totalSemModalidade = diag?.sem_modalidade?.length || 0;

  if (isLoading) {
    return (
      <Card className="border-amber-200">
        <CardContent className="py-4 flex items-center gap-2 text-sm text-amber-700">
          <Loader2 className="w-4 h-4 animate-spin" />
          Analisando emissões dos últimos 7 dias...
        </CardContent>
      </Card>
    );
  }

  if (totalSemModalidade === 0) {
    return null;
  }

  return (
    <Card className="border-amber-300 bg-amber-50/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2 text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            {totalSemModalidade} cliente(s) emitiram NF nos últimos 7 dias sem modalidade BOLETO configurada
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAberto(!aberto)}>
              {aberto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {aberto ? 'Recolher' : 'Ver lista'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-amber-700 mt-1">
          Para gerar boleto automaticamente nas próximas emissões, o cadastro do cliente precisa ter modalidade
          de pagamento cujo nome contenha "BOLETO".
        </p>
      </CardHeader>
      {aberto && (
        <CardContent>
          <div className="rounded-lg border border-amber-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-amber-900">
                <tr>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Modalidade atual</th>
                  <th className="p-2 text-center font-semibold">NFs últimos 7d</th>
                  <th className="p-2 text-center font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {diag.sem_modalidade.map(c => (
                  <tr key={c.cliente_id} className="border-t hover:bg-amber-50/40">
                    <td className="p-2 font-medium">{c.cliente_nome}</td>
                    <td className="p-2 text-slate-600">
                      <Badge variant="outline" className="text-xs">{c.modalidade_atual}</Badge>
                    </td>
                    <td className="p-2 text-center font-semibold text-amber-700">{c.qtd_nfs}</td>
                    <td className="p-2 text-center">
                      <Link
                        to={createPageUrl(`Clientes?id=${c.cliente_id}`)}
                        className="inline-flex items-center gap-1 text-xs text-cyan-700 hover:text-cyan-900 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Abrir cadastro
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {diag.com_modalidade > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              ✓ {diag.com_modalidade} NF(s) foram emitidas no período com clientes JÁ configurados para boleto.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}