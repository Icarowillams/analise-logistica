import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';
import { TIPOS_ACAO } from './TIPOS_ACAO';

export default function AbaTiposAcao() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Info className="w-5 h-5 text-blue-600" />
            Tipos de Alteração Registrados
          </CardTitle>
          <p className="text-sm text-slate-600">
            O Log Gerencial registra automaticamente todas as ações relevantes feitas no sistema.
            Cada ação é classificada em um dos tipos abaixo:
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            {TIPOS_ACAO.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.valor} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className={`w-10 h-10 rounded-lg ${t.cor.replace(/border-\S+/g, '')} flex items-center justify-center flex-shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{t.label}</p>
                    <p className="text-sm text-slate-600 mt-1">{t.descricao}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como o sistema registra?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-2">
          <p>• <strong>Automaticamente</strong>: toda criação, edição ou exclusão em entidades-chave (pedidos, clientes, cargas, transferências, cortes, permissões, produtos, funcionários, acerto de caixa) é capturada.</p>
          <p>• <strong>Edições</strong> mostram exatamente <strong>qual campo</strong> foi alterado, o <strong>valor anterior</strong> e o <strong>valor novo</strong>.</p>
          <p>• Eventos especiais (envio para Omie, faturamento, liberação, cancelamento) são detectados e classificados separadamente.</p>
          <p>• Cada registro contém <strong>data, hora, usuário</strong> e descrição leg\u00edvel da ação.</p>
        </CardContent>
      </Card>
    </div>
  );
}