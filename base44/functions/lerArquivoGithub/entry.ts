import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const owner = body.owner || 'Icarowillams';
    const repo = body.repo || 'analise-logistica';
    const path = body.path;
    const lines_from = body.lines_from || null;
    const lines_to = body.lines_to || null;

    if (!path) return Response.json({ error: 'path obrigatório' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // Se path é 'search:termo', busca no repo
    if (path.startsWith('search:')) {
      const termo = path.replace('search:', '');
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`, { headers });
      const treeData = await treeRes.json();
      const matches = (treeData.tree || []).filter(f => f.type === 'blob' && f.path.includes(termo));
      return Response.json({ sucesso: true, matches: matches.map(f => ({ path: f.path, size: f.size })) });
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers });
    const data = await res.json();
    
    if (data.message) return Response.json({ error: data.message, path }, { status: 404 });
    
    const content = atob(data.content.replace(/\n/g, ''));
    
    let lines = content.split('\n');
    const totalLines = lines.length;
    
    if (lines_from !== null || lines_to !== null) {
      const from = Math.max(0, (lines_from || 1) - 1);
      const to = Math.min(totalLines, lines_to || totalLines);
      lines = lines.slice(from, to);
      return Response.json({
        sucesso: true,
        path: data.path,
        sha: data.sha,
        total_lines: totalLines,
        showing: `${from + 1}-${to}`,
        content: lines.map((l, i) => `${from + i + 1}: ${l}`).join('\n')
      });
    }

    return Response.json({
      sucesso: true,
      path: data.path,
      sha: data.sha,
      size: data.size,
      total_lines: totalLines,
      content: totalLines > 500 
        ? lines.slice(0, 500).map((l, i) => `${i + 1}: ${l}`).join('\n') + '\n... (truncado)'
        : lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});