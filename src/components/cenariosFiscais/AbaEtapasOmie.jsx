import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Lock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function AbaEtapasOmie({ etapas }) {
  const [busca, setBusca] = React.useState('');

  // Agrupa por operação (extraído do código "11-50" → operação 11)
  const grupos = React.useMemo(() => {
    const map = new Map();
    etapas.forEach(et => {
      const [op, etapa] = (et.codigo || '').split('-');
      const chave = op || 'outros';
      const descOp = (et.descricao || et.nome.split(' / ')[0] || `Operação ${op}`).trim();
      if (!map.has(chave)) map.set(chave, { codigo: chave, descricao: descOp, etapas: [] });
      map.get(chave).etapas.push({ ...et, codigoEtapa: etapa });
    });
    return Array.from(map.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [etapas]);

  const filtrarEtapa = (et) =>
    !busca ||
    (et.nome || '').toLowerCase().includes(busca.toLowerCase()) ||
    (et.codigo || '').includes(busca);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <Lock className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>Espelho do Omie (somente leitura).</strong> Etapas de faturamento são fixas no Omie. Use "Sincronizar" para atualizar.
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Buscar etapa..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        {grupos.map(g => {
          const etapasFiltradas = g.etapas.filter(filtrarEtapa);
          if (etapasFiltradas.length === 0) return null;
          return (
            <div key={g.codigo} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="bg-amber-50 border-b px-4 py-2 flex items-center gap-2">
                <Badge className="bg-amber-200 text-amber-900 font-mono">{g.codigo}</Badge>
                <span className="text-sm font-semibold text-slate-700">{g.descricao}</span>
                <span className="text-xs text-slate-500 ml-auto">{etapasFiltradas.length} etapa(s)</span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600 w-24">Código</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600">Etapa</th>
                    <th className="text-left p-3 text-xs font-semibold text-slate-600 w-32">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {etapasFiltradas.map(et => (
                    <tr key={et.id} className="border-b hover:bg-slate-50">
                      <td className="p-3 text-xs font-mono">{et.codigoEtapa}</td>
                      <td className="p-3 text-sm">{et.nome.split(' / ').slice(1).join(' / ') || et.nome}</td>
                      <td className="p-3">
                        <Badge className={et.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                          {et.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {etapas.length === 0 && (
          <div className="bg-white rounded-xl border p-8 text-center text-slate-400">
            Nenhuma etapa importada — clique em "Sincronizar do Omie"
          </div>
        )}
      </div>
    </div>
  );
}