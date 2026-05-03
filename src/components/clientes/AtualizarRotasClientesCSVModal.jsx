import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, CheckCircle2, Loader2, Route, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function AtualizarRotasClientesCSVModal({ open, onOpenChange, onSuccess }) {
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);

  const executar = async (dryRun) => {
    if (!file && !fileUrl) {
      toast.error('Selecione um CSV primeiro.');
      return;
    }

    setLoading(true);
    try {
      let url = fileUrl;
      if (!url && file) {
        const upload = await base44.integrations.Core.UploadFile({ file });
        url = upload.file_url;
        setFileUrl(url);
      }

      const res = await base44.functions.invoke('atualizarRotasClientesCSV', {
        file_url: url,
        dryRun,
      });

      setResultado(res.data);
      if (dryRun) {
        toast.success('Pré-validação concluída. Confira o resumo antes de atualizar.');
      } else {
        toast.success(`${res.data.atualizacoes} cliente(s) atualizados com sucesso.`);
        onSuccess?.();
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message);
    }
    setLoading(false);
  };

  const limpar = () => {
    setFile(null);
    setFileUrl('');
    setResultado(null);
  };

  const fechar = (value) => {
    onOpenChange(value);
    if (!value) limpar();
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="w-5 h-5 text-cyan-600" />
            Atualizar rotas por CSV
          </DialogTitle>
          <DialogDescription>
            Envie um CSV com codigo, CNPJ/CPF, nome fantasia, razão social, rota e status para cruzar com os clientes já cadastrados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Fluxo seguro</AlertTitle>
            <AlertDescription>
              Primeiro clique em pré-validar. A atualização só acontece quando você clicar em “Atualizar clientes”.
            </AlertDescription>
          </Alert>

          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setFileUrl('');
              setResultado(null);
            }}
          />

          {resultado && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Resumo da leitura
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div><span className="text-slate-500">Linhas CSV</span><div className="font-bold">{resultado.total_linhas_csv}</div></div>
                <div><span className="text-slate-500">Vai atualizar</span><div className="font-bold text-cyan-700">{resultado.atualizacoes}</div></div>
                <div><span className="text-slate-500">Sem alteração</span><div className="font-bold">{resultado.sem_alteracao}</div></div>
                <div><span className="text-slate-500">Não encontrados</span><div className="font-bold text-amber-700">{resultado.nao_encontrados}</div></div>
                <div><span className="text-slate-500">Ambíguos</span><div className="font-bold text-red-700">{resultado.ambiguos}</div></div>
                <div><span className="text-slate-500">Rotas criadas</span><div className="font-bold">{resultado.rotas_criadas}</div></div>
              </div>
              {resultado.amostras?.atualizacoes?.length > 0 && (
                <div className="max-h-44 overflow-auto rounded-lg bg-white border border-slate-200">
                  {resultado.amostras.atualizacoes.slice(0, 8).map((item) => (
                    <div key={`${item.id}-${item.rota_nova}`} className="p-2 border-b last:border-b-0 text-xs">
                      <strong>{item.nome}</strong> → {item.rota_nova || '-'} / {item.status_novo || item.status_atual || '-'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => fechar(false)} disabled={loading}>Fechar</Button>
          <Button variant="outline" onClick={() => executar(true)} disabled={loading || !file}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Pré-validar CSV
          </Button>
          <Button onClick={() => executar(false)} disabled={loading || !resultado || resultado.atualizacoes === 0} className="bg-cyan-600 hover:bg-cyan-700">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
            Atualizar clientes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}