// ─────────────────────────────────────────────────────────────────────────────
//  Floating AI assistant.
//
//  When the user opens the chat we collect a snapshot of their current AP
//  state and inject it into the system prompt; subsequent answers are grounded
//  in that snapshot. Requests go to OpenRouter using the user's saved key.
//
//  Public API:
//    buildAssistantContext()   →  { snapshot, contextText }
// ─────────────────────────────────────────────────────────────────────────────

import { loadSettings } from '../data/carriers.js';
import { loadCarriersOverview, aggregateOverview, loadRecentActivity } from '../lib/carrierStatementsService.js';
import { loadCarriers, loadAuditsFromDB } from '../lib/coreService.js';
import { supabase } from '../lib/supabase.js';

const OR_BASE = 'https://openrouter.ai/api/v1';

// Agentic assistant — calls the `assistant` edge function, which holds the
// LLM key server-side and answers by writing READ-ONLY SQL over ALL the
// data (not a static snapshot). Returns { answer, queries }. The edge
// function loops tool→result→tool internally; we only pass the visible
// conversation (user/assistant turns, stripped of UI attachments).
// ── Per-user chat persistence (RLS-isolated) ──
// Each employee's conversation lives in assistant_chats keyed by their
// user_id; RLS guarantees no one (not even admin) reads another's via the
// API. Replaces the shared localStorage cache so private questions stay
// private and the chat follows the employee across devices.
export async function loadMyChat() {
  const { data, error } = await supabase.from('assistant_chats').select('messages').maybeSingle();
  if (error) return [];
  return Array.isArray(data?.messages) ? data.messages : [];
}
export async function saveMyChat(userId, messages) {
  if (!userId) return;
  const slim = (messages || []).map(({ role, content, queries }) => ({ role, content, queries })).slice(-50);
  await supabase.from('assistant_chats').upsert(
    { user_id: userId, messages: slim, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
}
export async function clearMyChat(userId) {
  if (!userId) return;
  await supabase.from('assistant_chats').delete().eq('user_id', userId);
}

export async function askAssistantAgent(messages) {
  const clean = (messages || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));
  // The website model picker (Settings → AI) drives the assistant too, so
  // the user has ONE place to choose the model. The KEY stays a Supabase
  // secret — only the model id (not secret) is passed from the client. If
  // unset, the edge function falls back to ASSISTANT_MODEL / its default.
  const model = loadSettings()?.openrouterModel || undefined;
  const { data, error } = await supabase.functions.invoke('assistant', { body: { messages: clean, model } });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || 'تعذّر تشغيل المساعد');
  return { answer: data.answer || '', queries: data.queries || [] };
}

// Concise SAR formatter for prompts (fewer tokens than locale-aware).
const fmt = n => (n == null || Number.isNaN(n)) ? '—' : Number(n).toFixed(2);

export async function buildAssistantContext() {
  const [overview, carriers, audits, activity] = await Promise.all([
    loadCarriersOverview().catch(() => []),
    loadCarriers().catch(() => []),
    loadAuditsFromDB(20).catch(() => []),
    loadRecentActivity(10).catch(() => ({ statements: [], operations: [] })),
  ]);
  const totals = aggregateOverview(overview);
  const today = new Date().toISOString().slice(0, 10);

  // Compact text representation for the system prompt.
  const lines = [];
  lines.push(`اليوم: ${today}`);
  lines.push(`عدد الشركات الموردة (شركات الشحن): ${carriers.length}`);
  lines.push(`عدد الشركات اللي عندها كشوف محفوظة: ${overview.length}`);
  lines.push('');
  lines.push('=== الإجماليات عبر كل الشركات ===');
  lines.push(`المستحق الإجمالي: ${fmt(totals.outstanding)} ر.س`);
  lines.push(`متأخّر السداد: ${fmt(totals.overdueAmount)} ر.س (${totals.overdueCount} عملية)`);
  lines.push(`مسدّد سابقاً: ${fmt(totals.paidTotal)} ر.س (${totals.paidCount} عملية)`);
  lines.push(`عمليات معلّقة: ${totals.pendingCount}`);
  lines.push(`عمليات معتمدة (مدققة): ${totals.auditedCount}`);
  lines.push(`متنازع عليها: ${totals.disputedCount}`);
  lines.push(`تحت المراجعة: ${totals.reviewingCount}`);
  lines.push('');
  lines.push('=== أعمار الديون ===');
  lines.push(`حتى 30 يوم: ${fmt(totals.aging.d0_30)} ر.س`);
  lines.push(`31 إلى 60 يوم: ${fmt(totals.aging.d31_60)} ر.س`);
  lines.push(`61 إلى 90 يوم: ${fmt(totals.aging.d61_90)} ر.س`);
  lines.push(`فوق 90 يوم: ${fmt(totals.aging.over90)} ر.س`);
  lines.push('');

  if (overview.length) {
    lines.push('=== أرصدة كل شركة ===');
    for (const r of overview) {
      lines.push(`• ${r.carrierName || r.carrierId}: ` +
        `مستحق ${fmt(r.outstanding)} | متأخّر ${fmt(r.overdueAmount)} | ` +
        `مسدّد ${fmt(r.paidTotal)} | معلّقة ${r.pendingCount} | ` +
        `معتمدة ${r.auditedCount} | متنازع ${r.disputedCount} | ` +
        `آخر كشف ${r.lastStatementAt ? r.lastStatementAt.slice(0,10) : '—'}`);
    }
    lines.push('');
  }

  if (carriers.length) {
    lines.push('=== شركات معرّفة في النظام ===');
    for (const c of carriers) {
      const contracts = c.contracts ?? [];
      const countries = contracts[0] ? Object.keys(contracts[0].pricing ?? {}).length : 0;
      lines.push(`• ${c.name} (${c.id}) — ${contracts.length} عقد · ${countries} وجهة مسعّرة`);
    }
    lines.push('');
  }

  if (audits.length) {
    lines.push(`=== آخر ${audits.length} مراجعة فاتورة شحنات ===`);
    for (const a of audits.slice(0, 12)) {
      lines.push(`• ${a.carrierName} ${a.period} — ${a.rowCount ?? 0} شحنة، ` +
        `${a.issueCount ?? 0} فرق، إجمالي ${fmt(a.diff)} ر.س ` +
        `(${new Date(a.date).toISOString().slice(0,10)})`);
    }
    lines.push('');
  }

  if (activity.statements.length) {
    lines.push('=== آخر الكشوف المرفوعة ===');
    for (const s of activity.statements.slice(0, 6)) {
      lines.push(`• ${s.carrier_name} ${s.period_from}→${s.period_to} ` +
        `إجمالي ${fmt(s.total_balance)} ر.س (${s.uploaded_at?.slice(0,10)})`);
    }
    lines.push('');
  }

  if (activity.operations.length) {
    lines.push('=== آخر تغييرات الحالة ===');
    for (const o of activity.operations.slice(0, 6)) {
      lines.push(`• ${o.carrier_id} ${o.doc_no} (${o.doc_type}) → ${o.status} ` +
        `بمبلغ ${fmt((o.amount_dr || 0) - (o.amount_cr || 0))} ر.س`);
    }
  }

  return {
    snapshot: { totals, overview, carriers, audits, activity },
    contextText: lines.join('\n'),
  };
}
