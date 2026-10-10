export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

const encoder = new TextEncoder();

function asBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

let crcTable: Uint32Array | undefined;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void { view.setUint16(offset, value, true); }
function writeU32(view: DataView, offset: number, value: number): void { view.setUint32(offset, value >>> 0, true); }

/** Create a small, standards-compatible ZIP using the STORE method (no compression). */
export function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.includes("../")) throw new Error(`Unsafe ZIP entry name: ${entry.name}`);
    const nameBytes = encoder.encode(name);
    const data = asBytes(entry.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.byteLength + data.byteLength);
    const localView = new DataView(local.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800); // UTF-8
    writeU16(localView, 8, 0); // STORE
    writeU16(localView, 10, 0); writeU16(localView, 12, 0);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, data.byteLength);
    writeU32(localView, 22, data.byteLength);
    writeU16(localView, 26, nameBytes.byteLength);
    writeU16(localView, 28, 0);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(central.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, 0); writeU16(centralView, 14, 0);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, data.byteLength);
    writeU32(centralView, 24, data.byteLength);
    writeU16(centralView, 28, nameBytes.byteLength);
    writeU16(centralView, 30, 0); writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0); writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    central.set(nameBytes, 46);
    centrals.push(central);

    localOffset += local.byteLength;
  }

  const centralSize = centrals.reduce((total, item) => total + item.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0); writeU16(endView, 6, 0);
  writeU16(endView, 8, entries.length); writeU16(endView, 10, entries.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, localOffset);
  writeU16(endView, 20, 0);

  return concat([...locals, ...centrals, end]);
}
