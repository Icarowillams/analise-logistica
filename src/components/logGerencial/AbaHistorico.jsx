import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FileText } from 'lucide-react';
import FiltrosLogGerencial from './FiltrosLogGerencial';
import ItemLog from './ItemLog';

const PAGE_SIZE = 100;

function dentroPeriodo(dateStr, inicio, fim) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (inicio && d < new Date(inicio + 'T00:00:00')) return false;
  if (fim && d > new Date(fim + 'T23:59:59')) return false;
  return true;
}

export default function AbaHistorico() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', tipo_acao: '', usuario_email: '', entidade_tipo: '', busca: '' });
  const [pagina, setPagina] = useState(1);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logsGerencial'],
    queryFn: () => base44.entities.LogGerencial.list('-created_date', 5000)
  });

  const usuariosUnicos = useMemo(() => [...new Set(logs.map(l => l.usuario_email).filter(Boolean))].sort(), [logs]);
  const entidadesUnicas = useMemo(() => [...new Set(logs.map(l => l.entidade_tipo).filter(Boolean))].sort(), [logs]);

  const filtrados = useMemo(() => {
    const busca = filtros.busca?.toLowerCase().trim();
    return logs.filter(l => {
      if (filtros.tipo_acao && l.tipo_acao !== filtros.tipo_acao) return false;
      if (filtros.usuario_email && l.usuario_email !== filtros.usuario_email) return false;
      if (filtros.entidade_tipo && l.entidade_tipo !== filtros.entidade_tipo) return false;
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(l.created_date, filtros.inicio, filtros.fim)) return false;
      if (busca) {
        const blob = `${l.descricao || ''} ${l.entidade_descricao || ''} ${l.usuario_nome || ''} ${l.usuario_email || ''}`.toLowerCase();
        if (!blob.includes(busca)) return false;
      }
      return true;
    });
  }, [logs, filtros]);

  const visiveis = filtrados.slice(0, pagina * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <FiltrosLogGerencial
        filtros={filtros}
        setFiltros={(novos) => { setFiltros(novos); setPagina(1); }}
        onLimpar={() => { setFiltros({ inicio: '', fim: '', tipo_acao: '', usuario_email: '', entidade_tipo: '', busca: '' }); setPagina(1); }}
        usuariosUnicos={usuariosUnicos}
        entidadesUnicas={entidadesUnicas}
      />

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span><strong>{filtrados.length}</strong> registros encontrados</span>
        <span>Exibindo {visiveis.length}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500"><Loader2 className="w-6 h-6 animate-spin mr-2" />Carregando histórico...</div>
      ) : visiveis.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400"><FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />Nenhum registro encontrado com os filtros atuais.</CardContent></Card>
      ) : (
        <ul className="space-y-2">
          {visiveis.map(log => <ItemLog key={log.id} log={log} />)}
        </ul>
      )}

      {visiveis.length < filtrados.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setPagina(p => p + 1)}>Carregar mais ({filtrados.length - visiveis.length} restantes)</Button>
        </div>
      )}
    </div>
  );
}