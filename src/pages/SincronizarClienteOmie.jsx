import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, CheckCircle2, XCircle, Link2 } from 'lucide-react';

export default function SincronizarClienteOmie() {
  const [busca, setBusca] = useState('');
  const [cliente, setCliente] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  const limparDoc = (v) => (v || '').replace(/\D/g, '');

  const buscarCliente = async () => {
    setErro('');
    setCliente(null);
    setResultado(null);
    const termo = busca.trim();
    if (!termo) {
      setErro('Informe o ID, CNPJ/CPF ou razão social do cliente.');
      return;
    }

    setBuscando(true);
    try {
      // 1) Tentar como ID
      let encontrado = null;
      try {
        encontrado = await base44.entities.Cliente.get(termo);
      } catch (_) { /* não é ID válido */ }

      // 2) Tentar por CNPJ/CPF
      if (!encontrado) {
        const docLimpo = limparDoc(termo);
        if (docLimpo.length >= 11) {
          const lista = await base44.entities.Cliente.filter({ cnpj_cpf: docLimpo });
          if (lista?.length) encontrado = lista[0];
          if (!encontrado) {
            // tentar com máscara original também
            const lista2 = await base44.entities.Cliente.filter({ cnpj_cpf: termo });
            if (lista2?.length) encontrado = lista2[0];
          }
        }
      }

      // 3) Tentar por razão social (parcial)
      if (!encontrado) {
        const lista = await base44.entities.Cliente.filter({ razao_social: termo });
        if (lista?.length) encontrado = lista[0];
      }

      if (!encontrado) {
        setErro('Cliente não encontrado no Base44.');
      } else {
        setCliente(encontrado);
      }
    } catch (e) {
      setErro('Erro ao buscar cliente: ' + e.message);
    } finally {
      setBuscando(false);
    }
  };

  const sincronizar = async () => {
    if (!cliente) return;
    setSincronizando(true);
    setResultado(null);
    setErro('');
    try {
      const response = await base44.functions.invoke('enviarClienteOmie', {
        event: { entity_id: cliente.id, type: 'manual_sync' },
        data: cliente
      });
      setResultado(response.data);

      // Atualiza o cliente em tela para refletir o novo codigo_omie
      if (response.data?.sucesso) {
        try {
          const atualizado = await base44.entities.Cliente.get(cliente.id);
          setCliente(atualizado);
        } catch (_) {}
      }
    } catch (e) {
      setErro('Erro ao sincronizar: ' + e.message);
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-cyan-600" />
            Sincronizar / Vincular Cliente ao Omie
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Busca um cliente no Base44 e envia ao Omie. Se o CNPJ/CPF já existir no Omie, o sistema apenas
            <strong> vincula</strong> os IDs (não recadastra) e grava o <code>codigo_omie</code> aqui.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ID, CNPJ/CPF ou Razão Social</Label>
            <div className="flex gap-2">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Ex.: 69fceb23ec80bab717771daa ou 00.000.000/0001-00"
                onKeyDown={(e) => e.key === 'Enter' && buscarCliente()}
              />
              <Button onClick={buscarCliente} disabled={buscando}>
                {buscando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="ml-2">Buscar</span>
              </Button>
            </div>
          </div>

          {erro && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
              <XCircle className="w-4 h-4" /> {erro}
            </div>
          )}

          {cliente && (
            <div className="border rounded-lg p-4 space-y-2 bg-slate-50">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-500">Razão Social:</span> <strong>{cliente.razao_social}</strong></div>
                <div><span className="text-slate-500">Nome Fantasia:</span> {cliente.nome_fantasia || '-'}</div>
                <div><span className="text-slate-500">CNPJ/CPF:</span> {cliente.cnpj_cpf || '-'}</div>
                <div><span className="text-slate-500">Tipo Nota:</span> {cliente.tipo_nota || '55'}</div>
                <div><span className="text-slate-500">ID Base44:</span> <code className="text-xs">{cliente.id}</code></div>
                <div>
                  <span className="text-slate-500">Código Omie atual:</span>{' '}
                  {cliente.codigo_omie
                    ? <code className="text-xs bg-green-100 px-1 rounded">{cliente.codigo_omie}</code>
                    : <span className="text-amber-600">não vinculado</span>}
                </div>
              </div>

              {cliente.tipo_nota === 'D1' ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
                  Cliente tipo D1 — não é sincronizado com o Omie.
                </div>
              ) : (
                <Button
                  onClick={sincronizar}
                  disabled={sincronizando}
                  className="bg-cyan-600 hover:bg-cyan-700 w-full"
                >
                  {sincronizando ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sincronizando...</>
                  ) : (
                    <><Link2 className="w-4 h-4 mr-2" /> Sincronizar / Vincular com Omie</>
                  )}
                </Button>
              )}
            </div>
          )}

          {resultado && (
            <div className={`p-3 rounded-md border text-sm ${
              resultado.sucesso
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <div className="flex items-center gap-2 font-medium mb-1">
                {resultado.sucesso ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {resultado.sucesso ? 'Vinculação concluída!' : 'Falha na sincronização'}
              </div>
              {resultado.sucesso ? (
                <div>
                  Código Omie vinculado: <code className="bg-white px-1 rounded">{resultado.codigo_omie}</code>
                  <div className="text-xs mt-1 opacity-80">{resultado.mensagem}</div>
                </div>
              ) : (
                <div>{resultado.erro}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}