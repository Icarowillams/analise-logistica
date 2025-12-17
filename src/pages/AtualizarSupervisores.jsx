import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function AtualizarSupervisores() {
  const [status, setStatus] = useState('');
  const [processing, setProcessing] = useState(false);
  const [stats, setStats] = useState({ total: 0, updated: 0, skipped: 0 });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const handleUpdate = async () => {
    setProcessing(true);
    setStatus('Processando...');
    
    let updated = 0;
    let skipped = 0;
    const total = clientes.length;

    for (const cliente of clientes) {
      // Apenas atualizar se tem vendedor mas não tem supervisor
      if (cliente.vendedor_id && !cliente.supervisor_id) {
        const vendedor = vendedores.find(v => v.id === cliente.vendedor_id);
        if (vendedor && vendedor.supervisor_id) {
          try {
            await base44.entities.Cliente.update(cliente.id, {
              supervisor_id: vendedor.supervisor_id
            });
            updated++;
            setStats({ total, updated, skipped });
          } catch (err) {
            console.error('Erro ao atualizar cliente:', cliente.id, err);
            skipped++;
          }
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
      
      if ((updated + skipped) % 50 === 0) {
        setStatus(`Processados ${updated + skipped} de ${total}...`);
      }
    }

    setStats({ total, updated, skipped });
    setStatus(`Concluído! ${updated} clientes atualizados, ${skipped} ignorados.`);
    setProcessing(false);
  };

  return (
    <div className="p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Atualizar Supervisores dos Clientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              Esta ferramenta irá atualizar automaticamente o campo <strong>supervisor_id</strong> de todos os clientes 
              que possuem um vendedor associado, mas ainda não têm supervisor definido.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Total de clientes: <strong>{clientes.length}</strong>
            </p>
            <p className="text-sm text-slate-600">
              Clientes sem supervisor: <strong>{clientes.filter(c => c.vendedor_id && !c.supervisor_id).length}</strong>
            </p>
          </div>

          {status && (
            <Alert className={processing ? 'bg-blue-50' : 'bg-emerald-50'}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}

          {stats.updated > 0 && (
            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <p className="font-semibold text-emerald-900">Estatísticas:</p>
              <p className="text-sm text-emerald-700">Total processados: {stats.total}</p>
              <p className="text-sm text-emerald-700">Atualizados: {stats.updated}</p>
              <p className="text-sm text-emerald-700">Ignorados: {stats.skipped}</p>
            </div>
          )}

          <Button 
            onClick={handleUpdate}
            disabled={processing || clientes.length === 0}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              'Atualizar Supervisores'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}