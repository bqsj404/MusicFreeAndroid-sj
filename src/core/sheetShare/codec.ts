/**
 * 歌单分享的 MFS2 编解码（D5）。
 *
 * 格式（与桌面版一致）：
 * ```
 * MFS2:<index>/<total>:<crc32>:<正文UTF-8字节数(base36,4位)>:<正文>
 * ```
 *
 * 为什么不用「JSON + base64url」（v1 `MFS1:` 的做法）：
 * 每首歌在 JSON+base64 下约 63 字节，而纯 UTF-8 行文本只要约 39 字节 ——
 * 一段二维码能装下的歌从 ~16 首变成 ~26 首。代价是要自己处理分隔与转义。
 *
 * 设计要点（照搬桌面版，见文档 10.5）：
 *  - 分隔符用**不可见控制字符**：行内字段 `U+001F`、行分隔 `U+001E`、
 *    元信息分隔 `U+001D`。它们几乎不可能出现在歌名里，但**仍然要转义**，
 *    因为第三方插件的字段不可信
 *  - 切分按 **UTF-8 字节**进行，并**回退到字符边界**，否则会把一个汉字劈成两半
 *  - 校验用**全量 CRC32**（8 位小写十六进制）
 *  - 单片段建议上限 1500 字节 —— 这不是 QR 的理论上限，而是**读取端**限制
 *    （二维码在长图里按 318 设备像素渲染，1500 字节约 2.86 px/模块，
 *    刚好在实测安全线 2.8 之上）
 *  - 片段数上限 256
 *  - 组装时**按 CRC 分组**：一张图里若混入两份歌单的二维码，各收各的；
 *    并以「能否成功拼装」作为最终判据，防止被污染片段凑成假的完整组
 *
 * 注意：RN 运行时（Hermes）没有 `TextEncoder` / `Buffer`，
 * 所以 UTF-8 编解码在这里手写，顺便让它可单测。
 */

export const CODEC_VERSION = 2;
export const FRAGMENT_PREFIX = "MFS2:";
export const LEGACY_PREFIX = "MFS1:";
/** 单片段建议上限（字节） */
export const FRAGMENT_BYTE_LIMIT = 1500;
/** 片段数上限 */
export const MAX_FRAGMENT_COUNT = 256;

const FIELD_SEP = "\u001f";
const ROW_SEP = "\u001e";
const META_SEP = "\u001d";

// ——— UTF-8 编解码（Hermes 无 TextEncoder，手写） ———

/** 字符串 → UTF-8 字节数组 */
export function toUtf8Bytes(input: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
        let code = input.charCodeAt(i);
        // 处理代理对（emoji 等）
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
            const next = input.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
                i++;
            }
        }
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
            out.push(
                0xe0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        } else {
            out.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        }
    }
    return out;
}

/** UTF-8 字节数组 → 字符串 */
export function fromUtf8Bytes(bytes: number[]): string {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
        const b0 = bytes[i];
        let code: number;
        let len: number;
        if (b0 < 0x80) {
            code = b0;
            len = 1;
        } else if ((b0 & 0xe0) === 0xc0) {
            code = b0 & 0x1f;
            len = 2;
        } else if ((b0 & 0xf0) === 0xe0) {
            code = b0 & 0x0f;
            len = 3;
        } else if ((b0 & 0xf8) === 0xf0) {
            code = b0 & 0x07;
            len = 4;
        } else {
            // 非法首字节，跳过
            i++;
            continue;
        }
        if (i + len > bytes.length) {
            break;
        }
        for (let k = 1; k < len; k++) {
            code = (code << 6) | (bytes[i + k] & 0x3f);
        }
        i += len;
        if (code > 0xffff) {
            code -= 0x10000;
            out += String.fromCharCode(0xd800 + (code >> 10));
            out += String.fromCharCode(0xdc00 + (code & 0x3ff));
        } else {
            out += String.fromCharCode(code);
        }
    }
    return out;
}

/** UTF-8 字节数 */
export function utf8Length(input: string): number {
    return toUtf8Bytes(input).length;
}

// ——— CRC32 ———

let crcTable: number[] | null = null;
function getCrcTable(): number[] {
    if (crcTable) {
        return crcTable;
    }
    const table: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    crcTable = table;
    return table;
}

/** CRC32（8 位小写十六进制） */
export function crc32(input: string): string {
    const table = getCrcTable();
    const bytes = toUtf8Bytes(input);
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    return crc.toString(16).padStart(8, "0");
}

// ——— 字段转义 ———

/**
 * 转义字段里的控制字符与反斜杠。
 *
 * 第三方插件的字段不可信，真出现 `U+001F` 之类会直接把行结构撑坏。
 */
export function escapeField(value?: string | null): string {
    if (!value) {
        return "";
    }
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/\u001f/g, "\\u001f")
        .replace(/\u001e/g, "\\u001e")
        .replace(/\u001d/g, "\\u001d");
}

/** 反转义 */
export function unescapeField(value?: string | null): string {
    if (!value) {
        return "";
    }
    return String(value)
        .replace(/\\u001d/g, "\u001d")
        .replace(/\\u001e/g, "\u001e")
        .replace(/\\u001f/g, "\u001f")
        .replace(/\\\\/g, "\\");
}

// ——— 正文编解码 ———

/** 分享载荷里的歌单项（只带还原所需的最小字段） */
export interface ISharedMusicItem {
    platform: string;
    id: string;
    title: string;
    artist?: string;
}

export interface ISharedSheet {
    title?: string;
    platform?: string;
    id?: string;
    musicList: ISharedMusicItem[];
}

/** 歌单 → 正文字符串 */
export function buildPayload(sheet: ISharedSheet): string {
    const meta = [
        escapeField(sheet.title),
        escapeField(sheet.platform),
        escapeField(sheet.id),
    ].join(FIELD_SEP);
    const rows = (sheet.musicList ?? []).map(item =>
        [
            escapeField(item.platform),
            escapeField(item.id),
            escapeField(item.title),
            escapeField(item.artist),
        ].join(FIELD_SEP),
    );
    return [meta, ...rows].join(ROW_SEP);
}

/** 正文 → 歌单（结构不对时返回 null） */
export function parsePayload(payload: string): ISharedSheet | null {
    if (!payload) {
        return null;
    }
    const parts = payload.split(ROW_SEP);
    if (!parts.length) {
        return null;
    }
    const metaFields = parts[0].split(FIELD_SEP);
    const musicList: ISharedMusicItem[] = [];

    for (let i = 1; i < parts.length; i++) {
        const row = parts[i];
        if (!row) {
            continue;
        }
        const fields = row.split(FIELD_SEP);
        const platform = unescapeField(fields[0]);
        const id = unescapeField(fields[1]);
        const title = unescapeField(fields[2]);
        if (!platform || !id) {
            continue;
        }
        musicList.push({
            platform,
            id,
            title,
            artist: unescapeField(fields[3]),
        });
    }

    return {
        title: unescapeField(metaFields[0]),
        platform: unescapeField(metaFields[1]),
        id: unescapeField(metaFields[2]),
        musicList,
    };
}

// ——— 切分 ———

/**
 * 把正文按 UTF-8 字节切成若干片段。
 *
 * 关键是**回退到字符边界**：直接按字节数组切会把一个汉字劈成两半，
 * 拼回来就是乱码。
 */
export function splitPayload(
    payload: string,
    byteLimit = FRAGMENT_BYTE_LIMIT,
): string[] {
    if (!payload) {
        return [];
    }
    if (utf8Length(payload) <= byteLimit) {
        return [payload];
    }
    const fragments: string[] = [];
    let current = "";
    let currentBytes = 0;

    // 逐「字符」累加（用 Array.from 保证代理对不被拆开）
    for (const ch of Array.from(payload)) {
        const chBytes = utf8Length(ch);
        if (currentBytes + chBytes > byteLimit && current) {
            fragments.push(current);
            current = "";
            currentBytes = 0;
        }
        current += ch;
        currentBytes += chBytes;
    }
    if (current) {
        fragments.push(current);
    }
    return fragments.slice(0, MAX_FRAGMENT_COUNT);
}

/**
 * 组装一个片段（编号从 1 开始）。
 *
 * `fullCrc` / `fullByteLength` 描述的是**整个 payload**（不是本片段）：
 * 同一歌单的所有片段共享同样的这两个值 —— 读取端正是靠 CRC 相同来
 * 把散落的片段归成一组，并在拼装完成后用它做整体校验。
 */
export function buildFragment(
    payload: string,
    index: number,
    total: number,
    fullCrc: string,
    fullByteLength: number,
): string {
    const byteLen = fullByteLength.toString(36).padStart(4, "0");
    return `${FRAGMENT_PREFIX}${index}/${total}:${fullCrc}:${byteLen}:${payload}`;
}

/** 歌单 → 片段数组 */
export function encodeSheet(
    sheet: ISharedSheet,
    byteLimit = FRAGMENT_BYTE_LIMIT,
): string[] {
    const payload = buildPayload(sheet);
    const parts = splitPayload(payload, byteLimit);
    const fullCrc = crc32(payload);
    const fullByteLength = utf8Length(payload);
    return parts.map((part, i) =>
        buildFragment(part, i + 1, parts.length, fullCrc, fullByteLength),
    );
}

/** 解析出的单个片段 */
export interface IParsedFragment {
    index: number;
    total: number;
    crc: string;
    byteLength: number;
    payload: string;
}

/**
 * 解析一个片段。
 *
 * 用「正文长度」字段定位正文起点，而不是 `split(":", 5)` ——
 * 正文里可能含 `:`（歌名里很常见）。
 */
export function parseFragment(text?: string | null): IParsedFragment | null {
    if (!text) {
        return null;
    }
    const trimmed = text.trim();
    if (!trimmed.startsWith(FRAGMENT_PREFIX)) {
        return null;
    }
    const body = trimmed.slice(FRAGMENT_PREFIX.length);
    const firstColon = body.indexOf(":");
    if (firstColon < 0) {
        return null;
    }
    const rangePart = body.slice(0, firstColon);
    const rest = body.slice(firstColon + 1);
    const slash = rangePart.indexOf("/");
    if (slash < 0) {
        return null;
    }
    const index = Number(rangePart.slice(0, slash));
    const total = Number(rangePart.slice(slash + 1));
    if (!Number.isFinite(index) || !Number.isFinite(total)) {
        return null;
    }

    const restColon1 = rest.indexOf(":");
    if (restColon1 < 0) {
        return null;
    }
    const crc = rest.slice(0, restColon1);
    const afterCrc = rest.slice(restColon1 + 1);
    const restColon2 = afterCrc.indexOf(":");
    if (restColon2 < 0) {
        return null;
    }
    const byteLength = parseInt(afterCrc.slice(0, restColon2), 36);
    const payload = afterCrc.slice(restColon2 + 1);

    return {
        index,
        total,
        crc,
        byteLength: Number.isFinite(byteLength) ? byteLength : 0,
        payload,
    };
}

/** 一段文本里所有片段 */
export function extractFragments(text?: string | null): IParsedFragment[] {
    if (!text) {
        return [];
    }
    const out: IParsedFragment[] = [];
    // 片段以固定前缀开头，按前缀切开即可（正文里不会出现该前缀）
    const chunks = text.split(FRAGMENT_PREFIX);
    chunks.slice(1).forEach(chunk => {
        const parsed = parseFragment(FRAGMENT_PREFIX + chunk.trim());
        if (parsed) {
            out.push(parsed);
        }
    });
    return out;
}

/**
 * 从一堆片段里组装歌单。
 *
 * **按 CRC 分组**：一张图/一段文本里可能混着两份歌单的二维码，
 * 各组各收各的。并且**以「能否成功拼装」为最终判据** ——
 * 光看数量凑齐不够，被污染的片段可能凑出一个假的完整组。
 */
export function decodeFragments(
    fragments: IParsedFragment[],
): ISharedSheet | null {
    if (!fragments?.length) {
        return null;
    }
    const groups = new Map<string, IParsedFragment[]>();
    fragments.forEach(fragment => {
        const key = `${fragment.total}:${fragment.crc}`;
        const list = groups.get(key) ?? [];
        list.push(fragment);
        groups.set(key, list);
    });

    for (const [, list] of groups) {
        const total = list[0].total;
        if (total <= 0 || total > MAX_FRAGMENT_COUNT) {
            continue;
        }
        // 每个序号只能有一份
        const byIndex = new Map<number, IParsedFragment>();
        let duplicated = false;
        list.forEach(fragment => {
            if (byIndex.has(fragment.index)) {
                duplicated = true;
            }
            byIndex.set(fragment.index, fragment);
        });
        if (duplicated || byIndex.size !== total) {
            continue;
        }
        const ordered: string[] = [];
        for (let i = 1; i <= total; i++) {
            const fragment = byIndex.get(i);
            if (!fragment) {
                break;
            }
            ordered.push(fragment.payload);
        }
        if (ordered.length !== total) {
            continue;
        }
        const payload = ordered.join("");
        // 拼装结果必须自洽：CRC 与字节数都要对上
        if (crc32(payload) !== list[0].crc) {
            continue;
        }
        const sheet = parsePayload(payload);
        if (sheet?.musicList?.length) {
            return sheet;
        }
    }
    return null;
}

/** 便捷：直接从文本导入（含多片段） */
export function decodeSheetFromText(text?: string | null): ISharedSheet | null {
    return decodeFragments(extractFragments(text));
}

/** 把多片段拼成人可读、机器可解析的文本 */
export function buildImportText(fragments: string[]): string {
    return fragments.join("\n");
}

