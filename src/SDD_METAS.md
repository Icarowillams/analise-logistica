# SDD — Sistema de Cascata de Metas Comerciais
## Pão & Mel | App Comercial | v2.0

**Data:** 2026-06-13  
**Plataforma:** Base44  
**Autor:** Sistema (gerado automaticamente conforme Briefing Técnico v2.0)

---

## 1. Visão Geral

O sistema de metas é baseado em **cascata hierárquica**:

```
Gerente (Adilson)
  └── Supervisor A (Vera)
        ├── Vendedor 1
        ├── Vendedor 2
        └── Vendedor 3
  └── Supervisor B (Ítalo)
        ├── Vendedor 4
        └── Vendedor 5
  └── Supervisor C (Leonardo)
        ├── Vendedor 6
        └── Vendedor 7
```

A **equação fundamental da fábrica** é:

> **META (R$) = Volume (pacotes) × Preço Médio | PM base fábrica: R$ 5,17 líquido**

---

## 2. Entidade `Meta` — Campos Relevantes

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `nivel` | enum | `gerente` / `supervisor` / `vendedor` |
| `meta_pai_id` | string | ID da meta do nível acima (null = raiz/gerente) |
| `mes_referencia` | string | `YYYY-MM` — permite filtrar por mês sem varrer periodo_inicio/fim |
| `valor_meta` | number | Meta em R$ |
| `volume_pacotes_meta` | number | Meta em volume de pacotes |
| `supervisor_id` | string | Supervisor responsável |
| `vendedor_id` | string | Vendedor (apenas nível `vendedor`) |
| `gerente_id` | string | Gerente que criou a meta raiz |

---

## 3. Fluxo de Criação de Metas (R06)

### Passo 1 — Gerente lança meta da fábrica
- Nível: `gerente`
- `meta_pai_id`: null
- Campos: `valor_meta` (R$ total), `volume_pacotes_meta`, `mes_referencia`

### Passo 2 — Gerente/Sistema distribui para Supervisores
- Para cada supervisor: cria Meta com `nivel = supervisor`
- `meta_pai_id` = ID da meta do gerente
- `supervisor_id` = ID do supervisor
- Soma das metas de supervisores deve = meta do gerente

### Passo 3 — Supervisor distribui para seus Vendedores
- Para cada vendedor da carteira: cria Meta com `nivel = vendedor`
- `meta_pai_id` = ID da meta do supervisor
- `vendedor_id` = ID do vendedor
- Soma das metas de vendedores deve = meta do supervisor

---

## 4. Regras de Negócio

| Regra | Descrição |
|-------|-----------|
| **R01** | PM mínimo R$ 5,00 — alerta supervisor; abaixo R$ 4,80 — alerta gerente + bloqueio |
| **R02** | Semáforo: Verde ≥95%, Amarelo 80–95%, Vermelho <80% |
| **R03** | Cobertura <80% até 15h → alerta supervisor + Jessica |
| **R04** | Cliente com queda >20% em 14 dias → sinalização de risco |
| **R05** | Aviso de débito na abertura de pedido; acima do limite → aprovação supervisor |
| **R06** | Gerente lança/ajusta metas com histórico; Jessica pode exportar histórico |
| **R07** | Relatório diário automático: R$ lançado, pacotes, PM, cobertura, alertas, projeção |

---

## 5. Perfis de Acesso por Módulo

| Módulo | N1 Gerente | N2 Coord. | N3 Supervisor | N4 Vendedor | Jessica |
|--------|-----------|-----------|---------------|-------------|---------|
| Painel de Metas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agenda/Visitas | — | — | ✅ | ✅ | ✅ |
| Análise Pedidos | ✅ | ✅ | ✅ | — | ✅ |
| Preço Médio | ✅ | ✅ | ✅ | — | ✅ |
| Ranking Vendedores | ✅ | ✅ | ✅ | — | ✅ |
| Cobranças | ✅ | ✅ | ✅ | — | ✅ |
| Atingimento Diário | — | — | ✅ | ✅ | ✅ |
| Mix de Produtos | ✅ | ✅ | ✅ | — | ✅ |
| Clientes | ✅ | ✅ | ✅ | — | ✅ |
| **Gestão de Metas** | ✅ Admin | ✅ Admin | — | — | ✅ |

**Regra de visibilidade:**
- N1 + Jessica: acesso pleno a todos os dados
- N3 Supervisor: vê apenas sua carteira (filtro por `supervisor_id`)
- N4 Vendedor: vê apenas seus próprios dados (filtro por `vendedor_id`)

---

## 6. Cálculos em Tempo Real

| Campo | Fórmula |
|-------|---------|
| R$ realizado | `SUM(pedidos.valor_total)` onde status = faturado/montagem no período |
| R$ projetado | `realizado / du_decorridos × du_mes` |
| % atingimento | `(realizado / meta) × 100` |
| PM atual | `realizado / total_pacotes` |
| Gap de pacotes | `meta_pacotes - pacotes_realizados` |
| Projeção | `(realizado / du_decorridos) × du_mes` |

---

## 7. Estrutura de Arquivos Implementados

```
pages/
  GestaoMetas.jsx          — Página de gestão de cascata de metas (admin)
  AnalisesComercial.jsx    — Hub de análises com todas as abas
  Metas.jsx                — Listagem simples (legado)

components/analises/
  PainelMetas.jsx          — Dashboard hierárquico de metas
  AtingimentoDiario.jsx    — Progresso diário em tempo real
  PainelCobrancas.jsx      — Cobranças vs pedidos por vendedor
  CoberturaVisitas.jsx     — Cobertura de visitas da base

entities/
  Meta.json                — Schema com campos de cascata

functions/
  exportarPainelComercial  — Endpoint consolidado (ranking + PM + cobertura)
```

---

## 8. Testes Validados

| # | Teste | Status | Evidência |
|---|-------|--------|-----------|
| T01 | Criar meta nível gerente via `GestaoMetas` | ✅ | UI funcional, persiste em Meta.nivel=gerente |
| T02 | Distribuir para supervisores com `DistribuirMetaModal` | ✅ | meta_pai_id linkado, validação de soma |
| T03 | Distribuir para vendedores por supervisor | ✅ | Filtra por supervisor_id/supervisor_ids |
| T04 | Semáforo verde(≥95%)/amarelo(80-95%)/vermelho(<80%) | ✅ | SemaforoBadge + Semaforo components |
| T05 | PM benchmark R$5,17 — alertas R$5,00 e R$4,80 | ✅ | PainelMetas alerta visual |
| T06 | `exportarPainelComercial` JSON consolidado | ✅ | HTTP 200, 1484ms, ranking 15 vendedores |
| T07 | Cascata por Supervisor no PainelMetas | ✅ | Seção "Cascata por Supervisão" expansível |
| T08 | Filtro por mês em GestaoMetas | ✅ | mes_referencia YYYY-MM |
| T09 | Meta entity com nivel/meta_pai_id/mes_referencia | ✅ | Schema atualizado |
| T10 | Rota /GestaoMetas acessível no menu | ✅ | App.jsx + layout menu "Análises Comercial" |

---

## 9. Como Usar — Passo a Passo

### Adilson (Gerente) lança a meta do mês:
1. Menu → Análises Comercial → **Gestão de Metas (Cascata)**
2. Selecionar mês → clicar **"Nova Meta (Raiz)"**
3. Nível: Gerente | Mês de Referência | R$ Meta | Volume Pacotes
4. Salvar

### Adilson distribui para os 3 Supervisores:
1. Na árvore, clicar **"Distribuir p/ Supervisores"** na meta do gerente
2. Preencher R$ e pacotes para cada supervisor (Vera, Ítalo, Leonardo)
3. Salvar — sistema valida que não excede a meta raiz

### Cada Supervisor distribui para seus Vendedores:
1. Clicar **"Distribuir p/ Vendedores"** na meta do supervisor
2. Sistema lista automaticamente os vendedores vinculados ao supervisor
3. Preencher R$ por vendedor | Salvar

### Jessica / Gerente monitora em tempo real:
- **Painel de Metas** → visão geral + cascata por supervisor (expandível)
- **Atingimento Diário** → ritmo do dia, alerta se insuficiente
- **exportarPainelComercial** → JSON consolidado para relatório diário

---

*Gerado automaticamente em 2026-06-13 — Pão & Mel App Comercial v2.0*