import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const STYLE_URL='https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER=[45.0792,23.8859];

export default function HudhudAddressMap({point,onPick}){
  const containerRef=useRef(null);
  const mapRef=useRef(null);
  const markerRef=useRef(null);
  const onPickRef=useRef(onPick);
  const [failed,setFailed]=useState(false);

  useEffect(()=>{onPickRef.current=onPick;},[onPick]);
  useEffect(()=>{
    if(!containerRef.current||mapRef.current)return undefined;
    const map=new maplibregl.Map({container:containerRef.current,style:STYLE_URL,center:DEFAULT_CENTER,zoom:4.2,attributionControl:true,cooperativeGestures:true});
    const marker=new maplibregl.Marker({color:'#087e58',draggable:true}).setLngLat(DEFAULT_CENTER).addTo(map);
    marker.getElement().setAttribute('aria-label','مؤشر الموقع القابل للتحريك');
    marker.on('dragend',()=>{const p=marker.getLngLat();onPickRef.current?.({lat:p.lat,lon:p.lng});});
    map.on('click',event=>{marker.setLngLat(event.lngLat);onPickRef.current?.({lat:event.lngLat.lat,lon:event.lngLat.lng});});
    map.on('error',event=>{if(event?.error)setFailed(true);});
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
    mapRef.current=map;markerRef.current=marker;
    return()=>{marker.remove();map.remove();markerRef.current=null;mapRef.current=null;};
  },[]);

  useEffect(()=>{
    if(!point||!mapRef.current||!markerRef.current)return;
    markerRef.current.setLngLat([point.lon,point.lat]);
    mapRef.current.flyTo({center:[point.lon,point.lat],zoom:16,essential:false});
  },[point?.lat,point?.lon]);

  return <section className="hudhud-map-shell" aria-label="خريطة اختيار الموقع">
    <div ref={containerRef} className="hudhud-map"/>
    <p className="hudhud-map-help">اضغط على الخريطة أو حرّك الدبوس لتحديد الموقع</p>
    {failed&&<p className="hudhud-map-fallback">تعذر تحميل طبقة الخريطة مؤقتًا. ما زال زر تحديد الموقع وخدمات هدهد يعملان.</p>}
  </section>;
}
