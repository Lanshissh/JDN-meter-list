// services/offlineSync.ts
// Offline IMPORT/EXPORT helpers for Reader devices

export type MeterClassification = "electric" | "water" | "lpg" | string;

export type OfflinePackageItem = {
  meter_id: string;
  stall_id: string | null;

  tenant_name: string | null;
  classification: MeterClassification | null;

  prev_reading: number | null;
  prev_date: string | null; // YYYY-MM-DD

  prev_image?: string | null;

  /** QR payload (usually meter_id) */
  qr: string;

  /** optional for UI */
  meter_number?: string | null;
};

export type OfflinePackage = {
  generated_at: string; // ISO
  device_serial?: string | null;
  device_name?: string | null;
  items: OfflinePackageItem[];
};

/** Legacy payload (older server) */
export type LegacyOfflineImportPayload = {
  server_time?: string;
  meters: Array<{
    meter_id: string;
    stall_id: string;
    meter_sn?: string;
    meter_type?: string; // electric | water | lpg
    prev_reading_value?: number | null;
    prev_lastread_date?: string | null;
  }>;
  stalls: Array<{
    stall_id: string;
    building_id: string;
    tenant_id: string | null;
  }>;
  tenants: Array<{
    tenant_id: string;
    tenant_name: string;
  }>;
};

export type OfflineReadingForExport = {
  meter_id: string;
  reading_value: number;
  lastread_date: string; // YYYY-MM-DD

  // optional offline-only fields
  remarks?: string | null;

  /**
   * NEW: backend expects `image` (base64 string or data URI).
   * Keep `image_base64` only for backward compatibility; we'll map to image.
   */
  image?: string | null;
  image_base64?: string | null;

  meter_type?: string | null;
  tenant_name?: string | null;
};

async function parseJsonSafe(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function normalizeClassification(meter_type?: string | null): MeterClassification | null {
  if (!meter_type) return null;
  const s = String(meter_type).trim().toLowerCase();
  if (s.includes("electric") || s.includes("power")) return "electric";
  if (s.includes("water")) return "water";
  if (s.includes("lpg") || s.includes("gas")) return "lpg";
  return meter_type;
}

function legacyToPackage(payload: LegacyOfflineImportPayload): OfflinePackage {
  const tenantMap = new Map<string, string>();
  for (const t of payload.tenants || []) tenantMap.set(String(t.tenant_id), String(t.tenant_name));

  const stallTenantMap = new Map<string, string | null>();
  for (const s of payload.stalls || []) {
    stallTenantMap.set(String(s.stall_id), s.tenant_id ? String(s.tenant_id) : null);
  }

  const items: OfflinePackageItem[] = (payload.meters || []).map((m) => {
    const stall_id = m.stall_id ? String(m.stall_id) : null;
    const tenant_id = stall_id ? stallTenantMap.get(stall_id) : null;
    const tenant_name = tenant_id ? tenantMap.get(tenant_id) || null : null;

    return {
      meter_id: String(m.meter_id),
      stall_id,
      meter_number: m.meter_sn ?? null,
      tenant_name,
      classification: normalizeClassification(m.meter_type ?? null),
      prev_reading: m.prev_reading_value ?? null,
      prev_date: m.prev_lastread_date ?? null,
      prev_image: null,
      qr: String(m.meter_id),
    };
  });

  return {
    generated_at: new Date().toISOString(),
    items,
  };
}

/**
 * IMPORT package to device (READERS ONLY).
 * Backend endpoint:
 * POST /offlineExport/import
 * body: { device_token }
 *
 * NEW server returns:
 * { package: { generated_at, device_serial, device_name, items: [...] } }
 */
export async function offlineImport(opts: {
  apiBaseUrl: string;
  authToken: string;
  deviceToken: string;
}): Promise<OfflinePackage> {
  if (!opts.deviceToken) throw new Error("Missing device token.");

  const res = await fetch(`${opts.apiBaseUrl}/offlineExport/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.authToken}`,
    },
    body: JSON.stringify({ device_token: opts.deviceToken }),
  });

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const msg = data?.error || data?.message || `Import failed (${res.status}).`;
    throw new Error(msg);
  }

  // Preferred format
  const pkg: OfflinePackage | null =
    data?.package ?? data?.data?.package ?? data?.data ?? null;

  if (pkg && Array.isArray(pkg.items)) {
    return {
      generated_at: pkg.generated_at || new Date().toISOString(),
      device_serial: pkg.device_serial ?? null,
      device_name: pkg.device_name ?? null,
      items: pkg.items.map((it: any) => ({
        meter_id: String(it.meter_id),
        stall_id: it.stall_id ?? null,
        meter_number: it.meter_number ?? it.meter_sn ?? null,
        tenant_name: it.tenant_name ?? null,
        classification: it.classification ?? normalizeClassification(it.meter_type ?? null),
        prev_reading: it.prev_reading ?? it.prev_reading_value ?? null,
        prev_date: it.prev_date ?? it.prev_lastread_date ?? null,
        prev_image: it.prev_image ?? null,
        qr: it.qr ? String(it.qr) : String(it.meter_id),
      })),
    };
  }

  // Legacy format fallback
  const legacy: LegacyOfflineImportPayload =
    data?.payload || data?.data || data;

  if (legacy?.meters && legacy?.stalls && legacy?.tenants) {
    return legacyToPackage(legacy);
  }

  throw new Error("Import payload invalid: expected {package:{items:[]}} or legacy meters/stalls/tenants.");
}

/**
 * EXPORT offline readings to server (READERS ONLY).
 * Backend endpoint:
 * POST /offlineExport/export
 * body: { device_token, readings: [...] }
 *
 * backend expects reading fields:
 * - meter_id
 * - reading_value
 * - lastread_date
 * - remarks
 * - image (base64 or data URI)
 */
export async function offlineExport(opts: {
  apiBaseUrl: string;
  authToken: string;
  deviceToken: string;
  readings: OfflineReadingForExport[];
}) {
  if (!opts.deviceToken) throw new Error("Missing device token.");
  if (!Array.isArray(opts.readings) || opts.readings.length === 0) {
    throw new Error("No offline readings to export.");
  }

  // basic validation
  for (const r of opts.readings) {
    if (!r.meter_id) throw new Error("Export contains a reading with no meter_id.");
    if (typeof r.reading_value !== "number" || Number.isNaN(r.reading_value)) {
      throw new Error(`Invalid reading_value for meter ${r.meter_id}.`);
    }
    if (!r.lastread_date) throw new Error(`Missing lastread_date for meter ${r.meter_id}.`);
  }

  const payloadReadings = opts.readings.map((r) => ({
    meter_id: r.meter_id,
    reading_value: r.reading_value,
    lastread_date: r.lastread_date,
    remarks: r.remarks ?? null,

    // ✅ backend expects `image`
    image: r.image ?? r.image_base64 ?? null,

    meter_type: r.meter_type ?? null,
    tenant_name: r.tenant_name ?? null,
  }));

  const res = await fetch(`${opts.apiBaseUrl}/offlineExport/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.authToken}`,
    },
    body: JSON.stringify({
      device_token: opts.deviceToken,
      readings: payloadReadings,
    }),
  });

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const msg = data?.error || data?.message || `Export failed (${res.status}).`;
    throw new Error(msg);
  }

  return data;
}