import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, CheckCircle2, XCircle, Link2, Users } from 'lucide-react';

export default function SincronizarClienteOmie() {
  // === MODO INDIVIDUAL ===
  const [busca, setBusca] = useState('');
  const [cliente, setCliente] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState('');

  // === MODO LOTE ===
  const [docsLote, setDocsLote] = useState('');
  const [processandoLote, setProcessandoLote] = useState(false);
  const [progressoLote, setProgressoLote] = useState({ atual: 0, total: 0 });
  const [resultadosLote, setResultadosLote] = useState([]);

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
      let encontrado = null;
      try {
        encontrado = await base44.entities.Cliente.get(termo);
      } catch (_) { /* não é ID válido */ }

      if (!encontrado) {
        const docLimpo = limparDoc(termo);
        if (docLimpo.length >= 11) {
          const lista = await base44.entities.Cliente.filter({ cnpj_cpf: docLimpo });
          if (lista?.length) encontrado = lista[0];
          if (!encontrado) {
            const lista2 = await base44.entities.Cliente.filter({ cnpj_cpf: termo });
            if (lista2?.length) encontrado = lista2[0];
          }
        }
      }

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

  // === LOTE ===
  const buscarClientePorDoc = async (docInput) => {
    const docLimpo = limparDoc(docInput);
    if (docLimpo.length < 11) return null;
    let lista = await base44.entities.Cliente.filter({ cnpj_cpf: docLimpo });
    if (lista?.length) return lista[0];
    lista = await base44.entities.Cliente.filter({ cnpj_cpf: docInput.trim() });
    return lista?.[0] || null;
  };

  const sincronizarLote = async () => {
    setResultadosLote([]);
    // Divide por linha, vírgula ou ponto-e-vírgula
    const docs = docsLote
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (docs.length === 0) return;

    setProcessandoLote(true);
    setProgressoLote({ atual: 0, total: docs.length });
    const resultados = [];

    for (let i = 0; i < docs.length; i++) {
      const docOriginal = docs[i];
      setProgressoLote({ atual: i + 1, total: docs.length });
      try {
        const cli = await buscarClientePorDoc(docOriginal);
        if (!cli) {
          resultados.push({ doc: docOriginal, status: 'nao_encontrado', mensagem: 'Cliente não encontrado no Base44' });
          continue;
        }
        if (cli.tipo_nota === 'D1') {
          resultados.push({ doc: docOriginal, razao: cli.razao_social, status: 'ignorado', mensagem: 'Cliente tipo D1 — não sincroniza com Omie' });
          continue;
        }
        const response = await base44.functions.invoke('enviarClienteOmie', {
          event: { entity_id: cli.id, type: 'manual_sync' },
          data: cli
        });
        if (response.data?.sucesso) {
          resultados.push({ doc: docOriginal, razao: cli.razao_social, status: 'sucesso', codigo_omie: response.data.codigo_omie, mensagem: response.data.mensagem });
        } else {
          resultados.push({ doc: docOriginal, razao: cli.razao_social, status: 'erro', mensagem: response.data?.erro || 'Erro desconhecido' });
        }
      } catch (e) {
        resultados.push({ doc: docOriginal, status: 'erro', mensagem: e.message });
      }
      setResultadosLote([...resultados]);
    }

    setProcessandoLote(false);
  };

  const totaisLote = {
    sucesso: resultadosLote.filter(r => r.status === 'sucesso').length,
    erro: resultadosLote.filter(r => r.status === 'erro').length,
    nao_encontrado: resultadosLote.filter(r => r.status === 'nao_encontrado').length,
    ignorado: resultadosLote.filter(r => r.status === 'ignorado').length,
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
            Busca um ou mais clientes no Base44 e envia ao Omie. Se o CNPJ/CPF já existir no Omie, o sistema apenas
            <strong> vincula</strong> os IDs (não recadastra) e grava o <code>codigo_omie</code> aqui.
          </p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="individual">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="individual"><Search className="w-4 h-4 mr-2" />Individual</TabsTrigger>
              <TabsTrigger value="lote"><Users className="w-4 h-4 mr-2" />Em Lote</TabsTrigger>
            </TabsList>

            {/* === ABA INDIVIDUAL === */}
            <TabsContent value="individual" className="space-y-4 mt-4">
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
            </TabsContent>

            {/* === ABA LOTE === */}
            <TabsContent value="lote" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>CNPJs/CPFs (um por linha, ou separados por vírgula/ponto-e-vírgula)</Label>
                <Textarea
                  value={docsLote}
                  onChange={(e) => setDocsLote(e.target.value)}
                  placeholder={'00.000.000/0001-00\n11.111.111/0001-11\n222.333.444-55'}
                  rows={8}
                  className="font-mono text-sm"
                  disabled={processandoLote}
                />
                <p className="text-xs text-slate-500">
                  {docsLote.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).length} documento(s) detectado(s)
                </p>
              </div>

              <Button
                onClick={sincronizarLote}
                disabled={processandoLote || !docsLote.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 w-full"
              >
                {processandoLote ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processando {progressoLote.atual} de {progressoLote.total}...</>
                ) : (
                  <><Users className="w-4 h-4 mr-2" /> Sincronizar Todos</>
                )}
              </Button>

              {resultadosLote.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2 text-center text-sm">
                    <div className="p-2 rounded bg-green-50 border border-green-200">
                      <div className="font-bold text-green-700">{totaisLote.sucesso}</div>
                      <div className="text-xs text-green-700">Sucesso</div>
                    </div>
                    <div className="p-2 rounded bg-red-50 border border-red-200">
                      <div className="font-bold text-red-700">{totaisLote.erro}</div>
                      <div className="text-xs text-red-700">Erros</div>
                    </div>
                    <div className="p-2 rounded bg-amber-50 border border-amber-200">
                      <div className="font-bold text-amber-700">{totaisLote.nao_encontrado}</div>
                      <div className="text-xs text-amber-700">Não encontrados</div>
                    </div>
                    <div className="p-2 rounded bg-slate-50 border border-slate-200">
                      <div className="font-bold text-slate-700">{totaisLote.ignorado}</div>
                      <div className="text-xs text-slate-700">Ignorados (D1)</div>
                    </div>
                  </div>

                  <div className="max-h-96 overflow-y-auto space-y-1 border rounded-lg p-2 bg-slate-50">
                    {resultadosLote.map((r, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded text-xs border flex items-start gap-2 ${
                          r.status === 'sucesso' ? 'bg-green-50 border-green-200' :
                          r.status === 'erro' ? 'bg-red-50 border-red-200' :
                          r.status === 'nao_encontrado' ? 'bg-amber-50 border-amber-200' :
                          'bg-slate-100 border-slate-200'
                        }`}
                      >
                        {r.status === 'sucesso' ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1">
                          <div className="font-mono font-medium">{r.doc}</div>
                          {r.razao && <div className="text-slate-600">{r.razao}</div>}
                          <div className="opacity-80">{r.mensagem}</div>
                          {r.codigo_omie && <div>Omie: <code className="bg-white px-1 rounded">{r.codigo_omie}</code></div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}