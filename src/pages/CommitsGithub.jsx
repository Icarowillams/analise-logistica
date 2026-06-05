import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GitCommit, RefreshCw, ExternalLink, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function CommitsGithub() {
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['github-commits', page],
    queryFn: async () => {
      const { data } = await base44.functions.invoke('listarCommitsGithub', { page, per_page: 20 });
      return data;
    },
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000
  });

  const commits = data?.commits || [];

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <GitCommit className="w-8 h-8 text-purple-500" />
          <div>
            <h1 className="text-2xl font-bold">Commits do Repositório</h1>
            <p className="text-sm text-slate-500">Icarowillams/analise-logistica</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : data?.error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-red-700 text-sm">{data.error}</CardContent>
        </Card>
      ) : commits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-slate-500">Nenhum commit encontrado</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {commits.map((commit) => (
            <Card key={commit.sha} className="hover:shadow-md transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  {commit.author_avatar ? (
                    <img src={commit.author_avatar} alt="" className="w-9 h-9 rounded-full mt-0.5 shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center mt-0.5 shrink-0">
                      <User className="w-4 h-4 text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 break-words whitespace-pre-line">
                      {commit.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{commit.author_name}</span>
                      <span>•</span>
                      <span>{commit.date ? format(new Date(commit.date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : ''}</span>
                      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                        {commit.sha_short}
                      </Badge>
                    </div>
                  </div>
                  <a
                    href={commit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-purple-600 transition-colors shrink-0 mt-1"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {commits.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
          </Button>
          <span className="text-sm text-slate-500">Página {page}</span>
          <Button variant="outline" size="sm" disabled={commits.length < 20} onClick={() => setPage(p => p + 1)}>
            Próxima <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}