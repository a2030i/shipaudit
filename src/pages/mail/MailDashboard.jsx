import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Spinner, Btn, toast } from '../../components/UI.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { getTasks, bulkAssignTasks, getAllSenders, getAllTaskIds, bulkDeleteTasks, getDeletedTasks, restoreTask, permanentDeleteTask, getAttachmentCounts } from '../../lib/mailService.js';
import { loadEmployees } from '../../lib/employeeService.js';

const STATUS = {
  unassigned:   { text: 'غير معيّن',       color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  analyzing:    { text: 'قيد التحليل',     color: '#a78bfa', bg: 'rgba(167,139,250,.12)' },
  pending_acc1: { text: 'بانتظار م. أول',  color: '#fbbf24', bg: 'rgba(251,191,36,.12)'  },
  pending_acc2: { text: 'بانتظار م. ثانٍ', color: '#fb923c', bg: 'rgba(251,146,60,.12)'  },
  approved_acc1:{ text: 'اعتمد م. أول',   color: '#34d399', bg: 'rgba(52,211,153,.12)'  },
  rejected_acc1:{ text: 'رفض م. أول',     color: '#f87171', bg: 'rgba(248,113,113,.12)' },
  approved:     { text: 'معتمد',           color: '#4ade80', bg: 'rgba(74,222,128,.12)'  },
  rejected:     { text: 'مرفوض',          color: '#f87171', bg: 'rgba(248,113,113,.12)' },
  not_financial:{ text: 'غير مالي',       color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
};

const PRIORITY = {
  low:    { color: '#475569', glow: false },
  normal: { color: '#38bdf8', glow: false },
  high:   { color: '#fbbf24', glow: false },
  urgent: { color: '#f87171', glow: true  },
};

const PAGE_SIZE = 100;
const getDomain = email => email.includes('@') ? email.split('@')[1] : email;

const PRIORITY_OPTIONS = [
  { value: 'all',    label: 'الكل',       color: 'var(--muted)' },
  { value: 'urgent', label: '🚨 عاجل',    color: '#f87171'      },
  { value: 'high',   label: '🔴 عالي',    color: '#fbbf24'      },
  { value: 'normal', label: '🔵 عادي',    color: '#38bdf8'      },
  { value: 'low',    label: '⚪ منخفض',   color: '#475569'      },
];
const SORT_OPTIONS = [
  { value: 'date_desc',     label: 'الأحدث أولاً'    },
  { value: 'date_asc',      label: 'الأقدم أولاً'    },
  { value: 'priority_desc', label: 'الأعلى أولوية'   },
];
const FINANCIAL_OPTIONS = [
  { value: 'all', label: 'الكل'      },
  { value: 'yes', label: '💰 مالي'   },
  { value: 'no',  label: '📋 غير مالي' },
];

export default function MailDashboard({ onSelectTask, onNewTask, refreshSignal }) {
  const { profile } = useAuth();
  const [tasks,        setTasks]        = useState([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(false);
  const [page,         setPage]         = useState(0);
  const [filter,       setFilter]       = useState('all');
  const [attachFilter, setAttachFilter] = useState('all');
  const [search,       setSearch]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Advanced filters
  const [showAdv,     setShowAdv]     = useState(false);
  const [priority,    setPriority]    = useState('all');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [assignedTo,  setAssignedTo]  = useState('all');
  const [isFinancial, setIsFinancial] = useState('all');
  const [sortBy,      setSortBy]      = useState('date_desc');
  const [allEmployees, setAllEmployees] = useState([]);

  // For non-admin: hide completed tasks by default
  const isAdmin = profile?.role === 'admin';
  const [showCompleted, setShowCompleted] = useState(false);

  const [showTrash, setShowTrash] = useState(false);

  // Quick filter chips
  const [readFilter,      setReadFilter]      = useState('all');
  const [sourceFilter,    setSourceFilter]    = useState('all');
  const [viewedFilter,    setViewedFilter]    = useState('all');
  const [senderEmails,    setSenderEmails]    = useState(new Set()); // multi-select
  const [allSenders,      setAllSenders]      = useState([]);
  const [showSenderMenu,  setShowSenderMenu]  = useState(false);
  const [senderSearch,    setSenderSearch]    = useState('');
  const [expandedDomains, setExpandedDomains] = useState(new Set());
  const [attachCounts,    setAttachCounts]    = useState({ excel: 1, pdf: 1, both: 1, none: 1 });

  // Bulk selection
  const [selectedIds,   setSelectedIds]   = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [employees,     setEmployees]     = useState([]);
  const [assigneeId,    setAssigneeId]    = useState('');
  const [assigning,     setAssigning]     = useState(false);
  const [selectingAll,  setSelectingAll]  = useState(false);
  const [bulkDeleting,  setBulkDeleting]  = useState(false);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);

  const activeFiltersCount = [
    priority     !== 'all',
    dateFrom     !== '',
    dateTo       !== '',
    assignedTo   !== 'all',
    isFinancial  !== 'all',
    sortBy       !== 'date_desc',
    readFilter      !== 'all',
    sourceFilter    !== 'all',
    senderEmails.size > 0 && senderEmails.size < allSenders.length,
    viewedFilter !== 'all',
  ].filter(Boolean).length;

  const resetAdvFilters = () => {
    setPriority('all'); setDateFrom(''); setDateTo('');
    setAssignedTo('all'); setIsFinancial('all'); setSortBy('date_desc');
    setReadFilter('all'); setSourceFilter('all'); setSenderEmails(new Set()); setViewedFilter('all');
  };

  // Debounce search
  const debounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const buildParams = useCallback((pg = 0) => ({
    page: pg, pageSize: PAGE_SIZE,
    attachFilter, search: debouncedSearch,
    priority, dateFrom, dateTo, assignedTo, isFinancial, sortBy,
    hideCompleted: !isAdmin && !showCompleted,
    readFilter, source: sourceFilter,
    statusFilter: filter,
    viewedFilter,
    // If all senders selected = no filter (avoids URL limit & count mismatch)
    senderEmails: senderEmails.size > 0 && senderEmails.size < allSendersLenRef.current ? [...senderEmails] : [],
  }), [attachFilter, debouncedSearch, priority, dateFrom, dateTo, assignedTo, isFinancial, sortBy, isAdmin, showCompleted, readFilter, sourceFilter, filter, viewedFilter, senderEmails]);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const { tasks: data, hasMore: more, total } = await getTasks(profile, buildParams(0));
      setTasks(data);
      setHasMore(more);
      setTotalCount(total);
      setPage(0);
    } catch (e) { toast(`خطأ في التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, [profile, buildParams]);

  const loadMore = async () => {
    if (!profile || loadingMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const { tasks: data, hasMore: more, total } = await getTasks(profile, buildParams(nextPage));
      setTasks(prev => [...prev, ...data]);
      setHasMore(more);
      setTotalCount(total);
      setPage(nextPage);
    } catch (e) { toast(`خطأ في التحميل: ${e.message}`, 'error'); }
    setLoadingMore(false);
  };

  useEffect(() => { load(); }, [load, refreshSignal]);

  // Load employees list for admin filters
  useEffect(() => {
    if (profile?.role === 'admin' && allEmployees.length === 0) {
      loadEmployees().then(setAllEmployees).catch(() => {});
    }
  }, [profile]);

  const allSendersLenRef = useRef(0);
  useEffect(() => { allSendersLenRef.current = allSenders.length; }, [allSenders]);

  const loadSenders = useCallback(() => {
    if (profile) getAllSenders(profile).then(setAllSenders).catch(() => {});
  }, [profile]);

  useEffect(() => { loadSenders(); }, [loadSenders]);

  useEffect(() => {
    if (profile) getAttachmentCounts(profile).then(setAttachCounts).catch(() => {});
  }, [profile]);

  // Group senders by domain
  const groupedSenders = useMemo(() => {
    const groups = new Map();
    for (const s of allSenders) {
      const domain = getDomain(s.email);
      if (!groups.has(domain)) groups.set(domain, { domain, senders: [], totalCount: 0 });
      groups.get(domain).senders.push(s);
      groups.get(domain).totalCount += s.count;
    }
    return [...groups.values()].sort((a, b) => b.totalCount - a.totalCount);
  }, [allSenders]);

  const filteredGroups = useMemo(() => {
    if (!senderSearch) return groupedSenders;
    const q = senderSearch.toLowerCase();
    return groupedSenders
      .map(g => ({
        ...g,
        senders: g.senders.filter(s =>
          s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || g.domain.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.senders.length > 0);
  }, [groupedSenders, senderSearch]);

  // Close sender dropdown on outside click
  useEffect(() => {
    if (!showSenderMenu) return;
    const handler = (e) => {
      if (!e.target.closest('[data-sender-menu]')) setShowSenderMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSenderMenu]);

  // Load employees when entering selection mode
  useEffect(() => {
    if (selectionMode) setEmployees(allEmployees);
  }, [selectionMode, allEmployees]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = async () => {
    setSelectingAll(true);
    try {
      const ids = await getAllTaskIds(profile, buildParams());
      setSelectedIds(new Set(ids));
    } catch {
      setSelectedIds(new Set(tasks.map(t => t.id)));
    }
    setSelectingAll(false);
  };
  const clearSelection = () => { setSelectedIds(new Set()); setSelectionMode(false); };

  const handleSelectTask = (id) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, is_read: true } : t));
    onSelectTask(id);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await bulkDeleteTasks([...selectedIds], profile.id);
      toast(`تم حذف ${selectedIds.size} إيميل ✓`, 'success');
      clearSelection();
      load();
      loadSenders();
    } catch (e) { toast(e.message, 'error'); }
    setBulkDeleting(false);
    setConfirmBulkDel(false);
  };

  const handleBulkAssign = async () => {
    if (!assigneeId || !selectedIds.size) return;
    setAssigning(true);
    try {
      await bulkAssignTasks([...selectedIds], assigneeId, profile.id);
      toast(`تم إسناد ${selectedIds.size} مهمة بنجاح`, 'success');
      clearSelection();
      load();
    } catch (e) { toast(e.message, 'error'); }
    setAssigning(false);
  };

  const filtered = filter === 'all'
    ? tasks
    : tasks.filter(t => t.status === filter);

  const unreadCount = tasks.filter(t => t.is_read === false).length;
  const stats = [
    { label: 'الكل',       value: totalCount,                                                color: '#38bdf8', icon: '📨' },
    { label: 'غير مقروء',  value: unreadCount,                                               color: '#38bdf8', icon: '🔵' },
    { label: 'معتمدة',     value: tasks.filter(t => t.status === 'approved').length,         color: '#4ade80', icon: '✅' },
    { label: 'عاجلة',      value: tasks.filter(t => t.priority === 'urgent').length,         color: '#f87171', icon: '🚨' },
  ];

  // Only show filter chips that have tasks (+ "all")
  const activeStatuses = Object.keys(STATUS).filter(s => tasks.some(t => t.status === s));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '16px 20px 0',
        background: 'var(--card)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(56,189,248,.2), rgba(56,189,248,.05))',
              border: '1px solid rgba(56,189,248,.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>📨</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>البريد المالي</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{totalCount}</span> إجمالي
                {tasks.length < totalCount && <span> · {tasks.length} محمّل</span>}
                {filtered.length !== tasks.length && <span> · {filtered.length} معروض</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => load()} disabled={loading} title="تحديث" style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border2)',
              background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              transition: 'all .15s',
            }}>
              {loading ? <Spinner size={12}/> : '↻'}
            </button>
            {isAdmin && (
              <button onClick={() => setShowTrash(true)} title="سلة المهملات" style={{
                width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border2)',
                background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                transition: 'all .15s',
              }}>🗑</button>
            )}
            {!isAdmin && (
              <button onClick={() => setShowCompleted(v => !v)} style={{
                fontSize: 11, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                background: showCompleted ? 'rgba(74,222,128,.1)' : 'var(--surface)',
                border: `1px solid ${showCompleted ? 'rgba(74,222,128,.3)' : 'var(--border2)'}`,
                color: showCompleted ? '#4ade80' : 'var(--muted)',
                transition: 'all .15s',
              }}>
                {showCompleted ? '✓ المنجزة' : 'المنجزة'}
              </button>
            )}
            {isAdmin && !selectionMode && (
              <Btn size="sm" variant="ghost" onClick={() => setSelectionMode(true)} style={{ gap: 5 }}>
                ☑ تحديد
              </Btn>
            )}
            {isAdmin && (
              <Btn size="sm" variant="primary" onClick={onNewTask} style={{ gap: 5 }}>
                + مهمة
              </Btn>
            )}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
          {stats.map(s => (
            <button key={s.label}
              onClick={() => setFilter(s.label === 'الكل' ? 'all' : filter)}
              style={{
                padding: '10px 8px', borderRadius: 10, cursor: 'default',
                background: `${s.color}0f`,
                border: `1px solid ${s.color}25`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'var(--font-mono)' }}>
                {s.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{
            position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--muted)', fontSize: 13, pointerEvents: 'none',
          }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالموضوع أو المرسل..."
            style={{
              width: '100%', padding: '8px 34px 8px 11px',
              borderRadius: 9, fontSize: 12, boxSizing: 'border-box',
              background: 'var(--surface)', border: '1px solid var(--border2)',
              color: 'var(--text)', outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13,
            }}>✕</button>
          )}
        </div>

        {/* Advanced filters toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={() => setShowAdv(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
            background: showAdv || activeFiltersCount > 0 ? 'rgba(56,189,248,.1)' : 'var(--surface)',
            border: `1px solid ${showAdv || activeFiltersCount > 0 ? 'rgba(56,189,248,.35)' : 'var(--border2)'}`,
            color: showAdv || activeFiltersCount > 0 ? 'var(--accent)' : 'var(--muted)',
            transition: 'all .15s',
          }}>
            <span>{showAdv ? '▲' : '▼'}</span>
            فلاتر متقدمة
            {activeFiltersCount > 0 && (
              <span style={{
                background: 'var(--accent)', color: '#000',
                borderRadius: 9, padding: '0 5px', fontSize: 10, fontWeight: 700,
              }}>{activeFiltersCount}</span>
            )}
          </button>
          {activeFiltersCount > 0 && (
            <button onClick={resetAdvFilters} style={{
              fontSize: 11, color: 'var(--red)', background: 'none',
              border: 'none', cursor: 'pointer', padding: '4px 6px',
            }}>✕ مسح الفلاتر</button>
          )}
        </div>

        {/* Advanced filters panel */}
        {showAdv && (
          <div style={{
            marginBottom: 12, padding: '14px 16px', borderRadius: 10,
            background: 'var(--bg)', border: '1px solid var(--border2)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>

            {/* Row 1: Priority + Financial + Sort */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <FilterGroup label="الأولوية">
                {PRIORITY_OPTIONS.map(o => (
                  <AdvChip key={o.value} active={priority === o.value}
                    color={o.color} onClick={() => setPriority(o.value)}>{o.label}</AdvChip>
                ))}
              </FilterGroup>

              <FilterGroup label="النوع">
                {FINANCIAL_OPTIONS.map(o => (
                  <AdvChip key={o.value} active={isFinancial === o.value}
                    color="var(--accent)" onClick={() => setIsFinancial(o.value)}>{o.label}</AdvChip>
                ))}
              </FilterGroup>

              <FilterGroup label="الترتيب">
                {SORT_OPTIONS.map(o => (
                  <AdvChip key={o.value} active={sortBy === o.value}
                    color="var(--accent)" onClick={() => setSortBy(o.value)}>{o.label}</AdvChip>
                ))}
              </FilterGroup>
            </div>

            {/* Row 2: Date range + Assigned to */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <FilterGroup label="من تاريخ">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={dateInputStyle}/>
              </FilterGroup>
              <FilterGroup label="إلى تاريخ">
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={dateInputStyle}/>
              </FilterGroup>
              {profile?.role === 'admin' && (
                <FilterGroup label="المعيّن له">
                  <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                    style={{ ...dateInputStyle, minWidth: 150 }}>
                    <option value="all">الكل</option>
                    <option value="unassigned">غير معيّن</option>
                    {allEmployees.filter(e => e.role !== 'admin').map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </FilterGroup>
              )}
            </div>
          </div>
        )}

        {/* Status filter chips */}
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 8,
          scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <Chip label="الكل" count={tasks.length} active={filter==='all'}
            color="var(--accent)" onClick={() => setFilter('all')}/>
          {activeStatuses.map(s => (
            <Chip key={s}
              label={STATUS[s].text}
              count={tasks.filter(t => t.status === s).length}
              active={filter === s}
              color={STATUS[s].color}
              onClick={() => setFilter(s === filter ? 'all' : s)}
            />
          ))}
        </div>

        {/* Attachment type filter chips */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', overflowX: 'auto', paddingBottom: 8,
          scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, paddingLeft: 2 }}>المرفق:</span>
          <Chip label="الكل" count={null} active={attachFilter==='all'}
            color="var(--muted)" onClick={() => setAttachFilter('all')}/>
          {attachCounts.excel > 0 && (
            <Chip label="📊 Excel" count={attachFilter==='excel' ? totalCount : null} active={attachFilter==='excel'}
              color="#4ade80" onClick={() => setAttachFilter(attachFilter==='excel' ? 'all' : 'excel')}/>
          )}
          {attachCounts.pdf > 0 && (
            <Chip label="📄 PDF" count={attachFilter==='pdf' ? totalCount : null} active={attachFilter==='pdf'}
              color="#f87171" onClick={() => setAttachFilter(attachFilter==='pdf' ? 'all' : 'pdf')}/>
          )}
          {attachCounts.both > 0 && (
            <Chip label="Excel+PDF" count={attachFilter==='both' ? totalCount : null} active={attachFilter==='both'}
              color="#a78bfa" onClick={() => setAttachFilter(attachFilter==='both' ? 'all' : 'both')}/>
          )}
          {attachCounts.none > 0 && (
            <Chip label="بدون مرفق" count={attachFilter==='none' ? totalCount : null} active={attachFilter==='none'}
              color="#94a3b8" onClick={() => setAttachFilter(attachFilter==='none' ? 'all' : 'none')}/>
          )}
        </div>

        {/* Read / Source filter chips */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', overflowX: 'auto', paddingBottom: 8,
          scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0, paddingLeft: 2 }}>القراءة:</span>
          <Chip label="الكل"    count={null} active={readFilter==='all'}    color="var(--muted)" onClick={() => setReadFilter('all')}/>
          <Chip label="🔵 غير مقروء" count={null} active={readFilter==='unread'} color="#38bdf8"      onClick={() => setReadFilter(readFilter==='unread' ? 'all' : 'unread')}/>
          <Chip label="✓ مقروء"    count={null} active={readFilter==='read'}   color="#4ade80"      onClick={() => setReadFilter(readFilter==='read' ? 'all' : 'read')}/>
          <div style={{ width: 1, height: 16, background: 'var(--border2)', flexShrink: 0, margin: '0 4px' }}/>
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>المصدر:</span>
          <Chip label="الكل"    count={null} active={sourceFilter==='all'}    color="var(--muted)" onClick={() => setSourceFilter('all')}/>
          <Chip label="📧 Gmail"  count={null} active={sourceFilter==='gmail'}  color="#38bdf8"      onClick={() => setSourceFilter(sourceFilter==='gmail' ? 'all' : 'gmail')}/>
          <Chip label="✏ يدوي"   count={null} active={sourceFilter==='manual'} color="#a78bfa"      onClick={() => setSourceFilter(sourceFilter==='manual' ? 'all' : 'manual')}/>
          {isAdmin && <>
            <div style={{ width: 1, height: 16, background: 'var(--border2)', flexShrink: 0, margin: '0 4px' }}/>
            <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>الفتح:</span>
            <Chip label="الكل"       count={null} active={viewedFilter==='all'}       color="var(--muted)"  onClick={() => setViewedFilter('all')}/>
            <Chip label="👁 تم الفتح"  count={null} active={viewedFilter==='viewed'}    color="#4ade80"       onClick={() => setViewedFilter(viewedFilter==='viewed'    ? 'all' : 'viewed')}/>
            <Chip label="🚫 لم يُفتح"  count={null} active={viewedFilter==='not_viewed'} color="#f87171"     onClick={() => setViewedFilter(viewedFilter==='not_viewed' ? 'all' : 'not_viewed')}/>
          </>}
        </div>

        {/* Senders dropdown */}
        {allSenders.length > 0 && (
          <div data-sender-menu style={{ position: 'relative', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>المرسلون:</span>
              <button onClick={() => setShowSenderMenu(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                background: senderEmails.size > 0 ? 'rgba(167,139,250,.12)' : 'var(--surface)',
                border: `1px solid ${senderEmails.size > 0 ? 'rgba(167,139,250,.4)' : 'var(--border2)'}`,
                color: senderEmails.size > 0 ? '#a78bfa' : 'var(--muted)',
                transition: 'all .15s',
              }}>
                🌐 {senderEmails.size > 0 && senderEmails.size < allSenders.length
                  ? `${senderEmails.size} مرسِل من ${groupedSenders.filter(g => g.senders.some(s => senderEmails.has(s.email))).length} نطاق`
                  : `كل النطاقات (${groupedSenders.length})`}
                <span style={{ fontSize: 9 }}>{showSenderMenu ? '▲' : '▼'}</span>
              </button>
              {senderEmails.size > 0 && senderEmails.size < allSenders.length && (
                <button onClick={() => setSenderEmails(new Set())} style={{
                  fontSize: 11, color: '#f87171', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '4px 4px',
                }}>✕ مسح</button>
              )}
            </div>

            {showSenderMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 100,
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.35)',
                width: 320, maxHeight: 360,
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                {/* Search */}
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <input
                    autoFocus
                    value={senderSearch}
                    onChange={e => setSenderSearch(e.target.value)}
                    placeholder="بحث بالاسم أو البريد..."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '6px 10px', borderRadius: 7, fontSize: 12,
                      background: 'var(--surface)', border: '1px solid var(--border2)',
                      color: 'var(--text)', outline: 'none',
                    }}
                  />
                </div>

                {/* Header row */}
                <div style={{
                  padding: '6px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', flexShrink: 0,
                }}>
                  <button onClick={() => {
                    const emails = filteredGroups.flatMap(g => g.senders.map(s => s.email));
                    setSenderEmails(new Set(emails));
                  }} style={{ fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    تحديد الكل
                  </button>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {groupedSenders.length} نطاق · {allSenders.length} مرسِل
                  </span>
                  <button onClick={() => setSenderEmails(new Set())} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    مسح الكل
                  </button>
                </div>

                {/* Domain-grouped list */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {filteredGroups.map(group => {
                    const { domain, senders, totalCount } = group;
                    const hasMultiple = senders.length > 1;
                    const isExpanded = expandedDomains.has(domain);
                    const allChecked = senders.every(s => senderEmails.has(s.email));
                    const someChecked = !allChecked && senders.some(s => senderEmails.has(s.email));

                    return (
                      <div key={domain}>
                        {/* Domain row */}
                        <div
                          onClick={() => setSenderEmails(prev => {
                            const next = new Set(prev);
                            if (allChecked) senders.forEach(s => next.delete(s.email));
                            else senders.forEach(s => next.add(s.email));
                            return next;
                          })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 14px', cursor: 'pointer',
                            background: allChecked ? 'rgba(56,189,248,.09)' : someChecked ? 'rgba(56,189,248,.04)' : 'transparent',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={e => { if (!allChecked && !someChecked) e.currentTarget.style.background = 'var(--surface)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = allChecked ? 'rgba(56,189,248,.09)' : someChecked ? 'rgba(56,189,248,.04)' : 'transparent'; }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                            border: `2px solid ${allChecked || someChecked ? '#38bdf8' : 'var(--border2)'}`,
                            background: allChecked ? '#38bdf8' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all .12s',
                          }}>
                            {allChecked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                            {someChecked && <span style={{ color: '#38bdf8', fontSize: 13, lineHeight: 1 }}>─</span>}
                          </div>
                          {/* Domain icon */}
                          <div style={{
                            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                            background: 'rgba(56,189,248,.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13,
                          }}>🌐</div>
                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12, fontWeight: 600,
                              color: allChecked || someChecked ? '#38bdf8' : 'var(--text)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>{domain}</div>
                            {!hasMultiple && senders[0].name !== senders[0].email && (
                              <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {senders[0].name}
                              </div>
                            )}
                            {hasMultiple && (
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{senders.length} مرسِل</div>
                            )}
                          </div>
                          {/* Count badge */}
                          <span style={{
                            flexShrink: 0, fontSize: 10, fontWeight: 600,
                            background: allChecked || someChecked ? 'rgba(56,189,248,.15)' : 'var(--surface)',
                            color: allChecked || someChecked ? '#38bdf8' : 'var(--muted)',
                            borderRadius: 10, padding: '1px 7px',
                            border: `1px solid ${allChecked || someChecked ? 'rgba(56,189,248,.3)' : 'var(--border2)'}`,
                          }}>{totalCount}</span>
                          {/* Expand arrow (only if multiple senders) */}
                          {hasMultiple && (
                            <span
                              onClick={e => {
                                e.stopPropagation();
                                setExpandedDomains(prev => {
                                  const next = new Set(prev);
                                  isExpanded ? next.delete(domain) : next.add(domain);
                                  return next;
                                });
                              }}
                              style={{
                                fontSize: 11, color: 'var(--muted)', flexShrink: 0,
                                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border2)',
                                cursor: 'pointer', transition: 'all .1s',
                              }}
                            >{isExpanded ? '▾' : '▸'}</span>
                          )}
                        </div>

                        {/* Individual senders (expanded or single) */}
                        {(!hasMultiple ? false : isExpanded) && senders.map(s => {
                          const checked = senderEmails.has(s.email);
                          return (
                            <div key={s.email}
                              onClick={() => setSenderEmails(prev => {
                                const next = new Set(prev);
                                checked ? next.delete(s.email) : next.add(s.email);
                                return next;
                              })}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 9,
                                padding: '6px 14px 6px 40px', cursor: 'pointer',
                                borderLeft: '2px solid rgba(167,139,250,.25)',
                                marginLeft: 14,
                                background: checked ? 'rgba(167,139,250,.07)' : 'transparent',
                                transition: 'background .1s',
                              }}
                              onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--surface)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = checked ? 'rgba(167,139,250,.07)' : 'transparent'; }}
                            >
                              <div style={{
                                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                border: `2px solid ${checked ? '#a78bfa' : 'var(--border2)'}`,
                                background: checked ? '#a78bfa' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all .12s',
                              }}>
                                {checked && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                              </div>
                              <div style={{
                                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                background: 'rgba(167,139,250,.12)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, color: '#a78bfa',
                              }}>
                                {(s.name[0] || '?').toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 11, fontWeight: checked ? 600 : 400,
                                  color: checked ? '#a78bfa' : 'var(--text)',
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>{s.name !== s.email ? s.name : s.email.split('@')[0]}</div>
                                {s.name !== s.email && (
                                  <div style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {s.email}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                flexShrink: 0, fontSize: 10, fontWeight: 600,
                                background: checked ? 'rgba(167,139,250,.2)' : 'var(--surface)',
                                color: checked ? '#a78bfa' : 'var(--muted)',
                                borderRadius: 10, padding: '1px 7px',
                                border: `1px solid ${checked ? 'rgba(167,139,250,.3)' : 'var(--border2)'}`,
                              }}>{s.count}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                <div style={{
                  padding: '8px 14px', borderTop: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
                }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {senderEmails.size > 0 ? `${senderEmails.size} محدد` : 'لم يُحدَّد شيء'}
                  </span>
                  <button onClick={() => setShowSenderMenu(false)} style={{
                    fontSize: 11, padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
                    background: 'var(--accent)', border: 'none', color: '#000', fontWeight: 600,
                  }}>تطبيق</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectionMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 16px', background: 'rgba(56,189,248,.07)',
          borderBottom: '1px solid rgba(56,189,248,.2)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, minWidth: 80 }}>
            {selectedIds.size} محدد
          </span>
          <button onClick={selectAll} disabled={selectingAll} style={{
            fontSize: 11, color: 'var(--muted)', background: 'none',
            border: '1px solid var(--border2)', borderRadius: 6,
            padding: '4px 10px', cursor: selectingAll ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {selectingAll ? <><Spinner size={10}/> جاري...</> : `تحديد الكل (${totalCount})`}
          </button>
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            style={{
              flex: 1, minWidth: 120, maxWidth: 200,
              background: 'var(--surface)', border: '1px solid var(--border2)',
              borderRadius: 7, padding: '5px 8px', fontSize: 12, color: 'var(--text)',
            }}
          >
            <option value="">اختر موظف...</option>
            {employees.filter(e => e.role !== 'admin').map(e => (
              <option key={e.id} value={e.id}>{e.name} — {e.role === 'accountant1' ? 'محاسب أول' : 'محاسب ثانٍ'}</option>
            ))}
          </select>
          <Btn size="sm" onClick={handleBulkAssign}
            disabled={!assigneeId || !selectedIds.size || assigning}>
            {assigning ? <Spinner size={12}/> : 'إسناد'}
          </Btn>
          {!confirmBulkDel ? (
            <button onClick={() => setConfirmBulkDel(true)} disabled={!selectedIds.size} style={{
              fontSize: 11, padding: '4px 11px', borderRadius: 6, cursor: 'pointer',
              background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.3)',
              color: '#f87171', marginRight: 4,
            }}>🗑 حذف</button>
          ) : (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginRight: 4 }}>
              <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>
                حذف {selectedIds.size} إيميل؟
              </span>
              <button onClick={handleBulkDelete} disabled={bulkDeleting} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'rgba(248,113,113,.2)', border: '1px solid rgba(248,113,113,.5)',
                color: '#f87171',
              }}>{bulkDeleting ? <Spinner size={10}/> : 'تأكيد'}</button>
              <button onClick={() => setConfirmBulkDel(false)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'none', border: '1px solid var(--border2)', color: 'var(--muted)',
              }}>لا</button>
            </div>
          )}
          <button onClick={clearSelection} style={{
            fontSize: 11, color: 'var(--muted)', background: 'none',
            border: 'none', cursor: 'pointer', padding: '4px 6px',
          }}>✕ إلغاء</button>
        </div>
      )}

      {/* ── Task list ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60 }}>
            <Spinner size={22}/>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>لا توجد مهام</div>
            <div style={{ fontSize: 12 }}>
              {search ? 'جرب كلمة بحث مختلفة' : 'لم يتم العثور على مهام بهذا الفلتر'}
            </div>
          </div>
        )}

        {!loading && filtered.map((task, i) => (
          <TaskRow
            key={task.id} task={task} index={i}
            selectionMode={selectionMode}
            selected={selectedIds.has(task.id)}
            onToggle={() => toggleSelect(task.id)}
            onSelect={() => selectionMode ? toggleSelect(task.id) : handleSelectTask(task.id)}
          />
        ))}

        {/* Load more */}
        {!loading && hasMore && filter === 'all' && (
          <div style={{ padding: '16px 20px', textAlign: 'center' }}>
            <button onClick={loadMore} disabled={loadingMore} style={{
              padding: '8px 24px', borderRadius: 8, cursor: 'pointer',
              background: 'var(--surface)', border: '1px solid var(--border2)',
              color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-sans)',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              {loadingMore ? <><Spinner size={12}/> جاري التحميل...</> : `⬇ تحميل المزيد (${tasks.length} محمّل)`}
            </button>
          </div>
        )}
      </div>

      {/* Trash panel */}
      {showTrash && (
        <TrashPanel profile={profile} onClose={() => setShowTrash(false)} onRestored={() => { load(); loadSenders(); }}/>
      )}
    </div>
  );
}

// ── Trash Panel ───────────────────────────────────────────────────────────────
function TrashPanel({ profile, onClose, onRestored }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState(null); // taskId being acted on

  const load = async () => {
    setLoading(true);
    try { setItems(await getDeletedTasks(profile)); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRestore = async (id) => {
    setActing(id);
    try {
      await restoreTask(id);
      setItems(prev => prev.filter(t => t.id !== id));
      onRestored();
      toast('تم الاسترجاع ✓', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setActing(null);
  };

  const handlePermanent = async (id) => {
    if (!confirm('حذف نهائي؟ لا يمكن التراجع.')) return;
    setActing(id);
    try {
      await permanentDeleteTask(id);
      setItems(prev => prev.filter(t => t.id !== id));
      toast('تم الحذف النهائي', 'success');
    } catch (e) { toast(e.message, 'error'); }
    setActing(null);
  };

  const tz = { timeZone: 'Asia/Riyadh' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 16, width: '100%', maxWidth: 640,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🗑 سلة المهملات</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {items.length} إيميل محذوف — يمكن الاسترجاع أو الحذف النهائي
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontSize: 20, padding: '0 4px',
          }}>✕</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <Spinner size={22}/>
            </div>
          )}
          {!loading && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✨</div>
              <div style={{ fontSize: 13 }}>سلة المهملات فارغة</div>
            </div>
          )}
          {!loading && items.map(task => (
            <div key={task.id} style={{
              padding: '12px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: 13, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {task.email_subject || '(بدون موضوع)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, display: 'flex', gap: 10 }}>
                  <span>{task.email_from}</span>
                  <span>·</span>
                  <span>حُذف {new Date(task.deleted_at).toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, ...tz })}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handleRestore(task.id)}
                  disabled={acting === task.id}
                  style={{
                    fontSize: 11, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                    background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)',
                    color: '#4ade80', fontWeight: 600,
                  }}>
                  {acting === task.id ? '...' : '↩ استرجاع'}
                </button>
                <button
                  onClick={() => handlePermanent(task.id)}
                  disabled={acting === task.id}
                  style={{
                    fontSize: 11, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                    background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.25)',
                    color: '#f87171',
                  }}>
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Advanced filter helpers ───────────────────────────────────────────────────
const dateInputStyle = {
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 7, padding: '5px 9px', fontSize: 11,
  color: 'var(--text)', outline: 'none', cursor: 'pointer',
};

function FilterGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function AdvChip({ active, color, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
      transition: 'all .12s', fontWeight: active ? 600 : 400,
      background: active ? `color-mix(in srgb,${color} 18%,transparent)` : 'var(--surface)',
      border: `1px solid ${active ? color + '55' : 'var(--border2)'}`,
      color: active ? color : 'var(--muted)',
    }}>{children}</button>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────────
function Chip({ label, count, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, padding: '5px 11px', borderRadius: 20,
      fontSize: 11, cursor: 'pointer', transition: 'all .15s',
      background: active ? `${color}20` : 'transparent',
      border: `1px solid ${active ? color + '50' : 'var(--border2)'}`,
      color: active ? color : 'var(--muted)',
      fontWeight: active ? 600 : 400,
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {label}
      {count > 0 && (
        <span style={{
          background: active ? color : 'var(--surface)',
          color: active ? '#000' : 'var(--muted)',
          borderRadius: 9, padding: '0px 5px', fontSize: 10, fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────
function TaskRow({ task, index, onSelect, selectionMode, selected, onToggle }) {
  const st = STATUS[task.status] || STATUS.unassigned;
  const pr = PRIORITY[task.priority] || PRIORITY.normal;
  const isUnread = task.is_read === false;

  const tz = { timeZone: 'Asia/Riyadh' };
  const dateStr = new Date(task.email_date || task.created_at)
    .toLocaleString('ar-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, ...tz });

  const unreadBg  = 'rgba(255,255,255,.045)';
  const selectedBg = 'rgba(56,189,248,.08)';

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '13px 20px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background .12s',
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: selected ? selectedBg : isUnread ? unreadBg : 'transparent',
        borderRight: isUnread ? '3px solid #38bdf8' : '3px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? selectedBg : isUnread ? unreadBg : 'transparent'; }}
    >
      {/* Checkbox (selection mode) or priority bar */}
      {selectionMode ? (
        <div style={{ flexShrink: 0, alignSelf: 'center', paddingTop: 2 }}
          onClick={e => { e.stopPropagation(); onToggle(); }}>
          <div style={{
            width: 18, height: 18, borderRadius: 5, border: `2px solid ${selected ? 'var(--accent)' : 'var(--border2)'}`,
            background: selected ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all .15s',
          }}>
            {selected && <span style={{ color: '#000', fontSize: 11, fontWeight: 700 }}>✓</span>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{
            width: 3, borderRadius: 3, flexShrink: 0,
            background: pr.color,
            boxShadow: pr.glow ? `0 0 6px ${pr.color}` : 'none',
            height: 40,
          }}/>
          {isUnread && (
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#38bdf8', boxShadow: '0 0 6px #38bdf8',
            }}/>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: subject + status + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{
            flex: 1,
            fontWeight: isUnread ? 700 : 400,
            fontSize: 13,
            color: isUnread ? 'var(--text)' : 'var(--muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {task.email_subject || '(بدون موضوع)'}
          </div>
          <span style={{
            flexShrink: 0, fontSize: 10, padding: '2px 9px', borderRadius: 20,
            background: st.bg, color: st.color, fontWeight: 600, border: `1px solid ${st.color}30`,
          }}>
            {st.text}
          </span>
          <span style={{
            flexShrink: 0, fontSize: 10, fontFamily: 'var(--font-mono)',
            color: isUnread ? 'var(--accent)' : 'var(--muted)',
            fontWeight: isUnread ? 600 : 400,
          }}>
            {dateStr}
          </span>
        </div>

        {/* Row 2: from + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200,
            color: isUnread ? 'var(--text)' : 'var(--muted)',
          }}>
            {task.email_from_name
              ? <><span style={{ fontWeight: isUnread ? 700 : 400 }}>{task.email_from_name}</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {task.email_from}</span></>
              : task.email_from}
          </span>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 'auto' }}>
            {task.has_excel && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(74,222,128,.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,.2)' }}>xlsx</span>}
            {task.has_pdf   && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(248,113,113,.1)', color: '#f87171', border: '1px solid rgba(248,113,113,.2)' }}>pdf</span>}
            {task.source === 'gmail' && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(56,189,248,.08)', color: 'var(--accent)', border: '1px solid rgba(56,189,248,.15)' }}>Gmail</span>}
            {task.assigned_profile?.name && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  background: task.assigned_profile.avatar_color || '#38bdf8',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, color: '#000', fontWeight: 700,
                }}>{task.assigned_profile.name[0]}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{task.assigned_profile.name}</span>
              </span>
            )}
          </div>
        </div>

        {/* Row 3: viewed indicator (admin) */}
        {task.last_viewed_at && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>👁</span>
            <span>آخر فتح: {new Date(task.last_viewed_at).toLocaleString('ar-SA', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh',
            })}</span>
          </div>
        )}

        {/* Row 4: summary or body preview */}
        {(task.ai_summary || task.email_body) && (
          <div style={{
            marginTop: 6, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {task.ai_summary
              ? <><span style={{ color: 'var(--accent)', marginLeft: 4 }}>✨</span>{task.ai_summary}</>
              : task.email_body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
            }
          </div>
        )}
      </div>
    </div>
  );
}
