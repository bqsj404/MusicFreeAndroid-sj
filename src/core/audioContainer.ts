/**
 * 音频容器嗅探（文件头 magic bytes）。
 *
 * 为什么需要：下载来的文件**扩展名经常不可信** —— 服务端把 m4a 标成 .mp3、
 * 把 flac 直接加个 .mp3 后缀都很常见。仅凭扩展名决定交给哪个解码器，
 * 轻则播不出声，重则全程静音却「显示在播放」。
 *
 * 判定只用文件开头这几十个字节，纯函数，便于单测。
 * 参考各容器的公开 magic：
 *
 *   ID3 / 0xFFFx   MPEG 音频（mp3），前者带 ID3v2 标签头
 *   fLaC           FLAC
 *   OggS           Ogg（多为 Vorbis/Opus）
 *   RIFF....WAVE   WAV
 *   ....ftyp       ISO BMFF（m4a/mp4），需再看 brand
 *   0x3026B275     ASF（wma）
 *   MAC  / APETAG  Monkey's Audio（ape，标签可能在尾部，故也认头部签名）
 *   0xFFF1/0xFFF9  ADTS（aac）
 */
export type AudioContainer =
    | "mp3"
    | "m4a"
    | "flac"
    | "ogg"
    | "wav"
    | "aac"
    | "ape"
    | "wma"
    | "unknown";

/** 嗅探所需的最小字节数 */
export const SNIFF_BYTES = 16;

function at(bytes: ArrayLike<number>, index: number): number {
    return index < bytes.length ? bytes[index] & 0xff : -1;
}

/** 从偏移处匹配 ASCII 串 */
function matchAscii(
    bytes: ArrayLike<number>,
    offset: number,
    text: string,
): boolean {
    for (let i = 0; i < text.length; i++) {
        if (at(bytes, offset + i) !== text.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

/**
 * 按文件头字节判断容器格式。
 *
 * @param bytes 文件开头若干字节（建议 >= [SNIFF_BYTES]）
 * @returns 容器格式；无法识别时返回 `"unknown"`
 */
export function detectContainer(bytes: ArrayLike<number>): AudioContainer {
    if (!bytes || bytes.length < 4) {
        return "unknown";
    }

    // ID3v2 标签头 → 一定是 MPEG 音频
    if (matchAscii(bytes, 0, "ID3")) {
        return "mp3";
    }
    // fLaC
    if (matchAscii(bytes, 0, "fLaC")) {
        return "flac";
    }
    // OggS
    if (matchAscii(bytes, 0, "OggS")) {
        return "ogg";
    }
    // RIFF....WAVE
    if (matchAscii(bytes, 0, "RIFF") && matchAscii(bytes, 8, "WAVE")) {
        return "wav";
    }
    // ....ftyp（ISO BMFF / MP4 家族，音频通常是 m4a）
    if (matchAscii(bytes, 4, "ftyp")) {
        return "m4a";
    }
    // ASF（wma）
    if (
        at(bytes, 0) === 0x30 &&
        at(bytes, 1) === 0x26 &&
        at(bytes, 2) === 0xb2 &&
        at(bytes, 3) === 0x75
    ) {
        return "wma";
    }
    // Monkey's Audio：头部 "MAC " 或尾部标签 "APETAGEX"（后者可能不在前 16 字节内）
    if (matchAscii(bytes, 0, "MAC ")) {
        return "ape";
    }
    // MPEG 帧同步：FF Ex/Fx
    if (at(bytes, 0) === 0xff) {
        const second = at(bytes, 1);
        // ADTS(AAC): FFF1 / FFF9
        if (second === 0xf1 || second === 0xf9) {
            return "aac";
        }
        // MPEG 音频: FFFB / FFF3 / FFF2 / FFFA
        if (
            second === 0xfb ||
            second === 0xf3 ||
            second === 0xf2 ||
            second === 0xfa
        ) {
            return "mp3";
        }
    }

    return "unknown";
}

/**
 * 按扩展名猜测容器（**不可信**，仅在嗅探失败时兜底）。
 */
export function guessContainerByExt(ext: string): AudioContainer {
    const key = (ext ?? "").toLowerCase().replace(/^\./, "");
    switch (key) {
        case "mp3":
            return "mp3";
        case "m4a":
        case "mp4":
        case "aac":
            return key === "aac" ? "aac" : "m4a";
        case "flac":
            return "flac";
        case "ogg":
        case "opus":
            return "ogg";
        case "wav":
            return "wav";
        case "ape":
            return "ape";
        case "wma":
            return "wma";
        default:
            return "unknown";
    }
}

/**
 * 扩展名与真实容器是否冲突（用于「扩展名不可信」的告警与修正）。
 *
 * 同一家族内不算冲突（如 `.mp4` 装 m4a 音频、`.opus` 装 ogg 容器）。
 */
export function isExtMismatch(
    ext: string,
    container: AudioContainer,
): boolean {
    if (container === "unknown") {
        return false;
    }
    const guessed = guessContainerByExt(ext);
    if (guessed === "unknown") {
        return false;
    }
    if (guessed === container) {
        return false;
    }
    // 同族放行
    const sameFamily =
        (guessed === "m4a" && container === "aac") ||
        (guessed === "aac" && container === "m4a");
    return !sameFamily;
}
