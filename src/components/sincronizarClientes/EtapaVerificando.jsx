import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function EtapaVerificando({ progressoMsg }) {
  return (
    <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardContent className="py-16 flex flex-col items-center gap-5">
        <div className="relative">
          <div className="h-20 w-20 rounded-full border-4 border-blue-200 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
          </div>
          <div className="absolute -top-1 -right-1 h-6 w-6 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
            <span className="text-white text-xs font-bold">...</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-blue-800">Analisando os sistemas</p>
          <p className="text-sm text-blue-500 mt-1">{progressoMsg || 'Iniciando verificação...'}</p>
          <p className="text-xs text-blue-400 mt-3">Isso pode levar alguns minutos dependendo do volume</p>
        </div>
      </CardContent>
    </Card>
  );
}