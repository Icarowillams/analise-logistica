import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, UserPlus, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { diaCurto } from './gestaoUtils';

export default function RoteirosClientesPendentes({ precadastros, onRecarregar }) {
  const adicionar = async (p) => {
    await base44.entities.PreCadastro.update(p.id, { status: 'em_cadastro' });
    toast.success('Marcado para cadastro. Vá em Clientes para finalizar.');
    onRecarregar();
  };

  const descartar = async (p) => {
    if (!confirm('Descartar esta solicitação?')) return;
    await base44.entities.PreCadastro.delete(p.id);
    toast.success('Solicitação descartada.');
    onRecarregar();
  };

  const formatarData = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('pt-BR');
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-700">
            <AlertTriangle className="w-5 h-5" />Clientes Não Cadastrados ({precadastros.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Código</th>
                <th className="text-left p-3 font-medium">Funcionário</th>
                <th className="text-left p-3 font-medium">Dias</th>
                <th className="text-left p-3 font-medium">Data do Log</th>
                <th className="text-left p-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {precadastros.map(p => (
                <tr key={p.id} className="border-b hover:bg-amber-50/50">
                  <td className="p-3">
                    <div className="font-medium">{p.cnpj_cpf || p.id.slice(0, 6)}</div>
                    {p.status === 'cadastrado' && <Badge className="bg-green-100 text-green-800 text-xs mt-1">Cadastrado!</Badge>}
                  </td>
                  <td className="p-3 font-medium">{(p.vendedor_nome || '').toUpperCase()}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {(p.observacoes || '').split(',').filter(Boolean).slice(0, 5).map((d, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{diaCurto(d.trim())}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-slate-500">{formatarData(p.data_solicitacao || p.created_date)}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => adicionar(p)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                        <UserPlus className="w-4 h-4 mr-1" />Adicionar ao Roteiro
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => descartar(p)} className="text-red-500 hover:bg-red-50 h-8 w-8">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {precadastros.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">Nenhum cliente pendente.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}