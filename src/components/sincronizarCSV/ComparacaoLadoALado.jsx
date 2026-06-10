import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';

const CAMPOS_LABEL = {
  razao_social: 'Razão Social',
  nome_fantasia: 'Nome Fantasia',
  cnpj_cpf: 'CNPJ/CPF',
  endereco: 'Endereço',
  numero: 'Número',
  bairro: 'Bairro',
  cidade: 'Cidade',
  estado: 'UF',
  cep: 'CEP',
  inativo: 'Inativo',
};

export default function ComparacaoLadoALado({ items, busca }) {
  const [expandidos, setExpandidos] = useState({});
  const [mostrarQtd, setMostrarQtd] = useState(100);

  const toggle = (id) => {
    setExpandidos(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filtrados = items.filter(item => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (item.razao_social || '').toLowerCase().includes(q)
      || (item.nome_fantasia || '').toLowerCase().includes(q)
      || (item.codigo || '').toLowerCase().includes(q);
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Badge className="bg-amber-500 text-white">{filtrados.length}</Badge>
          Clientes com diferenças (CSV × Base44)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 max-h-[600px] overflow-y-auto">
        {filtrados.slice(0, mostrarQtd).map((item) => {
          const isOpen = expandidos[item.id];
          return (
            <div key={item.id} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(item.id)}
                className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                  <span className="font-mono text-xs text-slate-400 flex-shrink-0">{item.codigo}</span>
                  <span className="font-medium truncate">{item.razao_social || item.nome_fantasia}</span>
                </div>
                <Badge className="bg-amber-100 text-amber-700 text-xs flex-shrink-0 ml-2">
                  {item.diffs.length} {item.diffs.length === 1 ? 'diferença' : 'diferenças'}
                </Badge>
              </button>

              {isOpen && (
                <div className="bg-slate-50 border-t px-4 py-3">
                  <div className="grid grid-cols-1 gap-2">
                    {/* Header */}
                    <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-500 pb-1 border-b border-slate-200">
                      <span>Campo</span>
                      <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                      CSV
                      </span>
                      <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                      Base44
                      </span>
                    </div>

                    {item.diffs.map((diff, idx) => (
                      <div key={idx} className="grid grid-cols-3 gap-2 items-center py-1.5 border-b border-slate-100 last:border-0">
                        <span className="text-xs font-medium text-slate-600">
                          {CAMPOS_LABEL[diff.campo] || diff.campo}
                        </span>
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono break-all">
                          {diff.csv || diff.base44 || <span className="italic text-slate-400">(vazio)</span>}
                        </span>
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-mono break-all">
                          {diff.base44 || <span className="italic text-slate-400">(vazio)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtrados.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">Nenhum resultado para o filtro.</p>
        )}
        {filtrados.length > mostrarQtd && (
          <button
            onClick={() => setMostrarQtd(prev => prev + 100)}
            className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Mostrar mais ({filtrados.length - mostrarQtd} restantes)
          </button>
        )}
      </CardContent>
    </Card>
  );
}