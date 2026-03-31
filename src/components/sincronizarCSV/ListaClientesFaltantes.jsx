import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function ListaClientesFaltantes({ titulo, items, cor, icon }) {
  const [aberto, setAberto] = useState(false);

  const corClasses = {
    purple: { badge: 'bg-purple-500', header: 'border-purple-200', row: 'hover:bg-purple-50' },
    orange: { badge: 'bg-orange-500', header: 'border-orange-200', row: 'hover:bg-orange-50' },
  };
  const cores = corClasses[cor] || corClasses.purple;

  return (
    <Card className={cores.header}>
      <CardHeader className="pb-2">
        <button onClick={() => setAberto(!aberto)} className="flex items-center justify-between w-full text-left">
          <CardTitle className="text-sm flex items-center gap-2">
            {icon}
            {titulo}
            <Badge className={`${cores.badge} text-white text-xs`}>{items.length}</Badge>
          </CardTitle>
          {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </CardHeader>
      {aberto && (
        <CardContent>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="px-2 py-1.5 text-left">Código</th>
                  <th className="px-2 py-1.5 text-left">Razão Social</th>
                  <th className="px-2 py-1.5 text-left">Nome Fantasia</th>
                  <th className="px-2 py-1.5 text-left">CNPJ/CPF</th>
                  <th className="px-2 py-1.5 text-left">Status/Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, i) => (
                  <tr key={i} className={cores.row}>
                    <td className="px-2 py-1.5 font-mono">{item.codigo || item.codigo_omie || item.codigo_integracao || '-'}</td>
                    <td className="px-2 py-1.5 font-medium">{item.razao_social || '-'}</td>
                    <td className="px-2 py-1.5 text-slate-600">{item.nome_fantasia || '-'}</td>
                    <td className="px-2 py-1.5 font-mono">{item.cpf_cnpj || item.cnpj_cpf || '-'}</td>
                    <td className="px-2 py-1.5">{item.status || item.tags || item.inativo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length >= 200 && (
            <p className="text-xs text-slate-400 mt-2 text-center">Mostrando apenas os primeiros 200 registros.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}