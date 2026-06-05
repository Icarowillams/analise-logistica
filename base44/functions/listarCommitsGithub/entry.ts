import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const owner = body.owner || 'Icarowillams';
    const repo = body.repo || 'analise-logistica';
    const page = body.page || 1;
    const perPage = body.per_page || 30;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');

    const url = `https://api.github.com/repos/${owner}/${repo}/commits?page=${page}&per_page=${perPage}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return Response.json({ 
        error: errData.message || `GitHub API error: ${response.status}` 
      }, { status: response.status });
    }

    const commits = await response.json();

    const resultado = commits.map(c => ({
      sha: c.sha,
      sha_short: c.sha?.substring(0, 7),
      message: c.commit?.message,
      author_name: c.commit?.author?.name,
      author_email: c.commit?.author?.email,
      author_avatar: c.author?.avatar_url,
      author_login: c.author?.login,
      date: c.commit?.author?.date,
      url: c.html_url,
      stats: c.stats || null
    }));

    return Response.json({ sucesso: true, commits: resultado });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});