import { DatabaseSync } from "node:sqlite";
import { Machine } from "../core/machine.js";
import { Session, SliceStatus } from "../core/session.js";
import { EventListType } from "../core/event-list.js";
import { MachineType, type MachineId, type MachineInfo, type SettingValue } from "../core/types.js";
import { isValidIanaTimeZone, systemTimeZone } from "../core/device-time.js";

const SCHEMA_VERSION = 5;
const WAVEFORM_CHUNK_MS = 60_000;

type SqlPrimitive = string | number | bigint | Uint8Array | null;

interface MachineRow {
  id: number;
  machine_type: number;
  capabilities: number;
  loader_name: string;
  brand: string;
  model: string;
  model_number: string;
  serial: string;
  series: string;
  last_imported_ms: number | null;
  info_version: number;
  unsupported: number;
  untested: number;
  profile_id: number | null;
  device_time_zone: string;
  time_zone_source: string;
}

interface SessionRow {
  row_id: number;
  id: number;
  machine_id: number;
  machine_type: number;
  first_ms: number;
  last_ms: number;
  enabled: number;
  summary_only: number;
  no_settings: number;
  changed: number;
}

interface EventListRow {
  id: number;
  session_id: number;
  channel_id: number;
  list_index: number;
  list_type: string;
  gain: number;
  offset: number;
  rate_ms: number;
  dimension: string;
  first_ms: number;
  duration_ms: number;
  min_value: number;
  max_value: number;
  second_field: number;
  raw_blob: Uint8Array;
  raw2_blob: Uint8Array | null;
  time_deltas_blob: Uint8Array | null;
}

interface WaveformChunkRow {
  raw_blob: Uint8Array;
}



export interface ProfileSummary {
  id: number;
  name: string;
  timeZone: string;
  createdMs: number;
  updatedMs: number;
}

export interface MachineTimeSettings {
  machineId: MachineId;
  profileId: number;
  deviceTimeZone: string;
  source: "profile" | "manual" | "unknown";
}

export interface GraphPreference {
  key: string;
  pinned: boolean;
  sortOrder: number;
  height?: number;
}

export interface GraphBookmark {
  id: number;
  machineId: MachineId;
  date: string;
  name: string;
  startMs: number;
  endMs: number;
}

export interface StoredMachineSummary {
  id: MachineId;
  brand: string;
  model: string;
  serial: string;
  machineType: MachineType;
  profileId?: number;
  deviceTimeZone?: string;
  sessionCount: number;
  firstSessionTime?: number;
  lastSessionTime?: number;
}

function asInt16Bytes(values: Int16Array): Uint8Array {
  return new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
}

function asUint32Bytes(values: Uint32Array): Uint8Array {
  return new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength));
}

function bytesToInt16(bytes: Uint8Array): Int16Array {
  const copy = Uint8Array.from(bytes);
  return new Int16Array(copy.buffer);
}

function bytesToUint32(bytes: Uint8Array): Uint32Array {
  const copy = Uint8Array.from(bytes);
  return new Uint32Array(copy.buffer);
}

function serializeSetting(value: SettingValue): { type: string; value: string | null } {
  if (value === null) return { type: "null", value: null };
  if (value instanceof Date) return { type: "date", value: String(value.getTime()) };
  switch (typeof value) {
    case "boolean": return { type: "boolean", value: value ? "1" : "0" };
    case "number": return { type: "number", value: String(value) };
    case "string": return { type: "string", value };
  }
}

function deserializeSetting(type: string, value: string | null): SettingValue {
  switch (type) {
    case "null": return null;
    case "date": return new Date(Number(value));
    case "boolean": return value === "1";
    case "number": return Number(value);
    case "string": return value ?? "";
    default: throw new Error(`Unsupported stored setting type: ${type}`);
  }
}

export class OscarDatabase {
  readonly path: string;
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.path = path;
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#migrate();
  }

  close(): void { this.#db.close(); }

  listProfiles(): ProfileSummary[] {
    const rows = this.#db.prepare("SELECT id, name, time_zone, created_ms, updated_ms FROM profiles ORDER BY name COLLATE NOCASE, id").all() as Array<{ id: number; name: string; time_zone: string; created_ms: number; updated_ms: number }>;
    return rows.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone, createdMs: row.created_ms, updatedMs: row.updated_ms }));
  }

  getProfile(id: number): ProfileSummary | undefined {
    const row = this.#db.prepare("SELECT id, name, time_zone, created_ms, updated_ms FROM profiles WHERE id = ?").get(id) as { id: number; name: string; time_zone: string; created_ms: number; updated_ms: number } | undefined;
    return row ? { id: row.id, name: row.name, timeZone: row.time_zone, createdMs: row.created_ms, updatedMs: row.updated_ms } : undefined;
  }

  createProfile(name: string, timeZone: string): ProfileSummary {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Profile name must not be empty");
    if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
    const now = Date.now();
    const result = this.#db.prepare("INSERT INTO profiles (name, time_zone, created_ms, updated_ms) VALUES (?, ?, ?, ?)").run(normalizedName, timeZone, now, now);
    const profile = this.getProfile(Number(result.lastInsertRowid));
    if (!profile) throw new Error("Failed to create profile");
    if (!this.getActiveProfile()) this.setActiveProfile(profile.id);
    return profile;
  }

  updateProfile(id: number, updates: { name?: string; timeZone?: string }): ProfileSummary {
    const current = this.getProfile(id);
    if (!current) throw new Error(`Profile ${id} was not found`);
    const name = updates.name !== undefined ? updates.name.trim() : current.name;
    const timeZone = updates.timeZone ?? current.timeZone;
    if (!name) throw new Error("Profile name must not be empty");
    if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
    this.#transaction(() => {
      this.#db.prepare("UPDATE profiles SET name = ?, time_zone = ?, updated_ms = ? WHERE id = ?").run(name, timeZone, Date.now(), id);
      if (updates.timeZone !== undefined) {
        this.#db.prepare("UPDATE machines SET device_time_zone = ? WHERE profile_id = ? AND time_zone_source = 'profile'").run(timeZone, id);
      }
    });
    return this.getProfile(id)!;
  }

  deleteProfile(id: number): void {
    const machineCount = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM machines WHERE profile_id = ?").get(id) as { count: number }).count);
    if (machineCount > 0) throw new Error("Cannot delete a profile that still has machines");
    const activeRow = this.#db.prepare("SELECT value FROM app_settings WHERE key = 'active_profile_id'").get() as { value: string } | undefined;
    const wasActive = Number(activeRow?.value) === id;
    this.#db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    if (wasActive) {
      const next = this.listProfiles()[0];
      if (next) this.setActiveProfile(next.id);
      else this.#db.prepare("DELETE FROM app_settings WHERE key = 'active_profile_id'").run();
    }
  }

  getActiveProfile(): ProfileSummary | undefined {
    const row = this.#db.prepare("SELECT value FROM app_settings WHERE key = 'active_profile_id'").get() as { value: string } | undefined;
    if (row) {
      const profile = this.getProfile(Number(row.value));
      if (profile) return profile;
    }
    return this.listProfiles()[0];
  }

  setActiveProfile(id: number): void {
    if (!this.getProfile(id)) throw new Error(`Profile ${id} was not found`);
    this.#db.prepare("INSERT INTO app_settings (key, value) VALUES ('active_profile_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(id));
  }

  moveMachineToProfile(machineId: MachineId, profileId: number): void {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error(`Profile ${profileId} was not found`);
    const row = this.#db.prepare("SELECT time_zone_source FROM machines WHERE id = ?").get(machineId) as { time_zone_source: string } | undefined;
    if (!row) throw new Error(`Machine ${machineId} was not found`);
    if (row.time_zone_source === "profile") {
      this.#db.prepare("UPDATE machines SET profile_id = ?, device_time_zone = ? WHERE id = ?").run(profileId, profile.timeZone, machineId);
    } else {
      this.#db.prepare("UPDATE machines SET profile_id = ? WHERE id = ?").run(profileId, machineId);
    }
  }

  getMachineTimeSettings(machineId: MachineId): MachineTimeSettings {
    const row = this.#db.prepare("SELECT profile_id, device_time_zone, time_zone_source FROM machines WHERE id = ?").get(machineId) as { profile_id: number | null; device_time_zone: string; time_zone_source: string } | undefined;
    if (!row) throw new Error(`Machine ${machineId} was not found`);
    const profileId = row.profile_id ?? this.getActiveProfile()?.id;
    if (profileId === undefined) throw new Error(`Machine ${machineId} is not assigned to a profile`);
    return { machineId, profileId, deviceTimeZone: row.device_time_zone, source: (row.time_zone_source as MachineTimeSettings["source"]) || "unknown" };
  }

  setMachineTimeZone(machineId: MachineId, timeZone?: string): MachineTimeSettings {
    const current = this.getMachineTimeSettings(machineId);
    const profile = this.getProfile(current.profileId);
    if (!profile) throw new Error(`Profile ${current.profileId} was not found`);
    const deviceTimeZone = timeZone?.trim() || profile.timeZone;
    if (!isValidIanaTimeZone(deviceTimeZone)) throw new RangeError(`Invalid IANA timezone: ${deviceTimeZone}`);
    const source = timeZone?.trim() ? "manual" : "profile";
    this.#db.prepare("UPDATE machines SET device_time_zone = ?, time_zone_source = ? WHERE id = ?").run(deviceTimeZone, source, machineId);
    return this.getMachineTimeSettings(machineId);
  }

  get schemaVersion(): number {
    const row = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
    return row?.version ?? 0;
  }

  saveMachine(machine: Machine, options: { profileId?: number; deviceTimeZone?: string; timeZoneSource?: "profile" | "manual" | "unknown" } = {}): void {
    const existing = this.#db.prepare("SELECT profile_id, device_time_zone, time_zone_source FROM machines WHERE id = ?").get(machine.id) as { profile_id: number | null; device_time_zone: string | null; time_zone_source: string | null } | undefined;
    const profile = options.profileId !== undefined
      ? this.getProfile(options.profileId)
      : existing?.profile_id !== null && existing?.profile_id !== undefined
        ? this.getProfile(existing.profile_id)
        : this.getActiveProfile() ?? this.createProfile("Default", systemTimeZone());
    if (!profile) throw new Error("A valid profile is required to save a machine");
    const deviceTimeZone = options.deviceTimeZone ?? existing?.device_time_zone ?? profile.timeZone;
    if (!isValidIanaTimeZone(deviceTimeZone)) throw new RangeError(`Invalid IANA timezone: ${deviceTimeZone}`);
    const timeZoneSource = options.timeZoneSource ?? (options.deviceTimeZone ? "manual" : (existing?.time_zone_source as "profile" | "manual" | "unknown" | undefined) ?? "profile");

    this.#transaction(() => {
      const info = machine.info;
      this.#db.prepare(`
        INSERT INTO machines (
          id, machine_type, capabilities, loader_name, brand, model, model_number,
          serial, series, last_imported_ms, info_version, unsupported, untested,
          profile_id, device_time_zone, time_zone_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          machine_type=excluded.machine_type,
          capabilities=excluded.capabilities,
          loader_name=excluded.loader_name,
          brand=excluded.brand,
          model=excluded.model,
          model_number=excluded.model_number,
          serial=excluded.serial,
          series=excluded.series,
          last_imported_ms=excluded.last_imported_ms,
          info_version=excluded.info_version,
          unsupported=excluded.unsupported,
          untested=excluded.untested,
          profile_id=excluded.profile_id,
          device_time_zone=excluded.device_time_zone,
          time_zone_source=excluded.time_zone_source
      `).run(
        machine.id, info.type, info.capabilities, info.loaderName, info.brand, info.model,
        info.modelNumber, info.serial, info.series, info.lastImported?.getTime() ?? null,
        info.version, machine.unsupported ? 1 : 0, machine.untested ? 1 : 0,
        profile.id, deviceTimeZone, timeZoneSource,
      );

      // Save the machine as a complete snapshot so stale child rows disappear.
      this.#db.prepare("DELETE FROM machine_properties WHERE machine_id = ?").run(machine.id);
      this.#db.prepare("DELETE FROM sessions WHERE machine_id = ?").run(machine.id);

      const propertyStmt = this.#db.prepare("INSERT INTO machine_properties (machine_id, key, value) VALUES (?, ?, ?)");
      for (const [key, value] of machine.properties) propertyStmt.run(machine.id, key, value);

      for (const session of [...machine.sessions.values()].sort((a, b) => a.id - b.id)) {
        this.#saveSession(machine.id, session);
      }
    });
  }

  loadMachine(id: MachineId): Machine | undefined {
    const row = this.#db.prepare("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | undefined;
    if (!row) return undefined;

    const info: MachineInfo = {
      type: row.machine_type as MachineType,
      capabilities: row.capabilities,
      loaderName: row.loader_name,
      brand: row.brand,
      model: row.model,
      modelNumber: row.model_number,
      serial: row.serial,
      series: row.series,
      version: row.info_version,
      ...(row.last_imported_ms !== null ? { lastImported: new Date(row.last_imported_ms) } : {}),
    };
    const machine = new Machine(row.id, info);
    machine.unsupported = row.unsupported !== 0;
    machine.untested = row.untested !== 0;

    const properties = this.#db.prepare("SELECT key, value FROM machine_properties WHERE machine_id = ? ORDER BY key").all(id) as Array<{ key: string; value: string }>;
    for (const property of properties) machine.properties.set(property.key, property.value);

    const sessions = this.#db.prepare("SELECT * FROM sessions WHERE machine_id = ? ORDER BY first_ms, id").all(id) as SessionRow[];
    for (const sessionRow of sessions) machine.addSession(this.#loadSession(sessionRow));
    return machine;
  }

  setSessionEnabled(machineId: MachineId, sessionId: number, enabled: boolean): void {
    const result = this.#db.prepare(`
      UPDATE sessions
      SET enabled = ?, changed = 1
      WHERE machine_id = ? AND id = ?
    `).run(enabled ? 1 : 0, machineId, sessionId);
    if (result.changes === 0) throw new Error(`Session ${sessionId} for machine ${machineId} was not found`);
  }

  getGraphPreferences(machineId: MachineId): GraphPreference[] {
    const rows = this.#db.prepare(`
      SELECT graph_key, pinned, sort_order, height
      FROM graph_preferences
      WHERE machine_id = ?
      ORDER BY pinned DESC, sort_order, graph_key
    `).all(machineId) as Array<{ graph_key: string; pinned: number; sort_order: number; height: number | null }>;
    return rows.map((row) => ({
      key: row.graph_key,
      pinned: row.pinned !== 0,
      sortOrder: row.sort_order,
      ...(row.height !== null ? { height: row.height } : {}),
    }));
  }

  #ensureGraphPreference(machineId: MachineId, key: string): { sortOrder: number } {
    if (!key.trim()) throw new Error("Graph key must not be empty");
    const existing = this.#db.prepare(`
      SELECT sort_order FROM graph_preferences WHERE machine_id = ? AND graph_key = ?
    `).get(machineId, key) as { sort_order: number } | undefined;
    if (existing) return { sortOrder: existing.sort_order };
    const nextOrder = Number((this.#db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM graph_preferences WHERE machine_id = ?
    `).get(machineId) as { next_order: number }).next_order);
    this.#db.prepare(`
      INSERT INTO graph_preferences (machine_id, graph_key, pinned, sort_order, height)
      VALUES (?, ?, 0, ?, NULL)
    `).run(machineId, key, nextOrder);
    return { sortOrder: nextOrder };
  }

  setGraphPinned(machineId: MachineId, key: string, pinned: boolean): void {
    this.#ensureGraphPreference(machineId, key);
    this.#db.prepare(`
      UPDATE graph_preferences SET pinned = ? WHERE machine_id = ? AND graph_key = ?
    `).run(pinned ? 1 : 0, machineId, key);
  }

  setGraphHeight(machineId: MachineId, key: string, height: number): void {
    const normalized = Math.round(Math.max(100, Math.min(520, height)));
    this.#ensureGraphPreference(machineId, key);
    this.#db.prepare(`
      UPDATE graph_preferences SET height = ? WHERE machine_id = ? AND graph_key = ?
    `).run(normalized, machineId, key);
  }

  setGraphOrder(machineId: MachineId, keys: readonly string[]): void {
    const unique = [...new Set(keys.filter((key) => key.trim()))];
    this.#transaction(() => {
      unique.forEach((key, index) => {
        this.#ensureGraphPreference(machineId, key);
        this.#db.prepare(`
          UPDATE graph_preferences SET sort_order = ? WHERE machine_id = ? AND graph_key = ?
        `).run(index, machineId, key);
      });
    });
  }

  listGraphBookmarks(machineId: MachineId, date: string): GraphBookmark[] {
    const rows = this.#db.prepare(`
      SELECT id, machine_id, therapy_date, name, start_ms, end_ms
      FROM graph_bookmarks
      WHERE machine_id = ? AND therapy_date = ?
      ORDER BY start_ms, name, id
    `).all(machineId, date) as Array<{ id: number; machine_id: number; therapy_date: string; name: string; start_ms: number; end_ms: number }>;
    return rows.map((row) => ({ id: row.id, machineId: row.machine_id, date: row.therapy_date, name: row.name, startMs: row.start_ms, endMs: row.end_ms }));
  }

  createGraphBookmark(machineId: MachineId, date: string, name: string, startMs: number, endMs: number): GraphBookmark {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Bookmark name must not be empty");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error("Bookmark range is invalid");
    const result = this.#db.prepare(`
      INSERT INTO graph_bookmarks (machine_id, therapy_date, name, start_ms, end_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(machineId, date, trimmed, Math.round(startMs), Math.round(endMs));
    return { id: Number(result.lastInsertRowid), machineId, date, name: trimmed, startMs: Math.round(startMs), endMs: Math.round(endMs) };
  }

  deleteGraphBookmark(machineId: MachineId, bookmarkId: number): void {
    this.#db.prepare(`DELETE FROM graph_bookmarks WHERE machine_id = ? AND id = ?`).run(machineId, bookmarkId);
  }

  listMachines(profileId?: number): StoredMachineSummary[] {
    const rows = this.#db.prepare(`
      SELECT m.id, m.brand, m.model, m.serial, m.machine_type, m.profile_id, m.device_time_zone,
             COUNT(s.id) AS session_count,
             MIN(s.first_ms) AS first_session_ms,
             MAX(s.last_ms) AS last_session_ms
      FROM machines m
      LEFT JOIN sessions s ON s.machine_id = m.id
      WHERE (? IS NULL OR m.profile_id = ?)
      GROUP BY m.id
      ORDER BY m.id
    `).all(profileId ?? null, profileId ?? null) as Array<{
      id: number; brand: string; model: string; serial: string; machine_type: number; profile_id: number | null; device_time_zone: string;
      session_count: number; first_session_ms: number | null; last_session_ms: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      brand: row.brand,
      model: row.model,
      serial: row.serial,
      machineType: row.machine_type as MachineType,
      profileId: row.profile_id ?? 0,
      deviceTimeZone: row.device_time_zone,
      sessionCount: row.session_count,
      ...(row.first_session_ms !== null ? { firstSessionTime: row.first_session_ms } : {}),
      ...(row.last_session_ms !== null ? { lastSessionTime: row.last_session_ms } : {}),
    }));
  }

  #saveSession(machineId: MachineId, session: Session): void {
    const inserted = this.#db.prepare(`
      INSERT INTO sessions (
        id, machine_id, machine_type, first_ms, last_ms, enabled, summary_only, no_settings, changed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, machineId, session.machineType, session.first, session.last,
      session.enabled ? 1 : 0, session.summaryOnly ? 1 : 0, session.noSettings ? 1 : 0, session.changed ? 1 : 0,
    );
    const sessionRowId = Number(inserted.lastInsertRowid);

    const settingStmt = this.#db.prepare("INSERT INTO session_settings (session_row_id, channel_id, value_type, value_text) VALUES (?, ?, ?, ?)");
    for (const [channelId, value] of session.settings) {
      const encoded = serializeSetting(value);
      settingStmt.run(sessionRowId, channelId, encoded.type, encoded.value);
    }

    const sliceStmt = this.#db.prepare("INSERT INTO session_slices (session_row_id, slice_index, start_ms, end_ms, status) VALUES (?, ?, ?, ?, ?)");
    session.slices.forEach((slice, index) => sliceStmt.run(sessionRowId, index, slice.start, slice.end, slice.status));

    const eventStmt = this.#db.prepare(`
      INSERT INTO event_lists (
        session_row_id, channel_id, list_index, list_type, gain, offset, rate_ms, dimension,
        first_ms, duration_ms, min_value, max_value, second_field, raw_blob, raw2_blob, time_deltas_blob
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [channelId, lists] of session.eventLists) {
      lists.forEach((list, listIndex) => {
        const raw = list.rawData();
        const inserted = eventStmt.run(
          sessionRowId, channelId, listIndex, list.type, list.gain, list.offset, list.rateMs, list.dimension,
          list.first, list.duration, list.min, list.max, list.hasSecondField ? 1 : 0,
          list.type === EventListType.Waveform ? new Uint8Array() : asInt16Bytes(raw),
          list.hasSecondField ? asInt16Bytes(list.rawData2()) : null,
          list.type === EventListType.Event ? asUint32Bytes(list.timeDeltas()) : null,
        );
        if (list.type === EventListType.Waveform) this.#saveWaveformChunks(Number(inserted.lastInsertRowid), list.first, list.rateMs, raw);
      });
    }
  }

  #loadSession(row: SessionRow): Session {
    const session = new Session(row.id, row.machine_type as MachineType);
    session.setBounds(row.first_ms, row.last_ms);
    session.enabled = row.enabled !== 0;
    session.summaryOnly = row.summary_only !== 0;
    session.noSettings = row.no_settings !== 0;
    session.changed = row.changed !== 0;

    const settings = this.#db.prepare("SELECT channel_id, value_type, value_text FROM session_settings WHERE session_row_id = ? ORDER BY channel_id").all(row.row_id) as Array<{ channel_id: number; value_type: string; value_text: string | null }>;
    for (const setting of settings) session.settings.set(setting.channel_id, deserializeSetting(setting.value_type, setting.value_text));

    const slices = this.#db.prepare("SELECT start_ms, end_ms, status FROM session_slices WHERE session_row_id = ? ORDER BY slice_index").all(row.row_id) as Array<{ start_ms: number; end_ms: number; status: number }>;
    for (const slice of slices) session.addSlice({ start: slice.start_ms, end: slice.end_ms, status: slice.status as SliceStatus });

    const lists = this.#db.prepare("SELECT * FROM event_lists WHERE session_row_id = ? ORDER BY channel_id, list_index").all(row.row_id) as EventListRow[];
    for (const stored of lists) {
      const type = stored.list_type as EventListType;
      const list = session.addEventList(stored.channel_id, type, {
        gain: stored.gain,
        offset: stored.offset,
        rateMs: stored.rate_ms,
        dimension: stored.dimension,
        secondField: stored.second_field !== 0,
        min: stored.min_value,
        max: stored.max_value,
      });
      const raw = type === EventListType.Waveform ? this.#loadWaveformRaw(stored.id) : bytesToInt16(stored.raw_blob);
      if (type === EventListType.Waveform) {
        list.addWaveform(stored.first_ms, raw, stored.duration_ms);
      } else {
        const deltas = stored.time_deltas_blob ? bytesToUint32(stored.time_deltas_blob) : new Uint32Array();
        const raw2 = stored.raw2_blob ? bytesToInt16(stored.raw2_blob) : new Int16Array();
        for (let index = 0; index < raw.length; index += 1) {
          const primary = raw[index];
          const delta = deltas[index];
          if (primary === undefined || delta === undefined) continue;
          const secondary = stored.second_field !== 0 ? raw2[index] : undefined;
          list.addEvent(stored.first_ms + delta, primary, secondary);
        }
      }
    }
    return session;
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );
    `);
    const versionRow = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
    const existingVersion = versionRow?.version ?? 0;
    if (existingVersion > SCHEMA_VERSION) throw new Error(`Database schema ${existingVersion} is newer than supported schema ${SCHEMA_VERSION}`);

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        time_zone TEXT NOT NULL,
        created_ms INTEGER NOT NULL,
        updated_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS machines (
        id INTEGER PRIMARY KEY,
        machine_type INTEGER NOT NULL,
        capabilities INTEGER NOT NULL,
        loader_name TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        model_number TEXT NOT NULL,
        serial TEXT NOT NULL,
        series TEXT NOT NULL,
        last_imported_ms INTEGER,
        info_version INTEGER NOT NULL,
        unsupported INTEGER NOT NULL DEFAULT 0,
        untested INTEGER NOT NULL DEFAULT 0,
        profile_id INTEGER REFERENCES profiles(id),
        device_time_zone TEXT NOT NULL DEFAULT 'UTC',
        time_zone_source TEXT NOT NULL DEFAULT 'unknown'
      );

      CREATE TABLE IF NOT EXISTS machine_properties (
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY(machine_id, key)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id INTEGER NOT NULL,
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        machine_type INTEGER NOT NULL,
        first_ms INTEGER NOT NULL,
        last_ms INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        summary_only INTEGER NOT NULL,
        no_settings INTEGER NOT NULL,
        changed INTEGER NOT NULL,
        UNIQUE(machine_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_machine_first ON sessions(machine_id, first_ms);

      CREATE TABLE IF NOT EXISTS session_settings (
        session_row_id INTEGER NOT NULL REFERENCES sessions(row_id) ON DELETE CASCADE,
        channel_id INTEGER NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT,
        PRIMARY KEY(session_row_id, channel_id)
      );

      CREATE TABLE IF NOT EXISTS session_slices (
        session_row_id INTEGER NOT NULL REFERENCES sessions(row_id) ON DELETE CASCADE,
        slice_index INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        PRIMARY KEY(session_row_id, slice_index)
      );

      CREATE TABLE IF NOT EXISTS event_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_row_id INTEGER NOT NULL REFERENCES sessions(row_id) ON DELETE CASCADE,
        channel_id INTEGER NOT NULL,
        list_index INTEGER NOT NULL,
        list_type TEXT NOT NULL,
        gain REAL NOT NULL,
        offset REAL NOT NULL,
        rate_ms REAL NOT NULL,
        dimension TEXT NOT NULL,
        first_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        min_value REAL NOT NULL,
        max_value REAL NOT NULL,
        second_field INTEGER NOT NULL,
        raw_blob BLOB NOT NULL,
        raw2_blob BLOB,
        time_deltas_blob BLOB,
        UNIQUE(session_row_id, channel_id, list_index)
      );
      CREATE INDEX IF NOT EXISTS idx_event_lists_session_channel ON event_lists(session_row_id, channel_id);

      CREATE TABLE IF NOT EXISTS waveform_chunks (
        event_list_id INTEGER NOT NULL REFERENCES event_lists(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        start_sample INTEGER NOT NULL,
        sample_count INTEGER NOT NULL,
        start_ms REAL NOT NULL,
        end_ms REAL NOT NULL,
        min_raw INTEGER NOT NULL,
        max_raw INTEGER NOT NULL,
        raw_blob BLOB NOT NULL,
        PRIMARY KEY(event_list_id, chunk_index)
      );
      CREATE INDEX IF NOT EXISTS idx_waveform_chunks_time ON waveform_chunks(event_list_id, start_ms, end_ms);

      CREATE TABLE IF NOT EXISTS graph_preferences (
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        graph_key TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        height INTEGER,
        PRIMARY KEY(machine_id, graph_key)
      );

      CREATE TABLE IF NOT EXISTS graph_bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        therapy_date TEXT NOT NULL,
        name TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_graph_bookmarks_machine_date ON graph_bookmarks(machine_id, therapy_date, start_ms);
    `);

    if (existingVersion > 0 && existingVersion < 4) {
      const columns = this.#db.prepare("PRAGMA table_info(graph_preferences)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "height")) this.#db.exec("ALTER TABLE graph_preferences ADD COLUMN height INTEGER;");
    }
    if (existingVersion > 0 && existingVersion < 5) {
      const machineColumns = this.#db.prepare("PRAGMA table_info(machines)").all() as Array<{ name: string }>;
      if (!machineColumns.some((column) => column.name === "profile_id")) this.#db.exec("ALTER TABLE machines ADD COLUMN profile_id INTEGER REFERENCES profiles(id);");
      if (!machineColumns.some((column) => column.name === "device_time_zone")) this.#db.exec("ALTER TABLE machines ADD COLUMN device_time_zone TEXT;");
      if (!machineColumns.some((column) => column.name === "time_zone_source")) this.#db.exec("ALTER TABLE machines ADD COLUMN time_zone_source TEXT NOT NULL DEFAULT 'unknown';");

      const machineCount = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM machines").get() as { count: number }).count);
      if (machineCount > 0) {
        let profile = this.#db.prepare("SELECT id, time_zone FROM profiles ORDER BY id LIMIT 1").get() as { id: number; time_zone: string } | undefined;
        if (!profile) {
          const zone = systemTimeZone();
          const now = Date.now();
          const inserted = this.#db.prepare("INSERT INTO profiles (name, time_zone, created_ms, updated_ms) VALUES ('Default', ?, ?, ?)").run(zone, now, now);
          profile = { id: Number(inserted.lastInsertRowid), time_zone: zone };
        }
        this.#db.prepare("UPDATE machines SET profile_id = COALESCE(profile_id, ?), device_time_zone = COALESCE(device_time_zone, ?), time_zone_source = CASE WHEN time_zone_source = 'unknown' THEN 'profile' ELSE time_zone_source END").run(profile.id, profile.time_zone);
        this.#db.prepare("INSERT INTO app_settings (key, value) VALUES ('active_profile_id', ?) ON CONFLICT(key) DO NOTHING").run(String(profile.id));
      }
    }
    if (existingVersion < 2) this.#migrateWaveformChunks();
    if (!versionRow) this.#db.prepare("INSERT INTO schema_version(version) VALUES (?)").run(SCHEMA_VERSION);
    else if (existingVersion !== SCHEMA_VERSION) this.#db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  #saveWaveformChunks(eventListId: number, firstMs: number, rateMs: number, raw: Int16Array): void {
    if (raw.length === 0) return;
    const samplesPerChunk = Math.max(1, Math.floor(WAVEFORM_CHUNK_MS / Math.max(rateMs, 0.001)));
    const statement = this.#db.prepare(`
      INSERT INTO waveform_chunks (event_list_id, chunk_index, start_sample, sample_count, start_ms, end_ms, min_raw, max_raw, raw_blob)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let start = 0, chunkIndex = 0; start < raw.length; start += samplesPerChunk, chunkIndex += 1) {
      const end = Math.min(raw.length, start + samplesPerChunk);
      const chunk = raw.slice(start, end);
      let minRaw = 32767;
      let maxRaw = -32768;
      for (const value of chunk) { minRaw = Math.min(minRaw, value); maxRaw = Math.max(maxRaw, value); }
      statement.run(
        eventListId, chunkIndex, start, chunk.length,
        firstMs + start * rateMs, firstMs + end * rateMs, minRaw, maxRaw, asInt16Bytes(chunk),
      );
    }
  }

  #loadWaveformRaw(eventListId: number): Int16Array {
    const rows = this.#db.prepare("SELECT raw_blob FROM waveform_chunks WHERE event_list_id = ? ORDER BY chunk_index").all(eventListId) as WaveformChunkRow[];
    if (rows.length === 0) {
      const legacy = this.#db.prepare("SELECT raw_blob FROM event_lists WHERE id = ?").get(eventListId) as { raw_blob: Uint8Array } | undefined;
      return legacy ? bytesToInt16(legacy.raw_blob) : new Int16Array();
    }
    const chunks = rows.map((row) => bytesToInt16(row.raw_blob));
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }

  #migrateWaveformChunks(): void {
    const rows = this.#db.prepare(`
      SELECT id, first_ms, rate_ms, raw_blob
      FROM event_lists
      WHERE list_type = ? AND length(raw_blob) > 0
      ORDER BY id
    `).all(EventListType.Waveform) as Array<{ id: number; first_ms: number; rate_ms: number; raw_blob: Uint8Array }>;
    this.#transaction(() => {
      for (const row of rows) {
        const count = this.#db.prepare("SELECT COUNT(*) AS count FROM waveform_chunks WHERE event_list_id = ?").get(row.id) as { count: number };
        if (count.count === 0) this.#saveWaveformChunks(row.id, row.first_ms, row.rate_ms, bytesToInt16(row.raw_blob));
        this.#db.prepare("UPDATE event_lists SET raw_blob = ? WHERE id = ?").run(new Uint8Array(), row.id);
      }
    });
  }

  #transaction(fn: () => void): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}

export { SCHEMA_VERSION };
