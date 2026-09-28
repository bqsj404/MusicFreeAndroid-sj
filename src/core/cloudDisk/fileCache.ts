/**
 * 云盘音频的本地缓存（绕开 RNTP 的 headers 透传问题）。
 *
 * 背景：把 `headers` / `userAgent` 交给 `react-native-track-player` 后，
 * ExoPlayer 发出的请求既没有 `Authorization` 也没有目标服务要求的 UA，
 * 导致播放 403（详见 `第4批-云盘实施记录.md` 第 4.1 节）。
 *
 * 因此这里改为：**先用 webdav 把音频下载到应用缓存，再以 `file://` 播放**。
 * 代价是没有边下边播、首次播放需等待下载；但数据胶囊**本来就不支持 Range**
 * （Range 请求返回 200 全量），流式播放的收益本来就有限，所以这个取舍可接受。
 *
 * 缓存策略：按远端存储路径的稳定 hash 命名，已存在且大小一致时直接复用。
 */
import RNFS from "react-native-fs";
import pathConst from "@/constants/pathConst";
import { toPlayableFileUrl } from "@/utils/fileUrl";
import { createCloudDiskClient } from "./client";
import { basename } from "./index";

/** 缓存目录（应用私有 cache 下，避免被系统当媒体扫描） */
const CLOUD_CACHE_DIR = `${pathConst.downloadCachePath}cloud/`;

/** 正在下载中的任务，避免同一文件并发重复下载 */
const inflight = new Map<string, Promise<string | null>>();

/** 把远端存储路径映射成稳定的本地文件名 */
function cacheFileName(remotePath: string): string {
    // 远端名形如 `歌名 - 歌手_<32位hex>.<ext>.zip`，本身就是稳定的；
    // 再用一个短 hash 兜住超长文件名与非法字符
    const raw = basename(remotePath);
    const safe = raw.replace(/[\\/:*?"<>|]/g, "_").slice(-120);
    let hash = 0;
    for (let i = 0; i < remotePath.length; i++) {
        hash = (hash * 31 + remotePath.charCodeAt(i)) | 0;
    }
    return `${(hash >>> 0).toString(16)}-${safe}`;
}

async function ensureDir() {
    try {
        const exists = await RNFS.exists(CLOUD_CACHE_DIR);
        if (!exists) {
            await RNFS.mkdir(CLOUD_CACHE_DIR);
        }
    } catch (e) {
        // 目录已存在时忽略
    }
}

/**
 * 确保远端音频已缓存到本地。
 *
 * @param remotePath 远端**存储路径**
 * @param remoteSize 远端大小（用于判断缓存是否仍然有效；0 表示未知，则总是重新下载）
 * @returns 本地 `file://` 路径；失败返回 null
 */
export async function ensureCloudFileCached(
    remotePath: string,
    remoteSize = 0,
): Promise<string | null> {
    if (!remotePath) {
        return null;
    }
    const filePath = `${CLOUD_CACHE_DIR}${cacheFileName(remotePath)}`;
    /*
     * 交给播放器的一律用 [toPlayableFileUrl]（会做百分号编码）：
     * 缓存名保留了远端原名（含中文/空格），而 ExoPlayer 拿到未编码的
     * `file://` URL 会 `MalformedURLException` —— 与本地音乐那条
     * 「下载的李白播不了」是同一个根因（第 7 批 · 问题 2）。
     * 下面的文件系统操作（exists/stat/unlink）继续用未编码的 filePath。
     */
    const fileUri = toPlayableFileUrl(filePath);

    // 已有缓存且大小一致 → 直接复用
    try {
        if (await RNFS.exists(filePath)) {
            const stat = await RNFS.stat(filePath);
            const size = Number(stat?.size ?? 0);
            if (size > 0 && (remoteSize <= 0 || size === remoteSize)) {
                return fileUri;
            }
        }
    } catch (e) {
        // 落到重新下载
    }

    // 同一文件并发只下一次
    const existing = inflight.get(remotePath);
    if (existing) {
        return existing;
    }

    const task = (async (): Promise<string | null> => {
        const client = createCloudDiskClient();
        if (!client) {
            return null;
        }
        try {
            await ensureDir();
            const contents = await client.getFileContents(remotePath, {
                format: "binary",
            });
            const base64 = toBase64(contents);
            if (!base64) {
                return null;
            }
            // 先写临时文件再改名，避免下载中断留下半截文件被当成有效缓存
            const tmpPath = `${filePath}.part`;
            await RNFS.writeFile(tmpPath, base64, "base64");
            try {
                if (await RNFS.exists(filePath)) {
                    await RNFS.unlink(filePath);
                }
            } catch (e) {
                // 忽略
            }
            await RNFS.moveFile(tmpPath, filePath);
            return fileUri;
        } catch (e) {
            return null;
        } finally {
            inflight.delete(remotePath);
        }
    })();

    inflight.set(remotePath, task);
    return task;
}

/** 把 webdav 返回的二进制内容转成 base64（不依赖 Buffer） */
function toBase64(contents: any): string | null {
    if (!contents) {
        return null;
    }
    try {
        if (typeof contents === "string") {
            // 有些实现直接给 base64 字符串
            return contents;
        }
        const bytes: Uint8Array =
            contents instanceof Uint8Array
                ? contents
                : contents?.buffer instanceof ArrayBuffer
                  ? new Uint8Array(contents.buffer)
                  : new Uint8Array(contents);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(
                null,
                Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[],
            );
        }
        return Base64.btoa(binary);
    } catch (e) {
        return null;
    }
}

import Base64 from "@/utils/base64";

/** 清空云盘音频缓存（设置页「清理缓存」可接） */
export async function clearCloudFileCache(): Promise<void> {
    try {
        if (await RNFS.exists(CLOUD_CACHE_DIR)) {
            await RNFS.unlink(CLOUD_CACHE_DIR);
        }
    } catch (e) {
        // 忽略
    }
    inflight.clear();
}

/** 缓存占用（字节）与文件数 */
export async function getCloudCacheUsage(): Promise<{
    bytes: number;
    files: number;
}> {
    try {
        if (!(await RNFS.exists(CLOUD_CACHE_DIR))) {
            return { bytes: 0, files: 0 };
        }
        const entries = await RNFS.readDir(CLOUD_CACHE_DIR);
        let bytes = 0;
        let files = 0;
        entries.forEach(entry => {
            if (entry.isFile()) {
                files++;
                bytes += Number(entry.size ?? 0);
            }
        });
        return { bytes, files };
    } catch (e) {
        return { bytes: 0, files: 0 };
    }
}
