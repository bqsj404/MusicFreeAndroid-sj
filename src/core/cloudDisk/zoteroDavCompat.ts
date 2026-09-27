/**
 * 「中国科技云数据胶囊」（`data.cstcloud.cn`）的 WebDAV 兼容层。
 *
 * 移植自桌面版 `src/infra/cloudDisk/main/zoteroDavCompat.ts`（逐字节等价，
 * 否则两端对同一个网盘账号看到的文件名会不一致，历史文件直接读不到）。
 *
 * 该服务是「只认 Zotero 客户端」的 DAV 网关，有两条硬性要求：
 *  1. 请求必须带 Zotero 的 User-Agent，否则被拒
 *  2. **上传的文件名必须以 `.zip` 结尾**（列目录 / 建目录 / MOVE 不校验）
 *
 * 因此上传时把文件名映射成：
 *      `<原名去扩展名>_<HMAC-SHA256 前 32 位小写 hex>.<原扩展名>.zip`
 * 无扩展名时映射为 `<原名>_<hash>.zip`；读取时再逆向还原为逻辑名。
 *
 * 注意：
 *  - HMAC key 与算法**不可更改**，改了历史文件就认不出来
 *  - 映射是幂等的（已是映射名则原样返回）
 */
import CryptoJs from "crypto-js";

/** 只对这些主机启用兼容（与桌面版一致） */
export const ZOTERO_ONLY_HOSTS = new Set(["data.cstcloud.cn"]);

/** Zotero 客户端 UA：服务端按 UA 判定客户端类型 */
export const ZOTERO_DAV_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 Zotero/8.0";

/** HMAC key（与桌面版逐字节一致，勿改） */
const HMAC_KEY = "MusicFree/dav-compat/v1";

/** 映射名识别：`_<32位hex>.<ext>.zip` */
const MAPPED_NAME_RE = /_([0-9a-f]{32})\.([^./\\]*)\.zip$/i;

/** 取 URL 的 host（解析失败返回空串） */
function hostOf(url: string): string {
    try {
        const matched = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url ?? "");
        if (!matched) {
            return "";
        }
        return matched[1].split("@").pop()!.split(":")[0].toLowerCase();
    } catch (e) {
        return "";
    }
}

/** 是否是需要兼容层的主机 */
export function isZoteroOnlyDav(url?: string | null): boolean {
    if (!url) {
        return false;
    }
    return ZOTERO_ONLY_HOSTS.has(hostOf(url));
}

/**
 * 该服务需要的额外请求头。
 *
 * 非目标主机返回 `undefined`（不影响普通 WebDAV 的行为）。
 */
export function davExtraHeaders(
    url?: string | null,
): Record<string, string> | undefined {
    return isZoteroOnlyDav(url) ? { "User-Agent": ZOTERO_DAV_UA } : undefined;
}

/** 文件名（逻辑名）的 HMAC-SHA256 前 32 位小写 hex */
function hashOf(fileName: string): string {
    return CryptoJs.HmacSHA256(fileName, HMAC_KEY).toString(CryptoJs.enc.Hex).slice(0, 32);
}

/**
 * 逻辑名 → 存储名（上传 / MOVE 目标用）。
 *
 * `晴天 - 周杰伦.mp3` → `晴天 - 周杰伦_<hash>.mp3.zip`
 * `无扩展名`         → `无扩展名_<hash>.zip`
 */
export function toStoredName(fileName: string): string {
    if (!fileName || MAPPED_NAME_RE.test(fileName)) {
        return fileName;
    }
    const dot = fileName.lastIndexOf(".");
    if (dot <= 0) {
        return `${fileName}_${hashOf(fileName)}.zip`;
    }
    return `${fileName.slice(0, dot)}_${hashOf(fileName)}.${fileName.slice(dot + 1)}.zip`;
}

/**
 * 存储名 → 逻辑名（展示 / 解析歌曲信息用）。
 *
 * 非映射名原样返回。
 */
export function toLogicalName(storedName: string): string {
    if (!storedName) {
        return storedName;
    }
    const matched = MAPPED_NAME_RE.exec(storedName);
    if (!matched) {
        return storedName;
    }
    const base = storedName.slice(0, storedName.length - matched[0].length);
    return `${base}.${matched[2]}`;
}

/** 最后一个路径段的替换（保持其余部分不变） */
function replaceLastSegment(remotePath: string, mapper: (name: string) => string): string {
    if (!remotePath) {
        return remotePath;
    }
    const slash = remotePath.lastIndexOf("/");
    const dir = slash >= 0 ? remotePath.slice(0, slash + 1) : "";
    const name = slash >= 0 ? remotePath.slice(slash + 1) : remotePath;
    return dir + mapper(name);
}

/** 逻辑路径 → 存储路径 */
export function toStoredPath(remotePath: string): string {
    return replaceLastSegment(remotePath, toStoredName);
}

/** 存储路径 → 逻辑路径 */
export function toLogicalPath(remotePath: string): string {
    return replaceLastSegment(remotePath, toLogicalName);
}
