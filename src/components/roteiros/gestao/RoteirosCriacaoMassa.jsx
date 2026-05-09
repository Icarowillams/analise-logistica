import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Download, Upload, ClipboardPaste, Play } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { baixarModeloCSV } from './gestaoUtils';

const COLUNAS_DIA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const SIM_VALUES = ['sim', 's', 'x', '1', 'y', 'yes'];

export default function RoteirosCriacaoMassa({ vendedores, clientes, onRecarregar }) {
  const [modo, setModo] = useState('colar');
  const [texto, setTexto] = useState('');
  const [processando, setProcessando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const lerArquivo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setTexto(String(ev.target.result || ''));
    reader.readAsText(file, 'UTF-8');
  };

  const processar = async () => {
    if (!texto.trim()) { toast.error('Cole os dados ou faça upload do arquivo.'); return; }
    setProcessando(true);

    const linhas = texto.split(/\r?\n/).filter(l => l.trim());
    const sep = linhas[0].includes(';') ? ';' : ',';
    const header = linhas[0].split(sep).map(h => h.trim().toLowerCase());
    const idxCod = header.indexOf('cod_cliente');
    const idxFunc = header.indexOf('funcionario');
    const idxDias = COLUNAS_DIA.map(d => header.indexOf(d));

    if (idxCod < 0 || idxFunc < 0) { toast.error('Cabeçalho inválido. Use: cod_cliente;funcionario;segunda;terca;...'); setProcessando(false); return; }

    const agrupado = new Map();
    const erros = [];

    for (let i = 1; i < linhas.length; i++) {
      const cols = linhas[i].split(sep).map(c => c.trim());
      const codCliente = cols[idxCod];
      const nomeFunc = cols[idxFunc];
      if (!codCliente || !nomeFunc) continue;

      const cliente = clientes.find(c => c.codigo_interno === codCliente || c.codigo_omie === codCliente);
      const vendedor = vendedores.find(v => (v.nome || '').toLowerCase() === nomeFunc.toLowerCase() || (v.email || '').toLowerCase() === nomeFunc.toLowerCase());

      if (!cliente) { erros.push(`Linha ${i + 1}: cliente "${codCliente}" não encontrado`); continue; }
      if (!vendedor) { erros.push(`Linha ${i + 1}: funcionário "${nomeFunc}" não encontrado`); continue; }

      COLUNAS_DIA.forEach((dia, idx) => {
        const v = (cols[idxDias[idx]] || '').toLowerCase();
        if (!SIM_VALUES.includes(v)) return;
        const chave = `${vendedor.id}|${dia}-feira`;
        if (!agrupado.has(chave)) agrupado.set(chave, { vendedor, dia: dia + (dia === 'sabado' || dia === 'domingo' ? '' : '-feira'), clientes: [] });
        agrupado.get(chave).clientes.push(cliente);
      });
    }

    let criados = 0, atualizados = 0;
    const existentes = await base44.entities.Roteiro.list('-created_date', 2000);

    for (const [, grupo] of agrupado) {
      const detalhes = grupo.clientes.map((c, i) => ({
        cliente_id: c.id, cliente_nome: c.razao_social, cliente_codigo: c.codigo_interno,
        cliente_cidade: c.cidade, cliente_endereco: c.endereco, cliente_telefone: c.telefone, ordem: i + 1
      }));
      const ids = grupo.clientes.map(c => c.id);
      const existente = existentes.find(r => r.vendedor_id === grupo.vendedor.id && r.dia_semana === grupo.dia);
      if (existente) {
        await base44.entities.Roteiro.update(existente.id, { clientes_ids: ids, clientes_detalhes: detalhes });
        atualizados++;
      } else {
        await base44.entities.Roteiro.create({
          vendedor_id: grupo.vendedor.id, vendedor_nome: grupo.vendedor.nome,
          dia_semana: grupo.dia, clientes_ids: ids, clientes_detalhes: detalhes, status: 'planejado'
        });
        criados++;
      }
    }

    setResultado({ criados, atualizados, erros });
    setProcessando(false);
    toast.success(`${criados} criados, ${atualizados} atualizados`);
    onRecarregar();
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Importar Roteiros em Massa</CardTitle>
          <Button variant="outline" size="sm" onClick={baixarModeloCSV}><Download className="w-4 h-4 mr-2" />Baixar Modelo</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm">
            <p className="font-semibold text-amber-900 mb-2">Formato Esperado</p>
            <p className="text-amber-800 mb-2">A primeira linha deve ser o cabeçalho com as seguintes colunas:</p>
            <code className="block bg-white rounded p-2 text-xs border">cod_cliente | funcionario | segunda | terca | quarta | quinta | sexta | sabado | domingo</code>
            <ul className="list-disc list-inside mt-2 space-y-1 text-amber-800">
              <li><b>cod_cliente:</b> Código do cliente (obrigatório)</li>
              <li><b>funcionario:</b> Nome do funcionário responsável</li>
              <li><b>Dias:</b> Use "sim", "s", "x" ou "1" para indicar atendimento no dia</li>
            </ul>
            <p className="mt-2 text-amber-700">💡 Um mesmo cliente pode ter roteiros diferentes para promotor e vendedor!</p>
          </div>

          <div className="flex gap-2">
            <Button variant={modo === 'colar' ? 'default' : 'outline'} onClick={() => setModo('colar')} className={modo === 'colar' ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}>
              <ClipboardPaste className="w-4 h-4 mr-2" />Colar Dados
            </Button>
            <Button variant={modo === 'upload' ? 'default' : 'outline'} onClick={() => setModo('upload')}>
              <Upload className="w-4 h-4 mr-2" />Upload de Arquivo
            </Button>
          </div>

          {modo === 'colar' ? (
            <div>
              <p className="text-sm text-slate-600 mb-2">Cole os dados aqui (copie do Excel e cole)...</p>
              <Textarea value={texto} onChange={e => setTexto(e.target.value)} className="font-mono text-xs h-48" placeholder="cod_cliente;funcionario;segunda;terca;quarta;quinta;sexta;sabado;domingo" />
            </div>
          ) : (
            <Input type="file" accept=".csv,.txt" onChange={lerArquivo} />
          )}

          <div className="flex justify-end">
            <Button onClick={processar} disabled={processando || !texto.trim()} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
              <Play className="w-4 h-4 mr-2" />{processando ? 'Processando...' : 'Processar Importação'}
            </Button>
          </div>

          {resultado && (
            <div className="rounded-lg border p-4 bg-slate-50">
              <p className="font-semibold mb-2">Resultado</p>
              <p className="text-sm">✅ Criados: <b>{resultado.criados}</b> · 🔄 Atualizados: <b>{resultado.atualizados}</b> · ❌ Erros: <b>{resultado.erros.length}</b></p>
              {resultado.erros.length > 0 && (
                <details className="mt-2"><summary className="cursor-pointer text-sm text-red-600">Ver erros</summary>
                  <ul className="text-xs mt-2 space-y-1 max-h-48 overflow-auto">{resultado.erros.map((e, i) => <li key={i} className="text-red-700">{e}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}