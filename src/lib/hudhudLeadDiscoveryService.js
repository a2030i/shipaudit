import { supabase } from './supabase.js';

export const HUDHUD_LEAD_CATEGORIES=[
  {key:'shopping',label:'التسوق'},
  {key:'beauty_care',label:'الجمال والعناية'},
  {key:'home_needs',label:'احتياجات المنزل'},
  {key:'grocery',label:'التموينات'},
  {key:'food_beverages',label:'المأكولات والمشروبات'},
  {key:'restaurants',label:'المطاعم'},
  {key:'companies',label:'الشركات'},
];

export async function loadHudhudCoverage(){
  const {data,error}=await supabase.functions.invoke('hudhud-lead-discovery',{body:{action:'coverage'}});
  if(error)throw error;if(!data?.ok)throw Error(data?.error||'تعذر تحميل نطاق هدهد.');return data.data||[];
}

export async function runHudhudLeadScan(cityKey,categoryKey){
  const {data,error}=await supabase.functions.invoke('hudhud-lead-discovery',{body:{action:'scan_city',city_key:cityKey,category_key:categoryKey}});
  if(error)throw error;if(!data?.ok)throw Error(data?.error||'تعذر تشغيل اكتشاف هدهد.');return data.data;
}

export async function loadHudhudCandidates({status='pending',limit=100}={}){
  let query=supabase.from('hudhud_lead_candidates').select('*').order('ecommerce_score',{ascending:false}).order('last_discovered_at',{ascending:false}).limit(limit);
  if(status)query=query.eq('review_status',status);
  const {data,error}=await query;if(error)throw error;return data||[];
}

export async function approveHudhudCandidate(id,notes=''){
  const {data,error}=await supabase.rpc('approve_hudhud_lead_candidate',{p_candidate_id:id,p_notes:notes||null});
  if(error)throw error;return data;
}

export async function rejectHudhudCandidate(id,notes=''){
  const {error}=await supabase.from('hudhud_lead_candidates').update({review_status:'rejected',review_notes:notes||null,reviewed_at:new Date().toISOString()}).eq('id',id);
  if(error)throw error;
}
