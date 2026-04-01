import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { acao, codigo } = await req.json();
    
    const token = Deno.env.get('WEBHOOK_ANALISE_COMERCIAL_TOKEN');
    const webhookUrl = Deno.env.get('WEBHOOK_ANALISE_COMERCIAL_URL');
    
    if (!token || !webhookUrl) {
      return Response.json({ error: 'Configuração do webhook financeiro incompleta. Configure WEBHOOK_ANALISE_COMERCIAL_URL com a URL completa do webhook e WEBHOOK_ANALISE_COMERCIAL_TOKEN.' }, { status: 500 });
    }

    // webhookUrl deve ser a URL completa (ex: https://app-name.base44.app/functions/webhookAnaliseComercial)
    if (!webhookUrl.startsWith('http')) {
      return Response.json({ 
        error: 'WEBHOOK_ANALISE_COMERCIAL_URL deve ser a URL completa do webhook (começando com https://). Exemplo: https://meu-app.base44.app/functions/webhookAnaliseComercial' 
      }, { status: 500 });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ acao: acao || 'consultar', codigo })
    });

    if (!response.ok) {
      const text = await response.text();
      return Response.json({ 
        erro: true, 
        mensagem: `Erro ao consultar sistema financeiro (HTTP ${response.status})`
      }, { status: response.status });
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ erro: true, mensagem: error.message }, { status: 500 });
  }
});