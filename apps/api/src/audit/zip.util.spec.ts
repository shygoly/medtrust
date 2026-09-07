import { buildZip } from "./zip.util";

describe("buildZip", () => {
  it("writes a valid store-mode ZIP with local header and central directory", () => {
    const zip = buildZip([{ name: "a.txt", data: Buffer.from("hello") }]);
    // local file header signature
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // end of central directory signature is somewhere near the end
    const eocd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThan(0);
    // entry count = 1
    expect(zip.readUInt16LE(eocd + 10)).toBe(1);
    // central directory signature present
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(cd).toBeGreaterThan(0);
  });

  it("supports multiple files", () => {
    const zip = buildZip([
      { name: "a.txt", data: Buffer.from("a") },
      { name: "b.json", data: Buffer.from("{}") },
    ]);
    const eocd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
  });
});
