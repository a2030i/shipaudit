import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from './UI.jsx';
import BulkPreflightDialog from './operations/BulkPreflightDialog.jsx';
import {
  lamhaStatusFailureLabel, loadCachedLamhaStoreStatuses, needsLamhaStatusRefresh,
  runLamhaStoreOperation,
} from '../lib/lamhaStoreStatusService.js';
import {
  decisionFinancialImpact, decisionStoreId, decisionTitle, evaluateLamhaStopEligibility,
} from '../lib/lamhaDecisionActions.js';
import { loadLamhaFinancialPolicyData } from '../lib/lamhaFinancialPolicyService.js';
import {
  createSubmissionGuard, summarizeActionResults, summarizeBulkPreflight,
} from '../lib/operationalWorkflows.js';

const MONEY = value => Number(value || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function LamhaDecisionActionReview({ rows = [], decision, enforceFinancialPolicy = false, onClose }) {
  const [results, setResults] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, label: '' });
  const [actionResult, setActionResult] = useState(null);
  const [policy, setPolicy] = useState({ loading: enforceFinancialPolicy, rows: new Map(), error: null });
  const stopRef = useRef(false);
  const submissionGuardRef = useRef(createSubmissionGuard());
  const storeIds = useMemo(() => [...new Set(rows.map(decisionStoreId).filter(Boolean))], [rows]);

  useEffect(() => {
    let cancelled = false;
    if (!enforceFinancialPolicy) {
      setPolicy({ loading: false, rows: new Map(), error: null });
      return undefined;
    }
    setPolicy(current => ({ ...current, loading: true, error: null }));
    loadLamhaFinancialPolicyData().then(data => {
      if (cancelled) return;
      setPolicy({ loading: false, rows: new Map((data.rows || []).map(row => [Number(row.storeId), row])), error: null });
    }).catch(error => {
      if (cancelled) return;
      setPolicy({ loading: false, rows: new Map(), error: error?.message || 'تعذر التحقق من قاعدة الإيقاف المالية' });
    });
    return () => { cancelled = true; };
  }, [enforceFinancialPolicy]);

  useEffect(() => {
    let cancelled = false;
    stopRef.current = false;
    const load = async () => {
      setLoading(true);
      let restored = [];
      try {
        const cached = await loadCachedLamhaStoreStatuses(storeIds);
        restored = cached.results || [];
      } catch {
        restored = [];
      }
      if (cancelled) return;
      const restoredMap = new Map(restored.map(result => [Number(result.storeId), result]));
      setResults(restoredMap);
      const targets = storeIds.filter(storeId => needsLamhaStatusRefresh(restoredMap.get(storeId)));
      if (targets.length) {
        setProgress({ completed: 0, total: targets.length, label: 'فحص حالة الحسابات مباشرة من لمحة' });
        const summary = await runLamhaStoreOperation({
          storeIds: targets,
          mode: 'get',
          context: enforceFinancialPolicy ? 'financial_policy' : 'direct',
          shouldStop: () => cancelled || stopRef.current,
          onProgress: ({ completed, total, results: nextResults }) => {
            if (cancelled) return;
            setProgress({ completed, total, label: 'فحص حالة الحسابات مباشرة من لمحة' });
            setResults(current => {
              const next = new Map(current);
              nextResults.forEach(result => next.set(Number(result.storeId), result));
              return next;
            });
          },
        });
        if (!cancelled && summary.failed) toast(`${summary.failed} حساب تعذر فحصه ويحتاج مراجعة`, 'warn');
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; stopRef.current = true; };
  }, [enforceFinancialPolicy, storeIds]);

  const preflight = useMemo(() => summarizeBulkPreflight(rows, row => {
    if (loading || policy.loading) return { status: 'review', reason: 'جارٍ فحص حالة لمحة والاستحقاق المالي' };
    if (enforceFinancialPolicy) {
      if (policy.error) return { status: 'review', reason: 'تعذر التحقق من قاعدة الإيقاف المالية' };
      const policyRow = policy.rows.get(decisionStoreId(row));
      if (!policyRow) return { status: 'review', reason: 'المتجر غير موجود في الربط المالي الحالي' };
      if (!policyRow.eligible) return { status: 'ineligible', reason: policyRow.exclusionReason || 'غير مؤهل ماليًا' };
      if (policyRow.policyGroup !== 'overdue') return { status: 'ineligible', reason: 'لم يعد لديه قابل للتحصيل متجاوز 30 يومًا' };
    }
    return evaluateLamhaStopEligibility(row, results.get(decisionStoreId(row)));
  }), [enforceFinancialPolicy, loading, policy, results, rows]);
  const eligibleAmount = preflight.eligible.reduce((sum, entry) => (
    sum + decisionFinancialImpact(entry.item, decision)
  ), 0);

  const confirm = () => submissionGuardRef.current.run(async () => {
    if (busy || !preflight.eligible.length) return;
    setBusy(true);
    let eligibleRows = preflight.eligible.map(entry => entry.item);
    let revalidationSkipped = [];
    if (enforceFinancialPolicy) {
      setProgress({ completed: 0, total: eligibleRows.length, label: 'إعادة التحقق من الاستحقاق المالي قبل التنفيذ' });
      try {
        const freshPolicy = await loadLamhaFinancialPolicyData();
        const freshById = new Map((freshPolicy.rows || []).map(row => [Number(row.storeId), row]));
        revalidationSkipped = eligibleRows.filter(row => {
          const current = freshById.get(decisionStoreId(row));
          return !current?.eligible || current.policyGroup !== 'overdue';
        });
        eligibleRows = eligibleRows.filter(row => !revalidationSkipped.includes(row));
      } catch (error) {
        toast(`توقف التنفيذ: ${error?.message || 'تعذر إعادة التحقق من الاستحقاق المالي'}`, 'error');
        setBusy(false);
        return;
      }
    }
    if (!eligibleRows.length) {
      toast('لم يبق أي حساب مؤهل بعد إعادة التحقق من البيانات المالية.', 'info');
      setBusy(false);
      return;
    }
    const nameById = new Map(eligibleRows.map(row => [decisionStoreId(row), row.customer?.storeName || row.customer?.name]));
    setProgress({ completed: 0, total: eligibleRows.length, label: 'إيقاف الحسابات والتحقق من النتيجة في لمحة' });
    try {
      const summary = await runLamhaStoreOperation({
        storeIds: eligibleRows.map(decisionStoreId),
        mode: 'deactivate',
        context: enforceFinancialPolicy ? 'financial_policy' : 'direct',
        onProgress: ({ completed, total }) => setProgress({ completed, total, label: 'إيقاف الحسابات والتحقق من النتيجة في لمحة' }),
      });
      setActionResult(summarizeActionResults([
        ...summary.results.map(item => ({
          key: Number(item.storeId),
          label: nameById.get(Number(item.storeId)) || `متجر #${item.storeId}`,
          status: item.ok ? (item.changed === false ? 'skipped' : 'success') : 'failed',
          reason: item.ok && item.changed === false ? 'كان الحساب موقوفًا قبل التنفيذ' : item.error || item.message || null,
        })),
        ...[...preflight.ineligible, ...preflight.requiresReview].map(entry => ({
          key: decisionStoreId(entry.item), label: entry.item.customer?.storeName || entry.item.customer?.name,
          status: 'skipped', reason: entry.reason,
        })),
        ...revalidationSkipped.map(row => ({
          key: decisionStoreId(row), label: row.customer?.storeName || row.customer?.name,
          status: 'skipped', reason: 'تغير الاستحقاق المالي قبل التنفيذ',
        })),
      ]));
    } catch (error) {
      setActionResult(summarizeActionResults(eligibleRows.map(row => ({
        key: decisionStoreId(row), label: row.customer?.storeName || row.customer?.name,
        status: 'failed', reason: error?.message || 'تعذر تنفيذ إيقاف حساب لمحة',
      }))));
    } finally {
      setBusy(false);
    }
  });

  return <BulkPreflightDialog
    open
    title={`مراجعة الإيقاف — ${decisionTitle(decision)}`}
    actionLabel={`تأكيد إيقاف ${preflight.eligible.length} حساب`}
    preflight={preflight}
    busy={busy}
    progress={progress}
    result={actionResult}
    impact={<div><span>الأثر المرتبط بالحالة <strong>{MONEY(eligibleAmount)} ر.س</strong></span><small style={{ display: 'block', marginTop: 5 }}>الإيقاف لا يطبّق رصيدًا ولا يسوي فاتورة ولا يكتب في Zoho.</small></div>}
    notice={loading
      || policy.loading
      ? 'جارٍ استعادة الفحوص الحديثة وقراءة حالة لمحة والتحقق من قاعدة الإيقاف المالية.'
      : enforceFinancialPolicy
        ? 'المؤهل فقط: قابل للتحصيل متجاوز 30 يومًا، بلا فرق مطابقة، وحساب لمحة يعمل. يعاد التحقق المالي قبل التنفيذ.'
        : 'المؤهل فقط هو الحساب الذي أثبتت قراءة لمحة الحديثة أنه يسمح بإنشاء الشحنات.'}
    renderRow={entry => {
      const row = entry.item;
      const storeId = decisionStoreId(row);
      const live = results.get(storeId);
      const policyRow = policy.rows.get(storeId);
      const reason = entry.status === 'eligible'
        ? enforceFinancialPolicy ? `مؤهل · ${MONEY(policyRow?.overdue30Amount)} ر.س متجاوز +30` : 'حساب لمحة يعمل'
        : entry.reason || lamhaStatusFailureLabel(live);
      return <div className={`is-${entry.status}`} key={row.identityKey || storeId}>
        <span><b>{row.customer?.storeName || row.customer?.name || `متجر #${storeId}`}</b><small style={{ display: 'block' }}>#{storeId || '—'} · {MONEY(decisionFinancialImpact(row, decision))} ر.س</small></span>
        <b>{reason}</b>
      </div>;
    }}
    onClose={onClose}
    onConfirm={confirm}
  />;
}
