import { MachineType, type ChannelId, type MachineId, type MachineInfo, type SessionId } from "./types.js";
import { Session } from "./session.js";

export class Machine {
  readonly id: MachineId;
  info: MachineInfo;
  unsupported = false;
  untested = false;
  readonly sessions = new Map<SessionId, Session>();
  readonly properties = new Map<string, string>();
  readonly availableChannels = new Set<ChannelId>();

  constructor(id: MachineId, info?: Partial<MachineInfo>) {
    this.id = id;
    this.info = {
      type: MachineType.Unknown,
      capabilities: 0,
      loaderName: "",
      brand: "",
      model: "",
      modelNumber: "",
      serial: "",
      series: "",
      version: 0,
      ...info,
    };
  }

  addSession(session: Session): void {
    if (session.machineType !== this.info.type) {
      throw new Error(`Session machine type ${session.machineType} does not match machine type ${this.info.type}`);
    }
    if (this.sessions.has(session.id)) throw new Error(`Duplicate session id: ${session.id}`);
    this.sessions.set(session.id, session);
    for (const channel of session.availableChannels()) this.availableChannels.add(channel);
  }

  session(id: SessionId): Session | undefined { return this.sessions.get(id); }
  hasChannel(id: ChannelId): boolean { return this.availableChannels.has(id); }

  get firstSessionTime(): number | undefined {
    const times = [...this.sessions.values()].map((s) => s.first).filter((v) => v > 0);
    return times.length ? Math.min(...times) : undefined;
  }

  get lastSessionTime(): number | undefined {
    const times = [...this.sessions.values()].map((s) => s.last).filter((v) => v > 0);
    return times.length ? Math.max(...times) : undefined;
  }
}
