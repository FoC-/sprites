export class Zip {
  private crc32 = (data: BufferSource) => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (var b = 0; b < 8; b++) c = (c & 1 ? 0xedb88320 : 0) ^ (c >>> 1);
      table[i] = c;
    }

    let crc = -1;
    for (var i = 0; i < data.byteLength; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  };

  private convertToDosDate(source: Date) {
    let date = 0;
    date |= ((source.getFullYear() - 1980) & 0b1111111) << 9;
    date |= ((source.getMonth() + 1) & 0b1111) << 5;
    date |= source.getDate() & 0b11111;

    let time = 0;
    time |= (source.getHours() & 0b11111) << 11;
    time |= (source.getMinutes() & 0b111111) << 5;
    time |= Math.round(source.getSeconds() / 2) & 0b11111;

    return { date, time };
  }

  private createLocalFileHeader(
    time: number,
    date: number,
    crc: number,
    size: number,
    fileName: Uint8Array,
    extraField = new Uint8Array()
  ) {
    const HEADER_SIZE = 30;
    const data = new Uint8Array(HEADER_SIZE + fileName.byteLength + extraField.byteLength);

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint32(0, 0x04034b50, true); // Magic number. Must be 50 4B 03 04.
    view.setUint16(4, 20, true); // Version needed to extract (minimum).
    view.setUint16(6, 0, true); // General purpose bit flag.
    view.setUint16(8, 0, true); // Compression method; e.g. none = 0
    view.setUint16(10, time, true); // File last modification time.
    view.setUint16(12, date, true); //File last modification date.
    view.setUint32(14, crc, true); // CRC-32 of uncompressed data.
    view.setUint32(18, size, true); // Compressed size (or FF FF FF FF for ZIP64).
    view.setUint32(22, size, true); // Uncompressed size (or FF FF FF FF for ZIP64).
    view.setUint16(26, fileName.byteLength, true); // File name length (n).
    view.setUint16(28, extraField.byteLength, true); // Extra field length (m).

    let offset = HEADER_SIZE;
    data.set(fileName, offset); // (n) File name.
    offset += fileName.byteLength;
    data.set(extraField, offset); // (m) Extra field.

    return data;
  }

  private createCentralDirectoryFileHeader(
    time: number,
    date: number,
    crc: number,
    size: number,
    localHeaderOffset: number,
    fileName: Uint8Array,
    extraField = new Uint8Array(),
    fileComment = new Uint8Array()
  ) {
    const HEADER_SIZE = 46;
    const data = new Uint8Array(HEADER_SIZE + fileName.byteLength + extraField.byteLength + fileComment.byteLength);

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint32(0, 0x02014b50, true); // Magic number. Must be 50 4B 01 02.
    view.setUint16(4, 20, true); // Version made by.
    view.setUint16(6, 20, true); // Version needed to extract (minimum).
    view.setUint16(8, 0, true); // General purpose bit flag.
    view.setUint16(10, 0, true); // Compression method. 0 = none
    view.setUint16(12, time, true); // File last modification time.
    view.setUint16(14, date, true); // File last modification date.
    view.setUint32(16, crc, true); // CRC-32 of uncompressed data.
    view.setUint32(20, size, true); // Compressed size (or FF FF FF FF for ZIP64).
    view.setUint32(24, size, true); // Uncompressed size (or FF FF FF FF for ZIP64).
    view.setUint16(28, fileName.byteLength, true); // File name length (n).
    view.setUint16(30, extraField.byteLength, true); // Extra field length (m).
    view.setUint16(32, fileComment.byteLength, true); // File comment length (k).
    view.setUint16(34, 0, true); // Disk number where file starts (or FF FF for ZIP64).
    view.setUint16(36, 1, true); // Internal file attributes.
    view.setUint32(38, 32, true); // External file attributes.
    view.setUint32(42, localHeaderOffset, true); // Relative offset of local file header (or FF FF FF FF for ZIP64). This is the number of bytes between the start of the first disk on which the file occurs, and the start of the local file header. This allows software reading the central directory to locate the position of the file inside the ZIP file.

    let offset = HEADER_SIZE;
    data.set(fileName, offset); // (n) File name.
    offset += fileName.byteLength;
    data.set(extraField, offset); // (m) Extra field.
    offset += extraField.byteLength;
    data.set(fileComment, offset); // (k) File comment.

    return data;
  }

  private createEndOfCentralDirectoryRecord(
    records: number,
    directorySize: number,
    directoryOffset: number,
    fileComment = new Uint8Array()
  ) {
    const HEADER_SIZE = 22;
    const data = new Uint8Array(HEADER_SIZE + fileComment.byteLength);

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint32(0, 0x06054b50, true); // Magic number. Must be 50 4B 05 06.
    view.setUint16(4, 0, true); // Number of this disk (or FF FF for ZIP64).
    view.setUint16(6, 0, true); // Disk where central directory starts (or FF FF for ZIP64).
    view.setUint16(8, records, true); // Number of central directory records on this disk (or FF FF for ZIP64).
    view.setUint16(10, records, true); // Total number of central directory records (or FF FF for ZIP64).
    view.setUint32(12, directorySize, true); // Size of central directory in bytes (or FF FF FF FF for ZIP64).
    view.setUint32(16, directoryOffset, true); // Offset of start of central directory, relative to start of archive (or FF FF FF FF for ZIP64).
    view.setUint16(20, fileComment.byteLength, true); // Comment length (n).

    let offset = HEADER_SIZE;
    data.set(fileComment, offset); // (n) Comment.

    return data;
  }

  private encoder = new TextEncoder();
  private records: {
    lastModified: Date;
    fileUrl: Uint8Array;
    data: BufferSource;
  }[] = [];

  addStr(fileUrl: string, lastModified: Date, data: string) {
    this.records.push({ lastModified, fileUrl: this.encoder.encode(fileUrl), data: this.encoder.encode(data) });
  }

  add(fileUrl: string, lastModified: Date, data: number[]) {
    this.records.push({ lastModified, fileUrl: this.encoder.encode(fileUrl), data: new Uint8Array(data) });
  }

  makeZip(): Blob {
    const directoryHeaders: BufferSource[] = [];
    const result: BufferSource[] = [];

    let localHeaderOffset = 0;
    for (const { lastModified, fileUrl, data } of this.records) {
      const { time, date } = this.convertToDosDate(lastModified);
      const crc = this.crc32(data);
      const localHeader = this.createLocalFileHeader(time, date, crc, data.byteLength, fileUrl);
      result.push(localHeader, data);

      const directoryHeader = this.createCentralDirectoryFileHeader(
        time,
        date,
        crc,
        data.byteLength,
        localHeaderOffset,
        fileUrl
      );
      directoryHeaders.push(directoryHeader);

      localHeaderOffset += localHeader.byteLength + data.byteLength;
    }

    const endOfCentralDirectoryRecord = this.createEndOfCentralDirectoryRecord(
      this.records.length,
      directoryHeaders.reduce((a, c) => a + c.byteLength, 0),
      localHeaderOffset
    );
    result.push(...directoryHeaders, endOfCentralDirectoryRecord);

    return new Blob(result, { type: "application/zip" });
  }
}
