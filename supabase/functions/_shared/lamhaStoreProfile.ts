type JsonRecord = Record<string, unknown>;

export function nestedLamhaRecords(value: unknown, maxDepth = 5) {
  const records: JsonRecord[] = [];
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  while (queue.length) {
    const current = queue.shift()!;
    if (!current.value || typeof current.value !== 'object' || seen.has(current.value as object)) continue;
    seen.add(current.value as object);
    if (Array.isArray(current.value)) {
      if (current.depth < maxDepth) {
        current.value.forEach(item => queue.push({ value: item, depth: current.depth + 1 }));
      }
      continue;
    }
    const record = current.value as JsonRecord;
    records.push(record);
    if (current.depth < maxDepth) {
      Object.values(record).forEach(item => {
        if (item && typeof item === 'object') queue.push({ value: item, depth: current.depth + 1 });
      });
    }
  }
  return records;
}

export function lamhaRecordStoreId(record: JsonRecord) {
  return Number(record.id ?? record.store_id ?? record.storeId ?? record.business_id ?? record.businessId) || null;
}

export function lamhaStoreProfileRecord(payload: unknown, expectedStoreId: number | null = null) {
  const records = nestedLamhaRecords(payload);
  return records.find(record => expectedStoreId != null && lamhaRecordStoreId(record) === expectedStoreId)
    || records.find(record => lamhaRecordStoreId(record) != null)
    || null;
}

function jsonSafe(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out: JsonRecord = {};
    for (const [key, item] of Object.entries(value as JsonRecord)) {
      if (item !== undefined) out[key] = jsonSafe(item);
    }
    return out;
  }
  return String(value);
}

// Lamha responses contain business data only. Request headers, Authorization
// values and the employee token never enter this function or the database.
export function sanitizedLamhaProfile(record: JsonRecord | null) {
  return record ? jsonSafe(record) as JsonRecord : {};
}

export function lamhaProfileMergeRow({
  storeId,
  record,
  listCheckedAt = null,
  detailCheckedAt = null,
  httpStatus = null,
  latencyMs = null,
}: {
  storeId: string | number;
  record: JsonRecord | null;
  listCheckedAt?: string | null;
  detailCheckedAt?: string | null;
  httpStatus?: number | null;
  latencyMs?: number | null;
}) {
  return {
    store_id: String(storeId),
    api_data: sanitizedLamhaProfile(record),
    api_list_checked_at: listCheckedAt,
    api_detail_checked_at: detailCheckedAt,
    api_http_status: httpStatus,
    api_latency_ms: latencyMs == null ? null : Math.max(0, Math.round(latencyMs)),
  };
}
