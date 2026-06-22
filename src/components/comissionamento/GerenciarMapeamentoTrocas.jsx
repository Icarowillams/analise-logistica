import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, User, Building2 } from 'lucide-react';
import { toast } from 'sonner';

// Mapeamento de responsabilidade dos motivos de troca (decisão #5).
// Não altera schema de trocas — só classifica VENDEDOR x EMPRESA. Motivo sem
// mapeamento = pendência (fora do cálculo de ambos os lados, seção 5.3).
export default function GerenciarMapeamentoTrocas() {
  const qc = useQueryClient();
  const { data: motivos = [] } = useQuery({
    queryKey: ['motivos-troca'],
    queryFn: () => base44.entities.MotivoTroca.list('-created_date', 1000)
  });
  const { data: mapeamentos = [] } = useQuery({
    queryKey: ['motivo-mapeamento'],
    queryFn: () => base44.entities.MotivoTrocaMapeamento.list('-created_date', 1000)
  });

  const mapaPorMotivo = new Map(mapeamentos.map(m => [String(m.motivo_id), m]));

  const classificar = async (motivo, responsabilidade) => {
    const existente = mapaPorMotivo.get(String(motivo.id));
    if (existente) {
      await base44.entities.MotivoTrocaMapeamento.update(existente.id, { responsabilidade, ativo: true });
    } else {
      await base44.entities.MotivoTrocaMapeamento.create({
        motivo_id: motivo.id, motivo_descricao: motivo.descricao, responsabilidade, ativo: true
      });
    }
    toast.success(`"${motivo.descricao}" → ${responsabilidade === 'VENDEDOR' ? 'Vendedor' : 'Empresa'}`);
    qc.invalidateQueries({ queryKey: ['motivo-mapeamento'] });
  };

  const pendentes = motivos.filter(m => !mapaPorMotivo.has(String(m.id)));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Classificação de Motivos de Troca</CardTitle>
        {pendentes.length > 0 && (
          <Badge variant="outline" className="w-fit bg-amber-50 text-amber-700 border-amber-200">
            <AlertTriangle className="w-3 h-3 mr-1" /> {pendentes.length} motivo(s) sem classificação
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5 max-h-[640px] overflow-y-auto">
        {motivos.length === 0 && <p className="text-sm text-slate-400">Nenhum motivo de troca cadastrado no sistema.</p>}
        {motivos.map(motivo => {
          const mp = mapaPorMotivo.get(String(motivo.id));
          const resp = mp?.responsabilidade;
          return (
            <div key={motivo.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-slate-700 truncate">{motivo.descricao}</span>
                {!resp && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Pendente</Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant={resp === 'VENDEDOR' ? 'default' : 'outline'}
                  className={resp === 'VENDEDOR' ? 'bg-slate-700 hover:bg-slate-800' : ''}
                  onClick={() => classificar(motivo, 'VENDEDOR')}
                >
                  <User className="w-3.5 h-3.5 mr-1" /> Vendedor
                </Button>
                <Button
                  size="sm"
                  variant={resp === 'EMPRESA' ? 'default' : 'outline'}
                  className={resp === 'EMPRESA' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  onClick={() => classificar(motivo, 'EMPRESA')}
                >
                  <Building2 className="w-3.5 h-3.5 mr-1" /> Empresa
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}