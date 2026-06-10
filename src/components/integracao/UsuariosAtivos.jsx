import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Clock, TrendingUp, Activity, Monitor } from 'lucide-react';

const ONLINE_MIN = 5;        // últimos 5 min = online agora
const RECENTE_H  = 24;       // últimas 24h = ativo hoje

function getIniciais(nomeOuEmail) {
  if (!nomeOuEmail) return '?';
  const partes = nomeOuEmail.trim().split(/\s+/);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return nomeOuEmail.slice(0, 2).toUpperCase();
}

function getCorAvatar(email) {
  const cores = [
    'bg-cyan-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-violet-500', 'bg-rose-500', 'bg-blue-500', 'bg-orange-500', 'bg-teal-500'
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

function nomePagina(path) {
  if (!path) return '-';
  const mapa = {
    '/': 'Início', '/MontagemCarga': 'Montagem de Carga', '/Cargas': 'Cargas',
    '/NotasOmie': 'Notas Fiscais', '/Pedidos': 'Pedidos', '/EmissaoPedidos': 'Emissão Pedidos',
    '/AcertoCaixa': 'Acerto de Caixa', '/IntegracaoOmieDashboard': 'Integração Omie',
    '/Clientes': 'Clientes', '/Operacao': 'Operação', '/AjustesPedidos': 'Ajustes Pedidos',
    '/EmissaoBoletos': 'Emissão Boletos', '/BoletosOmie': 'Boletos',
  };
  return mapa[path] || path.replace('/', '').replace(/([A-Z])/g, ' $1').trim() || path;
}

export default function UsuariosAtivos() {
  const agora = Date.now();

  // Presença em tempo real (heartbeat a cada 2 min)
  const { data: presencas = [] } = useQuery({
    queryKey: ['presencaUsuarios'],
    queryFn: () => base44.entities.PresencaUsuario.list('-ultimo_heartbeat', 50),
    refetchInterval: 30000,
    staleTime: 0,
  });

  // Logs de integração para ranking de ações
  const { data: logs = [] } = useQuery({
    queryKey: ['logsOmie'],
    staleTime: 0,
  });

  // Logs gerenciais para complementar nomes
  const { data: logsGerenciais = [] } = useQuery({
    queryKey: ['logsGerenciais-ativos'],
    queryFn: () => base44.entities.LogGerencial.list('-created_date', 200),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Mapa de email → nome (dos logs gerenciais)
  const nomesPorEmail = useMemo(() => {
    const m = {};
    for (const l of logsGerenciais) {
      if (l.usuario_email && l.usuario_nome && !m[l.usuario_email]) {
        m[l.usuario_email] = l.usuario_nome;
      }
    }
    return m;
  }, [logsGerenciais]);

  // Ranking de ações por email (últimas 24h)
  const acoesPorEmail = useMemo(() => {
    const m = {};
    const limite = agora - RECENTE_H * 3600000;
    for (const l of logs) {
      const email = l.usuario_email;
      if (!email || email.includes('sistema@') || email.includes('automacao')) continue;
      if (new Date(l.created_date).getTime() < limite) continue;
      m[email] = (m[email] || 0) + 1;
    }
    return m;
  }, [logs, agora]);

  // Usuários com heartbeat nas últimas 24h
  const usuarios = useMemo(() => {
    return presencas
      .filter(p => {
        if (!p.ultimo_heartbeat) return false;
        return agora - new Date(p.ultimo_heartbeat).getTime() < RECENTE_H * 3600000;
      })
      .map(p => ({
        ...p,
        nome: p.usuario_nome || nomesPorEmail[p.usuario_email] || p.usuario_email?.split('@')[0],
        totalAcoes: acoesPorEmail[p.usuario_email] || 0,
        online: agora - new Date(p.ultimo_heartbeat).getTime() < ONLINE_MIN * 60000,
      }))
      .sort((a, b) => new Date(b.ultimo_heartbeat) - new Date(a.ultimo_heartbeat));
  }, [presencas, nomesPorEmail, acoesPorEmail, agora]);

  const online  = usuarios.filter(u => u.online);
  const offline = usuarios.filter(u => !u.online);
  const topUsuarios = [...usuarios].sort((a, b) => b.totalAcoes - a.totalAcoes).slice(0, 3);

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

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-center">
            <p className="text-2xl font-bold text-green-700">{online.length}</p>
            <p className="text-xs text-green-600 mt-0.5">Online agora</p>
            <p className="text-[10px] text-green-500">últimos 5 min</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-center">
            <p className="text-2xl font-bold text-blue-700">{usuarios.length}</p>
            <p className="text-xs text-blue-600 mt-0.5">Ativos hoje</p>
            <p className="text-[10px] text-blue-500">últimas 24h</p>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">
              {Object.values(acoesPorEmail).reduce((s, v) => s + v, 0)}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Ações Omie</p>
            <p className="text-[10px] text-amber-500">últimas 24h</p>
          </div>
        </div>

        {/* Top 3 mais ativos */}
        {topUsuarios.filter(u => u.totalAcoes > 0).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Mais ativos hoje
            </p>
            <div className="flex flex-col gap-2">
              {topUsuarios.filter(u => u.totalAcoes > 0).map((u, i) => (
                <div key={u.usuario_email} className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
                  <span className="text-base">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{u.nome}</p>
                    <p className="text-[10px] text-slate-400 truncate">{u.usuario_email}</p>
                  </div>
                  <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">
                    {u.totalAcoes} ações
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Online agora */}
        {online.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3 text-green-500" /> Online agora
            </p>
            <div className="space-y-2">
              {online.map(u => (
                <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-green-50 border border-green-200">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ring-2 ring-green-400 ring-offset-1 ${getCorAvatar(u.usuario_email)}`}>
                    {getIniciais(u.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{u.nome}</p>
                    <p className="text-[10px] text-slate-400 truncate">{u.usuario_email}</p>
                    {u.pagina_atual && (
                      <p className="text-[10px] text-cyan-600 flex items-center gap-1 mt-0.5">
                        <Monitor className="w-2.5 h-2.5" />
                        {nomePagina(u.pagina_atual)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      {tempoRelativo(u.ultimo_heartbeat)}
                    </span>
                    {u.totalAcoes > 0 && (
                      <span className="text-[10px] text-slate-400">{u.totalAcoes} ações</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Offline recentes */}
        {offline.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Ativos hoje (offline)
            </p>
            <div className="space-y-1.5">
              {offline.map(u => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 opacity-60 ${getCorAvatar(u.usuario_email)}`}>
                    {getIniciais(u.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{u.nome}</p>
                    <p className="text-[10px] text-slate-400 truncate">{u.usuario_email}</p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="text-[10px] text-slate-400">{tempoRelativo(u.ultimo_heartbeat)}</span>
                    {u.totalAcoes > 0 && (
                      <span className="text-[10px] text-slate-300">{u.totalAcoes} ações</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {usuarios.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p>Nenhuma presença registrada ainda.</p>
            <p className="text-xs mt-1">Os usuários aparecerão ao navegar pelo sistema.</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}