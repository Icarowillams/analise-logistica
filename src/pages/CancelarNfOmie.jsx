import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Search, FileX, Loader2, AlertTriangle, CheckCircle2,
  XCircle, FileText, DollarSign, Calendar, User
} from 'lucide-react';
import { toast } from 'sonner';

export default function CancelarNfOmie() {
  const [numeroNf, setNumeroNf] = useState('');
  const [motivo, setMotivo] = useState('');
  const [nfInfo, setNfInfo] = useState(null);
  const [consultando, setConsultando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const consultarNf = async () => {
    if (!numeroNf.trim()) {
      toast.error('Informe o número da NF');
      return;
    }

    setConsultando(true);
    setNfInfo(null);
    setResultado(null);

    const response = await base44.functions.invoke('cancelarNfOmie', {
      numero_nf: numeroNf.trim(),
      apenas_consultar: true
    });

    const data = response.data;

    if (data.sucesso && data.nf_info) {
      setNfInfo(data.nf_info);
      if (data.ja_cancelada) {
        toast.info('Esta NF já está cancelada no Omie');
      }
    } else {
      toast.error(data.erro || 'NF não encontrada no Omie');
    }

    setConsultando(false);
  };

  const cancelarNf = async () => {
    if (!motivo.trim()) {
      toast.error('Informe o motivo do cancelamento');
      return;
    }

    if (!confirm(`Tem certeza que deseja cancelar a NF ${numeroNf}? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setCancelando(true);

    const response = await base44.functions.invoke('cancelarNfOmie', {
      numero_nf: numeroNf.trim(),
      motivo: motivo.trim()
    });

    const data = response.data;

    if (data.sucesso) {
      setResultado({ tipo: 'sucesso', mensagem: data.mensagem });
      toast.success(data.mensagem);
      setNfInfo(prev => prev ? { ...prev, jaCancelada: true } : prev);
    } else {
      setResultado({ tipo: 'erro', mensagem: data.erro });
      toast.error(data.erro);
    }

    setCancelando(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cancelar NF no Omie</h1>
        <p className="text-sm text-slate-500 mt-1">
          Consulte e cancele notas fiscais diretamente no Omie para retornos e devoluções
        </p>
      </div>

      {/* Busca */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4" />
            Consultar Nota Fiscal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label>Número da NF</Label>
              <Input
                placeholder="Ex: 172918"
                value={numeroNf}
                onChange={(e) => setNumeroNf(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && consultarNf()}
              />
            </div>
            <Button onClick={consultarNf} disabled={consultando} className="bg-amber-500 hover:bg-amber-600">
              {consultando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Consultar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resultado da consulta */}
      {nfInfo && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Dados da NF {numeroNf}
              </CardTitle>
              {nfInfo.jaCancelada ? (
                <Badge className="bg-red-500">Cancelada em {nfInfo.dataCancelamento}</Badge>
              ) : (
                <Badge className="bg-green-500">Ativa</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <InfoItem icon={User} label="Cliente" value={nfInfo.clienteNome || '-'} />
              <InfoItem icon={FileText} label="CNPJ/CPF" value={nfInfo.clienteCnpj || '-'} />
              <InfoItem icon={DollarSign} label="Valor" value={`R$ ${Number(nfInfo.valorNF || 0).toFixed(2)}`} />
              <InfoItem icon={Calendar} label="Emissão" value={nfInfo.dataEmissao || '-'} />
              <InfoItem icon={FileText} label="Série" value={nfInfo.serie || '-'} />
              <InfoItem icon={FileText} label="Chave NFe" value={nfInfo.chaveNFe ? `${nfInfo.chaveNFe.substring(0, 20)}...` : '-'} />
            </div>

            {/* Cancelamento */}
            {!nfInfo.jaCancelada && (
              <div className="mt-6 p-4 bg-red-50 rounded-lg border border-red-200">
                <h3 className="font-medium text-red-800 flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4" />
                  Cancelar esta Nota Fiscal
                </h3>
                <div className="space-y-3">
                  <div>
                    <Label>Motivo do cancelamento *</Label>
                    <Textarea
                      placeholder="Ex: Retorno de mercadoria - cliente ausente"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      className="bg-white"
                    />
                  </div>
                  <Button
                    onClick={cancelarNf}
                    disabled={cancelando}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {cancelando ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <FileX className="w-4 h-4 mr-2" />
                    )}
                    Cancelar NF no Omie
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Resultado do cancelamento */}
      {resultado && (
        <Card className={resultado.tipo === 'sucesso' ? 'border-green-200' : 'border-red-200'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {resultado.tipo === 'sucesso' ? (
                <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 shrink-0" />
              )}
              <p className={resultado.tipo === 'sucesso' ? 'text-green-800' : 'text-red-800'}>
                {resultado.mensagem}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  );
}