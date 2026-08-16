import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const FALLBACK_STYLE={
  version:8,
  sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},
  layers:[{id:'osm',type:'raster',source:'osm'}]
};
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
    const map=new maplibregl.Map({container:containerRef.current,style:FALLBACK_STYLE,center:DEFAULT_CENTER,zoom:4.2,attributionControl:true,cooperativeGestures:true});
    const marker=new maplibregl.Marker({color:'#087e58',draggable:true}).setLngLat(DEFAULT_CENTER).addTo(map);
    marker.getElement().setAttribute('aria-label','مؤشر الموقع القابل للتحريك');
    marker.on('dragend',()=>{const p=marker.getLngLat();onPickRef.current?.({lat:p.lat,lon:p.lng});});
    map.on('click',event=>{marker.setLngLat(event.lngLat);onPickRef.current?.({lat:event.lngLat.lat,lon:event.lngLat.lng});});
    const loadTimer=window.setTimeout(()=>{if(!map.isStyleLoaded())setFailed(true);},12000);
    map.on('load',()=>{window.clearTimeout(loadTimer);setFailed(false);});
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
    mapRef.current=map;markerRef.current=marker;
    return()=>{window.clearTimeout(loadTimer);marker.remove();map.remove();markerRef.current=null;mapRef.current=null;};
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
