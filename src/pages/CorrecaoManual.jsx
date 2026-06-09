import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wrench, RefreshCw, ShieldAlert, UserPlus } from 'lucide-react';

export default function CorrecaoManual() {
  const { user } = useAuth();

  // — Seção 1: corrigir espelhos —
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  // — Seção 2: vincular clientes a roteiro —
  const [vendedorNome, setVendedorNome] = useState('');
  const [codigosClientes, setCodigosClientes] = useState('');
  const [loadingVinc, setLoadingVinc] = useState(false);
  const [resultadoVinc, setResultadoVinc] = useState(null);
  const [erroVinc, setErroVinc] = useState(null);

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-slate-500">
        <ShieldAlert className="w-10 h-10 text-red-400" />
        <p className="text-lg font-medium">Acesso restrito a administradores.</p>
      </div>
    );
  }

  async function vincularClientes() {
    const codigos = codigosClientes.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!vendedorNome.trim() || !codigos.length) return;
    setLoadingVinc(true);
    setResultadoVinc(null);
    setErroVinc(null);
    try {
      const res = await base44.functions.invoke('vincularClientesRoteiro', {
        vendedor_nome: vendedorNome.trim(),
        codigos_clientes: codigos
      });
      setResultadoVinc(res);
    } catch (e) {
      setErroVinc(e?.message || 'Erro desconhecido');
    } finally {
      setLoadingVinc(false);
    }
  }

  async function executarCorrecao() {
    setLoading(true);
    setResultado(null);
    setErro(null);
    try {
      const res = await base44.functions.invoke('corrigirEspelhoManual', {});
      setResultado(res);
    } catch (e) {
      setErro(e?.message || 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Wrench className="w-6 h-6 text-amber-600" />
        <h1 className="text-xl font-semibold text-slate-800">Correção Manual — Espelhos Desatualizados</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-700 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            Vincular clientes ao roteiro de um vendedor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">
            Adiciona clientes (por <code className="bg-slate-100 px-1 rounded">codigo_interno</code>) ao roteiro
            de um vendedor. Se o vendedor não tiver roteiro, cria um para segunda-feira.
            Clientes já vinculados são ignorados (idempotente).
          </p>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Nome do vendedor (parcial)</Label>
              <Input
                placeholder="ex: Tiago Leandro"
                value={vendedorNome}
                onChange={e => setVendedorNome(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Códigos dos clientes (separados por vírgula ou espaço)</Label>
              <Input
                placeholder="ex: 28090, 26569"
                value={codigosClientes}
                onChange={e => setCodigosClientes(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={vincularClientes}
            disabled={loadingVinc || !vendedorNome.trim() || !codigosClientes.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loadingVinc
              ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Vinculando…</>
              : <><UserPlus className="w-4 h-4 mr-2" />Vincular ao Roteiro</>
            }
          </Button>
          {erroVinc && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <strong>Erro:</strong> {erroVinc}
            </div>
          )}
          {resultadoVinc && (
            <div className="space-y-2">
              <div className={`rounded-md border p-3 text-sm font-medium ${resultadoVinc.sucesso ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {resultadoVinc.clientes_adicionados?.length > 0
                  ? `${resultadoVinc.clientes_adicionados.length} cliente(s) adicionados ao roteiro de ${resultadoVinc.vendedor?.nome}.`
                  : resultadoVinc.mensagem || 'Concluído.'}
              </div>
              <pre className="bg-slate-900 text-slate-100 rounded-md p-4 text-xs overflow-auto max-h-72 whitespace-pre-wrap">
                {JSON.stringify(resultadoVinc, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-700">Corrigir etapa do PedidoLiberadoOmie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">
            Busca todos os registros de <code className="bg-slate-100 px-1 rounded">PedidoLiberadoOmie</code> com{' '}
            <code className="bg-slate-100 px-1 rounded">etapa != '20'</code> cujo Pedido correspondente tem{' '}
            <code className="bg-slate-100 px-1 rounded">status = 'liberado'</code>, e atualiza a etapa para{' '}
            <strong>20 (Liberado)</strong>.
          </p>
          <Button
            onClick={executarCorrecao}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {loading
              ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Corrigindo…</>
              : <><Wrench className="w-4 h-4 mr-2" />Corrigir Espelhos Desatualizados</>
            }
          </Button>

          {erro && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <strong>Erro:</strong> {erro}
            </div>
          )}

          {resultado && (
            <div className="space-y-2">
              <div className={`rounded-md border p-3 text-sm font-medium ${resultado.corrigidos > 0 ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {resultado.corrigidos > 0
                  ? `${resultado.corrigidos} espelho(s) corrigido(s).`
                  : resultado.mensagem || 'Nenhum espelho precisava de correção.'}
              </div>
              <pre className="bg-slate-900 text-slate-100 rounded-md p-4 text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(resultado, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
