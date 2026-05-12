import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, User, Clock } from 'lucide-react';
import { MAPA_TIPOS } from './TIPOS_ACAO';
import { format } from 'date-fns';

export default function ItemLog({ log }) {
  const [aberto, setAberto] = useState(false);
  const tipo = MAPA_TIPOS[log.tipo_acao] || MAPA_TIPOS.outro;
  const Icon = tipo.icon;
  const data = log.created_date ? format(new Date(log.created_date), 'dd/MM/yyyy - HH:mm:ss') : '-';
  const temAlteracoes = Array.isArray(log.alteracoes) && log.alteracoes.length > 0;

  return (
    <li className="bg-white border rounded-lg overflow-hidden">
      <div className="flex items-start gap-3 p-3 hover:bg-slate-50">
        <div className={`w-10 h-10 rounded-lg ${tipo.cor.replace(/border-\S+/g, '')} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${tipo.cor} border`}>{tipo.label}</Badge>
            <Badge variant="outline" className="text-xs">{log.entidade_tipo}</Badge>
            <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="w-3 h-3" />{data}</span>
          </div>
          <p className="text-sm text-slate-800 mt-1">{log.descricao || `${tipo.label} em ${log.entidade_descricao || log.entidade_tipo}`}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{log.usuario_nome || log.usuario_email}</span>
            {log.entidade_descricao && <span className="truncate">{log.entidade_descricao}</span>}
          </div>
        </div>
        {temAlteracoes && (
          <Button variant="ghost" size="sm" onClick={() => setAberto(!aberto)}>
            {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <span className="ml-1 text-xs">{log.alteracoes.length} campo{log.alteracoes.length === 1 ? '' : 's'}</span>
          </Button>
        )}
      </div>
      {aberto && temAlteracoes && (
        <div className="border-t bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold text-slate-700 mb-2">Campos alterados:</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left p-1 w-1/4">Campo</th>
                <th className="text-left p-1 w-1/3">Valor anterior</th>
                <th className="text-left p-1 w-1/3">Valor novo</th>
              </tr>
            </thead>
            <tbody>
              {log.alteracoes.map((a, idx) => (
                <tr key={idx} className="border-t border-slate-200">
                  <td className="p-1 font-mono text-slate-700">{a.campo}</td>
                  <td className="p-1 text-red-700 break-all">{a.valor_anterior}</td>
                  <td className="p-1 text-emerald-700 break-all">{a.valor_novo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}