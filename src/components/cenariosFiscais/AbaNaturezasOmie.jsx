import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Lock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export default function AbaNaturezasOmie({ naturezas }) {
  const [busca, setBusca] = React.useState('');
  const filtradas = naturezas.filter(n =>
    !busca ||
    (n.nome || '').toLowerCase().includes(busca.toLowerCase()) ||
    (n.omie_id || '').includes(busca)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <Lock className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>Espelho do Omie (somente leitura).</strong> Naturezas/Cenários são gerenciados diretamente no Omie. Use "Sincronizar" para atualizar esta lista.
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Buscar por nome ou ID Omie..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">ID Omie</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Nome</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Padrão</th>
              <th className="text-left p-3 text-xs font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(c => (
              <tr key={c.id} className="border-b hover:bg-slate-50">
                <td className="p-3 text-xs font-mono text-slate-600">{c.omie_id || '-'}</td>
                <td className="p-3 text-sm font-medium">{c.nome}</td>
                <td className="p-3">
                  {c.padrao ? <Badge className="bg-yellow-100 text-yellow-800">Padrão</Badge> : <span className="text-slate-300">-</span>}
                </td>
                <td className="p-3">
                  <Badge className={c.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>
                    {c.status}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-slate-400">
                {naturezas.length === 0 ? 'Nenhuma natureza importada — clique em "Sincronizar do Omie"' : 'Nenhum resultado'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}