import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
// Consulta débitos e limite de crédito do cliente no Omie

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { cliente_id } = await req.json();
        if (!cliente_id) {
            return Response.json({ error: 'cliente_id é obrigatório' }, { status: 400 });
        }

        // Buscar cliente no Base44
        const cliente = await base44.asServiceRole.entities.Cliente.get(cliente_id);
        if (!cliente) {
            return Response.json({ error: 'Cliente não encontrado' }, { status: 404 });
        }

        // 1) Consultar títulos a receber pendentes no Omie via PesquisarLancamentos
        const titulosPendentes = [];
        let pagina = 1;
        let totalPaginas = 1;

        while (pagina <= totalPaginas) {
            const response = await fetch("https://app.omie.com.br/api/v1/financas/pesquisartitulos/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "PesquisarLancamentos",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        nPagina: pagina,
                        nRegPorPagina: 100,
                        cNatureza: "R",
                        cStatus: "ATRASADO",
                        cCPFCNPJCliente: (cliente.cpf_cnpj || '').replace(/\D/g, '')
                    }]
                })
            });

            const data = await response.json();

            if (data.faultstring) {
                // Se não encontrou registros, não é erro
                if (data.faultstring.includes("não encontrad") || data.faultstring.includes("Não existem registros")) {
                    break;
                }
                console.log('[consultarDebitosOmie] Erro Omie atrasados:', data.faultstring);
                break;
            }

            if (data.titulosEncontrados) {
                titulosPendentes.push(...data.titulosEncontrados);
            }
            totalPaginas = data.nTotPaginas || 1;
            pagina++;
        }

        // Também buscar títulos EM ABERTO (vencidos hoje ou a vencer)
        pagina = 1;
        totalPaginas = 1;
        while (pagina <= totalPaginas) {
            const response = await fetch("https://app.omie.com.br/api/v1/financas/pesquisartitulos/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "PesquisarLancamentos",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [{
                        nPagina: pagina,
                        nRegPorPagina: 100,
                        cNatureza: "R",
                        cStatus: "EMABERTO",
                        cCPFCNPJCliente: (cliente.cpf_cnpj || '').replace(/\D/g, '')
                    }]
                })
            });

            const data = await response.json();
            if (data.faultstring) {
                if (data.faultstring.includes("não encontrad") || data.faultstring.includes("Não existem registros")) {
                    break;
                }
                break;
            }
            if (data.titulosEncontrados) {
                titulosPendentes.push(...data.titulosEncontrados);
            }
            totalPaginas = data.nTotPaginas || 1;
            pagina++;
        }

        const titulosPendentesUnicos = [];
        const titulosJaVistos = new Set();

        for (const titulo of titulosPendentes) {
            const cab = titulo.cabecTitulo || titulo;
            const chave = [
                cab.cNumTitulo || cab.cNumDocFiscal || '',
                cab.cNumParcela || '',
                cab.dDtVenc || '',
                String(cab.nValorTitulo || 0)
            ].join('|');

            if (!titulosJaVistos.has(chave)) {
                titulosJaVistos.add(chave);
                titulosPendentesUnicos.push(titulo);
            }
        }

        // 2) Consultar o cliente no Omie para pegar limite de crédito
        let limiteCredito = null;
        let saldoDisponivel = null;
        
        const clienteResponse = await fetch("https://app.omie.com.br/api/v1/geral/clientes/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ConsultarCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_cliente_integracao: cliente.codigo || cliente_id
                }]
            })
        });

        const clienteOmie = await clienteResponse.json();
        if (!clienteOmie.faultstring) {
            limiteCredito = clienteOmie.valor_limite_credito || 0;
            // Calcular total em aberto sem duplicidades
            const totalEmAberto = titulosPendentesUnicos.reduce((sum, t) => sum + ((t.cabecTitulo || t).nValorTitulo || 0), 0);
            saldoDisponivel = limiteCredito - totalEmAberto;
        }

        // Formatar títulos para retorno
        const titulos = titulosPendentesUnicos.map(t => {
            const cab = t.cabecTitulo || t;
            return {
                numero: cab.cNumTitulo || '',
                parcela: cab.cNumParcela || '',
                valor: cab.nValorTitulo || 0,
                vencimento: cab.dDtVenc || '',
                status: cab.cStatus || '',
                tipo: cab.cTipo || '',
                documento_fiscal: cab.cNumDocFiscal || '',
                observacao: cab.observacao || ''
            };
        });

        const totalDebitos = titulos.reduce((sum, t) => sum + t.valor, 0);
        const temPendencia = titulos.some(t => t.status === 'ATRASADO');

        return Response.json({
            cliente_nome: cliente.razao_social || cliente.nome_fantasia,
            cliente_codigo: cliente.codigo,
            titulos,
            total_debitos: totalDebitos,
            tem_pendencia: temPendencia,
            titulos_atrasados: titulos.filter(t => t.status === 'ATRASADO').length,
            limite_credito: limiteCredito,
            saldo_disponivel: saldoDisponivel
        });

    } catch (error) {
        console.error('Erro ao consultar débitos:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});