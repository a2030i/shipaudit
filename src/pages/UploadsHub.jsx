// "مركز الرفع" — one screen to drop any snapshot file.
//
// Every snapshot type in the system has its own page (mostly for
// browsing the data). Operators were complaining they had to hop
// between 5+ pages every cycle just to upload the periodic files.
// This page consolidates the upload action — one screen, one
// upload per card, and a clear "last upload was X days ago" per
// source so nobody forgets a file.
//
// Backed by uploadsHubService.loadUploadsOverview() (one round-trip
// fan-out across the 5 sources) and uploadFile() (unified dispatcher).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  RefreshCw, Upload, FileSpreadsheet, ExternalLink, Inbox,
  CheckCircle2, AlertTriangle, Calendar, ChevronLeft, Building2, FileText, Banknote, Sparkles, HelpCircle,
} from 'lucide-react';
import {
  Card, Btn, Spinner, Empty, Modal, toast, PageHeader, DropZone,
} from '../components/UI.jsx';
import { useAuth } from '../lib/auth.jsx';
import { UPLOAD_SOURCES, ORIGIN_BADGES, loadUploadsOverview, uploadFile, detectFileSource } from '../lib/uploadsHubService.js';

const fmtRel = (iso) => {
  if (!iso) return 'لم يُرفع بعد';
  const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7)   return `قبل ${days} أيام`;
  if (days < 30)  return `قبل ${Math.floor(days / 7)} أسابيع`;
  if (days < 365) return `قبل ${Math.floor(days / 30)} شهور`;
  return `قبل ${Math.floor(days / 365)} سنوات`;
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
};

export default function UploadsHub({ isActive = true }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [busy,    setBusy]    = useState({});  // { sourceId: true } while uploading
  const [picker,  setPicker]  = useState(null); // { file, detection } when auto-detect fails

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setSources(await loadUploadsOverview()); }
    catch (e) { toast(`فشل التحميل: ${e.message}`, 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isActive) refresh(); }, [isActive, refresh, location.pathname]);

  const handleUpload = async (sourceId, file) => {
    setBusy(b => ({ ...b, [sourceId]: true }));
    try {
      const result = await uploadFile({ sourceId, file, userId: profile?.id || null });
      toast(`✓ ${result.message}`, 'success');
      await refresh();
    } catch (e) {
      toast(`فشل: ${e.message}`, 'error');
    }
    setBusy(b => { const n = { ...b }; delete n[sourceId]; return n; });
  };

  // Smart drop — runs detector first; if confident, uploads to the
  // detected source; otherwise opens a picker modal so the operator
  // can choose manually. The file is read once here so the modal
  // doesn't need to re-read it on confirmation.
  const handleSmartDrop = async (file) => {
    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const detection = detectFileSource(rows);
      if (detection?.sourceId && detection.confidence >= 0.85) {
        toast(`اكتُشف نوع الملف: ${UPLOAD_SOURCES.find(s => s.id === detection.sourceId)?.label}`, 'info');
        await handleUpload(detection.sourceId, file);
      } else {
        setPicker({ file, detection });
      }
    } catch (e) {
      toast(`تعذّر فحص الملف: ${e.message}`, 'error');
    }
  };

  const handlePickerConfirm = async (sourceId) => {
    if (!picker) return;
    const file = picker.file;
    setPicker(null);
    await handleUpload(sourceId, file);
  };

  // Summary at top: how many sources are fresh / stale / missing
  const summary = useMemo(() => {
    let fresh = 0, stale = 0, missing = 0;
    for (const s of sources) {
      if (!s.last)       missing++;
      else if (s.stale)  stale++;
      else               fresh++;
    }
    return { fresh, stale, missing };
  }, [sources]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <Spinner size={28}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHeader
        icon={<Inbox size={22}/>}
        iconColor="#0EA5E9"
        title="مركز الرفع"
        subtitle="ارفع كل الملفات الدورية من مكان واحد — كل بطاقة تعرض آخر رفع وحالته"
        actions={
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13}/>} onClick={refresh}>
            تحديث
          </Btn>
        }
      />

      {/* Summary strip */}
      <div style={{
        display: 'grid', gap: 12, marginBottom: 20,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}>
        <SummaryStat
          label="حديثة"
          value={summary.fresh}
          icon={<CheckCircle2 size={16}/>}
          color="#10B981"
          hint="رُفعت ضمن الفترة المتوقّعة"
        />
        <SummaryStat
          label="متأخّرة"
          value={summary.stale}
          icon={<AlertTriangle size={16}/>}
          color="#F59E0B"
          hint="تجاوزت الدورة المعتادة"
        />
        <SummaryStat
          label="لم تُرفع"
          value={summary.missing}
          icon={<Upload size={16}/>}
          color="#DC2626"
          hint="لا يوجد سجل سابق"
        />
        <SummaryStat
          label="الإجمالي"
          value={sources.length}
          icon={<FileSpreadsheet size={16}/>}
          color="#0EA5E9"
          hint="أنواع الملفات الدورية"
        />
      </div>

      {/* Hero drop zone — auto-detects the file type. The 5 cards
          below still have their own drop zones for cases where the
          operator wants to force the type or detection isn't
          confident. */}
      <Card style={{
        marginBottom: 20,
        background: 'linear-gradient(135deg, color-mix(in srgb, #0EA5E9 8%, transparent), color-mix(in srgb, #8B5CF6 6%, transparent))',
        border: '2px dashed color-mix(in srgb, #0EA5E9 35%, transparent)',
        padding: 22,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <span style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'color-mix(in srgb, #0EA5E9 16%, transparent)',
            color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={22}/>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
              ارفع أي ملف — النظام يكتشف نوعه تلقائياً
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
              العملاء (Zoho) · الموردون (Zoho) · متاجر المنصّة · استحقاق المتاجر · كشف فواتير العملاء —
              ندرّب الكاشف على بصمات الأعمدة والعناوين، ولو ما عرف نسأل عنه.
            </div>
          </div>
        </div>
        <DropZone onFile={handleSmartDrop} accept=".xlsx,.xls,.csv">
          <Upload size={16}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>اسحب الملف هنا — يكفي ملف واحد</span>
        </DropZone>
      </Card>

      {/* Section: snapshot uploads */}
      <SectionTitle icon={<FileSpreadsheet size={14}/>} color="#3B82F6">
        ملفات Snapshot — حالة كل نوع
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 14, marginBottom: 24,
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      }}>
        {sources.map(src => (
          <UploadSourceCard
            key={src.id}
            source={src}
            busy={!!busy[src.id]}
            onUpload={(file) => handleUpload(src.id, file)}
            onNavigate={() => navigate(src.link)}
          />
        ))}
      </div>

      {/* Section: workflow shortcuts (uploads that have their own
          multi-step pages — not appropriate to inline-upload here). */}
      <SectionTitle icon={<ExternalLink size={14}/>} color="#8B5CF6">
        ملفات متخصّصة — لها صفحات خاصة
      </SectionTitle>
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        <ShortcutCard
          icon={<FileText size={18}/>}
          color="#10B981"
          title="مراجعة فاتورة شركة شحن"
          subtitle="رفع فاتورة من شركة شحن وتدقيقها مع العقد"
          onClick={() => navigate('/upload')}
        />
        <ShortcutCard
          icon={<Banknote size={18}/>}
          color="#F59E0B"
          title="ملف تحصيل COD"
          subtitle="رفع ملف تحصيل من شركة شحن أو تحويل بنكي"
          onClick={() => navigate('/cod-settlements')}
        />
        <ShortcutCard
          icon={<Building2 size={18}/>}
          color="#0EA5E9"
          title="كشف بنكي"
          subtitle="رفع كشف الحساب البنكي لتطبيق على الحركات"
          onClick={() => navigate('/bank')}
        />
        <ShortcutCard
          icon={<FileText size={18}/>}
          color="#8B5CF6"
          title="كشف حساب شركة شحن"
          subtitle="رفع كشف خارجي من شركة شحن للمطابقة"
          onClick={() => navigate('/aramex-statements')}
        />
      </div>

      {/* Manual type picker — opens when auto-detect couldn't confidently
          identify the file. The user picks; we upload with their choice. */}
      {picker && (
        <TypePickerModal
          file={picker.file}
          detection={picker.detection}
          onCancel={() => setPicker(null)}
          onConfirm={handlePickerConfirm}
        />
      )}
    </div>
  );
}

function TypePickerModal({ file, detection, onCancel, onConfirm }) {
  return (
    <Modal title="ما عرفنا نوع الملف — اختر النوع بنفسك" onClose={onCancel} width={620}>
      <div style={{ padding: '4px 4px 0' }}>
        {/* File info banner */}
        <div style={{
          padding: 12, marginBottom: 14, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--muted)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <FileSpreadsheet size={16} color="#0EA5E9"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {file?.name}
            </div>
            <div style={{ marginTop: 2 }}>
              {(file?.size / 1024).toFixed(1)} KB
              {detection?.sourceId && (
                <span style={{ marginInlineStart: 10, color: '#F59E0B' }}>
                  · أقرب احتمال: {UPLOAD_SOURCES.find(s => s.id === detection.sourceId)?.label}
                  {detection.confidence != null && ` (${Math.round(detection.confidence * 100)}%)`}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.7 }}>
          <HelpCircle size={12} style={{ display: 'inline', marginInlineEnd: 5, verticalAlign: 'middle' }}/>
          اختر النوع الصحيح وسنرفع الملف للجدول المناسب. إذا الكاشف يكرّر الخطأ على نفس النوع، ابعت لي عيّنة وأضبط البصمة.
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {UPLOAD_SOURCES.map(src => (
            <button key={src.id} onClick={() => onConfirm(src.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', cursor: 'pointer',
              border: `1.5px solid ${detection?.sourceId === src.id ? src.accent : 'var(--border)'}`,
              borderRadius: 10,
              background: detection?.sourceId === src.id
                ? `color-mix(in srgb, ${src.accent} 8%, transparent)`
                : 'var(--surface)',
              textAlign: 'right',
              fontFamily: 'var(--font-sans)',
              transition: 'all .12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = src.accent; }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = detection?.sourceId === src.id ? src.accent : 'var(--border)';
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8,
                background: `color-mix(in srgb, ${src.accent} 14%, transparent)`,
                color: src.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <FileSpreadsheet size={15}/>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{src.label}</span>
                  {ORIGIN_BADGES[src.origin] && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                      background: `color-mix(in srgb, ${ORIGIN_BADGES[src.origin].color} 14%, transparent)`,
                      color: ORIGIN_BADGES[src.origin].color, letterSpacing: .4,
                    }}>
                      من {ORIGIN_BADGES[src.origin].label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{src.subtitle}</div>
              </div>
              {detection?.sourceId === src.id && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: `color-mix(in srgb, ${src.accent} 16%, transparent)`,
                  color: src.accent,
                }}>
                  مقترح
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn size="md" variant="ghost" onClick={onCancel}>إلغاء</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── subcomponents ─────────────────────────────────────────────
function SectionTitle({ icon, color, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
    }}>
      <span style={{
        width: 24, height: 24, borderRadius: 7,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{children}</span>
    </div>
  );
}

function SummaryStat({ label, value, icon, color, hint }) {
  return (
    <Card style={{
      padding: 14,
      background: `color-mix(in srgb, ${color} 5%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: .4 }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: 'var(--font-mono)', letterSpacing: -0.5 }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>
    </Card>
  );
}

function UploadSourceCard({ source, busy, onUpload, onNavigate }) {
  const { last, stale, daysSince, accent, origin } = source;
  // Status indicator — green/amber/red based on freshness
  const statusColor = !last ? '#DC2626' : stale ? '#F59E0B' : '#10B981';
  const statusLabel = !last ? 'لم يُرفع بعد'
                    : stale ? `متأخّر — ${daysSince} يوم`
                    : `حديث — ${fmtRel(last.lastAt)}`;
  const originBadge = ORIGIN_BADGES[origin];
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <FileSpreadsheet size={16}/>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{source.label}</span>
            {originBadge && (
              <span style={{
                fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                background: `color-mix(in srgb, ${originBadge.color} 14%, transparent)`,
                color: originBadge.color, letterSpacing: .4,
                whiteSpace: 'nowrap',
              }}>
                من {originBadge.label}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{source.subtitle}</div>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
          background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
          color: statusColor, fontSize: 10.5, fontWeight: 700,
          flexShrink: 0,
        }}>
          {!last ? <Upload size={10}/> : stale ? <AlertTriangle size={10}/> : <CheckCircle2 size={10}/>}
          {statusLabel}
        </span>
      </div>

      {/* Last-upload metadata */}
      {last ? (
        <div style={{
          padding: 10, borderRadius: 8,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7,
        }}>
          <div>
            <Calendar size={11} style={{ display: 'inline', marginInlineEnd: 5, verticalAlign: 'middle' }}/>
            {fmtDateTime(last.lastAt)}
            {last.fileName && (
              <span style={{ marginInlineStart: 8, color: 'var(--muted2)' }}>·</span>
            )}
            {last.fileName && (
              <span style={{ marginInlineStart: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                {last.fileName}
              </span>
            )}
          </div>
          <div style={{ marginTop: 4, color: 'var(--text2)', fontWeight: 600 }}>
            {last.rowCount.toLocaleString('ar-SA')} صف
            {last.matchedCount != null && ` · ${last.matchedCount.toLocaleString('ar-SA')} مطابق`}
            {last.total != null && ` · إجمالي ${Number(last.total).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س`}
          </div>
        </div>
      ) : (
        <div style={{
          padding: 10, borderRadius: 8,
          background: 'color-mix(in srgb, #DC2626 5%, transparent)',
          border: '1px dashed color-mix(in srgb, #DC2626 30%, transparent)',
          fontSize: 11.5, color: '#DC2626', textAlign: 'center', fontWeight: 600,
        }}>
          لم يُرفع أي ملف بعد — ابدأ بالرفع الأول
        </div>
      )}

      {/* Drop zone */}
      {busy ? (
        <div style={{
          padding: 18, borderRadius: 8, textAlign: 'center',
          background: 'var(--surface2)', border: '1px solid var(--border)',
        }}>
          <Spinner size={20}/>
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>جارٍ المعالجة…</div>
        </div>
      ) : (
        <DropZone onFile={onUpload} accept=".xlsx,.xls,.csv">
          <Upload size={14}/>
          <span style={{ fontSize: 12 }}>اسحب الملف هنا أو اضغط للاختيار</span>
        </DropZone>
      )}

      {/* Drill-in link */}
      <button
        onClick={onNavigate}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 8px', background: 'transparent', border: 'none',
          color: 'var(--muted)', fontSize: 11, cursor: 'pointer',
          fontFamily: 'var(--font-sans)', alignSelf: 'flex-start',
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = accent}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
      >
        افتح الصفحة المرتبطة
        <ChevronLeft size={11}/>
      </button>
    </Card>
  );
}

function ShortcutCard({ icon, color, title, subtitle, onClick }) {
  return (
    <Card
      onClick={onClick}
      hover
      style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 36, height: 36, borderRadius: 9,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>
        </div>
        <ChevronLeft size={14} color="var(--muted2)"/>
      </div>
    </Card>
  );
}
