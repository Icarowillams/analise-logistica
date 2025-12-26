import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verificar autenticação do usuário
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Obter configurações do outro app
        const gestorVisitaAppId = Deno.env.get("GESTOR_VISITA_APP_ID");
        const gestorVisitaApiKey = Deno.env.get("GESTOR_VISITA_API_KEY");

        if (!gestorVisitaAppId || !gestorVisitaApiKey) {
            return Response.json({ 
                error: 'Configuração incompleta. Configure GESTOR_VISITA_APP_ID e GESTOR_VISITA_API_KEY nas variáveis de ambiente.' 
            }, { status: 400 });
        }

        // Buscar dados do Gestor Visita
        const gestorVisitaUrl = `https://api.base44.com/v1/apps/${gestorVisitaAppId}/entities/Lancamento`;
        
        const response = await fetch(gestorVisitaUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${gestorVisitaApiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return Response.json({ 
                error: 'Erro ao buscar dados do Gestor Visita',
                details: await response.text()
            }, { status: response.status });
        }

        const lancamentos = await response.json();

        // Processar e importar lançamentos
        let importados = 0;
        let erros = [];

        for (const lancamento of lancamentos) {
            try {
                // Mapear campos do lançamento para estrutura de Venda
                const vendaData = {
                    data: lancamento.data,
                    cliente_id: lancamento.cliente_id,
                    cliente_nome: lancamento.cliente_nome,
                    vendedor_id: lancamento.vendedor_id,
                    vendedor_nome: lancamento.vendedor_nome,
                    produto_id: lancamento.produto_id,
                    produto_nome: lancamento.produto_nome,
                    quantidade: lancamento.quantidade || 0,
                    valor_unitario: lancamento.valor_unitario || 0,
                    valor_total: lancamento.valor_total || 0,
                    observacoes: lancamento.observacoes || '',
                    // Adicione outros campos conforme necessário
                };

                await base44.asServiceRole.entities.Venda.create(vendaData);
                importados++;
            } catch (error) {
                erros.push({
                    lancamento_id: lancamento.id,
                    erro: error.message
                });
            }
        }

        return Response.json({
            success: true,
            total_lancamentos: lancamentos.length,
            importados,
            erros: erros.length > 0 ? erros : null
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});