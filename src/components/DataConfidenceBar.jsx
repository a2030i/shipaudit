import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, RefreshCw, CheckCircle2, AlertTriangle, Clock3, ExternalLink } from 'lucide-react';
import { Btn, Spinner } from './UI.jsx';
import { loadZohoWebhookHealth } from '../lib/pnlService.js';

function agoAr(iso) {
  if (!iso) return 'غير متوفر';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${min} د`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

function healthTone(health) {
  if (!health) return { color: 'var(--muted)', label: 'جار فحص الربط', icon: Clock3 };
  const fresh = health.webhookLastAt && (Date.now() - new Date(health.webhookLastAt).getTime()) < 6 * 3600_000;
  if (fresh) return { color: 'var(--green)', label: 'زوهو حي', icon: CheckCircle2 };
  if (health.webhookReady) return { color: 'var(--gold)', label: 'الربط جاهز، التحديث قديم', icon: AlertTriangle };
  return { color: 'var(--muted)', label: 'بانتظار أول تحديث', icon: Clock3 };
}

export default function DataConfidenceBar({
  active = true,
  sourceLabel = 'زوهو بوكس (مباشر)',
  snapshotMeta = null,
  note = 'الأرقام في هذه الشاشة تقرأ من زوهو مباشرة، والتحديث من هنا يغنيك عن الرجوع لصفحة زوهو.',
  canSync = false,
  syncing = false,
  refreshing = false,
  onSync = null,
  onRefresh = null,
  sourcePath = '/zoho-data',
}) {
  const navigate = useNavigate();
  const [health, setHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const reloadHealth = useCallback(async () => {
    if (!active) return;
    setLoadingHealth(true);
    try { setHealth(await loadZohoWebhookHealth()); }
    finally { setLoadingHealth(false); }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    reloadHealth();
    const timer = setInterval(reloadHealth, 60_000);
    return () => clearInterval(timer);
  }, [active, reloadHealth]);

  const syncAndReload = async () => {
    if (!onSync) return;
    await onSync();
    await reloadHealth();
  };

  const tone = healthTone(health);
  const ToneIcon = tone.icon;

  return (
    <div className="data-confidence" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
      margin: '-12px 0 18px',
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div className="data-confidence__main" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 420px' }}>
        <div className="data-confidence__icon" style={{
          width: 34, height: 34, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: tone.color,
          background: `color-mix(in srgb, ${tone.color} 10%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone.color} 24%, var(--border))`,
          flexShrink: 0,
        }}>
          {loadingHealth ? <Spinner size={15}/> : <ToneIcon size={17}/>}
        </div>
        <div className="data-confidence__copy" style={{ minWidth: 0 }}>
          <div className="data-confidence__headline" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span className="data-confidence__status" style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{tone.label}</span>
            <span className="data-confidence__source" style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Database size={12}/> {sourceLabel}
            </span>
            {snapshotMeta && (
              <span className="data-confidence__snapshot" style={{ fontSize: 10.5, color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>{snapshotMeta}</span>
            )}
          </div>
          <div className="data-confidence__detail" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
            آخر تحديث: <b style={{ color: 'var(--text)' }}>{agoAr(health?.webhookLastAt)}</b>
            <span style={{ marginInline: 6 }}>·</span>
            آخر مزامنة: <b style={{ color: 'var(--text)' }}>{agoAr(health?.lastSyncAt)}</b>
            <span style={{ marginInline: 6 }}>·</span>
            {note}
          </div>
        </div>
      </div>

      <div className="data-confidence__actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {sourcePath && (
          <Btn size="sm" variant="ghost" icon={<ExternalLink size={13}/>} onClick={() => navigate(sourcePath)}>
            فتح المصدر
          </Btn>
        )}
        {onRefresh && (
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} className={refreshing ? 'spin' : ''}/>} onClick={onRefresh} disabled={refreshing || syncing}>
            تحديث العرض
          </Btn>
        )}
        {onSync && canSync && (
          <Btn size="sm" variant="accent" icon={<RefreshCw size={13} className={syncing ? 'spin' : ''}/>} onClick={syncAndReload} disabled={syncing || refreshing}>
            مزامنة زوهو
          </Btn>
        )}
      </div>
    </div>
  );
}
