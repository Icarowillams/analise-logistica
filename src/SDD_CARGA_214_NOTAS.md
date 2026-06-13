# SDD: Diagnóstico Carga 214 — Notas Fiscais não aparecem (v2)

**Data:** 2026-06-13
**Carga:** 214 (ID: `6a2d7cff9c0ffcd7884b548b`)

---

## 1. Sumário Executivo

A carga 214 foi faturada e a fila `FilaCargaOmie` foi 100% processada com sucesso. Porém os pedidos NÃO aparecem na aba "Emissão" de NotasOmie porque os espelhos `PedidoLiberadoOmie` estão com **etapa `"20"`** em vez de **etapa `"50"`**.

---

## 2. Causa Raiz

### Evidências:
- **FilaCargaOmie**: 11 itens, todos `status: "concluido"` — processados entre 15:58 e 16:00
- **PedidoLiberadoOmie** (espelho): etapa `"20"` para TODOS os pedidos da carga
  - `sincronizado_em`: 17:12:52~55 (DEPOIS do processamento da fila)
  - `origem_sync`: `gerenciar_pedidos`

### Hipótese:
1. `processarFilaCargaOmie` chamou `TrocarEtapaPedido` no Omie (20→50) com sucesso
2. Atualizou o espelho `PedidoLiberadoOmie` com `etapa: "50"` (linhas 306-320)
3. **Porém**, uma sincronização posterior (`sincronizarLiberadosOmieRapido` ou `reconciliarStatusPedidosOmie`) sobrescreveu os espelhos, voltando a etapa para `"20"`

A sincronização `origem_sync: "gerenciar_pedidos"` puxa dados do Omie e reescreve o espelho. Se houve race condition ou a chamada Omie retornou etapa desatualizada, o espelho foi regravado com valor incorreto.

---

## 3. Correção Imediata

Sincronizar o espelho da carga 214 via `reconciliarEspelhoCargaCompleto`, que consulta a etapa real no Omie e atualiza o `PedidoLiberadoOmie`:

```
reconciliarEspelhoCargaCompleto({ numero_carga: "214" })
```

Ou usar o botão "Sincronizar espelho da carga" na tela NotasOmie → Emissão, informando o nº da carga 214.

---

## 4. Correção de Longo Prazo (sugestão)

No `processarFilaCargaOmie`, após atualizar o espelho `PedidoLiberadoOmie` com `etapa: "50"`, marcar o espelho com um flag `etapa_confirmada_em` para evitar que sincronizações posteriores sobrescrevam com valor desatualizado. Alternativamente, a sincronização `gerenciar_pedidos` deve respeitar o campo `etapa` se ele foi atualizado há menos de X minutos pelo processador de fila.

---

## 5. Estado Atual dos Espelhos (Carga 214)

| Nº Pedido | Código Omie | Etapa Espelho | NF |
|-----------|-------------|---------------|-----|
| 1357 | 11527080829 | **20** ❌ | — |
| 1329 | 11527040559 | **20** ❌ | — |
| 1324 | 11527040484 | **20** ❌ | — |
| 1333 | 11527040613 | **20** ❌ | — |
| 1334 | 11527040644 | **20** ❌ | — |
| 1315 | 11527039171 | **20** ❌ | — |
| 1287 | 11527033391 | **20** ❌ | — |
| 1284 | 11527032494 | **20** ❌ | — |
| 1279 | 11527029163 | **20** ❌ | — |
| 1220 | 11526775731 | **20** ❌ | — |
| 1072 | 11526391919 | **20** ❌ | — |

Todos deveriam estar com etapa `"50"` para aparecer na Emissão.