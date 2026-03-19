import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/";
const NF_ENTRADA_URL = "https://app.omie.com.br/api/v1/produtos/notaentrada/";

async function consultarNfOmie(numeroNf) {
    const response = await fetch(NF_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "ConsultarNF",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{ nNF: String(numeroNf) }]
        })
    });
    const data = await response.json();
    
    if (data.faultstring) {
        // Fallback: ListarNF
        const listResp = await fetch(NF_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ListarNF",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    pagina: 1,
                    registros_por_pagina: 5,
                    nNFInicial: String(numeroNf),
                    nNFFinal: String(numeroNf)
                }]
            })
        });
        const listData = await listResp.json();
        if (!listData.faultstring) {
            const nfs = listData.nfCadastro || [];
            if (nfs.length > 0) return { encontrada: true, nf: nfs[0] };
        }
        return { encontrada: false, erro: data.faultstring };
    }
    
    return { encontrada: true, nf: data };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (user.role !== 'admin') {
            return Response.json({ error: 'Apenas administradores podem fazer devoluções' }, { status: 403 });
        }

        const body = await req.json();
        const { numero_nf, motivo, itens_devolvidos } = body;

        if (!numero_nf) {
            return Response.json({ error: 'numero_nf é obrigatório' }, { status: 400 });
        }
        if (!motivo) {
            return Response.json({ error: 'motivo é obrigatório' }, { status: 400 });
        }

        // Consultar NF original
        const resultado = await consultarNfOmie(numero_nf);
        if (!resultado.encontrada) {
            return Response.json({ sucesso: false, erro: resultado.erro });
        }

        const nfOriginal = resultado.nf;
        const chaveNFe = nfOriginal.compl?.cChaveNFe;
        
        if (!chaveNFe) {
            return Response.json({
                sucesso: false,
                erro: `NF ${numero_nf} não possui chave de acesso NFe. Não é possível gerar devolução.`
            });
        }

        // Dados do destinatário da NF original (é o cliente)
        const dest = nfOriginal.nfDestInt || {};
        // Buscar código do cliente no Omie
        const nCodCli = dest.nCodCli || nfOriginal.nfDestInt?.nCodCli;

        if (!nCodCli) {
            return Response.json({
                sucesso: false,
                erro: `Não foi possível identificar o código do cliente na NF ${numero_nf}.`
            });
        }
        
        // Montar itens da NF de entrada no formato correto do Omie
        const itensNfOriginal = nfOriginal.det || [];
        let produtos = [];
        const timestamp = Date.now();

        if (itens_devolvidos && itens_devolvidos.length > 0) {
            // Devolução parcial
            for (let i = 0; i < itens_devolvidos.length; i++) {
                const itemDev = itens_devolvidos[i];
                const itemOriginal = itensNfOriginal.find(it => 
                    it.prod?.cProd === itemDev.codigo_produto || 
                    it.prod?.xProd === itemDev.nome_produto
                );
                if (itemOriginal) {
                    produtos.push({
                        cCodItInt: `DEV${timestamp}_${i}`,
                        nCodProd: itemOriginal.prod?.nCodProd || 0,
                        nQtde: itemDev.quantidade || itemOriginal.prod?.qCom,
                        nValUnit: itemOriginal.prod?.vUnCom || 0,
                        cCFOP: "1.202" // Devolução de venda de mercadoria
                    });
                }
            }
        } else {
            // Devolução total
            for (let i = 0; i < itensNfOriginal.length; i++) {
                const item = itensNfOriginal[i];
                produtos.push({
                    cCodItInt: `DEV${timestamp}_${i}`,
                    nCodProd: item.prod?.nCodProd || 0,
                    nQtde: item.prod?.qCom || 0,
                    nValUnit: item.prod?.vUnCom || 0,
                    cCFOP: "1.202"
                });
            }
        }

        if (produtos.length === 0) {
            return Response.json({
                sucesso: false,
                erro: 'Nenhum item encontrado para devolução'
            });
        }

        // Data de hoje formatada DD/MM/YYYY
        const hoje = new Date();
        const dHoje = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

        console.log(`[devolverNfOmie] Gerando NF de Entrada para NF ${numero_nf} com ${produtos.length} itens...`);

        // Payload no formato correto da API Omie (IncluirNotaEnt)
        const nfEntradaPayload = {
            cabec: {
                cCodIntNotaEnt: `DEV_NF${numero_nf}_${timestamp}`,
                dPrevisao: dHoje,
                nCodCli: nCodCli
            },
            infAdic: {
                cCodCateg: "2.01.03",
                cDadosAdNF: `Devolução referente à NF ${numero_nf}. Motivo: ${motivo}`,
                cNRefNFe: chaveNFe
            },
            produtos
        };

        console.log(`[devolverNfOmie] Payload: ${JSON.stringify(nfEntradaPayload).substring(0, 1500)}`);

        const response = await fetch(NF_ENTRADA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "IncluirNotaEnt",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [nfEntradaPayload]
            })
        });

        const respData = await response.json();
        console.log(`[devolverNfOmie] Resposta Omie: ${JSON.stringify(respData).substring(0, 500)}`);

        if (respData.faultstring) {
            return Response.json({
                sucesso: false,
                erro: `Erro ao gerar NF de Entrada: ${respData.faultstring}`,
                nf_original: {
                    numero: numero_nf,
                    chaveNFe,
                    clienteNome: dest.cRazao || '',
                    clienteCnpj: dest.cnpj_cpf || ''
                }
            });
        }

        return Response.json({
            sucesso: true,
            mensagem: `NF de Entrada (devolução) gerada com sucesso referente à NF ${numero_nf}`,
            nf_entrada: {
                codigo: respData.nCodNotaEnt,
                codigo_integracao: respData.cCodIntNotaEnt
            },
            nf_original: {
                numero: numero_nf,
                chaveNFe,
                clienteNome: dest.cRazao || '',
                clienteCnpj: dest.cnpj_cpf || ''
            }
        });

    } catch (error) {
        console.error('[devolverNfOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});