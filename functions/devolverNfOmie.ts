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

        // Dados do destinatário (que se torna o remetente na devolução)
        const dest = nfOriginal.nfDestInt || {};
        
        // Montar itens da NF de entrada
        // Se itens_devolvidos foi fornecido, usar. Senão, devolver tudo.
        const itensNfOriginal = nfOriginal.det || [];
        let det = [];

        if (itens_devolvidos && itens_devolvidos.length > 0) {
            // Devolução parcial
            for (const itemDev of itens_devolvidos) {
                const itemOriginal = itensNfOriginal.find(i => 
                    i.prod?.cProd === itemDev.codigo_produto || 
                    i.prod?.xProd === itemDev.nome_produto
                );
                if (itemOriginal) {
                    det.push({
                        prod: {
                            cProd: itemOriginal.prod?.cProd,
                            xProd: itemOriginal.prod?.xProd,
                            NCM: itemOriginal.prod?.NCM || '',
                            CFOP: "5202", // Devolução de compra
                            uCom: itemOriginal.prod?.uCom || 'UN',
                            qCom: itemDev.quantidade || itemOriginal.prod?.qCom,
                            vUnCom: itemOriginal.prod?.vUnCom,
                            vProd: (itemDev.quantidade || itemOriginal.prod?.qCom) * itemOriginal.prod?.vUnCom
                        }
                    });
                }
            }
        } else {
            // Devolução total
            for (const item of itensNfOriginal) {
                det.push({
                    prod: {
                        cProd: item.prod?.cProd,
                        xProd: item.prod?.xProd,
                        NCM: item.prod?.NCM || '',
                        CFOP: "5202",
                        uCom: item.prod?.uCom || 'UN',
                        qCom: item.prod?.qCom,
                        vUnCom: item.prod?.vUnCom,
                        vProd: item.prod?.vProd
                    }
                });
            }
        }

        if (det.length === 0) {
            return Response.json({
                sucesso: false,
                erro: 'Nenhum item encontrado para devolução'
            });
        }

        console.log(`[devolverNfOmie] Gerando NF de Entrada para NF ${numero_nf} com ${det.length} itens...`);

        // Gerar NF de Entrada referenciando a NF original
        const nfEntradaPayload = {
            ide: {
                dEmi: new Date().toLocaleDateString('pt-BR'),
                natOp: "DEVOLUCAO",
                finNFe: "4", // 4 = Devolução/Retorno
                tpNF: "0"    // 0 = Entrada
            },
            NFref: [{
                refNFe: chaveNFe
            }],
            nfEmitInt: {
                cnpj_cpf: dest.cnpj_cpf || '',
                cRazao: dest.cRazao || ''
            },
            det,
            infAdic: {
                infCpl: `Devolução referente à NF ${numero_nf}. Motivo: ${motivo}`
            }
        };

        console.log(`[devolverNfOmie] Payload: ${JSON.stringify(nfEntradaPayload).substring(0, 1000)}`);

        const response = await fetch(NF_ENTRADA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "IncluirNFEntrada",
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
            nf_entrada: respData,
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