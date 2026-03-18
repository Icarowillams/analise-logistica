import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/";
const NF_UTIL_URL = "https://app.omie.com.br/api/v1/produtos/notafiscalutil/";
const PEDIDO_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

function parseDataOmie(dEmi) {
    if (!dEmi) return null;
    // Formato DD/MM/YYYY
    const parts = dEmi.split('/');
    if (parts.length === 3) {
        return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    }
    return null;
}

function dentroDosPrazoCancelamento(dEmi) {
    const dataEmissao = parseDataOmie(dEmi);
    if (!dataEmissao) return { dentro: false, horas: null };
    const agora = new Date();
    const diffMs = agora - dataEmissao;
    const diffHoras = diffMs / (1000 * 60 * 60);
    return { dentro: diffHoras <= 24, horas: Math.round(diffHoras) };
}

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
        console.log(`[cancelarNfOmie] ConsultarNF falhou: ${data.faultstring}. Tentando ListarNF...`);
        
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
        console.log(`[cancelarNfOmie] ListarNF resposta: ${JSON.stringify(listData).substring(0, 500)}`);
        
        let nf = null;
        if (!listData.faultstring) {
            const nfs = listData.nfCadastro || [];
            if (nfs.length > 0) {
                nf = nfs[0];
            }
        }
        
        if (!nf) {
            return { encontrada: false, erro: `NF ${numeroNf} não encontrada no Omie. Erro original: ${data.faultstring}` };
        }
        
        const prazo = dentroDosPrazoCancelamento(nf.ide?.dEmi);
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
            clienteCnpj: nf.nfDestInt?.cnpj_cpf || '',
            dentroPrazo24h: prazo.dentro,
            horasDesdeEmissao: prazo.horas
        };
    }
    
    const prazo = dentroDosPrazoCancelamento(data.ide?.dEmi);
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
        clienteCnpj: data.nfDestInt?.cnpj_cpf || '',
        dentroPrazo24h: prazo.dentro,
        horasDesdeEmissao: prazo.horas
    };
}

async function cancelarNFe(nCodNF) {
    console.log(`[cancelarNfOmie] Cancelando NFe via CancelarNFe, nCodNF=${nCodNF}...`);
    
    const response = await fetch(NF_UTIL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "CancelarNFe",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{ nCodNF }]
        })
    });

    const data = await response.json();
    console.log(`[cancelarNfOmie] Resposta CancelarNFe: ${JSON.stringify(data).substring(0, 500)}`);
    
    if (data.faultstring) {
        return { sucesso: false, erro: data.faultstring };
    }
    
    return { sucesso: true, resposta: data };
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
            param: [{ codigo_pedido: nIdPedido }]
        })
    });

    const data = await response.json();
    console.log(`[cancelarNfOmie] Resposta cancelamento pedido: ${JSON.stringify(data).substring(0, 500)}`);
    
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
                nf_info: nfInfo,
                status_nf: 'cancelada'
            });
        }

        // Se é apenas consulta, retornar os dados
        if (apenas_consultar) {
            return Response.json({
                sucesso: true,
                apenas_consulta: true,
                nf_info: nfInfo,
                status_nf: 'ativa'
            });
        }

        // PASSO 2: Verificar prazo de 24h
        if (!nfInfo.dentroPrazo24h) {
            return Response.json({
                sucesso: false,
                erro: `NF ${numero_nf} emitida há ${nfInfo.horasDesdeEmissao}h — fora do prazo de 24h para cancelamento. Use a opção de Devolução (NF de Entrada) para devolver.`,
                nf_info: nfInfo,
                status_nf: 'ativa',
                fora_prazo: true
            });
        }

        // PASSO 3: Cancelar a NFe via API CancelarNFe
        if (!nfInfo.nCodNF) {
            return Response.json({
                sucesso: false,
                erro: `NF ${numero_nf} encontrada, mas sem código interno (nCodNF). Cancelamento manual necessário.`,
                nf_info: nfInfo
            });
        }

        const cancelNFeResult = await cancelarNFe(nfInfo.nCodNF);

        if (!cancelNFeResult.sucesso) {
            // Verificar se já foi cancelada
            const jaCanc = cancelNFeResult.erro?.toLowerCase().includes('cancelad');
            if (jaCanc) {
                return Response.json({
                    sucesso: true,
                    ja_cancelada: true,
                    mensagem: `NF ${numero_nf} já estava cancelada no Omie`,
                    nf_info: nfInfo,
                    status_nf: 'cancelada'
                });
            }
            
            // Tentar cancelar pelo pedido como fallback
            if (nfInfo.nIdPedido) {
                console.log(`[cancelarNfOmie] CancelarNFe falhou, tentando cancelar pedido...`);
                const cancelPedResult = await cancelarPedidoVinculado(nfInfo.nIdPedido);
                if (cancelPedResult.sucesso) {
                    return Response.json({
                        sucesso: true,
                        mensagem: `NF ${numero_nf} — pedido cancelado com sucesso (cancelamento via pedido)`,
                        nf_info: nfInfo,
                        status_nf: 'cancelada',
                        metodo: 'pedido'
                    });
                }
            }

            return Response.json({
                sucesso: false,
                erro: `Erro ao cancelar NF ${numero_nf}: ${cancelNFeResult.erro}`,
                nf_info: nfInfo,
                status_nf: 'ativa'
            });
        }

        console.log(`[cancelarNfOmie] NF ${numero_nf} cancelada com sucesso via CancelarNFe!`);

        return Response.json({
            sucesso: true,
            mensagem: `NF ${numero_nf} cancelada com sucesso no Omie`,
            nf_info: nfInfo,
            status_nf: 'cancelada',
            metodo: 'nfe'
        });

    } catch (error) {
        console.error('[cancelarNfOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});