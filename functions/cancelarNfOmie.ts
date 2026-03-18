import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/";
const PEDIDO_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

async function consultarNfOmie(numeroNf) {
    console.log(`[cancelarNfOmie] Consultando NF ${numeroNf} no Omie...`);
    
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
        // Tentar buscar listando por número
        console.log(`[cancelarNfOmie] ConsultarNF falhou: ${data.faultstring}. Tentando ListarNF...`);
        
        // Tentar listar sem filtro de tipo (saída e entrada)
        let nf = null;
        for (const tpNF of ["1", "0", null]) {
            const params = {
                pagina: 1,
                registros_por_pagina: 10,
                nNFInicial: String(numeroNf),
                nNFFinal: String(numeroNf)
            };
            if (tpNF !== null) params.tpNF = tpNF;
            
            console.log(`[cancelarNfOmie] Tentando ListarNF com tpNF=${tpNF}...`);
            const listResp = await fetch(NF_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    call: "ListarNF",
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [params]
                })
            });
            
            const listData = await listResp.json();
            console.log(`[cancelarNfOmie] ListarNF resposta: ${JSON.stringify(listData).substring(0, 300)}`);
            
            if (!listData.faultstring) {
                const nfs = listData.nfCadastro || [];
                if (nfs.length > 0) {
                    nf = nfs[0];
                    break;
                }
            }
        }
        
        if (!nf) {
            return { encontrada: false, erro: `NF ${numeroNf} não encontrada no Omie (tentou saída, entrada e sem filtro)` };
        }
        return {
            encontrada: true,
            nCodNF: nf.compl?.nIdNF || null,
            nIdPedido: nf.compl?.nIdPedido || null,
            chaveNFe: nf.compl?.cChaveNFe || null,
            dataCancelamento: nf.ide?.dCan || null,
            jaCancelada: !!nf.ide?.dCan,
            serie: nf.ide?.serie || null,
            dataEmissao: nf.ide?.dEmi || null,
            valorNF: nf.total?.ICMSTot?.vNF || 0,
            clienteNome: nf.nfDestInt?.cRazao || '',
            clienteCnpj: nf.nfDestInt?.cnpj_cpf || ''
        };
    }
    
    return {
        encontrada: true,
        nCodNF: data.compl?.nIdNF || null,
        nIdPedido: data.compl?.nIdPedido || null,
        chaveNFe: data.compl?.cChaveNFe || null,
        dataCancelamento: data.ide?.dCan || null,
        jaCancelada: !!data.ide?.dCan,
        serie: data.ide?.serie || null,
        dataEmissao: data.ide?.dEmi || null,
        valorNF: data.total?.ICMSTot?.vNF || 0,
        clienteNome: data.nfDestInt?.cRazao || '',
        clienteCnpj: data.nfDestInt?.cnpj_cpf || ''
    };
}

async function cancelarPedidoVinculado(nIdPedido) {
    console.log(`[cancelarNfOmie] Cancelando pedido ${nIdPedido} no Omie...`);
    
    const response = await fetch(PEDIDO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "CancelarPedidoVenda",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                codigo_pedido: nIdPedido
            }]
        })
    });

    const data = await response.json();
    console.log(`[cancelarNfOmie] Resposta cancelamento:`, JSON.stringify(data).substring(0, 500));
    
    if (data.faultstring) {
        return { sucesso: false, erro: data.faultstring };
    }
    
    return { sucesso: true, resposta: data };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (user.role !== 'admin') {
            return Response.json({ error: 'Apenas administradores podem cancelar NFs' }, { status: 403 });
        }

        const body = await req.json();
        const { numero_nf, motivo, apenas_consultar } = body;

        if (!numero_nf) {
            return Response.json({ error: 'numero_nf é obrigatório' }, { status: 400 });
        }

        // PASSO 1: Consultar NF no Omie
        const nfInfo = await consultarNfOmie(numero_nf);
        
        if (!nfInfo.encontrada) {
            return Response.json({
                sucesso: false,
                erro: nfInfo.erro,
                nf_encontrada: false
            });
        }

        // Se já está cancelada
        if (nfInfo.jaCancelada) {
            return Response.json({
                sucesso: true,
                ja_cancelada: true,
                mensagem: `NF ${numero_nf} já estava cancelada no Omie (${nfInfo.dataCancelamento})`,
                nf_info: nfInfo
            });
        }

        // Se é apenas consulta, retornar os dados
        if (apenas_consultar) {
            return Response.json({
                sucesso: true,
                apenas_consulta: true,
                nf_info: nfInfo
            });
        }

        // PASSO 2: Cancelar o pedido vinculado à NF
        if (!nfInfo.nIdPedido) {
            return Response.json({
                sucesso: false,
                erro: `NF ${numero_nf} encontrada, mas sem pedido vinculado (nIdPedido). Cancelamento manual necessário.`,
                nf_info: nfInfo
            });
        }

        const cancelResult = await cancelarPedidoVinculado(nfInfo.nIdPedido);

        if (!cancelResult.sucesso) {
            // Verificar se o erro indica que já foi cancelado
            const jaCanc = cancelResult.erro?.includes('cancelado') || cancelResult.erro?.includes('Cancelado');
            if (jaCanc) {
                return Response.json({
                    sucesso: true,
                    ja_cancelada: true,
                    mensagem: `Pedido da NF ${numero_nf} já estava cancelado no Omie`,
                    nf_info: nfInfo
                });
            }
            
            return Response.json({
                sucesso: false,
                erro: `Erro ao cancelar pedido ${nfInfo.nIdPedido}: ${cancelResult.erro}`,
                nf_info: nfInfo
            });
        }

        console.log(`[cancelarNfOmie] NF ${numero_nf} cancelada com sucesso!`);

        return Response.json({
            sucesso: true,
            mensagem: `NF ${numero_nf} cancelada com sucesso no Omie`,
            nf_info: nfInfo,
            cancelamento: cancelResult.resposta
        });

    } catch (error) {
        console.error('[cancelarNfOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});