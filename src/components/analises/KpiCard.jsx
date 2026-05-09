import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export default function KpiCard({ titulo, valor, sub, icon: Icon, cor = 'cyan' }) {
  const cores = {
    cyan: 'from-cyan-500 to-blue-600 text-cyan-50',
    emerald: 'from-emerald-500 to-teal-600 text-emerald-50',
    amber: 'from-amber-500 to-orange-600 text-amber-50',
    red: 'from-red-500 to-rose-600 text-red-50',
    indigo: 'from-indigo-500 to-purple-600 text-indigo-50',
    slate: 'from-slate-600 to-slate-800 text-slate-50'
  };
  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <CardContent className="p-0">
        <div className={`bg-gradient-to-br ${cores[cor]} p-4 flex items-center justify-between`}>
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">{titulo}</p>
            <p className="text-2xl md:text-3xl font-bold mt-1">{valor}</p>
            {sub && <p className="text-xs opacity-80 mt-1">{sub}</p>}
          </div>
          {Icon && <Icon className="w-10 h-10 opacity-30" />}
        </div>
      </CardContent>
    </Card>
  );
}