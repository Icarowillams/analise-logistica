# Boletos Omie

Documentação operacional da tela **Boletos Omie** e da nova aba de **Emissão**.

## Abas da tela

### Impressão

A aba **Impressão** mantém a função original da tela:

- consulta boletos já emitidos no Omie;
- permite selecionar boletos;
- permite imprimir boleto individual;
- permite imprimir boletos agrupados;
- serve como consulta e segunda via.

### Emissão

A aba **Emissão** permite consultar títulos a receber no Omie e emitir boletos manualmente para títulos elegíveis.

## Regra de elegibilidade da emissão

Um título só aparece na aba **Emissão** quando atende a todos os critérios abaixo:

1. pertence a uma carga faturada selecionada;
2. está no contas a receber do Omie;
3. ainda não possui boleto gerado;
4. pertence a um cliente cadastrado no Base44;
5. o cliente possui modalidade de pagamento interna configurada como **BOLETO BANCARIO**.

## Modalidade de pagamento boleto

A modalidade de boleto é identificada principalmente pelo ID interno:

```txt
69ff70445fbcb49b659710df
```

Também há uma validação por nome da modalidade, aceitando registros cujo nome contenha **BOLETO** e **BANCARIO**.

## Entidades usadas

### Cliente

Campos relevantes:

- `codigo_omie`
- `codigo_cliente_omie`
- `cnpj_cpf`
- `modalidade_pagamento_id`
- `razao_social`
- `nome_fantasia`

### ModalidadePagamento

Campos relevantes:

- `nome`
- `status`

### Carga

Campos relevantes:

- `numero_carga`
- `status_carga`
- `pedidos_omie`
- `quantidade_pedidos`
- `motorista_nome`

## Funções usadas

### listarContasReceberOmie

Consulta títulos do contas a receber no Omie.

Usada na aba **Emissão** para buscar títulos em aberto no período recente e cruzar com os pedidos da carga selecionada.

### gerarBoletosOmie

Emite boletos no Omie a partir dos códigos de lançamento selecionados.

## Arquivos relacionados

- `pages/BoletosOmie.jsx`
- `components/boletos/EmissaoBoletosTab.jsx`
- `components/boletos/FiltrosBoletos.jsx`
- `components/boletos/TabelaBoletos.jsx`
- `components/boletos/ListaTitulosCarga.jsx`
- `components/boletos/ResultadoGeracaoBoletos.jsx`
- `functions/listarContasReceberOmie`
- `functions/gerarBoletosOmie`

## Schemas

Não houve criação de novos schemas para esta alteração.

Os schemas já existentes usados por esta funcionalidade são:

- `docs/schemas/Cliente.jsonc`
- `docs/schemas/ModalidadePagamento.jsonc`
- `docs/schemas/Carga.jsonc