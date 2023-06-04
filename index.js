const colorspaces = {
    srgb: 0,
    linear: 1,
};

const colorspaceNames = {
    0: "srgb",
    1: "linear",
};

const MAGIC_QOIF = 0x716f6966;

const QOI_OP_RGB = 0b11111110;
const QOI_OP_RGBA = 0b11111111;
const QOI_OP_INDEX = 0b00_000000;
const QOI_OP_DIFF = 0b01_000000;
const QOI_OP_LUMA = 0b10_000000;
const QOI_OP_RUN = 0b11_000000;

const colorHash = (r, g, b, a) => (r * 3 + g * 5 + b * 7 + a * 11) & 63;

export function encode(data, options = {}) {
    let { width, height, channels = 4, colorspace = "srgb" } = options;
    const colorspaceId = colorspaces[colorspace];

    data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    width = Number(width) >>> 0;
    height = Number(height) >>> 0;

    if (channels !== 3 && channels !== 4) {
        throw new Error(`Invalid number of channels: ${JSON.stringify(channels)}, expected 3 or 4.`);
    }

    if (colorspaceId === undefined) {
        throw new Error(`Invalid colorspace: ${JSON.stringify(colorspace)}, expected "srgb" or "linear".`);
    }

    if (data.byteLength !== width * height * channels) {
        throw new Error(`Invalid data size: ${data.byteLength} bytes, expected ${width * height * channels} bytes.`);
    }

    const index = new Uint32Array(64);
    const result = new Uint8Array(14 + width * height * 5 + 8);
    let o = 0;

    const writeUint32 = (v) => {
        result[o++] = v >>> 24;
        result[o++] = v >>> 16;
        result[o++] = v >>> 8;
        result[o++] = v;
    };

    const writeUint8 = (v) => {
        result[o++] = v;
    };

    // Header

    writeUint32(MAGIC_QOIF); // "qoif"
    writeUint32(width);
    writeUint32(height);
    writeUint8(channels);
    writeUint8(colorspaceId);

    // Data

    let run = 0;

    let r = 0x00,
        g = 0x00,
        b = 0x00,
        a = 0xff,
        v = 0x000000ff;
    let _r, _g, _b, _a, _v;

    for (let i = 0; i < width * height * channels; i += channels) {
        _r = r;
        _g = g;
        _b = b;
        _a = a;
        _v = v;

        r = data[i + 0];
        g = data[i + 1];
        b = data[i + 2];
        a = channels === 4 ? data[i + 3] : _a;
        v = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

        if (v === _v) {
            ++run;

            if (run === 62) {
                writeUint8(QOI_OP_RUN | ((run - 1) & 0b111111));
                run = 0;
            }

            continue;
        } else if (run !== 0) {
            writeUint8(QOI_OP_RUN | ((run - 1) & 0b111111));
            run = 0;
        }

        // QOI_OP_INDEX
        const indexPos = colorHash(r, g, b, a);

        if (v === index[indexPos]) {
            writeUint8(QOI_OP_INDEX | indexPos);
            continue;
        }

        index[indexPos] = v;

        if (a === _a) {
            // QOI_OP_DIFF
            const dr = r - _r;
            const dg = g - _g;
            const db = b - _b;

            const _dr = ((dr & 0xff) << 24) >> 24;
            const _dg = ((dg & 0xff) << 24) >> 24;
            const _db = ((db & 0xff) << 24) >> 24;

            if (_dr > -3 && _dr < 2 && _dg > -3 && _dg < 2 && _db > -3 && _db < 2) {
                const __dr = _dr + 2;
                const __dg = _dg + 2;
                const __db = _db + 2;

                writeUint8(QOI_OP_DIFF | (__dr << 4) | (__dg << 2) | __db);
                continue;
            }

            // QOI_OP_LUMA
            const dr_dg = dr - dg;
            const db_dg = db - dg;

            const _dr_dg = ((dr_dg & 0xff) << 24) >> 24;
            const _db_dg = ((db_dg & 0xff) << 24) >> 24;

            if (_dg > -33 && _dg < 32 && _dr_dg > -9 && _dr_dg < 8 && _db_dg > -9 && _db_dg < 8) {
                const __dg = _dg + 32;
                const __dr_dg = _dr_dg + 8;
                const __db_dg = _db_dg + 8;

                writeUint8(QOI_OP_LUMA | __dg);
                writeUint8((__dr_dg << 4) | __db_dg);
                continue;
            }

            // QOI_OP_RGB
            writeUint8(QOI_OP_RGB);
            writeUint8(r);
            writeUint8(g);
            writeUint8(b);
        } else {
            // QOI_OP_RGBA
            writeUint8(QOI_OP_RGBA);
            writeUint8(r);
            writeUint8(g);
            writeUint8(b);
            writeUint8(a);
        }
    }

    if (run > 0) {
        writeUint8(QOI_OP_RUN | ((run - 1) & 0b111111));
    }

    // End

    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x00);
    writeUint8(0x01);

    return result.slice(0, o);
}

export function decode(data, options = {}) {
    const { channels: outputChannels = 4 } = options;

    if (outputChannels !== 3 && outputChannels !== 4) {
        throw new Error(`Invalid number of output channels: ${outputChannels}, expected 3 or 4.`);
    }

    if (data.byteLength < 14) {
        throw new Error(`Invalid data size: ${data.byteLength} bytes, expected at least 14 bytes.`);
    }

    // Header

    const headerView = new DataView(data.buffer, data.byteOffset, 14);

    const magic = headerView.getUint32(0);
    if (magic !== MAGIC_QOIF) {
        throw new Error(`Data is not QOI.`);
    }

    const width = headerView.getUint32(4);
    const height = headerView.getUint32(8);
    const channels = headerView.getUint8(12);
    const colorspaceId = headerView.getUint8(13);
    const colorspace = colorspaceNames[colorspaceId];

    if (channels !== 3 && channels !== 4) {
        throw new Error(`Invalid QOI: ${channels} channels, expected 3 or 4.`);
    }

    if (colorspace === undefined) {
        throw new Error(`Invalid QOI: ${colorspaceId} is not a valid colorspace.`);
    }

    if (width * height > 0 && data.byteLength === 14) {
        throw new Error(`Invalid data size: 14 bytes, expected at least 15 bytes.`);
    }

    // Data

    data = new Uint8Array(data.buffer, data.byteOffset + 14, data.byteLength - 14);

    const index = new Uint32Array(64);
    const result = new Uint8Array(width * height * outputChannels);
    let o = 0,
        i = 0;

    const readUint8 = () =>
        data[i++] ??
        (() => {
            throw new Error(`Unexpected end of data.`);
        })();

    const writeRGBA = (r, g, b, a) => {
        result[o++] = r;
        result[o++] = g;
        result[o++] = b;

        if (outputChannels === 4) {
            result[o++] = a;
        }
    };

    let r = 0x00,
        g = 0x00,
        b = 0x00,
        a = 0xff;
    let _r, _g, _b, _a;

    while (o < result.length) {
        let op = readUint8();

        _r = r;
        _g = g;
        _b = b;
        _a = a;

        const indexPos = colorHash(r, g, b, a);
        index[indexPos] = (r << 24) | (g << 16) | (b << 8) | a;

        if (op === QOI_OP_RGB) {
            // QOI_OP_RGB
            r = readUint8();
            g = readUint8();
            b = readUint8();
            a = _a;

            writeRGBA(r, g, b, a);
            continue;
        }

        if (op === QOI_OP_RGBA) {
            // QOI_OP_RGBA
            r = readUint8();
            g = readUint8();
            b = readUint8();
            a = readUint8();

            writeRGBA(r, g, b, a);
            continue;
        }

        const flag = op & 0b11_000000;

        if (flag === QOI_OP_LUMA) {
            // QOI_OP_LUMA
            const dg = (op & 0b00_111111) - 32;

            op = readUint8();
            const dr_dg = ((op >>> 4) & 0b1111) - 8;
            const db_dg = (op & 0b1111) - 8;

            const dr = (dr_dg + dg) & 0xff;
            const db = (db_dg + dg) & 0xff;

            r = (_r + dr) & 0xff;
            g = (_g + dg) & 0xff;
            b = (_b + db) & 0xff;
            a = _a;

            writeRGBA(r, g, b, a);
            continue;
        }

        if (flag === QOI_OP_INDEX) {
            // QOI_OP_INDEX
            const indexPos = op & 0b00_111111;
            const indexVal = index[indexPos];

            r = (indexVal >>> 24) & 0xff;
            g = (indexVal >>> 16) & 0xff;
            b = (indexVal >>> 8) & 0xff;
            a = indexVal & 0xff;

            writeRGBA(r, g, b, a);
            continue;
        }

        if (flag === QOI_OP_DIFF) {
            // QOI_OP_DIFF
            const d = op & 0b00_111111;
            const dr = ((d >>> 4) & 0b11) - 2;
            const dg = ((d >>> 2) & 0b11) - 2;
            const db = (d & 0b11) - 2;

            r = (_r + dr) & 0xff;
            g = (_g + dg) & 0xff;
            b = (_b + db) & 0xff;
            a = _a;

            writeRGBA(r, g, b, a);
            continue;
        }

        if (flag === QOI_OP_RUN) {
            // QOI_OP_RUN
            const run = (op & 0b00_111111) + 1;

            for (let j = 0; j < run; j++) {
                writeRGBA(r, g, b, a);
            }

            continue;
        }

        throw new Error("WTF");
    }

    return {
        width,
        height,
        channels,
        colorspace,
        data: result,
    };
}

export const QOI = {
    encode,
    decode,
};

export default {
    ...QOI,
    QOI,
};
