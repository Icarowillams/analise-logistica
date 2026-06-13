# SDD: Diagnóstico Carga 214 — Notas Fiscais não aparecem

**Data:** 2026-06-13
**Carga:** 214 (ID: `6a2d7cff9c0ffcd7884b548b`)
**Responsável:** Rafael Campos

---

## 1. Sumário Executivo

A carga 214 não exibe o botão "Notas Fiscais" na tela de Cargas e seus pedidos não aparecem na aba "Emissão" de NotasOmie. O problema é que a carga ainda está com `status_carga: "montagem"` — o processo de faturamento não foi executado.

---

## 2. Estado Atual da Carga 214

| Campo | Valor |
|-------|-------|
| `status_carga` | `montagem` |
| `processamento_omie_status` | `nao_iniciado` |
| `numero_carga` | `214` |
| `motorista_nome` | (não informado) |
| `veiculo_placa` | `KII-5277` |
| `pedidos_omie` | 7+ pedidos, todos etapa `20` |
| `pedidos_internos` | (não visível nos dados truncados) |
| `pedidos_troca` | `[]` |
| `notas_fiscais` | `[]` |
| `valor_total_carga` | R$ 3.496,95 |

### Pedidos Omie na Carga (amostra):
| Nº Pedido | Cliente | Código Cliente | Etapa | NF |
|-----------|---------|----------------|-------|-----|
| 1357 | VAREJAO IDEAL | 4390 | 20 | — |
| 1329 | SONHO MEU | 66 | 20 | — |
| 1324 | QUITANDA DA ALDEIA | 28099 | 20 | — |
| 1333 | HOTIFRUTAS | 24161 | 20 | — |
| 1334 | MERCADINHO ESQUINAO | 20139 | 20 | — |
| 1315 | ATACAREJO MERCADINHO IPUTINGA | 21604 | 20 | — |
| 1287 | MERCADINHO SUPERMIX | 1445 | 20 | — |

Todos os pedidos têm `codigo_pedido`, `cnpj_cpf_cliente` e `nome_cliente` preenchidos — **prontos para faturamento**. Nenhum é D1.

---

## 3. Fluxo de Emissão de NF (Arquitetura)

```
┌─────────────────────────────────────────────────────────────────┐
│ FLUXO COMPLETO: DA MONTAGEM À NF EMITIDA                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [1] Faturar Carga                                              │
│       │                                                         │
│       ├── faturarCargaOmie(carga_id)                            │
│       │   ├── status_carga → "faturada"                         │
│       │   ├── pedidos: status → "montagem"                      │
│       │   └── pedidos: status_faturamento → "pendente"          │
│       │                                                         │
│       └── ⚠️ NÃO altera etapa no Omie (permanece 20)            │
│                                                                 │
│  [2] Processar Fila (automático ou manual)                      │
│       │                                                         │
│       ├── processarFilaCargaOmie()                              │
│       │   ├── TrocarEtapaPedido no Omie: 20 → 50                │
│       │   ├── Atualiza PedidoLiberadoOmie (espelho)             │
│       │   └── Atualiza Pedido local                             │
│       │                                                         │
│       └── PedidoLiberadoOmie.etapa → "50" ✅                    │
│                                                                 │
│  [3] Emitir NF-e                                                │
│       │                                                         │
│       ├── NotasOmie → Aba "Emissão"                             │
│       │   └── Filtra: PedidoLiberadoOmie.etapa = "50"           │
│       │       E numero_nf = vazio                               │
│       │                                                         │
│       └── emitirNfsLoteOmie(codigos_pedido)                     │
│           ├── Cria FilaEmissaoNF                                │
│           ├── Emite NF-e via Omie                               │
│           └── Gera boleto se modalidade = BOLETO BANCARIO       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Causa Raiz

A carga 214 está no **passo 0** do fluxo — `status_carga: "montagem"`. O botão "Notas Fiscais" (ícone 📄) **só aparece para cargas com `status_carga: "faturada"`**, conforme o código em `pages/Cargas`:

```jsx
// Linha 493-503 de pages/Cargas
const jaFaturada = row.status_carga === 'faturada';
{jaFaturada && (
  <Button onClick={() => abrirNotas(row)} title="Abrir NFe da carga">
    <FileText />
  </Button>
)}
```

Além disso, a aba "Emissão" em NotasOmie filtra pedidos por `PedidoLiberadoOmie.etapa = "50"`. Como os pedidos ainda estão em etapa `20` no Omie, eles não apareceriam lá mesmo que o botão estivesse visível.

---

## 5. Solução

**Ação imediata:** Clicar no botão **"Faturar"** na linha da carga 214 na tela de Cargas.

Isso dispara `faturarCargaOmie`, que:
1. Muda `status_carga` para `"faturada"`
2. Marca pedidos com `status_faturamento: "pendente"`
3. Habilita os botões de Notas Fiscais na interface

Em seguida, o processo `processarFilaCargaOmie` (rodado automaticamente ou via botão "Processar Fila Agora") vai:
1. Chamar `TrocarEtapaPedido` no Omie (20→50)
2. Atualizar o espelho `PedidoLiberadoOmie` com `etapa: "50"`

Após isso, os pedidos aparecerão em **NotasOmie → Emissão** prontos para emitir NF-e.

---

## 6. Observações

- Nenhum pedido da carga 214 é D1 — todos podem ser faturados e receber NF-e
- O `processamento_omie_status` está `nao_iniciado` porque a fila (`FilaCargaOmie`) não foi populada ainda — isso acontece apenas após o faturamento
- A função `faturarCargaOmie` é **local e não chama a API Omie** — a mudança de etapa é delegada ao `processarFilaCargaOmie