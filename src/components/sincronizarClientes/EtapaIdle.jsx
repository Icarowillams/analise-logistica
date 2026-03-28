import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, Database, ArrowRight, Shield, AlertCircle } from 'lucide-react';

export default function EtapaIdle({ onVerificar, erroMsg }) {
  return (
    <div className="space-y-6">
      {erroMsg && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{erroMsg}</AlertDescription>
        </Alert>
      )}

      <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 overflow-hidden">
        <CardContent className="p-0">
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-400/30">
                <img
                  src="https://www.omie.com.br/wp-content/themes/flavor-flavor-flavor/lib/assets/img/logo-omie.svg"
                  alt="Omie"
                  className="h-7 brightness-0 invert"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-neutral-900">Sincronização Inteligente</h2>
                <p className="text-sm text-neutral-500">Base44 → Omie ERP</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              <StepCard
                num="1"
                icon={<Database className="w-5 h-5" />}
                title="Análise"
                desc="Busca todos os clientes em ambos os sistemas"
              />
              <StepCard
                num="2"
                icon={<Search className="w-5 h-5" />}
                title="Comparação"
                desc="Identifica clientes faltantes por ID e CPF/CNPJ"
              />
              <StepCard
                num="3"
                icon={<ArrowRight className="w-5 h-5" />}
                title="Envio"
                desc="Envia os faltantes via UpsertCliente do Omie"
              />
            </div>

            <div className="flex items-center gap-3 p-3 bg-white/60 rounded-lg border border-amber-200 mb-6">
              <Shield className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800">
                A sincronização usa <strong>UpsertCliente</strong> — se o cliente já existir, ele é atualizado sem duplicar.
              </p>
            </div>

            <Button onClick={onVerificar} size="lg" className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-base shadow-lg shadow-amber-500/30 h-12">
              <Search className="w-5 h-5 mr-2" />
              Iniciar Verificação
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({ num, icon, title, desc }) {
  return (
    <div className="bg-white/70 rounded-xl p-4 border border-amber-100">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-6 w-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">{num}</span>
        <span className="text-amber-600">{icon}</span>
      </div>
      <p className="font-semibold text-sm text-neutral-800">{title}</p>
      <p className="text-xs text-neutral-500 mt-1">{desc}</p>
    </div>
  );
}