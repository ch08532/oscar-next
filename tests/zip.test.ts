import test from "node:test";
import assert from "node:assert/strict";
import { createStoredZip, crc32 } from "../src/desktop/zip.js";

function findAscii(data: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= data.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (data[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

test("stored ZIP contains valid headers, names, and CRC32", () => {
  const payload = new TextEncoder().encode("hello diagnostics\n");
  const archive = createStoredZip([{ name: "diagnostics.json", data: payload }, { name: "logs/app.log", data: "ok\n" }]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.ok(findAscii(archive, "diagnostics.json"));
  assert.ok(findAscii(archive, "logs/app.log"));
  assert.ok(findAscii(archive, "hello diagnostics"));
  assert.equal(view.getUint32(14, true), crc32(payload));
  assert.equal(view.getUint32(archive.byteLength - 22, true), 0x06054b50);
});

test("stored ZIP rejects traversal names", () => {
  assert.throws(() => createStoredZip([{ name: "../secret.txt", data: "nope" }]), /Unsafe ZIP entry/);
});
