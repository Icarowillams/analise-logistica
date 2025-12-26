import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verificar autenticação do usuário
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Configuração do app Gestor Visita
        const gestorVisitaAppId = '68b1f50209adbcb52b0d911b';
        const gestorVisitaApiKey = '60cf11f680fa4a83b1631326d3c773b1';

        // Buscar dados de Roteiros do Gestor Visita
        const gestorVisitaUrl = `https://app.base44.com/api/apps/${gestorVisitaAppId}/entities/Roteiro`;
        
        const response = await fetch(gestorVisitaUrl, {
            method: 'GET',
            headers: {
                'api_key': gestorVisitaApiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return Response.json({ 
                error: 'Erro ao buscar dados do Gestor Visita',
                details: await response.text()
            }, { status: response.status });
        }

        const roteiros = await response.json();

        // Processar e importar roteiros
        let importados = 0;
        let erros = [];

        for (const roteiro of roteiros) {
            try {
                // Mapear campos do roteiro para estrutura de Venda
                // Ajuste os campos conforme a estrutura real do Roteiro
                const vendaData = {
                    data: roteiro.data || new Date().toISOString().split('T')[0],
                    vendedor_id: roteiro.promotor_id,
                    vendedor_nome: roteiro.promotor_nome,
                    observacoes: `Roteiro importado - Dia: ${roteiro.dia_semana}, Status: ${roteiro.status}`,
                    // Adicione mapeamento de outros campos conforme necessário
                };

                await base44.asServiceRole.entities.Venda.create(vendaData);
                importados++;
            } catch (error) {
                erros.push({
                    roteiro_id: roteiro.id,
                    erro: error.message
                });
            }
        }

        return Response.json({
            success: true,
            total_roteiros: roteiros.length,
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