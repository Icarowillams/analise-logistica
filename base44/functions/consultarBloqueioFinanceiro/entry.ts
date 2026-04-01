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
    if (!token) {
      return Response.json({ error: 'Token do webhook não configurado' }, { status: 500 });
    }

    // Obter a URL do próprio webhook neste app
    const appId = Deno.env.get('BASE44_APP_ID');
    const webhookUrl = `https://app.base44.com/api/apps/${appId}/functions/webhookAnaliseComercial`;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ acao: acao || 'consultar', codigo })
    });

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});