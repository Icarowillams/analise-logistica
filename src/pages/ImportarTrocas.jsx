import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function ImportarTrocas() {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold">Importação de Trocas</h2>
          <p className="text-slate-600">
            A importação de trocas é feita automaticamente pela sincronização com o Omie.
          </p>
          <p className="text-sm text-slate-500">
            Para gerenciar pedidos de troca, acesse <strong>Pedidos → Gerenciar Pedidos</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
