import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, LocateFixed, LockKeyhole, MapPin, RotateCw } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { FunctionRegion } from '@supabase/supabase-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../lib/supabase.js';
import { LamhaLogo } from '../components/BrandLogo.jsx';
import './PublicShortAddress.css';

const RIYADH = { lat: 24.7136, lon: 46.6753 };
const HUDHUD_PUBLISHABLE_KEY = String(import.meta.env.VITE_HUDHUD_PUBLISHABLE_KEY || '').trim();
const HUDHUD_MAP_ID = String(import.meta.env.VITE_HUDHUD_MAP_ID || 'default').trim();
const HUDHUD_STYLE_URL = HUDHUD_PUBLISHABLE_KEY
  ? `https://b.hudhud.sa/v1/maps/styles/${encodeURIComponent(HUDHUD_MAP_ID)}?variant=light&lang=ar&api_key=${encodeURIComponent(HUDHUD_PUBLISHABLE_KEY)}`
  : null;
const shortcodeOf = data => data?.shortcode || data?.short_address || data?.address?.shortcode || null;

export default function PublicShortAddress() {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [point, setPoint] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('حرّك العلامة أو اضغط على الخريطة لتحديد موقعك بدقة.');
  const [copied, setCopied] = useState(false);

  const lookup = useCallback(async ({ lat, lon }) => {
    setStatus('loading');
    setMessage('جاري التحقق من العنوان…');
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('hudhud-short-address', {
        body: { lat, lon, website: '' },
        region: FunctionRegion.EuCentral1,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'تعذر العثور على العنوان');
      setResult(data.data);
      setStatus('success');
      setMessage(
        shortcodeOf(data.data)
          ? 'تم تحديد عنوانك'
          : 'تم تحديد العنوان، لكن هدهد لا يعيد العنوان المختصر من الإحداثيات حاليًا.',
      );
    } catch {
      setStatus('error');
      setMessage('تعذر الوصول إلى خدمة العناوين. حاول مرة أخرى.');
    }
  }, []);

  const selectPoint = useCallback((lat, lon, lookupNow = true) => {
    const next = { lat: Number(lat), lon: Number(lon) };
    setPoint(next);
    markerRef.current?.setLngLat([next.lon, next.lat]);
    if (lookupNow) lookup(next);
  }, [lookup]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current || !HUDHUD_STYLE_URL) return undefined;
    if (!maplibregl.getRTLTextPluginStatus || maplibregl.getRTLTextPluginStatus() === 'unavailable') {
      maplibregl.setRTLTextPlugin(
        'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',
        true,
      );
    }
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: HUDHUD_STYLE_URL,
      center: [RIYADH.lon, RIYADH.lat],
      zoom: 11,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    const marker = new maplibregl.Marker({ color: '#078455', draggable: true })
      .setLngLat([RIYADH.lon, RIYADH.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const selected = marker.getLngLat();
      selectPoint(selected.lat, selected.lng);
    });
    map.on('click', event => selectPoint(event.lngLat.lat, event.lngLat.lng));
    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [selectPoint]);

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus('error');
      setMessage('متصفحك لا يدعم تحديد الموقع. اختر موقعك من الخريطة.');
      return;
    }
    setStatus('locating');
    setMessage('جاري تحديد موقعك…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 17 });
        selectPoint(coords.latitude, coords.longitude);
      },
      () => {
        setStatus('error');
        setMessage('لم نتمكن من الوصول إلى موقعك. اسمح بالموقع أو اختر المكان من الخريطة.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const copy = async () => {
    const value = shortcodeOf(result);
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const address = result?.address_ar || result?.display_name || '';
  const shortcode = shortcodeOf(result);

  return (
    <main className="short-address-page" dir="rtl">
      <header className="short-address-header" aria-label="لمحة ShipAudit"><LamhaLogo /></header>
      <section className="short-address-intro">
        <h1>اعرف عنوانك المختصر</h1>
        <p>حدّد موقعك الحالي على الخريطة، وسنعرض لك بيانات عنوانك بدقة.</p>
        <button className="locate-button" type="button" onClick={locate} disabled={status === 'locating'}>
          {status === 'locating' ? <RotateCw className="spin" size={21} /> : <LocateFixed size={21} />}
          {status === 'locating' ? 'جاري تحديد الموقع' : 'استخدم موقعي الحالي'}
        </button>
      </section>
      <section className="short-address-workspace" aria-label="تحديد الموقع والعنوان">
        <div className="short-address-map" ref={mapNode}>
          {!HUDHUD_STYLE_URL && (
            <div className="short-address-map-setup" role="status">
              <MapPin size={30} />
              <strong>خريطة هدهد جاهزة للربط</strong>
              <span>ستظهر فور إضافة مفتاح Publishable ومعرّف الخريطة.</span>
            </div>
          )}
        </div>
        <div className={`short-address-result ${status}`} aria-live="polite">
          <div className="selected-location">
            <span className="result-icon"><MapPin size={22} /></span>
            <div>
              <strong>{status === 'success' ? 'تم تحديد موقعك' : 'حدّد موقعك'}</strong>
              <p>{message}</p>
              {point && <small>{point.lat.toFixed(6)}، {point.lon.toFixed(6)}</small>}
            </div>
          </div>
          <div className="shortcode-output">
            <div>
              <span className="output-label">عنوانك المختصر</span>
              <strong className={shortcode ? '' : 'unavailable'}>{shortcode || 'غير متاح بعد'}</strong>
              {address && <p>{address}</p>}
            </div>
            <button type="button" className="copy-button" onClick={copy} disabled={!shortcode}>
              {copied ? <Check size={20} /> : <Copy size={20} />}
              {copied ? 'تم النسخ' : 'نسخ العنوان'}
            </button>
          </div>
          <div className="privacy-note">
            <LockKeyhole size={15} /> نستخدم موقعك فقط للبحث عن العنوان، ولا نحفظه في هذه الصفحة.
          </div>
        </div>
      </section>
    </main>
  );
}
