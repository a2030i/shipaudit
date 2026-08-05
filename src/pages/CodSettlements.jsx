import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, RefreshCw, Search, AlertCircle, CheckCircle2, XCircle, MessageSquare, Trash2, Download, ChevronDown, ChevronLeft, Pencil, Check, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtl } from '../lib/xlsxRtl.js';
import { Card, Btn, Input, Select, Modal, Empty, Spinner, toast, PageHeader, DropZone } from '../components/UI.jsx';
import CarrierTabs from '../components/CarrierTabs.jsx';
import { Banknote } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import {
  loadReconciliation, summarizeReconciliation, ageOutstanding, ageOverRemit,
  saveSettlementUpload, setReconciliationAction, clearReconciliationAction,
  loadSettlementUploads, deleteSettlementUpload, loadUploadShipments, setUploadLabel,
  findDuplicateSettlementAwbs, loadOutstandingByCarrier, saveConsolidatedExpected,
} from '../lib/codSettlementService.js';
import { INTERNAL_PARSER, REMITTANCE_PARSERS, listSupportedCarriers } from '../engine/codParsers/index.js';
import { loadCarriers } from '../lib/coreService.js';
import { useWindowedRows } from '../hooks/useWindowedRows.js';

// ─── Status meta ──────────────────────────────────────────────────────────
// over_remit splits visually: recent (≤ 30d, blue) is just sequencing —
// the matching outgoing settlement hasn't been uploaded yet, totally
// normal. Aged (> 30d, red) is a real anomaly worth investigating.
const STATUS_META = {
  matched:          { label: '✓ مسوّاة',                 color: 'var(--green)' },
  approved:         { label: '✓ مُعتمَدة',               color: 'var(--green)' },
  resolved:         { label: '✓ تم الحل',                color: 'var(--green)' },
  outstanding:      { label: '🔴 متبقّي',                color: 'var(--red)'   },
  pending_review:   { label: '🟡 فرق غير مراجَع',         color: 'var(--gold)'  },
  disputed:         { label: '⚠️ اعتراض مفتوح',           color: 'var(--gold)'  },
  over_remit:       { label: '🔵 وارد · بانتظار المطابقة', color: 'var(--brand)' },
  over_remit_aged:  { label: '🔴 تحويل وصل بلا تسوية تقابله',   color: 'var(--red)'   },
};

function statusKey(r) {
  return (r.status === 'over_remit' && r.isOverRemitAged) ? 'over_remit_aged' : r.status;
}

const fmt = n => (n == null || Number.isNaN(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Module-level guard for COD imports landing from the Webhook page.
// React 18 StrictMode (dev) runs effects twice and PageSlot keeps the
// page mounted across navigation — useRef would reset and an empty-
// deps useEffect would only fire once. A Set on module scope survives
// both, so an import is consumed exactly once per click.
const CONSUMED_COD_IMPORTS = new Set();

export default function CodSettlements({ isActive = true }) {
  const { user, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const carriers = listSupportedCarriers();
  const [carrier, setCarrier] = useState(carriers[0]?.id || 'c_1777506662790');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('outstanding'); // outstanding|pending|disputed|matched|all
  const [search, setSearch] = useState('');
  // Bulk note-taking: Set<awb> selected via row checkboxes. Cleared on
  // carrier/tab change (selection is view-scoped, like the ledger's).
  const [selectedAwbs, setSelectedAwbs] = useState(() => new Set());
  // 'all' | 'with' | 'without' — filter rows by accounting-note presence.
  const [noteFilter, setNoteFilter] = useState('all');
  // Bulk search: paste a LIST of AWBs (from Excel / carrier email — any
  // separator) and filter to exactly those rows. null = inactive.
  const [bulkSearch, setBulkSearch] = useState(null);     // Set<awb> | null
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [actionModal, setActionModal] = useState(null);  // { row, kind:'approve'|'dispute'|'edit'|'resolve' }
  const [uploadModal, setUploadModal] = useState(null);  // { direction:'out'|'in' }
  // رفع المتوقّع المجمّع (كل الشركات بملف واحد): null | { busy } | { result }
  const [consolidated, setConsolidated] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [confirmDeleteUpload, setConfirmDeleteUpload] = useState(null);
  // outstandingByCarrier: Map<carrier_id, sar> — drives the dropdown
  // labels so the user can see at a glance which carrier owes the most.
  const [outstandingByCarrier, setOutstandingByCarrier] = useState(new Map());
  // fileKindById: Map<carrier_id, file_kind>. For audit_with_cod carriers
  // (iMile/DeliverNow) the audit approval ALREADY creates the received
  // ('in') rows — so the manual «ارفع تحويل» button is hidden to prevent
  // double-counting the same COD.
  const [fileKindById, setFileKindById] = useState(new Map());
  // carrierMeta: كل شركات النظام (id+name) لبناء المنتقي الشامل (لا المحلّلات فقط).
  const [carrierMeta, setCarrierMeta] = useState([]);

  const refresh = useCallback(async () => {
    if (!carrier) return;
    setLoading(true);
    try {
      const [data, uploadsList, outstanding] = await Promise.all([
        loadReconciliation(carrier),
        loadSettlementUploads({ carrierId: carrier }),
        loadOutstandingByCarrier(),
      ]);
      setRows(data);
      setUploads(uploadsList);
      setOutstandingByCarrier(outstanding);
    } catch (e) {
      toast(`فشل التحميل: ${e.message}`, 'error');
    }
    setLoading(false);
  }, [carrier]);

  const handleDeleteUpload = async (uploadId) => {
    try {
      await deleteSettlementUpload(uploadId);
      toast('تم حذف التسوية', 'info');
      setConfirmDeleteUpload(null);
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  // AWB → its aggregate reconciliation row, so a per-file export can stamp
  // each shipment with its overall status (the file only knows its own
  // amount; the status comes from matching against the opposite direction).
  const reconByAwb = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(String(r.awb).trim(), r);
    return m;
  }, [rows]);

  // Download ONE settlement file's shipments, each tagged with its status
  // in the reconciliation (matched / outstanding / over_remit / …). Works
  // for both directions — carrier file (in) or internal-system file (out).
  const [exportingUpload, setExportingUpload] = useState(null);
  const [renamingId, setRenamingId] = useState(null);   // ملف قيد إعادة التسمية
  const [renameVal, setRenameVal] = useState('');
  const saveRename = async (u) => {
    try {
      await setUploadLabel(u.uploadId, renameVal, user?.id || null);
      setUploads(prev => prev.map(x => x.uploadId === u.uploadId ? { ...x, label: renameVal.trim() || null } : x));
      setRenamingId(null);
      toast('حُفظت التسمية', 'success');
    } catch (e) { toast(`تعذّر الحفظ: ${e.message}`, 'error'); }
  };
  const handleExportUpload = async (u) => {
    setExportingUpload(u.uploadId);
    try {
      const ship = await loadUploadShipments(u.uploadId);
      if (!ship.length) { toast('لا توجد شحنات في هذا الملف', 'info'); return; }
      const headers = [
        'رقم الشحنة (AWB)', 'مبلغ هذا الملف (ر.س)', 'الحالة في المطابقة',
        'إجمالي متوقّع', 'إجمالي مُستلَم', 'الفرق', 'ملاحظة',
      ];
      const data = ship.map(s => {
        const r = reconByAwb.get(String(s.awb).trim());
        const statusLabel = r
          ? (STATUS_META[statusKey(r)]?.label || r.status)
          : 'غير مطابَق';
        return [
          String(s.awb),
          +Number(s.amount || 0).toFixed(2),
          statusLabel,
          r ? r.paid : '',
          r ? r.received : '',
          r ? r.diff : '',
          r?.notes || '',
        ];
      });
      const total = ship.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
      const totalRow = ['الإجمالي', +total.toFixed(2), '', '', '', '', ''];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data, [], totalRow]);
      ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, u.direction === 'in' ? 'مُستلَم' : 'متوقّع');
      const safe = String(u.sourceFile || u.uploadId).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      XLSX.writeFile(rtl(wb), `تسوية_${safe}.xlsx`);
      toast(`تم تصدير ${ship.length} شحنة مع حالتها`, 'success');
    } catch (e) {
      toast(`فشل التصدير: ${e.message}`, 'error');
    }
    setExportingUpload(null);
  };

  // Export the outstanding (متبقّي) list as Excel — what the carrier still
  // owes us, ready to send back to them as a follow-up list.
  const handleExportOutstanding = () => {
    const outstanding = rows.filter(r => r.status === 'outstanding');
    if (!outstanding.length) {
      toast('لا توجد شحنات متبقّية للتصدير', 'info');
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wb = XLSX.utils.book_new();
    const headers = ['رقم الشحنة (AWB)', 'المبلغ (ر.س)', 'تاريخ التسوية مع المتجر', 'الأيام منذ التسوية'];
    const data = outstanding
      .sort((a, b) => (a.firstOutDate || '').localeCompare(b.firstOutDate || ''))
      .map(r => {
        const days = r.firstOutDate
          ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
          : '—';
        return [r.awb, +r.diff.toFixed(2), r.firstOutDate || '—', days];
      });
    const totalRow = ['الإجمالي', outstanding.reduce((s, r) => s + r.diff, 0).toFixed(2), '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, [], totalRow]);
    ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'متبقّي عند الناقل');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(rtl(wb), `متبقي_عند_الناقل_${carrier}_${dateStr}.xlsx`);
    toast(`تم تصدير ${outstanding.length} شحنة`, 'success');
  };

  // Export EVERY carrier's outstanding in ONE sheet, with a leading
  // "الناقل" column. Loops loadReconciliation per carrier (sequential —
  // 8 carriers, light queries) so the operator gets the whole "غير
  // محصَّل" picture in a single file instead of exporting 8 times.
  const [exportingAll, setExportingAll] = useState(false);
  // رفع مراجعة فاتورة من صفحة التحصيل مباشرة — يختار الملف هنا، يُخزَّن
  // (نمط §1.5 webhookImport) ثم يفتح معالج المراجعة جاهزاً على النتائج بلا
  // إعادة اختيار يدوي. المراجعة معالج متعدّد الخطوات فيُعرَض في /upload.
  const handleReviewUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv,.pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        sessionStorage.setItem('webhookImport', JSON.stringify({
          base64: btoa(bin), filename: file.name, carrierId: carrier,
        }));
        navigate('/upload');
      } catch (e) { toast(`فشل قراءة الملف: ${e.message}`, 'error'); }
    };
    input.click();
  };

  // رفع «المتوقّع المجمّع» — ملف واحد من النظام الداخلي يوزّع على كل الناقلين.
  const handleConsolidatedFile = async (file) => {
    if (!file) return;
    setConsolidated({ busy: true });
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      // §6: أعِد حساب !ref تحسّباً لنطاق قديم من المُصدِّر (وإلا تُفقَد صفوف صامتاً)
      let mr = 0, mc = 0;
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue;
        const a = XLSX.utils.decode_cell(k);
        if (a.r > mr) mr = a.r; if (a.c > mc) mc = a.c;
      }
      if (mr > 0 || mc > 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const res = await saveConsolidatedExpected({ allRows, fileName: file.name, userId: user?.id });
      setConsolidated({ result: res });
      await refresh();
    } catch (e) {
      toast(`فشل الرفع المجمّع: ${e.message}`, 'error');
      setConsolidated(null);
    }
  };

  const handleExportAllOutstanding = async () => {
    setExportingAll(true);
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const all = [];
      for (const c of carriers) {
        let data;
        try { data = await loadReconciliation(c.id); }
        catch { continue; }  // a single carrier failing must not kill the export
        for (const r of data.filter(r => r.status === 'outstanding')) {
          const days = r.firstOutDate
            ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
            : '—';
          all.push([c.label, r.awb, +r.diff.toFixed(2), r.firstOutDate || '—', days]);
        }
      }
      if (!all.length) {
        toast('لا توجد شحنات متبقّية لدى أي ناقل', 'info');
        setExportingAll(false);
        return;
      }
      // Group by carrier, then oldest-first within each carrier.
      all.sort((a, b) =>
        String(a[0]).localeCompare(String(b[0]), 'ar') ||
        String(a[3]).localeCompare(String(b[3])));
      const headers = ['الناقل', 'رقم الشحنة (AWB)', 'المبلغ (ر.س)', 'تاريخ التسوية مع المتجر', 'الأيام منذ التسوية'];
      const total = all.reduce((s, r) => s + (Number(r[2]) || 0), 0);
      const carrierCount = new Set(all.map(r => r[0])).size;
      const totalRow = ['الإجمالي', '', +total.toFixed(2), '', ''];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...all, [], totalRow]);
      ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'متبقّي كل الناقلين');
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(rtl(wb), `متبقي_كل_الناقلين_${dateStr}.xlsx`);
      toast(`تم تصدير ${all.length} شحنة من ${carrierCount} ناقل`, 'success');
    } catch (e) {
      toast(`فشل تصدير الكل: ${e.message}`, 'error');
    }
    setExportingAll(false);
  };

  // Export whatever the user is currently looking at — respects both the
  // active tab AND the search filter. Sheet/file names adapt to the tab
  // so the admin can save several exports without overwriting each other.
  const handleExportCurrentTab = () => {
    if (!filtered.length) {
      toast('لا توجد شحنات في هذا القسم لتصديرها', 'info');
      return;
    }
    const TAB_NAMES = {
      outstanding: 'متبقّي عند الناقل',
      pending:     'فروق تنتظر مراجعة',
      disputed:    'اعتراضات',
      over:        'مُستلَم بانتظار',
      matched:     'مسوّاة',
      all:         'كل الشحنات',
    };
    const tabName = TAB_NAMES[tab] || 'COD';
    const STATUS_AR = {
      outstanding:     'متبقّي',
      pending_review:  'فرق ينتظر',
      disputed:        'اعتراض',
      over_remit:      'مُستلَم بانتظار',
      matched:         'مسوّى',
      approved:        'معتمد',
      resolved:        'محلول',
    };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const headers = [
      'رقم الشحنة (AWB)',
      'دفعنا للمتجر (ر.س)',
      'استلمنا من الناقل (ر.س)',
      'الفرق (ر.س)',
      'الحالة',
      'تاريخ التسوية مع المتجر',
      'الأيام منذ التسوية',
      'ملاحظات',
    ];
    const data = filtered.map(r => {
      const days = r.firstOutDate
        ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
        : '';
      return [
        r.awb,
        r.hasOut    ? Number(r.paid).toFixed(2)     : '',
        r.hasIn     ? Number(r.received).toFixed(2) : '',
        Number(r.diff || 0).toFixed(2),
        STATUS_AR[r.status] || r.status || '',
        r.firstOutDate || '',
        days,
        r.notes || '',
      ];
    });
    const totalPaid     = filtered.reduce((s, r) => s + (r.hasOut ? Number(r.paid) || 0 : 0), 0);
    const totalReceived = filtered.reduce((s, r) => s + (r.hasIn  ? Number(r.received) || 0 : 0), 0);
    const totalDiff     = filtered.reduce((s, r) => s + (Number(r.diff) || 0), 0);
    const totalRow = ['الإجمالي', totalPaid.toFixed(2), totalReceived.toFixed(2), totalDiff.toFixed(2), '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data, [], totalRow]);
    ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 36 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tabName.slice(0, 28)); // sheet name limit ≈ 31 chars
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(rtl(wb), `${tabName}_${carrier}_${dateStr}.xlsx`);
    toast(`تم تصدير ${filtered.length} شحنة من قسم «${tabName}»`, 'success');
  };

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh]);

  // Load each carrier's file_kind once — lets us hide «ارفع تحويل» for
  // audit_with_cod carriers (their COD comes from audit approval).
  useEffect(() => {
    if (!isActive) return;
    loadCarriers()
      .then(list => {
        setFileKindById(new Map((list || []).map(c => [c.id, c.file_signature?.file_kind || null])));
        setCarrierMeta(list || []);
      })
      .catch(() => { /* non-fatal — buttons just stay visible */ });
  }, [isActive]);

  // ── Webhook → COD auto-import ───────────────────────────────────
  // When the admin clicks "حفظ كتحصيل" in the Webhook page, the file
  // is stashed in sessionStorage as `webhookCodImport`. We pick it up
  // here, switch the dropdown to its carrier, and open the 'in'
  // upload modal pre-filled with the file's bytes so the user just
  // clicks "حفظ" to import.
  //
  // Same module-level Set pattern as UploadWizard: PageSlot keeps
  // this page mounted, so an empty deps useEffect would never re-fire
  // on later visits. We depend on location.pathname instead.
  // Carrier-workspace scoping: /cod-settlements?carrier=X selects that
  // carrier and shows the workspace tab bar. location.search as dep (not
  // empty deps) because PageSlot keeps the page mounted across visits.
  // MoneyHub links use /money?tab=cod&carrier=X, so accept that canonical
  // route too.
  useEffect(() => {
    const isCodRoute = location.pathname === '/cod-settlements'
      || (location.pathname === '/money' && new URLSearchParams(location.search).get('tab') === 'cod');
    if (!isCodRoute) return;
    const wanted = new URLSearchParams(location.search).get('carrier');
    if (wanted) setCarrier(wanted);
  }, [location.pathname, location.search]);
  const fromWorkspace = (location.pathname === '/cod-settlements' || location.pathname === '/money')
    && !!new URLSearchParams(location.search).get('carrier');

  useEffect(() => {
    if (location.pathname !== '/cod-settlements') return;
    let raw;
    try { raw = sessionStorage.getItem('webhookCodImport'); } catch { return; }
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch {
      sessionStorage.removeItem('webhookCodImport');
      return;
    }
    if (!payload?.base64 || !payload?.filename || !payload?.carrierId) return;
    const key = payload.eventId || payload.filename;
    if (CONSUMED_COD_IMPORTS.has(key)) return;
    CONSUMED_COD_IMPORTS.add(key);
    sessionStorage.removeItem('webhookCodImport');

    try {
      // Decode base64 → File so UploadModal can run the parser on it.
      const bin = atob(payload.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], payload.filename, {
        type: /\.(xlsx|xlsm)$/i.test(payload.filename)
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream',
      });
      setCarrier(payload.carrierId);
      setUploadModal({ direction: 'in', preloadedFile: file, sourceEventId: payload.eventId });
      toast(`جارٍ معالجة ملف التحصيل: ${payload.filename}`, 'info');
    } catch (err) {
      CONSUMED_COD_IMPORTS.delete(key);
      toast(`فشل استيراد ملف التحصيل: ${err.message}`, 'error');
    }
  }, [location.pathname]);

  const summary    = useMemo(() => summarizeReconciliation(rows), [rows]);
  const aging      = useMemo(() => ageOutstanding(rows), [rows]);
  const agingOver  = useMemo(() => ageOverRemit(rows), [rows]);

  // Global COD outstanding across ALL carriers (not just the selected one).
  // The per-carrier hero metrics below are scoped to `carrier`; this banner
  // surfaces the company-wide figure so the operator sees total uncollected
  // COD without flipping through every carrier in the dropdown. We sum only
  // the positive (still-owed-to-us) balances so a carrier that over-remitted
  // doesn't net away another carrier's genuine outstanding.
  const globalOutstanding = useMemo(() => {
    let total = 0, carriersDue = 0;
    for (const v of outstandingByCarrier.values()) {
      const n = Number(v) || 0;
      if (n > 0.5) { total += n; carriersDue++; }
    }
    return { total: +total.toFixed(2), carriersDue };
  }, [outstandingByCarrier]);

  // المنتقي: كل شركات النظام (سواء لها محلّل تحصيل أو لا) — لا المحلّلات فقط.
  // مرتّب ديناميكياً: الأعلى مبلغاً (مطلقاً) أولاً، ثم أبجدياً عند التساوي.
  const pickerCarriers = useMemo(() => {
    const labelById = new Map();
    for (const c of carriers)    labelById.set(c.id, c.label);                 // محلّلات التحصيل
    for (const c of carrierMeta) if (!labelById.has(c.id)) labelById.set(c.id, c.name || c.id); // كل شركات DB
    for (const id of outstandingByCarrier.keys()) if (!labelById.has(id)) labelById.set(id, id);
    return [...labelById].map(([id, label]) => ({ id, label, due: outstandingByCarrier.get(id) || 0 }))
      .sort((a, b) => Math.abs(b.due) - Math.abs(a.due) || String(a.label).localeCompare(String(b.label), 'ar'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierMeta, outstandingByCarrier]);

  const counts = useMemo(() => {
    const c = {
      all: rows.length, outstanding: 0, pending: 0,
      disputed: 0, matched: 0, overRemit: 0,
    };
    for (const r of rows) {
      if (r.status === 'outstanding')    c.outstanding++;
      else if (r.status === 'pending_review') c.pending++;
      else if (r.status === 'disputed')  c.disputed++;
      else if (r.status === 'over_remit') c.overRemit++;
      else c.matched++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let pool = rows;
    if (tab === 'outstanding')   pool = pool.filter(r => r.status === 'outstanding');
    else if (tab === 'pending')  pool = pool.filter(r => r.status === 'pending_review');
    else if (tab === 'disputed') pool = pool.filter(r => r.status === 'disputed');
    else if (tab === 'matched')  pool = pool.filter(r => ['matched','approved','resolved'].includes(r.status));
    else if (tab === 'over')     pool = pool.filter(r => r.status === 'over_remit');
    if (noteFilter === 'with')         pool = pool.filter(r => !!r.notes);
    else if (noteFilter === 'without') pool = pool.filter(r => !r.notes);
    if (bulkSearch) pool = pool.filter(r => bulkSearch.has(String(r.awb).trim()));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      pool = pool.filter(r => r.awb.toLowerCase().includes(q));
    }
    // Outstanding first by oldest, then disputed by oldest, others alphabetical
    return [...pool].sort((a, b) => {
      const o = (r) => r.firstOutDate || '';
      return (o(a) || '').localeCompare(o(b) || '');
    });
  }, [rows, tab, search, noteFilter, bulkSearch]);

  // Incremental render — only the first batch is in the DOM until the
  // operator scrolls near the bottom. Keeps the table snappy as
  // cod_settlement grows past tens of thousands of rows per carrier.
  const { visible, hasMore, sentinelRef, count, total } = useWindowedRows(filtered, { batch: 200 });

  const openAction = (row, kind) => setActionModal({ row, kind });

  const submitAction = async ({ status, notes }) => {
    try {
      // Bulk note: same text applied to every selected AWB. Empty text =
      // clear the note on all of them (mirrors the single-row semantics).
      const targets = actionModal.bulkAwbs?.length
        ? actionModal.bulkAwbs
        : [actionModal.row.awb];
      for (const awb of targets) {
        if (status === 'note' && !notes) {
          await clearReconciliationAction(carrier, awb);
        } else {
          await setReconciliationAction({
            carrierId: carrier, awb,
            status, notes, userId: user?.id,
          });
        }
      }
      toast(targets.length > 1 ? `تم الحفظ على ${targets.length} شحنة` : 'تم الحفظ', 'success');
      setActionModal(null);
      setSelectedAwbs(new Set());
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  const reopenAction = async (row) => {
    try {
      await clearReconciliationAction(carrier, row.awb);
      toast('تم إعادة الفتح', 'info');
      refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
  };

  return (
    <div style={{ padding: '24px 28px 80px', maxWidth: 1320, margin: '0 auto' }}>
      {fromWorkspace && (
        <CarrierTabs
          carrierId={carrier}
          carrierName={carriers.find(c => c.id === carrier)?.name || carrier}
          active="cod"
        />
      )}
      <PageHeader
        icon={<Banknote size={22}/>}
        title="تسويات الدفع عند الاستلام"
        subtitle="المعتمد للمراجعات يُغذّي «المتوقَّع»، والناقل يُحوّل النقد فعلياً كـ«مُستلَم» — الفرق = ما تبقّى"
        actions={
          <>
            <select value={carrier} onChange={e => setCarrier(e.target.value)}
              className="page-action-select"
              style={{
                padding: '10px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                background: 'var(--surface)', border: '1px solid var(--border2)',
                color: 'var(--text)', cursor: 'pointer', minWidth: 220,
              }}>
              {pickerCarriers.map(c => {
                const due = c.due;
                let dueLabel = '';
                if (Math.abs(due) >= 0.5) {
                  const sign = due > 0 ? '' : '-';
                  // Show the exact halalas (2dp), not rounded — so the dropdown
                  // matches the «المتبقي عند الناقل» card below it.
                  const num = Math.abs(due).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  dueLabel = ` — ${sign}${num} ر.س`;
                }
                return <option key={c.id} value={c.id}>{c.label}{dueLabel}</option>;
              })}
            </select>
            <Btn size="md" variant="ghost" icon={<Upload size={14}/>}
              onClick={handleReviewUpload}
              title="اختر فاتورة هذا الناقل هنا — تُفتح المراجعة جاهزة على النتائج">
              رفع مراجعة
            </Btn>
            <Btn size="md" variant="ghost" icon={<RefreshCw size={14}/>} onClick={refresh}>تحديث</Btn>
            {/* audit_with_cod carriers (iMile/DeliverNow): the received COD
                is auto-created on audit approval, so a manual «ارفع تحويل»
                would double-count it. Hide the button; show a hint. */}
            {fileKindById.get(carrier) === 'audit_with_cod' ? (
              <span style={{
                fontSize: 11.5, color: 'var(--muted)', maxWidth: 200, lineHeight: 1.5,
                alignSelf: 'center', padding: '0 6px',
              }}>
                💡 التحصيل يُسجَّل تلقائياً عند اعتماد المراجعة لهذا الناقل
              </span>
            ) : (
              <Btn size="md" variant="accent" icon={<Upload size={14}/>}
                onClick={() => setUploadModal({ direction: 'in' })}
                title="تحصيل شركة الشحن — المبلغ الذي حوّلته الشركة فعلياً (مُستلَم)">
                تحصيل شركة الشحن
              </Btn>
            )}
            <div className={`page-action-menu${moreActionsOpen ? ' is-open' : ''}`}>
              <button type="button" className="page-action-menu__trigger"
                aria-expanded={moreActionsOpen} onClick={() => setMoreActionsOpen(open => !open)}>
                إجراءات إضافية
              </button>
              {moreActionsOpen && <div className="page-action-menu__panel">
                {summary.outstandingCount > 0 && (
                  <Btn size="md" variant="ghost" icon={<Download size={14}/>}
                    onClick={handleExportOutstanding}
                    title="تصدير المتبقي عند الناقل المختار فقط">
                    تصدير المتبقي للناقل المحدد
                  </Btn>
                )}
                <Btn size="md" variant="ghost"
                  icon={exportingAll ? <Spinner size={14}/> : <Download size={14}/>}
                  onClick={handleExportAllOutstanding}
                  disabled={exportingAll}
                  title="تصدير غير المحصَّل لكل الناقلين في ملف واحد (عمود لكل ناقل)">
                  {exportingAll ? 'جارٍ التجميع…' : 'تصدير المتبقي لكل الناقلين'}
                </Btn>
                <Btn size="md" variant="ghost" icon={<Upload size={14}/>}
                  onClick={() => setUploadModal({ direction: 'out' })}
                  title="تحصيل لمحة — ما يتوقّع نظام لمحة الداخلي تحصيله (لناقل واحد)">
                  تسجيل تحصيل لمحة لناقل واحد
                </Btn>
                {(!can || can('cod.upload_out')) && (
                  <Btn size="md" variant="ghost" icon={<Upload size={14}/>}
                    onClick={() => setConsolidated({ pick: true })}
                    title="تحصيل لمحة المجمّع — ملف واحد يغطّي كل الشركات (تم التوصيل + مبلغ>0)">
                    تسجيل تحصيل لمحة المجمّع
                  </Btn>
                )}
              </div>}
            </div>
          </>
        }
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={22}/></div>
      ) : rows.length === 0 ? (
        <Card style={{ padding: 44, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>💰</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>لا توجد تسويات بعد</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, marginBottom: 22 }}>
            اعتماد أي مراجعة فيها أعمدة COD يُغذّي «المتوقّع من الناقل» تلقائياً.
            وعند وصول التحويل، ارفع ملف التحويل كـ«مُستلَم». النظام يُطابق رقم الشحنة (AWB) ويعرض الفرق.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Btn variant="ghost" icon={<Upload size={14}/>} onClick={() => setUploadModal({ direction: 'out' })}>
              تحصيل لمحة (يدوي)
            </Btn>
            <Btn variant="accent" icon={<Upload size={14}/>} onClick={() => setUploadModal({ direction: 'in' })}>
              تحصيل شركة الشحن
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* Global COD outstanding across all carriers — company-wide view */}
          {globalOutstanding.total > 0.5 && (
            <div style={{
              marginBottom: 14, padding: '12px 16px', borderRadius: 11,
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--red) 12%, transparent), color-mix(in srgb, var(--red) 4%, transparent))',
              border: '1px solid var(--red)',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 20 }}>🏦</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  إجمالي COD المستحق غير المحصَّل — كل الناقلين
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 22, color: 'var(--red)' }}>
                  {fmt(globalOutstanding.total)} <span style={{ fontSize: 12, color: 'var(--muted)' }}>ر.س</span>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', lineHeight: 1.6 }}>
                موزَّع على <strong style={{ color: 'var(--text)' }}>{globalOutstanding.carriersDue}</strong> ناقل
                <br/>= متوقَّع (مُغذّى من المراجعات) − مُستلَم فعلياً
              </div>
            </div>
          )}

          {/* Headline metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Hero label="المتبقي عند الناقل" value={fmt(summary.outstandingAmount)}
              suffix="ر.س" hint={`${summary.outstandingCount} شحنة لم تُحوَّل`} color="var(--red)" big/>
            <Hero label="فروق تنتظر مراجعة" value={summary.pendingReviewCount}
              hint={`${fmt(summary.pendingReviewAmount)} ر.س قيمة الفروق`} color="var(--gold)"/>
            <Hero label="اعتراضات مفتوحة" value={summary.disputedCount}
              hint={summary.disputedCount > 0 ? `أقدم اعتراض: ${summary.oldestDisputeDays} يوم` : 'لا اعتراضات'}
              color="var(--gold)"/>
            {summary.overRemitAgedCount > 0
              ? <Hero label="🚨 تحويل وصل بلا تسوية تقابله" value={summary.overRemitAgedCount}
                  hint={`${fmt(summary.overRemitAgedAmount)} ر.س · مضى +30 يوم`} color="var(--red)"/>
              : <Hero label="مسوّاة" value={fmt(summary.matchedAmount)} suffix="ر.س"
                  hint={`${summary.matchedCount} شحنة من أصل ${rows.length}`} color="var(--green)"/>
            }
          </div>

          {/* Aging of outstanding (we paid merchant, carrier hasn't paid us yet) */}
          {summary.outstandingCount > 0 && (
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
                📅 منذ متى المبلغ متأخّر عند الشركة
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <AgingCard label="0–14 يوم"   color="var(--green)" {...aging.d0_14}/>
                <AgingCard label="15–30 يوم"  color="var(--gold)"  {...aging.d15_30}/>
                <AgingCard label="31–60 يوم"  color="var(--gold)"  {...aging.d31_60}/>
                <AgingCard label="+60 يوم"    color="var(--red)"   {...aging.d61}/>
              </div>
            </Card>
          )}

          {/* Aging of over_remit (carrier paid us, no matching outgoing yet) */}
          {summary.overRemitCount > 0 && (
            <Card style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--brand)', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>
                📥 أعمار الوارد بدون مقابل (من تاريخ تحويل الناقل)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <AgingCard label="0–30 يوم · طبيعي"   color="var(--brand)"   {...agingOver.d0_30}/>
                <AgingCard label="31–60 يوم · انتبه"  color="var(--gold)"   {...agingOver.d31_60}/>
                <AgingCard label="+60 يوم — تأكّد منه"    color="var(--red)" {...agingOver.d61}/>
              </div>
            </Card>
          )}

          {/* Uploads history — one row per file, with per-file totals so
              the user can see exactly which incoming file contributed
              which amount. Collapsible to keep the page compact. */}
          {uploads.length > 0 && (
            <Card style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
              <button onClick={() => setUploadsOpen(o => !o)}
                style={{
                  width: '100%', padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--surface)', border: 'none',
                  borderBottom: uploadsOpen ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', textAlign: 'right',
                }}>
                {uploadsOpen ? <ChevronDown size={16} color="var(--accent)"/> : <ChevronLeft size={16} color="var(--muted)"/>}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>
                  📑 الملفات المرفوعة ({uploads.length})
                </span>
                <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                  📥 {uploads.filter(u => u.direction === 'in').length} مُستلَم ·
                  {' '}📋 {uploads.filter(u => u.direction === 'out').length} متوقّع
                </span>
              </button>
              {uploadsOpen && (() => {
                // Split outbound vs inbound so each side gets its
                // own column with totals. Per-outbound file we also
                // show "unsettled" — shipments paid to the merchant
                // whose matching 'in' from the carrier hasn't arrived
                // yet. Per-inbound we show "matched vs over-remit".
                const outFiles = uploads.filter(u => u.direction === 'out');
                const inFiles  = uploads.filter(u => u.direction === 'in');
                const outTotal = outFiles.reduce((s, u) => s + u.amount, 0);
                const inTotal  = inFiles.reduce((s, u) => s + u.amount, 0);
                const outUnsettled = outFiles.reduce((s, u) => s + (u.unsettledAmount || 0), 0);

                const FileRow = ({ u }) => (
                  <div key={u.uploadId} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto auto',
                    gap: 10, alignItems: 'center',
                    padding: '10px 14px', borderBottom: '1px solid var(--border)22',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {(() => {
                          const src = String(u.sourceFile || '');
                          // Audit-driven batch — either direction, single chip.
                          if (src.startsWith('audit:') || src.includes(':auto-in')) {
                            return (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '1px 7px', borderRadius: 10,
                                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                                color: 'var(--accent)',
                                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                                fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }} title="مُستخرج تلقائياً من فاتورة الناقل المعتمَدة">
                                📋 من فاتورة الناقل
                              </span>
                            );
                          }
                          if (u.direction === 'out') {
                            return (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '1px 7px', borderRadius: 10,
                                background: 'var(--surface)',
                                color: 'var(--muted)',
                                border: '1px solid var(--border)',
                                fontSize: 9.5, fontFamily: 'var(--font-mono)', fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}>
                                🏢 من نظامكم الداخلي
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {renamingId === u.uploadId ? (
                          <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveRename(u); if (e.key === 'Escape') setRenamingId(null); }}
                            onClick={e => e.stopPropagation()}
                            placeholder="اسم ودّي للملف…"
                            style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--text)', minWidth: 200 }}/>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {u.label || u.sourceFile || '(بدون اسم ملف)'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        {u.uploadDate}
                        {u.label && u.sourceFile && (
                          <span style={{ marginInlineStart: 6, opacity: .8 }}>· {u.sourceFile}</span>
                        )}
                        {u.settlementRef && (
                          <span style={{ marginInlineStart: 6, fontFamily: 'var(--font-mono)' }}>· {u.settlementRef}</span>
                        )}
                      </div>
                      {u.direction === 'out' && u.unsettledCount > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--gold)', marginTop: 3, fontWeight: 600 }}>
                          ⏳ متبقّي {u.unsettledCount} شحنة · {fmt(u.unsettledAmount)} ر.س
                        </div>
                      )}
                      {u.direction === 'out' && u.unsettledCount === 0 && u.count > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--accent)', marginTop: 3, fontWeight: 600 }}>
                          ✓ مسوّى بالكامل
                        </div>
                      )}
                      {u.direction === 'in' && u.unsettledCount > 0 && (
                        <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 3, fontWeight: 600 }}>
                          ⚠ {u.unsettledCount} شحنة بلا مقابل متوقّع · {fmt(u.unsettledAmount)} ر.س
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 56 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>{u.count}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>شحنة</div>
                    </div>
                    <div style={{ textAlign: 'left', minWidth: 100 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: u.direction === 'in' ? 'var(--green)' : 'var(--text)' }}>
                        {fmt(u.amount)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>ر.س</div>
                    </div>
                    {renamingId === u.uploadId ? (
                      <>
                        <Btn size="sm" variant="accent" onClick={() => saveRename(u)} title="حفظ التسمية"><Check size={12}/></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setRenamingId(null)} title="إلغاء"><X size={12}/></Btn>
                      </>
                    ) : (
                      <Btn size="sm" variant="ghost"
                        onClick={() => { setRenamingId(u.uploadId); setRenameVal(u.label || ''); }}
                        title="تسمية ودّية للملف">
                        <Pencil size={12}/>
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost"
                      onClick={() => handleExportUpload(u)}
                      disabled={exportingUpload === u.uploadId}
                      title="تنزيل شحنات هذا الملف مع حالة كل شحنة في المطابقة">
                      {exportingUpload === u.uploadId ? <Spinner size={12}/> : <Download size={12}/>}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setConfirmDeleteUpload(u)} title="حذف الملف">
                      <Trash2 size={12}/>
                    </Btn>
                  </div>
                );

                const SectionHeader = ({ icon, label, color, files, total, extra }) => (
                  <div style={{
                    padding: '10px 14px',
                    background: `color-mix(in srgb, ${color} 8%, transparent)`,
                    borderTop: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)22',
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 999,
                      fontSize: 10.5, fontWeight: 700,
                      background: `color-mix(in srgb, ${color} 18%, transparent)`,
                      color, fontFamily: 'var(--font-sans)',
                    }}>
                      {icon} {label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {files.length} ملف
                    </span>
                    <span style={{ marginInlineStart: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color }}>
                      {fmt(total)} ر.س
                    </span>
                    {extra}
                  </div>
                );

                return (
                  <div className="m-flow" style={{ maxHeight: 420, overflowY: 'auto' }}>
                    {/* Outgoing section — what we EXPECT to receive from
                        the carrier. Sources: internal merchant-settlement
                        export, OR auto-extracted from an approved carrier
                        invoice (rows tagged with source_file='audit:...'). */}
                    {outFiles.length > 0 && (
                      <>
                        <SectionHeader
                          icon="📋" label="متوقّع من الناقل" color="var(--accent)"
                          files={outFiles} total={outTotal}
                          extra={outUnsettled > 0 && (
                            <span style={{ fontSize: 10.5, color: 'var(--gold)', fontWeight: 700 }}>
                              · متبقّي عند الناقل {fmt(outUnsettled)} ر.س
                            </span>
                          )}
                        />
                        {outFiles.map(u => <FileRow key={u.uploadId} u={u}/>)}
                      </>
                    )}
                    {/* Incoming section — actual cash carrier remitted to us. */}
                    {inFiles.length > 0 && (
                      <>
                        <SectionHeader
                          icon="📥" label="مُستلَم من الناقل" color="var(--green)"
                          files={inFiles} total={inTotal}
                        />
                        {inFiles.map(u => <FileRow key={u.uploadId} u={u}/>)}
                      </>
                    )}
                  </div>
                );
              })()}
            </Card>
          )}

          {/* Tabs */}
          <Card style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 0, padding: 6, background: 'var(--surface)', flexWrap: 'wrap' }}>
              <Tab id="outstanding" label="🔴 متبقّي"        n={counts.outstanding} active={tab} onClick={setTab}/>
              <Tab id="pending"     label="🟡 فروق"          n={counts.pending}     active={tab} onClick={setTab}/>
              <Tab id="disputed"    label="⚠️ اعتراضات"      n={counts.disputed}    active={tab} onClick={setTab}/>
              <Tab id="over"        label="🔵 مُستلَم بانتظار" n={counts.overRemit}   active={tab} onClick={setTab}/>
              <Tab id="matched"     label="✓ مسوّاة"         n={counts.matched}     active={tab} onClick={setTab}/>
              <Tab id="all"         label="الكل"             n={counts.all}         active={tab} onClick={setTab}/>
            </div>
            <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Search size={14} color="var(--muted)"/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="بحث برقم الشحنة (AWB)..."
                style={{ flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12, fontFamily: 'var(--font-mono)' }}/>
              {bulkSearch ? (
                <Btn size="sm" variant="primary" onClick={() => { setBulkSearch(null); setBulkText(''); }}
                  title="إلغاء البحث الجماعي">
                  📋 {bulkSearch.size} رقم · المطابق {filtered.length} ✕
                </Btn>
              ) : (
                <Btn size="sm" variant="ghost" onClick={() => setBulkModalOpen(true)}
                  title="الصق قائمة أرقام شحنات (من إكسل أو إيميل) للفلترة عليها كلها">
                  📋 بحث جماعي
                </Btn>
              )}
              <Btn
                size="sm" variant="ghost" icon={<Download size={13}/>}
                onClick={handleExportCurrentTab}
                disabled={!filtered.length}
                title={filtered.length
                  ? `تصدير ${filtered.length} شحنة من القسم الحالي إلى Excel`
                  : 'لا توجد شحنات في القسم الحالي'}
              >
                📥 تصدير القسم الحالي ({filtered.length})
              </Btn>
            </div>
          </Card>

          {/* Helpful explainer when looking at the over_remit tab — most of
              the time these aren't anomalies, they're just sequencing. */}
          {tab === 'over' && counts.overRemit > 0 && (
            <div style={{
              marginBottom: 12, padding: '10px 14px',
              background: 'color-mix(in srgb, var(--brand) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--brand) 35%, transparent)',
              borderRadius: 11, fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
            }}>
              💡 هذي شحنات استلمت تحويلها من الناقل ولم يطابقها أي AWB في تسوياتك الصادرة بعد.
              غالباً تسلسل رفع طبيعي — ارفع التسوية الصادرة من نظامكم وستتم المطابقة تلقائياً.
              {summary.overRemitAgedCount > 0 && (
                <div style={{ marginTop: 6, color: 'var(--red)', fontWeight: 600 }}>
                  ⚠️ منها {summary.overRemitAgedCount} شحنة بمبلغ {summary.overRemitAgedAmount.toFixed(2)} ر.س
                  مضى عليها +{30} يوم بدون مقابل — تحتاج تحقيق.
                </div>
              )}
            </div>
          )}

          {/* Table */}
          {/* Note filter + bulk-note bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {[['all','الكل'],['with','📝 عليها ملاحظة'],['without','بدون ملاحظة']].map(([k, l]) => (
              <button key={k} onClick={() => setNoteFilter(k)}
                style={{
                  padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                  border: '1px solid', borderColor: noteFilter === k ? 'var(--accent)' : 'var(--border)',
                  background: noteFilter === k ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  color: noteFilter === k ? 'var(--accent)' : 'var(--muted)',
                }}>{l}</button>
            ))}
            {selectedAwbs.size > 0 && (
              <>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginInlineStart: 'auto' }}>
                  {selectedAwbs.size} شحنة محددة
                </span>
                <Btn size="sm" variant="primary"
                  onClick={() => setActionModal({
                    kind: 'note',
                    bulkAwbs: [...selectedAwbs],
                    row: { awb: `${selectedAwbs.size} شحنة محددة`, diff: 0, notes: '' },
                  })}>
                  📝 ملاحظة على المحدد
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setSelectedAwbs(new Set())}>إلغاء</Btn>
              </>
            )}
          </div>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className="m-flow" style={{ maxHeight: 600, overflowY: 'auto' }}>
              {filtered.length === 0
                ? <Empty icon="✓" title="لا شيء في هذي الحالة" sub="غيّر التبويب أعلاه"/>
                : (
                  <table className="m-cards" style={{ fontSize: 12, width: '100%' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr>
                        <th style={{ width: 34, textAlign: 'center' }}>
                          <input type="checkbox"
                            checked={visible.length > 0 && visible.every(r => selectedAwbs.has(r.awb))}
                            onChange={() => setSelectedAwbs(prev => {
                              const next = new Set(prev);
                              const all = visible.every(r => next.has(r.awb));
                              for (const r of visible) { if (all) next.delete(r.awb); else next.add(r.awb); }
                              return next;
                            })}
                            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--accent)' }}/>
                        </th>
                        <th style={{ minWidth: 130 }}>AWB</th>
                        <th style={{ minWidth: 110 }}>دفعنا للمتجر</th>
                        <th style={{ minWidth: 110 }}>استلمنا من الناقل</th>
                        <th style={{ minWidth: 100 }}>الفرق</th>
                        <th style={{ minWidth: 110 }}>تاريخ الصادرة</th>
                        <th style={{ minWidth: 130 }}>الحالة</th>
                        <th style={{ minWidth: 240 }}>إجراء / ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(r => (
                        <Row key={r.awb} r={r} onAction={openAction} onReopen={reopenAction}
                          checked={selectedAwbs.has(r.awb)}
                          onToggle={() => setSelectedAwbs(prev => {
                            const next = new Set(prev);
                            if (next.has(r.awb)) next.delete(r.awb); else next.add(r.awb);
                            return next;
                          })}/>
                      ))}
                      {hasMore && (
                        <tr ref={sentinelRef}>
                          <td colSpan={7} style={{
                            padding: '14px 16px', textAlign: 'center',
                            color: 'var(--muted)', fontSize: 11.5,
                            fontFamily: 'var(--font-mono)',
                          }}>
                            تحميل المزيد… ({count.toLocaleString('en-US')} / {total.toLocaleString('en-US')})
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>
        </>
      )}

      {actionModal && (
        <ActionModal
          row={actionModal.row}
          kind={actionModal.kind}
          onClose={() => setActionModal(null)}
          onSubmit={submitAction}
        />
      )}

      {bulkModalOpen && (
        <Modal title="📋 بحث جماعي بأرقام الشحنات" onClose={() => setBulkModalOpen(false)} width={520}>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 0 }}>
            الصق قائمة أرقام (من إكسل أو إيميل) — أي فاصل يكفي: سطر جديد، مسافة، فاصلة…
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'291588270464\n291593017441\n…'}
            rows={8}
            autoFocus
            style={{
              width: '100%', padding: 10, borderRadius: 8, fontSize: 12,
              fontFamily: 'var(--font-mono)', direction: 'ltr',
              border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
              resize: 'vertical',
            }}
          />
          {(() => {
            const tokens = [...new Set(bulkText.split(/[\s,;،]+/).map(t => t.trim()).filter(t => t.length >= 4))];
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
                  {tokens.length ? `${tokens.length} رقم مميّز` : 'لم يُلصق شيء بعد'}
                </span>
                <Btn variant="primary" disabled={!tokens.length}
                  onClick={() => {
                    setBulkSearch(new Set(tokens));
                    setSearch('');
                    setBulkModalOpen(false);
                  }}>
                  فلترة على {tokens.length || ''} رقم
                </Btn>
                <Btn variant="ghost" onClick={() => setBulkModalOpen(false)}>إلغاء</Btn>
              </div>
            );
          })()}
        </Modal>
      )}

      {uploadModal && (
        <UploadModal
          direction={uploadModal.direction}
          carrier={carrier}
          preloadedFile={uploadModal.preloadedFile}
          sourceEventId={uploadModal.sourceEventId}
          onClose={() => setUploadModal(null)}
          onDone={() => { setUploadModal(null); refresh(); }}
          userId={user?.id}
        />
      )}

      {consolidated && (
        <Modal title="📦 رفع المتوقّع المجمّع — كل الشركات" onClose={() => setConsolidated(null)} width={580}>
          {consolidated.busy ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <Spinner size={22}/>
              <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>جارٍ التوزيع والحفظ لكل ناقل…</div>
            </div>
          ) : consolidated.result ? (() => {
            const { results, unmapped, stats } = consolidated.result;
            const labelOf = id => carriers.find(c => c.id === id)?.label || id;
            const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
            const totalDups  = results.reduce((s, r) => s + (r.dups || 0), 0);
            return (
              <>
                <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.8, marginBottom: 12 }}>
                  ✅ <b>تم التوصيل:</b> {stats.delivered} · 🔁 <b>مرتجع متجاهَل:</b> {stats.notDelivered} · 0️⃣ مبلغ صفر: {stats.zeroAmount}<br/>
                  ➕ <b>أُضيف جديد:</b> {totalAdded} · ⏭ <b>مكرّر متخطّى:</b> {totalDups}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ background: 'var(--surface2)', textAlign: 'right' }}>
                    {['الناقل', 'مُسلَّم', 'أُضيف', 'مكرّر', 'القيمة'].map(h => <th key={h} style={{ padding: '8px 10px', fontSize: 11, color: 'var(--muted)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.carrierId} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{labelOf(r.carrierId)}</td>
                        <td style={{ padding: '8px 10px' }}>{r.submitted}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--green)', fontWeight: 700 }}>{r.error ? '—' : r.added}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{r.dups || 0}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {results.some(r => r.error) && (
                  <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>⚠️ أخطاء: {results.filter(r => r.error).map(r => `${labelOf(r.carrierId)}: ${r.error}`).join(' · ')}</div>
                )}
                {unmapped.length > 0 && (
                  <div style={{ background: 'color-mix(in srgb, var(--gold) 8%, transparent)', color: 'var(--gold)', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 10 }}>
                    🏷️ شركات بلا ناقل مطابق (تُجوهلت): {unmapped.map(u => `${u.name} (${u.n}/${u.total})`).join(' · ')}
                  </div>
                )}
                <div style={{ marginTop: 14, textAlign: 'left' }}><Btn variant="primary" onClick={() => setConsolidated(null)}>تم</Btn></div>
              </>
            );
          })() : (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
                ارفع ملف «التحصيل المتوقّع» المجمّع من نظامك الداخلي. النظام يأخذ <b>«تم التوصيل» فقط + مبلغ&gt;0</b>، ويوزّعه على كل ناقل حسب عمود «شركة الشحن». <b>الموجود مسبقاً يُتخطّى تلقائياً</b> (لا تكرار، لا حذف).
              </div>
              <DropZone onFile={handleConsolidatedFile} title="اختر ملف Excel المجمّع"
                hint="يكفي وجود: شركة الشحن · حالة الطلب · المبلغ · رقم الشحنة (مهما كان الترتيب)"/>
            </>
          )}
        </Modal>
      )}

      {confirmDeleteUpload && (
        <Modal title="⚠️ حذف الملف" onClose={() => setConfirmDeleteUpload(null)} width={420}>
          <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 14 }}>
            سيتم حذف الملف <strong>{confirmDeleteUpload.sourceFile || `#${confirmDeleteUpload.uploadId.slice(0, 16)}`}</strong>
            {' '}({confirmDeleteUpload.count} صف، {fmt(confirmDeleteUpload.amount)} ر.س).
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
            هذا الإجراء يحذف فقط هذي الدفعة من السجل — أي مطابقات أُعتمدت أو نزاعات أُغلقت بناءً عليها قد تعود للحالة "غير مراجعة".
          </div>
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setConfirmDeleteUpload(null)}>إلغاء</Btn>
            <Btn variant="danger" onClick={() => handleDeleteUpload(confirmDeleteUpload.uploadId)}>تأكيد الحذف</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function Row({ r, onAction, onReopen, checked, onToggle }) {
  const meta = STATUS_META[statusKey(r)] ?? STATUS_META.matched;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysOpen = r.actionDate
    ? Math.floor((today - new Date(r.actionDate)) / 86400000)
    : 0;
  return (
    <tr style={checked ? { background: 'color-mix(in srgb, var(--accent) 6%, transparent)' } : undefined}>
      <td data-label="" style={{ textAlign: 'center' }}>
        <input type="checkbox" checked={!!checked} onChange={onToggle}
          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--accent)' }}/>
      </td>
      <td data-label="" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 11 }}>{r.awb}</td>
      <td data-label="دفعنا للمتجر" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {r.hasOut ? Number(r.paid).toFixed(2) : <span style={{ color: 'var(--muted)' }}>—</span>}
      </td>
      <td data-label="استلمنا من الناقل" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
        {r.hasIn ? Number(r.received).toFixed(2) : <span style={{ color: 'var(--muted)' }}>—</span>}
      </td>
      <td data-label="الفرق" style={{
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        color: Math.abs(r.diff) < 0.01 ? 'var(--green)' : (r.diff > 0 ? 'var(--red)' : 'var(--accent)'),
      }}>
        {r.diff > 0 ? '+' : ''}{Number(r.diff).toFixed(2)}
      </td>
      <td data-label="تاريخ الصادرة" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.firstOutDate || '—'}</td>
      <td data-label="الحالة">
        <span style={{
          background: `${meta.color}20`, border: `1px solid ${meta.color}40`,
          color: meta.color, fontSize: 10, fontWeight: 700,
          padding: '2px 8px', borderRadius: 12, fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
        }}>{meta.label}</span>
        {r.status === 'disputed' && daysOpen > 0 && (
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            مفتوح منذ {daysOpen} يوم
          </div>
        )}
      </td>
      <td data-label="إجراء / ملاحظات">
        {/* Mismatched diffs awaiting decision */}
        {r.status === 'pending_review' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Btn size="sm" variant="accent" onClick={() => onAction(r, 'approve')}>✓ اعتماد</Btn>
            <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'dispute')}>⚠️ اعتراض</Btn>
          </div>
        )}
        {/* Active dispute — show note + resolve/edit */}
        {r.status === 'disputed' && (
          <>
            {r.notes && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
                💬 {r.notes}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="accent" onClick={() => onAction(r, 'resolve')}>✓ تم الحل</Btn>
              <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'edit')}>✏️ تحديث</Btn>
            </div>
          </>
        )}
        {/* Approved/Resolved — show note + reopen */}
        {(r.status === 'approved' || r.status === 'resolved') && (
          <>
            {r.notes && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
                💬 {r.notes}
              </div>
            )}
            <Btn size="sm" variant="ghost" onClick={() => onReopen(r)}>↩ إعادة فتح</Btn>
          </>
        )}
        {r.status === 'outstanding' && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const days = r.firstOutDate
            ? Math.floor((today - new Date(r.firstOutDate)) / 86_400_000)
            : null;
          const ageColor = days == null ? 'var(--muted)'
            : days > 60 ? 'var(--red)' : days > 30 ? 'var(--gold)' : 'var(--muted)';
          return (
            <div>
              {r.notes && <NoteLine notes={r.notes}/>}
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                بانتظار التحويل من الناقل
              </div>
              {days != null && (
                <div style={{ fontSize: 10, color: ageColor, marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  ⏱ {days} يوم منذ التسوية
                </div>
              )}
              <NoteBtn r={r} onAction={onAction}/>
            </div>
          );
        })()}
        {r.status === 'over_remit' && (
          <>
            {r.notes && <NoteLine notes={r.notes}/>}
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
              مرّ {r.daysReceived ?? 0} يوم على الاستلام بدون مقابل
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="accent" onClick={() => onAction(r, 'approve')}>✓ اعتماد</Btn>
              <Btn size="sm" variant="ghost"  onClick={() => onAction(r, 'dispute')}>⚠️ اعتراض</Btn>
              <NoteBtn r={r} onAction={onAction} inline/>
            </div>
          </>
        )}
        {r.status === 'matched' && (
          <div>
            {r.notes ? <NoteLine notes={r.notes}/> : <span style={{ fontSize: 11, color: 'var(--green)' }}>—</span>}
            <NoteBtn r={r} onAction={onAction}/>
          </div>
        )}
      </td>
    </tr>
  );
}

// Inline note display (💬) — shown on any row that carries an accounting note.
function NoteLine({ notes }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
      💬 {notes}
    </div>
  );
}

// Neutral "add/edit accounting note" button — attaches a note for the
// accountant WITHOUT changing the row's reconciliation status.
function NoteBtn({ r, onAction, inline = false }) {
  return (
    <Btn size="sm" variant="ghost" onClick={() => onAction(r, 'note')}
      style={inline ? undefined : { marginTop: 6 }}>
      {r.notes ? '✏️ تعديل الملاحظة' : '📝 ملاحظة للمحاسبة'}
    </Btn>
  );
}

// ── ActionModal ────────────────────────────────────────────────────────
function ActionModal({ row, kind, onClose, onSubmit }) {
  const initialNotes = (kind === 'edit' || kind === 'resolve' || kind === 'note') ? (row.notes ?? '') : '';
  const [notes, setNotes] = useState(initialNotes);
  const titles = {
    approve: 'اعتماد الفرق', dispute: 'فتح اعتراض',
    resolve: 'إغلاق الاعتراض (تم الحل)', edit: 'تحديث ملاحظة الاعتراض',
    note: 'ملاحظة للمحاسبة',
  };
  const submit = () => {
    let status;
    if (kind === 'approve') status = 'approved';
    else if (kind === 'dispute' || kind === 'edit') status = 'disputed';
    else if (kind === 'resolve') status = 'resolved';
    else if (kind === 'note') status = 'note';
    // 'note' may be cleared (empty = remove). Others require text (except approve).
    if (kind !== 'approve' && kind !== 'note' && !notes.trim()) {
      toast('لازم تكتب ملاحظة', 'error');
      return;
    }
    onSubmit({ status, notes: notes.trim() || null });
  };
  return (
    <Modal title={titles[kind] || 'إجراء'} onClose={onClose} width={460}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        AWB: <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{row.awb}</span>
        {' · '}الفرق: <span style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          {row.diff > 0 ? '+' : ''}{Number(row.diff).toFixed(2)} ر.س
        </span>
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={kind === 'approve'
          ? 'سبب الاعتماد (اختياري)... مثلاً: فرق رسوم تحصيل، سبق مناقشته'
          : kind === 'resolve'
            ? 'وش حصل؟ (مطلوب)... مثلاً: أرامكس صحّحت وحوّلت 10 ر.س الناقصة بتاريخ ...'
            : kind === 'note'
              ? 'ملاحظة للمحاسبة (اتركها فارغة للحذف)... مثلاً: طُلب التحويل من الناقل بتاريخ ...، أو: راجَعها المحاسب'
              : 'تفاصيل الاعتراض (مطلوب)... مثلاً: تواصلت مع مدير حساب أرامكس بتاريخ ...'
        }
        rows={5}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
          fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.7,
        }}
      />
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        <Btn variant={kind === 'approve' || kind === 'resolve' ? 'accent' : 'primary'}
          onClick={submit}>تأكيد</Btn>
      </div>
    </Modal>
  );
}

// ── UploadModal ────────────────────────────────────────────────────────
export function UploadModal({ direction, carrier, onClose, onDone, userId, preloadedFile, sourceEventId }) {
  // Multi-file: each file produces its own preview (rows, dedup tags,
  // own filename). They're saved one-by-one, so each gets its own
  // upload_id and shows up as a separate row in the uploads strip.
  const [files, setFiles] = useState([]);             // File[]
  const [previews, setPreviews] = useState([]);       // [{ file, parserId, parserLabel, rows, newCount, inBatchDups, crossFileDups }]
  const [uploadDate, setUploadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [settlementRef, setSettlementRef] = useState('');
  const [busy, setBusy] = useState(false);

  const parseOne = async (f) => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const parser = direction === 'out'
      ? INTERNAL_PARSER
      : REMITTANCE_PARSERS[carrier];
    if (!parser) throw new Error(`لا يوجد parser للناقل ${carrier}`);

    const rows = [];
    const seenAcrossSheets = new Set();
    const sheetErrors = [];
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      // Some exporters (J&T's "WestBr..." statement is the worst
      // offender) ship the file with a stale !ref that covers only
      // the first dozen rows even though the sheet actually holds
      // hundreds. sheet_to_json honours !ref, so without this fix we
      // silently drop everything past row 12. Recompute the true
      // bounds from the cell addresses before reading.
      let mr = 0, mc = 0;
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue;
        const a = XLSX.utils.decode_cell(k);
        if (a.r > mr) mr = a.r;
        if (a.c > mc) mc = a.c;
      }
      if (mr > 0 || mc > 0) {
        ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:mr,c:mc} });
      }
      const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (!sheetRows.length) continue;
      try {
        const parsed = parser.parse(sheetRows);
        for (const r of parsed) {
          const key = String(r.awb).trim();
          if (seenAcrossSheets.has(key)) continue;
          seenAcrossSheets.add(key);
          rows.push(r);
        }
      } catch (sheetErr) {
        sheetErrors.push(`${sheetName}: ${sheetErr.message}`);
      }
    }
    if (!rows.length) {
      const detail = sheetErrors.length ? `\n${sheetErrors.join('\n')}` : '';
      throw new Error(`${f.name}: لم تُستخرج أي صفوف صالحة` + detail);
    }
    return { rows, parser };
  };

  const handleFiles = async (fileList) => {
    const list = Array.from(fileList || []).filter(Boolean);
    if (!list.length) return;
    setFiles(list);
    setBusy(true);
    const out = [];
    // Cross-file dedup runs across BOTH the prior DB ledger AND the
    // pending batches in this same upload session.
    const sessionAwbs = new Set();
    for (const f of list) {
      try {
        const { rows, parser } = await parseOne(f);

        // In-file dups
        const seenInFile = new Set();
        const inBatchDups = new Set();
        const fileUniqueAwbs = [];
        for (const r of rows) {
          const awb = String(r.awb).trim();
          if (!awb) continue;
          if (seenInFile.has(awb)) inBatchDups.add(awb);
          else {
            seenInFile.add(awb);
            fileUniqueAwbs.push(awb);
          }
        }
        // Cross-file dups: against DB + against previously-staged
        // files in this same multi-upload session.
        const dbExisting = await findDuplicateSettlementAwbs({
          carrierId: carrier, direction, awbs: fileUniqueAwbs,
        });

        const tagged = rows.map(r => {
          const awb = String(r.awb).trim();
          let tag = 'new';
          if (dbExisting.has(awb))    tag = 'cross_file';
          else if (sessionAwbs.has(awb)) tag = 'cross_file';
          return { ...r, awb, _dup: tag };
        });
        const seen2 = new Set();
        for (const r of tagged) {
          if (r._dup !== 'new') continue;
          if (seen2.has(r.awb)) r._dup = 'in_batch';
          else seen2.add(r.awb);
        }
        // Add this file's uniques to the session set so later files
        // in the same multi-upload don't double-count them.
        for (const r of tagged) {
          if (r._dup === 'new') sessionAwbs.add(r.awb);
        }

        out.push({
          file: f,
          parserId:      parser.id,
          parserLabel:   parser.label,
          rows:          tagged,
          newCount:      tagged.filter(r => r._dup === 'new').length,
          inBatchDups:   tagged.filter(r => r._dup === 'in_batch').length,
          crossFileDups: tagged.filter(r => r._dup === 'cross_file').length,
          total:         tagged.reduce((s, r) => s + r.amount, 0),
          error:         null,
        });
      } catch (e) {
        out.push({ file: f, error: e.message });
      }
    }
    setPreviews(out);
    setBusy(false);
  };

  // If a preloaded File was passed in (Webhook → "حفظ كتحصيل" flow),
  // feed it through handleFiles once on mount.
  useEffect(() => {
    if (preloadedFile) {
      handleFiles([preloadedFile]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-bind the rest of the component to the FIRST preview's data
  // when only one file is staged (keeps the single-file UX clean).
  const preview = previews.length === 1 ? previews[0] : null;
  const isMulti = previews.length > 1;
  const validPreviews = previews.filter(p => !p.error && p.rows?.length);
  const grandRows = validPreviews.reduce((s, p) => s + p.newCount, 0);
  const grandTotal = validPreviews.reduce((s, p) => s + (p.rows || []).filter(r => r._dup === 'new').reduce((a, r) => a + r.amount, 0), 0);

  // Save every staged file. Each file becomes its own upload_id row,
  // so the uploads strip lists them separately. The save loop runs
  // sequentially; aggregate counts feed the success toast.
  const handleSave = async () => {
    if (!previews.length) return;
    setBusy(true);
    let savedCount = 0;
    let skippedCount = 0;
    let ledgerErr = null;  // M2: التقط فشل قيد COD CR ليُعرَض للمستخدم
    const fileErrors = [];
    try {
      for (const p of previews) {
        if (p.error || !p.rows?.length) continue;
        const result = await saveSettlementUpload({
          direction, carrierId: carrier, rows: p.rows,
          uploadDate, sourceFile: p.file?.name,
          settlementRef: settlementRef.trim() || null,
          userId,
        });
        savedCount += result.count || 0;
        skippedCount += (result.inBatchDuplicates || 0) + (result.crossFileDuplicates || 0);
        if (result.ledgerError) ledgerErr = result.ledgerError;
      }
      if (savedCount === 0) {
        toast(`كل الصفوف مكررة — لم يُحفظ شيء (${skippedCount} متجاوَزة)`, 'error');
        setBusy(false);
        return;
      }
      const parts = [`تم حفظ ${savedCount} صف`];
      if (previews.length > 1) parts.push(`من ${previews.length} ملف`);
      if (skippedCount) parts.push(`تم تجاوز ${skippedCount} مكرّر`);
      if (settlementRef) parts.push(`تسوية #${settlementRef.trim()}`);
      toast(parts.join(' · '), skippedCount ? 'info' : 'success');
      if (ledgerErr) toast(`⚠️ حُفظت الشحنات لكن قيد COD في الدفتر فشل: ${ledgerErr} — راجع /integrity`, 'error');
      // Close the loop on a webhook → COD import: flip the source
      // event to 'processed' so the Webhook page swaps in the
      // "✓ تمت معالجته" badge instead of the import button.
      if (sourceEventId) {
        try {
          const { markEventProcessed } = await import('../lib/webhookService.js');
          await markEventProcessed(sourceEventId, null, userId || null);
        } catch (err) {
          console.warn('webhook event mark-processed (COD) failed:', err.message);
        }
      }
      onDone({
        savedCount,
        skippedCount,
        fileCount: previews.length,
        total: grandTotal,
        direction,
        carrier,
        uploadDate,
        fileNames: previews.map(p => p.file?.name).filter(Boolean),
      });
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    if (fileErrors.length) toast(fileErrors.join(' / '), 'warn');
    setBusy(false);
  };

  const isIn = direction === 'in';
  const carrierLabel = REMITTANCE_PARSERS[carrier]?.label || carrier;

  return (
    <Modal
      title={isIn
        ? `📥 تحصيل شركة الشحن · ${carrierLabel}`
        : `📋 تحصيل لمحة · ${carrierLabel}`}
      onClose={onClose} width={560}
    >
      {/* Carrier badge — keeps the destination carrier visible at all
          times so the user never wonders which carrier they're
          uploading against, especially when the modal was opened via
          the Webhook auto-import path. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', marginBottom: 14,
        background: isIn ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'rgba(122,130,196,.10)',
        border: `1px solid ${isIn ? 'color-mix(in srgb, var(--accent) 32%, transparent)' : 'var(--border2)'}`,
        borderRadius: 9, fontSize: 12,
      }}>
        <span style={{ fontSize: 16 }}>{isIn ? '📥' : '📋'}</span>
        <span style={{ color: 'var(--muted)' }}>
          {isIn ? 'تحصيل شركة الشحن من' : 'تحصيل لمحة لـ'}:
        </span>
        <strong style={{ color: 'var(--text)', fontSize: 13 }}>{carrierLabel}</strong>
        <span style={{
          marginInlineStart: 'auto',
          padding: '2px 8px', borderRadius: 9,
          background: 'var(--surface)', border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
        }}>
          {carrier}
        </span>
      </div>
      {previews.length === 0 && (
        <>
          <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            {isIn
              ? 'الملف من ' + (REMITTANCE_PARSERS[carrier]?.label || carrier) +
                ' — يجب أن يحتوي على عمودَي AWB و CollectedAmount.'
              : 'الملف من نظامكم الداخلي — يجب أن يحتوي على عمودَي "رقم الشحنة" و"إجمالي الاستحقاق".'
            }
          </div>
          <DropZone
            onFile={(files) => handleFiles(files)}
            accept=".xlsx,.xls"
            multi
            title="اسحب الملفات هنا"
            hint={<>تقدر تسحب أكثر من ملف مرة وحدة، أو <span style={{ color: 'var(--accent)', fontWeight: 600 }}>اضغط للاختيار</span></>}
          />
          {busy && <div style={{ marginTop: 10, textAlign: 'center' }}><Spinner size={16}/> جارٍ تحليل الملفات...</div>}
        </>
      )}
      {previews.length > 0 && (
        <>
          {/* Multi-file summary: one row per uploaded file with its
              own SAR total + dup tags. The single-file case still
              renders cleanly (just one row). */}
          <div style={{
            padding: '10px 14px', marginBottom: 12,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            borderRadius: 9, fontSize: 12,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
              ✓ تم تحليل {previews.length} {previews.length === 1 ? 'ملف' : 'ملفات'}
              {' · '}
              <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                {grandRows} صف جديد · {fmt(grandTotal)} ر.س
              </span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {previews.map((p, idx) => {
                const fileTotal = p.error ? 0 : (p.rows || []).reduce((s, r) => s + r.amount, 0);
                const newTotal  = p.error ? 0 : (p.rows || []).filter(r => r._dup === 'new').reduce((s, r) => s + r.amount, 0);
                return (
                  <div key={idx} style={{
                    display: 'grid', gridTemplateColumns: '1fr auto', gap: 10,
                    padding: '6px 10px',
                    background: p.error ? 'color-mix(in srgb, var(--red) 8%, transparent)' : 'var(--card)',
                    border: `1px solid ${p.error ? 'color-mix(in srgb, var(--red) 30%, transparent)' : 'var(--border)'}`,
                    borderRadius: 7,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.file.name}
                      </div>
                      {p.error ? (
                        <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 2 }}>✗ {p.error}</div>
                      ) : (
                        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                          {p.rows.length} صف
                          {p.inBatchDups > 0   && ` · 🔁 ${p.inBatchDups} مكرّر داخل الملف`}
                          {p.crossFileDups > 0 && ` · 📎 ${p.crossFileDups} مكرّر مع سابق`}
                          {p.newCount !== p.rows.length && ` · سيُحفظ ${p.newCount}`}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                      {!p.error && (
                        <>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                            {fmt(newTotal)}
                          </div>
                          <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>
                            {newTotal !== fileTotal ? `إجمالي الملف ${fmt(fileTotal)}` : 'ر.س'}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* In single-file mode keep the legacy dup warning for
              visual symmetry with the rest of the modal. Multi-file
              previews already show per-file dup counts above. */}
          {preview && !preview.error && (preview.inBatchDups > 0 || preview.crossFileDups > 0) && (
            <div style={{
              padding: '10px 14px', marginBottom: 12,
              background: 'color-mix(in srgb, var(--red) 8%, transparent)',
              border: '1px solid var(--red)',
              borderRadius: 9, fontSize: 12, lineHeight: 1.8,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
                ⚠️ كشف تكرار — سيتم تجاوز الصفوف المكررة عند الحفظ
              </div>
              {preview.inBatchDups > 0 && (
                <div style={{ color: 'var(--text)' }}>
                  🔁 <strong>{preview.inBatchDups}</strong> صف مكرّر داخل نفس الملف (نفس AWB أكثر من مرة)
                </div>
              )}
              {preview.crossFileDups > 0 && (
                <div style={{ color: 'var(--text)' }}>
                  📎 <strong>{preview.crossFileDups}</strong> صف موجود في ملف سابق لنفس الناقل في نفس الاتجاه
                </div>
              )}
              <div style={{ color: 'var(--green)', fontWeight: 700, marginTop: 4 }}>
                ✓ سيُحفظ {preview.newCount} صف جديد فقط
              </div>
            </div>
          )}
          <Input label="تاريخ التسوية" type="date" value={uploadDate}
            onChange={e => setUploadDate(e.target.value)}/>
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
            افتراضي = اليوم. عدّله إذا الملف يخصّ فترة سابقة.
          </div>
          <div style={{ marginTop: 12 }}>
            <Input label="رقم التسوية (اختياري)" value={settlementRef}
              onChange={e => setSettlementRef(e.target.value)}
              placeholder={direction === 'out' ? 'مثلاً: تسوية 18102026' : 'رقم الفاتورة/التحويل من الناقل'}/>
            <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
              يساعد على ربط التسوية بسجلاتك الداخلية أو فاتورة الناقل.
            </div>
          </div>
          {/* Single-file: show a peek of the rows. Multi-file: per-
              file summary above is the right level of detail and a
              giant row table would be overwhelming.
              When the parser failed for this file (preview.error set),
              preview.rows is undefined — show the error inline instead
              of crashing the render with a "Cannot read 'slice'" throw. */}
          {preview && preview.error && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              background: 'color-mix(in srgb, var(--red) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 32%, transparent)',
              borderRadius: 9, fontSize: 12, color: 'var(--text)', lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
                ⚠ تعذّر قراءة الملف
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                {preview.error}
              </div>
            </div>
          )}
          {preview && !preview.error && Array.isArray(preview.rows) && (
            <div style={{
              marginTop: 12, maxHeight: 200, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 9,
            }}>
              <table style={{ fontSize: 11, width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <tr><th>AWB</th><th style={{ textAlign: 'left' }}>المبلغ</th></tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((r, i) => {
                    const isDup = r._dup === 'in_batch' || r._dup === 'cross_file';
                    return (
                      <tr key={i} style={isDup ? { background: 'color-mix(in srgb, var(--red) 6%, transparent)' } : undefined}>
                        <td style={{ fontFamily: 'var(--font-mono)', color: isDup ? 'var(--red)' : 'var(--accent)' }}>
                          {r.awb}
                          {r._dup === 'in_batch' && (
                            <span style={{ marginRight: 6, fontSize: 9, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                              🔁 مكرّر داخل الملف
                            </span>
                          )}
                          {r._dup === 'cross_file' && (
                            <span style={{ marginRight: 6, fontSize: 9, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                              📎 مكرّر مع ملف سابق
                            </span>
                          )}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'left', color: isDup ? 'var(--muted)' : 'var(--text)', textDecoration: isDup ? 'line-through' : 'none' }}>
                          {r.amount.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                  {preview.rows.length > 50 && (
                    <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 10 }}>
                      +{preview.rows.length - 50} صف إضافية…
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
        {previews.length > 0 && (
          <Btn variant="accent" onClick={handleSave} disabled={busy || grandRows === 0}>
            {busy ? <Spinner size={13}/> : `تأكيد حفظ ${grandRows} صف${previews.length > 1 ? ` من ${previews.length} ملف` : ''}`}
          </Btn>
        )}
      </div>
    </Modal>
  );
}

// ── Bits ───────────────────────────────────────────────────────────────
function Tab({ id, label, n, active, onClick }) {
  const isActive = active === id;
  return (
    <button onClick={() => onClick(id)}
      style={{
        flex: 1, minWidth: 110,
        padding: '8px 12px', borderRadius: 7, border: 'none',
        background: isActive ? 'var(--card)' : 'transparent',
        color: isActive ? 'var(--text)' : 'var(--muted)',
        fontWeight: isActive ? 700 : 500, fontSize: 12, cursor: 'pointer',
        boxShadow: isActive ? '0 1px 4px rgba(0,0,0,.3)' : 'none',
      }}>
      {label} {n != null && <span style={{ opacity: 0.7, fontFamily: 'var(--font-mono)', fontSize: 10 }}>({n})</span>}
    </button>
  );
}

function Hero({ label, value, suffix, hint, color, big }) {
  return (
    <div className="stat-card" style={{
      background: 'var(--card)',
      borderRadius: 'var(--r-lg)', padding: '20px 24px',
      boxShadow: 'var(--shadow-sm)',
      '--sc-tone': color,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 11.5, fontWeight: 500 }}>
          {label}
        </span>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 14%, transparent)`,
        }}/>
      </div>
      <div style={{
        color, fontSize: big ? 28 : 24,
        fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap',
        letterSpacing: -0.6, lineHeight: 1,
      }}>
        {value}
        {suffix && <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 6, fontWeight: 500 }}> {suffix}</span>}
      </div>
      {hint && <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 8 }}>{hint}</div>}
    </div>
  );
}

function AgingCard({ label, count, amount, color }) {
  const dim = !count;
  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 'var(--r-lg)', padding: '14px 18px',
      boxShadow: 'var(--shadow-sm)',
      opacity: dim ? 0.5 : 1,
      transition: 'opacity .2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 500 }}>{label}</span>
        <span style={{
          minWidth: 22, height: 22, borderRadius: 999, paddingInline: 7,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
        }}>{count}</span>
      </div>
      <div style={{ color, fontSize: 17, fontFamily: 'var(--font-mono)', fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: -0.3 }}>
        {fmt(amount)}
        <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 5, fontWeight: 500 }}> ر.س</span>
      </div>
    </div>
  );
}
