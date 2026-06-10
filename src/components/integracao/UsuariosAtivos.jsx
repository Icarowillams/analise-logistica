import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, TrendingUp, Activity } from 'lucide-react';

const JANELA_ATIVO_MIN = 30; // últimos 30 minutos = "online agora"
const JANELA_RECENTE_H = 24; // últimas 24h = "ativo hoje"

function getIniciais(email) {
  if (!email) return '?';
  const nome = email.split('@')[0];
  return nome.slice(0, 2).toUpperCase();
}

function getCorAvatar(email) {
  const cores = [
    'bg-cyan-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-violet-500', 'bg-rose-500', 'bg-blue-500', 'bg-orange-500'
  ];
  let hash = 0;
  for (const c of (email || '')) hash = (hash * 31 + c.charCodeAt(0)) % cores.length;
  return cores[hash];
}

function tempoRelativo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

export default function UsuariosAtivos() {
  // Dados gerais (24h) — reutiliza cache da página pai, sem refetch agressivo
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logsOmie'],
    staleTime: 60000,
  });

  // Dados "online agora" — query separada, atualiza a cada 2 minutos
  const { data: logsOnline = [] } = useQuery({
    queryKey: ['logsOmie-online-agora'],
    queryFn: () => base44.entities.LogIntegracaoOmie.list('-created_date', 100),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 0,
  });

  const { data: logsGerenciais = [] } = useQuery({
    queryKey: ['logsGerenciais-ativos'],
    queryFn: () => base44.entities.LogGerencial.list('-created_date', 200),
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const agora = Date.now();

  // Calcula quem está "online agora" com base na query dedicada (atualiza a cada 2min)
  const onlineAgora = useMemo(() => {
    const mapa = {};
    for (const l of logsOnline) {
      const email = l.usuario_email;
      if (!email || email.includes('sistema@') || email.includes('automacao')) continue;
      const ts = new Date(l.created_date).getTime();
      if (agora - ts > JANELA_ATIVO_MIN * 60000) continue;
      if (!mapa[email] || mapa[email].ultimaAtividade < ts) {
        mapa[email] = {
          email,
          nome: null,
          ultimaAtividade: ts,
          ultimaAcao: l.call || l.operacao || '-',
        };
      }
    }
    // Enriquece com nomes dos logs gerenciais
    for (const l of logsGerenciais) {
      if (mapa[l.usuario_email] && !mapa[l.usuario_email].nome && l.usuario_nome) {
        mapa[l.usuario_email].nome = l.usuario_nome;
      }
    }
    return Object.values(mapa).sort((a, b) => b.ultimaAtividade - a.ultimaAtividade);
  }, [logsOnline, logsGerenciais, agora]);

  const usuarios = useMemo(() => {
    const mapa = {};

    // Consolida logs de integração Omie (com usuario_email)
    for (const l of logs) {
      const email = l.usuario_email;
      if (!email || email.includes('sistema@') || email.includes('automacao')) continue;
      const ts = new Date(l.created_date).getTime();
      if (!mapa[email] || mapa[email].ultimaAtividade < ts) {
        mapa[email] = {
          email,
          nome: null,
          ultimaAtividade: ts,
          ultimaAcao: l.call || l.operacao || '-',
          totalAcoes: (mapa[email]?.totalAcoes || 0) + 1,
        };
      } else {
        mapa[email].totalAcoes = (mapa[email].totalAcoes || 0) + 1;
      }
    }

    // Consolida logs gerenciais (com usuario_nome)
    for (const l of logsGerenciais) {
      const email = l.usuario_email;
      if (!email || email.includes('sistema@') || email.includes('automacao')) continue;
      const ts = new Date(l.created_date).getTime();
      if (!mapa[email]) {
        mapa[email] = {
          email,
          nome: l.usuario_nome || null,
          ultimaAtividade: ts,
          ultimaAcao: l.descricao || '-',
          totalAcoes: 1,
        };
      } else {
        if (!mapa[email].nome && l.usuario_nome) mapa[email].nome = l.usuario_nome;
        if (mapa[email].ultimaAtividade < ts) {
          mapa[email].ultimaAtividade = ts;
          mapa[email].ultimaAcao = l.descricao || mapa[email].ultimaAcao;
        }
        mapa[email].totalAcoes = (mapa[email].totalAcoes || 0) + 1;
      }
    }

    return Object.values(mapa)
      .filter(u => agora - u.ultimaAtividade < JANELA_RECENTE_H * 3600000)
      .sort((a, b) => b.ultimaAtividade - a.ultimaAtividade);
  }, [logs, logsGerenciais, agora]);

  // "online" vem da query dedicada (atualiza a cada 2min)
  const online = onlineAgora;
  const recentes = usuarios.filter(u => agora - u.ultimaAtividade >= JANELA_ATIVO_MIN * 60000);

  // Top 3 por total de ações
  const topUsuarios = [...usuarios].sort((a, b) => b.totalAcoes - a.totalAcoes).slice(0, 3);

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-5 h-5 text-cyan-600" />
          Usuários Ativos
          {online.length > 0 && (
            <Badge className="bg-green-100 text-green-700 border-green-300 ml-1">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse" />
              {online.length} online
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* KPIs rápidos */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{online.length}</p>
            <p className="text-xs text-green-600 mt-0.5">Online agora</p>
            <p className="text-[10px] text-green-500">últimos 30 min</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{usuarios.length}</p>
            <p className="text-xs text-blue-600 mt-0.5">Ativos hoje</p>
            <p className="text-[10px] text-blue-500">últimas 24h</p>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">
              {usuarios.reduce((s, u) => s + (u.totalAcoes || 0), 0)}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Ações totais</p>
            <p className="text-[10px] text-amber-500">últimas 24h</p>
          </div>
        </div>

        {/* Top 3 mais ativos */}
        {topUsuarios.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Mais ativos hoje
            </p>
            <div className="flex flex-wrap gap-2">
              {topUsuarios.map((u, i) => (
                <div key={u.email} className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${getCorAvatar(u.email)}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-slate-800 leading-none">{u.nome || u.email.split('@')[0]}</p>
                    <p className="text-[10px] text-slate-500">{u.totalAcoes} ações</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lista online agora */}
        {online.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3 text-green-500" /> Online agora
            </p>
            <div className="space-y-2">
              {online.map(u => (
                <div key={u.email} className="flex items-center gap-3 p-2.5 rounded-xl bg-green-50 border border-green-100">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${getCorAvatar(u.email)}`}>
                    {getIniciais(u.nome || u.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {u.nome || u.email.split('@')[0]}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">↳ {u.ultimaAcao}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {tempoRelativo(u.ultimaAtividade)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lista recentes (não online) */}
        {recentes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Ativos hoje (offline)
            </p>
            <div className="space-y-1.5">
              {recentes.map(u => (
                <div key={u.email} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 opacity-70 ${getCorAvatar(u.email)}`}>
                    {getIniciais(u.nome || u.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">
                      {u.nome || u.email.split('@')[0]}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">
                    {tempoRelativo(u.ultimaAtividade)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {usuarios.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-sm">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
            Nenhuma atividade nas últimas 24h
          </div>
        )}
      </CardContent>
    </Card>
  );
}