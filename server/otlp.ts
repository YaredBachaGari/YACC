// OTLP/HTTP decoding (plan step 4.4): agent programs report their token use over OpenTelemetry.
// Claude Code and Gemini CLI send metrics; Codex sends log events. Both JSON and protobuf
// bodies are read, so a program that ignores the JSON setting still counts.
//
// Only what usage needs is decoded: sums (counters) with their attributes and times, and log
// records with their event name and attributes. Everything else is skipped.

export type Attrs = Record<string, string | number | boolean>;

export interface MetricPoint {
  name: string;
  attrs: Attrs;
  value: number;
  temporality: "delta" | "cumulative";
  start: string; // nanoseconds since the epoch, as a string
  time: string;
}

export interface LogEvent {
  name: string; // event.name attribute, the record's event_name, or its body
  attrs: Attrs;
}

const isProto = (contentType: string | undefined) => /protobuf/i.test(contentType ?? "");

// ---------------------------------------------------------------- JSON

type JsonAny = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean };
type JsonKv = { key: string; value?: JsonAny };

function jsonAttrs(list: JsonKv[] | undefined): Attrs {
  const out: Attrs = {};
  for (const kv of list ?? []) {
    const v = kv.value ?? {};
    if (v.stringValue !== undefined) out[kv.key] = v.stringValue;
    else if (v.intValue !== undefined) out[kv.key] = Number(v.intValue);
    else if (v.doubleValue !== undefined) out[kv.key] = Number(v.doubleValue);
    else if (v.boolValue !== undefined) out[kv.key] = v.boolValue;
  }
  return out;
}

const jsonTemporality = (t: unknown): "delta" | "cumulative" => (t === 1 || t === "AGGREGATION_TEMPORALITY_DELTA" ? "delta" : "cumulative");

function metricsFromJson(body: unknown): MetricPoint[] {
  const out: MetricPoint[] = [];
  const req = body as { resourceMetrics?: { scopeMetrics?: { metrics?: { name: string; sum?: { dataPoints?: unknown[]; aggregationTemporality?: unknown } }[] }[] }[] };
  for (const rm of req.resourceMetrics ?? [])
    for (const sm of rm.scopeMetrics ?? [])
      for (const m of sm.metrics ?? []) {
        if (!m.sum) continue;
        const temporality = jsonTemporality(m.sum.aggregationTemporality);
        for (const raw of m.sum.dataPoints ?? []) {
          const dp = raw as { attributes?: JsonKv[]; asInt?: string | number; asDouble?: number; startTimeUnixNano?: string | number; timeUnixNano?: string | number };
          const value = dp.asDouble !== undefined ? Number(dp.asDouble) : Number(dp.asInt ?? 0);
          if (!Number.isFinite(value)) continue;
          out.push({ name: m.name, attrs: jsonAttrs(dp.attributes), value, temporality, start: String(dp.startTimeUnixNano ?? "0"), time: String(dp.timeUnixNano ?? "0") });
        }
      }
  return out;
}

function logsFromJson(body: unknown): LogEvent[] {
  const out: LogEvent[] = [];
  const req = body as { resourceLogs?: { scopeLogs?: { logRecords?: { attributes?: JsonKv[]; body?: JsonAny; eventName?: string }[] }[] }[] };
  for (const rl of req.resourceLogs ?? [])
    for (const sl of rl.scopeLogs ?? [])
      for (const r of sl.logRecords ?? []) {
        const attrs = jsonAttrs(r.attributes);
        out.push({ name: String(attrs["event.name"] ?? r.eventName ?? r.body?.stringValue ?? ""), attrs });
      }
  return out;
}

// ---------------------------------------------------------------- Protobuf (the few messages needed)

interface Field {
  no: number;
  wire: number;
  varint?: bigint;
  fixed64?: Buffer;
  bytes?: Buffer;
}

/** Splits a protobuf message into its fields. Throws on a malformed body. */
export function fields(buf: Buffer): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = (): bigint => {
    let shift = 0n;
    let v = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error("truncated varint");
      const b = buf[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
      if (shift > 70n) throw new Error("varint too long");
    }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const no = key >>> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ no, wire, varint: varint() });
    else if (wire === 1) {
      if (i + 8 > buf.length) throw new Error("truncated fixed64");
      out.push({ no, wire, fixed64: buf.subarray(i, i + 8) });
      i += 8;
    } else if (wire === 2) {
      const len = Number(varint());
      if (i + len > buf.length) throw new Error("truncated bytes");
      out.push({ no, wire, bytes: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new Error("truncated fixed32");
      i += 4;
    } else throw new Error(`unsupported wire type ${wire}`);
  }
  return out;
}

const sub = (fs: Field[], no: number) => fs.filter((f) => f.no === no && f.bytes).map((f) => f.bytes!);
const str = (b: Buffer) => b.toString("utf8");

/** AnyValue: string 1, bool 2, int 3, double 4. */
function anyValue(b: Buffer): string | number | boolean | undefined {
  for (const f of fields(b)) {
    if (f.no === 1 && f.bytes) return str(f.bytes);
    if (f.no === 2 && f.varint !== undefined) return f.varint !== 0n;
    if (f.no === 3 && f.varint !== undefined) return Number(BigInt.asIntN(64, f.varint));
    if (f.no === 4 && f.fixed64) return f.fixed64.readDoubleLE(0);
  }
  return undefined;
}

/** KeyValue: key 1, value 2. */
function protoAttrs(list: Buffer[]): Attrs {
  const out: Attrs = {};
  for (const kv of list) {
    const fs = fields(kv);
    const key = sub(fs, 1)[0];
    const val = sub(fs, 2)[0];
    if (!key) continue;
    const v = val ? anyValue(val) : undefined;
    if (v !== undefined) out[str(key)] = v;
  }
  return out;
}

const fixed64Str = (f: Field | undefined) => (f?.fixed64 ? f.fixed64.readBigUInt64LE(0).toString() : "0");

// ExportMetricsServiceRequest 1 → ResourceMetrics: scope_metrics 2 → ScopeMetrics: metrics 2 →
// Metric: name 1, sum 7 → Sum: data_points 1, aggregation_temporality 2 → NumberDataPoint:
// start 2, time 3, as_double 4, as_int 6, attributes 7.
function metricsFromProto(buf: Buffer): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const rm of sub(fields(buf), 1))
    for (const sm of sub(fields(rm), 2))
      for (const m of sub(fields(sm), 2)) {
        const mf = fields(m);
        const name = sub(mf, 1)[0];
        const sum = sub(mf, 7)[0];
        if (!name || !sum) continue;
        const sf = fields(sum);
        const temporality = sf.find((f) => f.no === 2)?.varint === 1n ? "delta" : "cumulative";
        for (const dp of sub(sf, 1)) {
          const df = fields(dp);
          const d = df.find((f) => f.no === 4)?.fixed64;
          const n = df.find((f) => f.no === 6)?.fixed64;
          const value = d ? d.readDoubleLE(0) : n ? Number(n.readBigInt64LE(0)) : 0;
          out.push({ name: str(name), attrs: protoAttrs(sub(df, 7)), value, temporality, start: fixed64Str(df.find((f) => f.no === 2)), time: fixed64Str(df.find((f) => f.no === 3)) });
        }
      }
  return out;
}

// ExportLogsServiceRequest 1 → ResourceLogs: scope_logs 2 → ScopeLogs: log_records 2 →
// LogRecord: body 5, attributes 6, event_name 12.
function logsFromProto(buf: Buffer): LogEvent[] {
  const out: LogEvent[] = [];
  for (const rl of sub(fields(buf), 1))
    for (const sl of sub(fields(rl), 2))
      for (const r of sub(fields(sl), 2)) {
        const rf = fields(r);
        const attrs = protoAttrs(sub(rf, 6));
        const body = sub(rf, 5)[0];
        const eventName = sub(rf, 12)[0];
        out.push({ name: String(attrs["event.name"] ?? (eventName ? str(eventName) : body ? anyValue(body) ?? "" : "")), attrs });
      }
  return out;
}

// ---------------------------------------------------------------- entry points

export function decodeMetrics(body: Buffer, contentType: string | undefined): MetricPoint[] {
  if (isProto(contentType)) return metricsFromProto(body);
  return metricsFromJson(JSON.parse(body.toString("utf8") || "{}"));
}

export function decodeLogs(body: Buffer, contentType: string | undefined): LogEvent[] {
  if (isProto(contentType)) return logsFromProto(body);
  return logsFromJson(JSON.parse(body.toString("utf8") || "{}"));
}
