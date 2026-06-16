# Lições Aprendidas — Integração Omie (NUNCA ESQUECER)

Memória técnica permanente de erros cometidos e soluções confirmadas em produção.
Sempre consultar e atualizar este arquivo antes de mexer em integração Omie.

---

## 1. ListarNF (produtos/nfconsultar) — NÃO filtra por pedido ❌

**ERRO COMETIDO:** Tentei filtrar `ListarNF` por `nIdPedido` / `nIdPedidoVenda` / `nCodPedido`
para achar as NFs de uma carga direto pelo código do pedido. **A API Omie REJEITA esses
parâmetros** — o filtro por pedido simplesmente não existe em `ListarNF`.

**Sintoma real:** Carga 242 estava faturada, com 8 NFs emitidas (182510–182517) na Omie,
mas a tela "Impressão NF 55" mostrava ZERO NFs. A consulta direta por pedido voltava vazia.

**Parâmetros que o ListarNF ACEITA:**
- `nNF` → filtra por UM número de NF exato (retorna 1 nota na hora) ✅
- `dEmiInicial` / `dEmiFinal` → faixa de DATAS de emissão (DD/MM/AAAA) ✅
- `cRazao` → nome/razão do cliente ✅
- `cCPFCNPJDest` → CNPJ/CPF do destinatário (só dígitos) ✅
- `pagina` / `registros_por_pagina` (máx 100) ✅

**SOLUÇÃO CONFIRMADA (em produção, 16/06/2026):**
Cada NF retornada traz o pedido de origem em `nf.compl.nIdPedido`. Para achar as NFs de
uma carga pelos códigos de pedido:
1. Buscar as NFs por **FAIXA DE DATAS** (a data da carga, com janela de folga ±dias).
2. Varrer as páginas.
3. **CRUZAR client-side pelo `nf.compl.nIdPedido`** contra o conjunto de pedidos da carga.
4. Parar cedo quando já achou todas (`encontradas.length >= alvo.size`).

Quando a carga JÁ tem os números de NF gravados (`pedidos_omie[].numero_nf`), o caminho
mais rápido é buscar cada NF direto por `nNF` em paralelo (lotes de ~6), sem varrer datas.

**Onde está implementado:** `functions/listarNfsOmie` (CAMINHO 2 = codigos_pedido) e
`components/notasOmie/NotasNF55Tab` (envia janela de datas ±3/+1 dia da data da carga).

---

## 2. ListarNF ordena de forma NÃO cronológica ⚠️

A ordenação das páginas do `ListarNF` NÃO é por data crescente nem decrescente de forma
confiável — a última página pode ter NFs antigas (ex.: 13/05) enquanto NFs recentes (16/06)
ficam no meio. **NÃO confie na ordem das páginas.** Sempre filtre por `dEmiInicial/dEmiFinal`
para restringir o período em vez de tentar "ir para a última página".

---

## 3. Payload pesado estoura serialização (erro 500) ⚠️

Incluir `nf.det` (itens), `total` detalhado e `nf_raw` (objeto cru) na LISTAGEM, multiplicado
por 50–100 NFs, estoura a serialização da resposta → erro 500. **Na listagem retorne só o
resumo** (`qtd_itens`). O detalhe de UMA nota é carregado sob demanda via
`consultarDetalheNotaOmie` ao abrir/imprimir. Use a flag `incluir_raw=true` só quando
o front pedir explicitamente.

---

## 4. Latência do espelho local vs Omie ⚠️

Uma carga pode estar marcada "faturada" localmente enquanto pedidos individuais ainda estão
em "etapa 20" no espelho local, mesmo já estando em "etapa 60" (NF emitida) na Omie de
produção. **Não dependa só do status local** para decidir se há NF — confirme na Omie.

---

## 5. Status HTTP antes de res.json() ✅

Em 5xx/429/425 o corpo da resposta Omie geralmente NÃO é JSON. Sempre cheque `res.status`
ANTES de chamar `res.json()`, senão quebra com "Unexpected token". 425 = circuit breaker
(consumo redundante) → não retentar imediatamente.