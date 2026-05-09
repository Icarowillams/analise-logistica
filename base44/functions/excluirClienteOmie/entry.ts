import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        // Automação de entidade envia: { event, data, old_data, payload_too_large }
        const { event, data: cliente } = body;

        console.log('[excluirClienteOmie] Payload recebido:', JSON.stringify(body).substring(0, 500));
        console.log('[excluirClienteOmie] Event:', JSON.stringify(event));

        // Determinar o ID do cliente para usar como codigo_cliente_integracao
        // Na exclusão, o data pode vir com os dados do registro antes da exclusão
        const clienteCodigo = cliente?.codigo || event?.entity_id || cliente?.id;
        const clienteNome = cliente?.razao_social || cliente?.nome_fantasia || 'N/A';

        if (!clienteCodigo) {
            console.log('[excluirClienteOmie] Nenhum código de cliente encontrado no payload');
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        console.log('[excluirClienteOmie] Excluindo cliente do Omie - Código:', clienteCodigo, '- Nome:', clienteNome);

        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                call: "ExcluirCliente",
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                    codigo_cliente_integracao: clienteCodigo
                }]
            })
        });

        const resultado = await response.json();

        console.log('[excluirClienteOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            // Se o erro for "Cliente não encontrado", considerar como sucesso (já foi excluído)
            const erroLower = resultado.faultstring.toLowerCase();
            if (erroLower.includes('não encontrado') || erroLower.includes('não cadastrado') || erroLower.includes('not found')) {
                console.log('[excluirClienteOmie] Cliente já não existe no Omie (ignorando erro):', resultado.faultstring);
                return Response.json({ 
                    sucesso: true, 
                    mensagem: 'Cliente já não existia no Omie'
                });
            }

            console.error('[excluirClienteOmie] Erro Omie ao excluir:', resultado.faultstring);
            return Response.json({ 
                sucesso: false, 
                erro: resultado.faultstring 
            });
        }

        console.log('[excluirClienteOmie] Cliente excluído do Omie com sucesso:', clienteNome);
        return Response.json({ 
            sucesso: true, 
            mensagem: 'Cliente excluído do Omie com sucesso'
        });

    } catch (error) {
        console.error('[excluirClienteOmie] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});