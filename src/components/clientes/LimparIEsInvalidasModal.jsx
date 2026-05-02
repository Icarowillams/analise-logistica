import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, CheckCircle2, Eraser } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Limpa Inscrições Estaduais inválidas dos clientes PJ.
 * Critério "lixo" = mesma regra do enviarClienteOmie:
 *   - vazia, "isento", menos de 2 dígitos, todos dígitos iguais (000..., 111...)
 */
function ieEhLixo(ieRaw) {
  const txt = String(ieRaw || '').trim();
  if (!txt) return true;
  if (/^isent/i.test(txt)) return true;
  const dig = txt.replace(/\D/g, '');
  if (dig.length < 2) return true;
  if (/^(\d)\1+$/.test(dig)) return true;
  return false;
}

export default function LimparIEsInvalidasModal({ open, onOpenChange }) {
  const [analisando, setAnalisando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [analise, setAnalise] = useState(null); // { total, comIeLixo, lista }
  const [resultado, setResultado] = useState(null);
  const queryClient = useQueryClient();

  const analisar = async () => {
    setAnalisando(true);
    setAnalise(null);
    setResultado(null);
    try {
      const todos = await base44.entities.Cliente.list();
      const pj = todos.filter(c => {
        const doc = (c.cnpj_cpf || '').replace(/\D/g, '');
        return doc.length === 14;
      });
      const comIeLixo = pj.filter(c => {
        const ieRaw = String(c.inscricao_estadual || '').trim();
        // só consideramos "lixo" o que tem ALGUMA coisa digitada que não vale
        // (já vazio também limpamos pra normalizar, mas aqui foco em LIXO)
        return ieRaw && ieEhLixo(ieRaw);
      });
      setAnalise({ total: pj.length, comIeLixo: comIeLixo.length, lista: comIeLixo });
    } catch (e) {
      toast.error('Erro ao analisar: ' + e.message);
    } finally {
      setAnalisando(false);
    }
  };

  const executar = async () => {
    if (!analise?.lista?.length) return;
    setExecutando(true);
    let ok = 0, erro = 0;
    for (const c of analise.lista) {
      try {
        await base44.entities.Cliente.update(c.id, { inscricao_estadual: '' });
        ok++;
      } catch (_) {
        erro++;
      }
    }
    setResultado({ ok, erro });
    setExecutando(false);
    queryClient.invalidateQueries(['clientes']);
    if (erro === 0) toast.success(`✅ ${ok} cliente(s) atualizado(s) — agora vão como ISENTO no Omie`);
    else toast.warning(`${ok} ok, ${erro} com erro`);
  };

  const fechar = () => {
    setAnalise(null);
    setResultado(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eraser className="w-5 h-5 text-amber-600" />
            Limpar Inscrições Estaduais Inválidas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="font-medium text-amber-900 mb-1">O que essa ação faz?</p>
            <p className="text-amber-800">
              Procura clientes <b>PJ (CNPJ)</b> com IE preenchida mas <b>inválida</b>:
              números com menos de 2 dígitos, todos dígitos iguais (ex: 000000000, 111111111),
              ou texto "isento" digitado errado. Esses clientes passam a ser enviados ao Omie como
              <b> contribuinte = N + IE = ISENTO</b>, evitando a rejeição SEFAZ <b>233</b>.
            </p>
            <p className="text-amber-800 mt-1">
              <b>PF (CPF)</b> não é afetado — sempre vai como não-contribuinte.
            </p>
          </div>

          {!analise && (
            <Button onClick={analisar} disabled={analisando} className="w-full">
              {analisando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlertCircle className="w-4 h-4 mr-2" />}
              {analisando ? 'Analisando base...' : 'Analisar clientes'}
            </Button>
          )}

          {analise && !resultado && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded-lg p-3 bg-slate-50">
                  <p className="text-xs text-slate-500">Total PJ</p>
                  <p className="text-2xl font-bold">{analise.total}</p>
                </div>
                <div className="border rounded-lg p-3 bg-red-50 border-red-200">
                  <p className="text-xs text-red-600">Com IE inválida</p>
                  <p className="text-2xl font-bold text-red-700">{analise.comIeLixo}</p>
                </div>
              </div>

              {analise.comIeLixo > 0 && (
                <>
                  <div className="max-h-60 overflow-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Código</th>
                          <th className="text-left p-2">Razão Social</th>
                          <th className="text-left p-2">CNPJ</th>
                          <th className="text-left p-2">IE atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analise.lista.slice(0, 100).map(c => (
                          <tr key={c.id} className="border-t">
                            <td className="p-2 font-mono">{c.codigo}</td>
                            <td className="p-2 truncate max-w-[200px]">{c.razao_social}</td>
                            <td className="p-2 font-mono text-slate-500">{c.cnpj_cpf}</td>
                            <td className="p-2 font-mono text-red-600">{c.inscricao_estadual}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {analise.lista.length > 100 && (
                      <div className="p-2 text-center text-xs text-slate-500 bg-slate-50">
                        ...e mais {analise.lista.length - 100} cliente(s)
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={executar}
                    disabled={executando}
                    className="w-full bg-red-600 hover:bg-red-700"
                  >
                    {executando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eraser className="w-4 h-4 mr-2" />}
                    {executando ? 'Limpando IEs...' : `Limpar IE de ${analise.comIeLixo} cliente(s)`}
                  </Button>
                </>
              )}

              {analise.comIeLixo === 0 && (
                <div className="text-center py-6 text-emerald-600">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2" />
                  <p className="font-medium">Nenhuma IE inválida encontrada!</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Todas as IEs cadastradas têm formato válido. Se ainda houver rejeição 233,
                    a IE está baixada/cancelada na SEFAZ — apague manualmente nesses clientes.
                  </p>
                </div>
              )}
            </div>
          )}

          {resultado && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-lg">{resultado.ok} cliente(s) limpos</p>
              {resultado.erro > 0 && <p className="text-red-600 text-sm">{resultado.erro} com erro</p>}
              <p className="text-xs text-slate-500 mt-2">
                Agora reenvie esses clientes ao Omie e tente faturar novamente.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}