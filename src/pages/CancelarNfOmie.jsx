import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search, FileX, Loader2, AlertTriangle, CheckCircle2,
  XCircle, FileText, DollarSign, Calendar, User, Clock, Undo2
} from 'lucide-react';
import { toast } from 'sonner';
import NfInfoCard from '@/components/nf/NfInfoCard.jsx';
import CancelarNfSection from '@/components/nf/CancelarNfSection.jsx';
import DevolverNfSection from '@/components/nf/DevolverNfSection.jsx';

export default function CancelarNfOmie() {
  const [numeroNf, setNumeroNf] = useState('');
  const [nfInfo, setNfInfo] = useState(null);
  const [consultando, setConsultando] = useState(false);
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

  const handleResultado = (res) => {
    setResultado(res);
    if (res.tipo === 'sucesso') {
      setNfInfo(prev => prev ? { ...prev, jaCancelada: true } : prev);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cancelar / Devolver NF</h1>
        <p className="text-sm text-slate-500 mt-1">
          Cancele NFs dentro de 24h ou gere NF de Entrada (devolução) para NFs mais antigas
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

      {/* Dados da NF */}
      {nfInfo && (
        <>
          <NfInfoCard nfInfo={nfInfo} numeroNf={numeroNf} />

          {/* Ações */}
          {!nfInfo.jaCancelada && (
            <Card>
              <CardContent className="p-4">
                {nfInfo.dentroPrazo24h ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3 text-green-700">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Dentro do prazo de 24h ({nfInfo.horasDesdeEmissao}h desde emissão) — Cancelamento disponível
                      </span>
                    </div>
                    <Tabs defaultValue="cancelar">
                      <TabsList>
                        <TabsTrigger value="cancelar">Cancelar NF</TabsTrigger>
                        <TabsTrigger value="devolver">Devolução (NF Entrada)</TabsTrigger>
                      </TabsList>
                      <TabsContent value="cancelar">
                        <CancelarNfSection numeroNf={numeroNf} onResult={handleResultado} />
                      </TabsContent>
                      <TabsContent value="devolver">
                        <DevolverNfSection numeroNf={numeroNf} onResult={handleResultado} />
                      </TabsContent>
                    </Tabs>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3 text-amber-700">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        Fora do prazo de 24h ({nfInfo.horasDesdeEmissao}h desde emissão) — Apenas devolução disponível
                      </span>
                    </div>
                    <DevolverNfSection numeroNf={numeroNf} onResult={handleResultado} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Resultado */}
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