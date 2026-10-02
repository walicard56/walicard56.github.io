// Monta o texto do lembrete diário a partir dos dados do usuário (sem dependências, testável).
export type Fixo = { nome?: string; valor?: number; dia?: number | null; pago?: boolean };
export type State = { months?: Record<string, { fixos?: Fixo[] }> };

const brl = (v: number) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');

/** Ano-mês e dia no fuso do usuário. */
export function localDate(tz: string, offsetDays = 0, now = Date.now()) {
  const d = new Date(now + offsetDays * 864e5);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  return { monthId: `${parts.year}-${parts.month}`, day: +parts.day };
}

/** Mensagem do dia, ou null se não houver contas vencendo hoje ou amanhã. */
export function buildMessage(state: State, tz: string, now = Date.now()) {
  const today = localDate(tz, 0, now), tomorrow = localDate(tz, 1, now);
  // Mês ainda não aberto no app: usa as contas fixas do último mês salvo (todas como não pagas).
  const ids = Object.keys(state.months ?? {}).sort();
  const fixosOf = (monthId: string): Fixo[] => {
    const m = state.months?.[monthId];
    if (m) return m.fixos ?? [];
    const prev = ids.filter((id) => id < monthId).pop();
    return prev ? (state.months![prev].fixos ?? []).map((f) => ({ ...f, pago: false })) : [];
  };
  const pend = (monthId: string, day: number) =>
    fixosOf(monthId).filter((f) => f.dia === day && !f.pago && (+(f.valor ?? 0)) > 0);
  const hoje = pend(today.monthId, today.day), amanha = pend(tomorrow.monthId, tomorrow.day);
  if (!hoje.length && !amanha.length) return null;
  const list = (fs: Fixo[]) => fs.map((f) => `${f.nome} (${brl(+(f.valor ?? 0))})`).join(', ');
  const title = hoje.length
    ? `💡 Vence hoje: ${hoje.length > 1 ? hoje.length + ' contas' : hoje[0].nome}`
    : `⏰ Amanhã vence: ${amanha.length > 1 ? amanha.length + ' contas' : amanha[0].nome}`;
  const body = [hoje.length ? 'Hoje: ' + list(hoje) : '', amanha.length ? 'Amanhã: ' + list(amanha) : ''].filter(Boolean).join(' · ');
  return { title, body, tag: `contas-${today.monthId}-${today.day}`, url: './index.html#contas' };
}
