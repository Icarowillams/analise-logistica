import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle, UserX } from 'lucide-react';
import { toast } from 'sonner';

export default function CorrigirPlanosPlanilha() {
  const [arquivo, setArquivo] = useState(null);
  const [somenteVazios, setSomenteVazios] = useState(true);
  const [processando, setProcessando] = useState(false);
  const [resumo, setResumo] = useState(null);

  const processar = async () => {
    if (!arquivo) {
      toast.error('Selecione o arquivo CADASTROS-ATIVOS (XLSX ou CSV)');
      return;
    }
    setProcessando(true);
    setResumo(null);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: arquivo });
      const response = await base44.functions.invoke('corrigirPlanosViaPlanilha', {
        file_url,
        somente_vazios: somenteVazios,
      });
      if (response.data?.error) {
        toast.error(response.data.error);
      } else {
        setResumo(response.data);
        toast.success(`Processado: ${response.data.atualizados} clientes atualizados`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Erro ao processar planilha');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Corrigir Planos via Planilha (CADASTROS-ATIVOS)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">
            Lê as colunas <strong>CODIGO</strong> (1ª coluna), <strong>PLANO PAGAMENTO</strong> e <strong>COBRANCA</strong> da planilha
            e aplica o plano de pagamento e a modalidade nos clientes por código interno. Nomes sem correspondência no banco não são aplicados.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <label className="flex-1">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-emerald-400 transition-colors">
                <Upload className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                <span className="text-sm text-slate-600">
                  {arquivo ? arquivo.name : 'Clique para selecionar o arquivo XLSX/CSV'}
                </span>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="somente-vazios" checked={somenteVazios} onCheckedChange={setSomenteVazios} />
            <Label htmlFor="somente-vazios" className="text-sm">
              Preencher apenas clientes sem plano/modalidade (modo seguro)
            </Label>
          </div>

          <Button onClick={processar} disabled={processando || !arquivo} className="bg-emerald-600 hover:bg-emerald-700">
            {processando ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processando...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Processar</>
            )}
          </Button>
        </CardContent>
      </Card>

      {resumo && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-800">{resumo.total_planilha}</div>
                <div className="text-xs text-slate-500">Linhas na planilha</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">{resumo.atualizados}</div>
                <div className="text-xs text-slate-500">Atualizados</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{resumo.ja_corretos}</div>
                <div className="text-xs text-slate-500">Já corretos</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-500">{resumo.sem_cliente_no_banco?.length || 0}</div>
                <div className="text-xs text-slate-500">Sem cliente no banco</div>
              </CardContent>
            </Card>
          </div>

          {resumo.nao_mapeados?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Não mapeados ({resumo.nao_mapeados.length}) — plano/cobrança sem correspondência no banco
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b">
                        <th className="py-1.5 pr-4">Código</th>
                        <th className="py-1.5 pr-4">Plano (planilha)</th>
                        <th className="py-1.5">Cobrança (planilha)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumo.nao_mapeados.map((n, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1.5 pr-4 font-mono text-xs">{n.codigo}</td>
                          <td className="py-1.5 pr-4">{n.plano || '—'}</td>
                          <td className="py-1.5">{n.cobranca || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {resumo.sem_cliente_no_banco?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UserX className="w-4 h-4 text-red-500" />
                  Códigos sem cliente no banco ({resumo.sem_cliente_no_banco.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {resumo.sem_cliente_no_banco.map((c) => (
                    <Badge key={c} variant="outline" className="font-mono text-xs">{c}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {resumo.nao_mapeados?.length === 0 && resumo.sem_cliente_no_banco?.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
              Todas as linhas foram processadas sem pendências.
            </div>
          )}
        </div>
      )}
    </div>
  );
}