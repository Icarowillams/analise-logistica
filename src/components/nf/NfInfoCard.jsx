import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, DollarSign, Calendar, User } from 'lucide-react';

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

export default function NfInfoCard({ nfInfo, numeroNf }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Dados da NF {numeroNf}
          </CardTitle>
          <div className="flex items-center gap-2">
            {nfInfo.jaCancelada ? (
              <Badge className="bg-red-500">Cancelada em {nfInfo.dataCancelamento}</Badge>
            ) : (
              <Badge className="bg-green-500">Ativa</Badge>
            )}
            {nfInfo.dentroPrazo24h !== undefined && !nfInfo.jaCancelada && (
              <Badge variant="outline" className={nfInfo.dentroPrazo24h ? 'border-green-300 text-green-700' : 'border-amber-300 text-amber-700'}>
                {nfInfo.horasDesdeEmissao}h desde emissão
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <InfoItem icon={User} label="Cliente" value={nfInfo.clienteNome || '-'} />
          <InfoItem icon={FileText} label="CNPJ/CPF" value={nfInfo.clienteCnpj || '-'} />
          <InfoItem icon={DollarSign} label="Valor" value={`R$ ${Number(nfInfo.valorNF || 0).toFixed(2)}`} />
          <InfoItem icon={Calendar} label="Emissão" value={nfInfo.dataEmissao || '-'} />
          <InfoItem icon={FileText} label="Série" value={nfInfo.serie || '-'} />
          <InfoItem icon={FileText} label="Chave NFe" value={nfInfo.chaveNFe ? `${nfInfo.chaveNFe.substring(0, 25)}...` : '-'} />
        </div>
      </CardContent>
    </Card>
  );
}