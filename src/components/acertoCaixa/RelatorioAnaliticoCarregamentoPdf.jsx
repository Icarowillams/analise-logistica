import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FileBarChart, Download, Loader2, Search } from 'lucide-react';

const ontemISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const fmtMoney = (v) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (v) => (v || 0).toLocaleString('pt-BR');
const fmtData = (s) => s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '-';

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color:#000; padding:16px; }
h1 { font-size:14px; font-weight:700; }
.sub { font-size:9px; color:#333; margin-top:2px; }
table { width:100%; border-collapse:collapse; margin-top:10px; }
th, td { border:1px solid #999; padding:2px 4px; font-size:8px; text-align:left; }
th { background:#e5e5e5; font-weight:700; text-transform:uppercase; }
td.r, th.r { text-align:right; }
td.c, th.c { text-align:center; }
tfoot td { font-weight:700; background:#f0f0f0; }
`;

export default function RelatorioAnaliticoCarregamentoPdf() {
  const printRef = useRef();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(ontemISO());
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);

  const gerar = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('relatorioAnaliticoCarregamento', { data });
      setResultado(res.data);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Relatorio_Analitico_${data}</title><style>${printStyles}</style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  const linhas = resultado?.linhas || [];
  const totais = resultado?.totais || { carregamentos: 0, pedidos: 0, pacotes: 0, valor: 0 };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
          <FileBarChart className="w-4 h-4 mr-2" /> Relatório Analítico
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileBarChart className="w-5 h-5 text-indigo-600" />Relatório Analítico do Carregamento</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Data do carregamento</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
          </div>
          <Button onClick={gerar} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}Gerar
          </Button>
          {resultado && (
            <Button onClick={handlePrint} className="bg-gradient-to-r from-blue-500 to-blue-600">
              <Download className="w-4 h-4 mr-2" /> Imprimir / Salvar PDF
            </Button>
          )}
        </div>

        {loading && <div className="py-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}

        {resultado && !loading && (
          <div className="overflow-x-auto -mx-2 px-2">
            <div ref={printRef} className="bg-white" style={{ minWidth: '760px', padding: '16px', fontFamily: 'Arial, sans-serif', color: '#000' }}>
              <h1 style={{ fontSize: '14px', fontWeight: 700 }}>Relatório Analítico do Carregamento</h1>
              <div style={{ fontSize: '9px', color: '#333', marginTop: '2px' }}>Empresa: 1 - PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME</div>
              <div style={{ fontSize: '9px', color: '#333' }}>Data do carregamento: {fmtData(data)} &nbsp;·&nbsp; Pág. 1 de 1</div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
                <thead>
                  <tr>
                    {['Carga', 'Dt. Saída', 'Placa', 'Motorista', 'Qt. Ped.', 'Pacotes', 'Vl. Total', 'Dt. Acerto', 'Faturista', 'Status'].map((h, i) => (
                      <th key={h} style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', background: '#e5e5e5', textAlign: i >= 4 && i <= 6 ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, idx) => (
                    <tr key={idx}>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px', fontWeight: 600 }}>{l.numero_carga}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{fmtData(l.data_carga)}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{l.veiculo_placa}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{l.motorista_nome}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px', textAlign: 'right' }}>{fmtNum(l.quantidade_pedidos)}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px', textAlign: 'right', fontWeight: 600 }}>{fmtNum(l.quantidade_total_pacotes)}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px', textAlign: 'right' }}>{fmtMoney(l.valor_total_carga)}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{fmtData(l.data_acerto)}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{l.faturista || '-'}</td>
                      <td style={{ border: '1px solid #999', padding: '2px 4px', fontSize: '8px' }}>{l.status_carga}</td>
                    </tr>
                  ))}
                  {linhas.length === 0 && (
                    <tr><td colSpan="10" style={{ border: '1px solid #999', padding: '8px', fontSize: '9px', textAlign: 'center', color: '#888' }}>Nenhuma carga nesta data.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="4" style={{ border: '1px solid #999', padding: '3px 4px', fontSize: '9px', fontWeight: 700, background: '#f0f0f0' }}>TOTAIS — {fmtNum(totais.carregamentos)} carregamento(s)</td>
                    <td style={{ border: '1px solid #999', padding: '3px 4px', fontSize: '9px', fontWeight: 700, background: '#f0f0f0', textAlign: 'right' }}>{fmtNum(totais.pedidos)}</td>
                    <td style={{ border: '1px solid #999', padding: '3px 4px', fontSize: '9px', fontWeight: 700, background: '#f0f0f0', textAlign: 'right' }}>{fmtNum(totais.pacotes)}</td>
                    <td style={{ border: '1px solid #999', padding: '3px 4px', fontSize: '9px', fontWeight: 700, background: '#f0f0f0', textAlign: 'right' }}>{fmtMoney(totais.valor)}</td>
                    <td colSpan="3" style={{ border: '1px solid #999', background: '#f0f0f0' }}></td>
                  </tr>
                </tfoot>
              </table>

              <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '8px', color: '#888' }}>
                Pão e Mel — Documento gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}