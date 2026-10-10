import { MachineType, type ChannelId } from "./types.js";
import { Session } from "./session.js";

export interface RespiratoryEventChannels {
  hypopnea: ChannelId;
  obstructive: ChannelId;
  apnea: ChannelId;
  clearAirway: ChannelId;
  rera?: ChannelId;
}

export class Day {
  readonly date: string;
  readonly sessions: Session[] = [];

  constructor(date: string) { this.date = date; }

  addSession(session: Session): void {
    if (session.first === 0) throw new Error("Cannot add a session with first=0");
    this.sessions.push(session);
    this.sessions.sort((a, b) => a.first - b.first);
  }

  getSessions(type: MachineType, includeDisabled = false): Session[] {
    return this.sessions.filter((s) => s.machineType === type && (includeDisabled || s.enabled));
  }

  totalTimeMs(type?: MachineType): number {
    return this.sessions
      .filter((s) => s.enabled && (type === undefined || s.machineType === type))
      .reduce((total, s) => total + s.hours() * 3_600_000, 0);
  }

  hours(type?: MachineType): number { return this.totalTimeMs(type) / 3_600_000; }

  count(channelId: ChannelId): number {
    return this.sessions.filter((s) => s.enabled).reduce((total, s) => total + s.count(channelId), 0);
  }

  sum(channelId: ChannelId): number {
    return this.sessions.filter((s) => s.enabled).reduce((total, s) => total + s.sum(channelId), 0);
  }

  avg(channelId: ChannelId): number {
    const count = this.sessions.filter((s) => s.enabled).reduce((total, s) => total + s.count(channelId), 0);
    return count === 0 ? 0 : this.sum(channelId) / count;
  }

  min(channelId: ChannelId): number {
    const sessions = this.sessions.filter((s) => s.enabled && s.channelExists(channelId));
    return sessions.length ? Math.min(...sessions.map((s) => s.min(channelId))) : 0;
  }

  max(channelId: ChannelId): number {
    const sessions = this.sessions.filter((s) => s.enabled && s.channelExists(channelId));
    return sessions.length ? Math.max(...sessions.map((s) => s.max(channelId))) : 0;
  }

  percentile(channelId: ChannelId, percentile: number): number {
    const values = this.sessions
      .filter((s) => s.enabled)
      .flatMap((s) => (s.eventLists.get(channelId) ?? []).flatMap((list) => list.values()))
      .sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(percentile * values.length) - 1));
    return values[index] ?? 0;
  }

  cph(channelId: ChannelId, type?: MachineType): number {
    const h = this.hours(type);
    return h > 0 ? this.count(channelId) / h : 0;
  }

  calcAHI(channels: RespiratoryEventChannels): number {
    const events = this.count(channels.hypopnea) + this.count(channels.obstructive) +
      this.count(channels.apnea) + this.count(channels.clearAirway);
    const h = this.hours(MachineType.CPAP);
    return h > 0 ? events / h : 0;
  }

  calcRDI(channels: RespiratoryEventChannels): number {
    const rera = channels.rera === undefined ? 0 : this.count(channels.rera);
    const events = this.count(channels.hypopnea) + this.count(channels.obstructive) +
      this.count(channels.apnea) + this.count(channels.clearAirway) + rera;
    const h = this.hours(MachineType.CPAP);
    return h > 0 ? events / h : 0;
  }
}
