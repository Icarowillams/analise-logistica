import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Loader2, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';

const formatMoeda = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatPeso = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatData = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

export default function RelatorioCarregamento() {
  const hoje = new Date().toISOString().slice(0, 10);
  const [dataInicial, setDataInicial] = useState(hoje);
  const [dataFinal, setDataFinal] = useState(hoje);
  const [carregando, setCarregando] = useState(false);
  const [relatorio, setRelatorio] = useState(null);
  const printRef = useRef(null);

  const buscar = async () => {
    if (!dataInicial || !dataFinal) return;
    setCarregando(true);
    setRelatorio(null);
    try {
      const { data: resp } = await base44.functions.invoke('relatorioAnaliticoCarregamento', {
        data_inicial: dataInicial,
        data_final: dataFinal
      });
      if (resp?.sucesso) {
        setRelatorio(resp);
      } else {
        toast.error(resp?.error || 'Erro ao buscar relatório');
      }
    } catch (e) {
      toast.error('Erro ao consultar: ' + (e?.response?.data?.error || e.message));
    }
    setCarregando(false);
  };

  const imprimir = () => {
    if (!printRef.current) return;
    const win = window.open('', '_blank', 'width=1100,height=800');
    const estilo = `
      <style>
        body { font-family: 'Courier New', monospace; font-size: 11px; margin: 20px; color: #000; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #333; color: #fff; padding: 5px 4px; text-align: left; font-size: 10px; border: 1px solid #333; }
        td { padding: 4px; border: 1px solid #ccc; font-size: 10px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .header h2 { margin: 0; font-size: 14px; }
        .header .info { font-size: 10px; }
        .totais td { font-weight: bold; border-top: 2px solid #000; }
        .rodape { margin-top: 10px; font-size: 10px; }
        @media print { body { margin: 0; } }
      </style>
    `;
    win.document.write(estilo + printRef.current.innerHTML);
    win.document.close();
    setTimeout(() => win.print(), 500);
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-3">
        <FileText className="w-7 h-7 text-cyan-600" />
        <div>
          <h1 className="text-2xl font-bold">Relatório Analítico do Carregamento</h1>
          <p className="text-sm text-slate-500">Consolidado de cargas por período</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtro</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <Label>De</Label>
              <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
            </div>
            <Button onClick={buscar} disabled={carregando}>
              {carregando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar
            </Button>
            {relatorio && (
              <Button variant="outline" onClick={imprimir}>
                <Printer className="w-4 h-4 mr-2" /> Imprimir
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {carregando && (
        <div className="py-12 text-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
          Consultando cargas...
        </div>
      )}

      {relatorio && !carregando && (
        <Card>
          <CardContent className="p-4">
            <div ref={printRef}>
              {/* Cabeçalho do relatório */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 'bold' }}>Relatório Analítico do Carregamento</h2>
                  <div style={{ fontSize: 10 }}>Empresa: 1 - PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 10 }}>
                  <div>{new Date().toLocaleString('pt-BR')}</div>
                  <div>Página 1 de 1</div>
                </div>
              </div>

              {/* Tabela */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: "'Courier New', monospace" }}>
                  <thead>
                    <tr style={{ background: '#333', color: '#fff' }}>
                      <th style={thStyle}>Carreg.</th>
                      <th style={thStyle}>Dt. Saida</th>
                      <th style={thStyle}>Placa</th>
                      <th style={thStyle}>Motorista</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Qt. Pedidos</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Vl. Total</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Tot. Peso Bruto</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Tot. Peso Liq.</th>
                      <th style={thStyle}>Destino</th>
                      <th style={thStyle}>Dt. Acerto</th>
                      <th style={thStyle}>Faturista</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorio.linhas.map((l, i) => (
                      <tr key={i}>
                        <td style={tdStyle}>{l.carregamento}</td>
                        <td style={tdStyle}>{formatData(l.data_saida)}</td>
                        <td style={tdStyle}>{l.placa}</td>
                        <td style={tdStyle}>{l.motorista}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{l.qt_pedidos}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatMoeda(l.vl_total)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPeso(l.peso_bruto)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPeso(l.peso_liq)}</td>
                        <td style={tdStyle}>{l.destino}</td>
                        <td style={tdStyle}>{l.dt_acerto}</td>
                        <td style={tdStyle}>{l.faturista}</td>
                        <td style={tdStyle}>{l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totais */}
                  <tfoot>
                    <tr style={{ fontWeight: 'bold', borderTop: '2px solid #000' }}>
                      <td style={tdStyle} colSpan={4}>
                        {relatorio.total_carregamentos} Carregamento(s) Listado(s)
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>{relatorio.totais.qt_pedidos}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>{formatMoeda(relatorio.totais.vl_total)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>{formatPeso(relatorio.totais.peso_bruto)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>{formatPeso(relatorio.totais.peso_liq)}</td>
                      <td style={tdStyle} colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const thStyle = {
  padding: '6px 5px',
  textAlign: 'left',
  fontSize: 10,
  border: '1px solid #555',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '4px 5px',
  border: '1px solid #ccc',
  fontSize: 10,
  whiteSpace: 'nowrap'
};