/**
 * 云盘写操作：确保远端目录、上传单个文件。
 *
 * 上传细节：
 *  - 文件名先经 [buildUploadFileName] 组装为逻辑名，再经 [toStoredName] 映射为
 *    服务端要求的 `<名>_<hash>.<ext>.zip`（数据胶囊只接受 `.zip` 结尾）
 *  - 二进制内容用 `react-native-fs` 读为 base64，再转 `Uint8Array` 交给 webdav，
 *    避免依赖 Node `Buffer`（RN 侧未提供 polyfill）
 */
import { createCloudDiskClient } from "./client";
import { CLOUD_LYRIC_DIR, CLOUD_MUSIC_DIR, CLOUD_ROOT_DIR, CLOUD_TRASH_DIR } from "./constant";
import {
    buildUploadFileName,
    sanitizeFileName,
    toStoredName,
    toStoredPath,
} from "./zoteroDavCompat";
import { basename, extname, parseCloudFileName } from "./index";
import Base64 from "@/utils/base64";
import RNFS from "react-native-fs";

/** 目录存在则不动，不存在则递归创建（缺哪级建哪级） */
export async function ensureRemoteDir(remoteDir: string): Promise<boolean> {
    const client = createCloudDiskClient();
    if (!client) {
        return false;
    }
    const segments = remoteDir.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
        current += `/${segment}`;
        try {
            if (!(await client.exists(current))) {
                await client.createDirectory(current);
            }
        } catch (e: any) {
            // 并发或已存在时忽略，其他错误继续抛
            if (!/exists|405|301/i.test(String(e?.message ?? ""))) {
                throw e;
            }
        }
    }
    return true;
}

/** 确保音频目录存在（上传前调用） */
export function ensureMusicDir() {
    return ensureRemoteDir(CLOUD_MUSIC_DIR);
}

/** 确保歌词目录存在 */
export function ensureLyricDir() {
    return ensureRemoteDir(CLOUD_LYRIC_DIR);
}

/** 确保回收站目录存在 */
export function ensureTrashDir() {
    return ensureRemoteDir(CLOUD_TRASH_DIR);
}

/** 确保根目录存在 */
export function ensureRootDir() {
    return ensureRemoteDir(CLOUD_ROOT_DIR);
}

/** base64 → Uint8Array（不依赖 Buffer；用项目自带的 Base64 实现） */
export function base64ToBytes(base64: string): Uint8Array {
    const binary = Base64.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** 单个上传任务 */
export interface IUploadTask {
    /** 本地文件绝对路径（可带 file:// 前缀） */
    filePath: string;
    /** 歌名（用于生成远端文件名与清单记账） */
    title?: string;
    /** 歌手 */
    artist?: string;
    /** 来源平台（清单记账用，默认「云盘」） */
    platform?: string;
    /** 平台内 id（清单记账用） */
    musicId?: string;
}

/** 上传结果 */
export interface IUploadResult {
    uploaded: number;
    skipped: number;
    failed: number;
    errors: string[];
}

/** 去掉 file:// 前缀 */
function toPlainPath(path: string): string {
    return path.startsWith("file://") ? decodeURIComponent(path.slice(7)) : path;
}

/**
 * 上传一首本地文件到云盘。
 *
 * @returns `"uploaded" | "skipped" | { failed: string }`
 */
export async function uploadLocalFile(
    task: IUploadTask,
    remoteSizes: Map<string, number>,
): Promise<"uploaded" | "skipped" | { failed: string }> {
    const client = createCloudDiskClient();
    if (!client) {
        return { failed: "未配置 WebDAV" };
    }
    const plainPath = toPlainPath(task.filePath);
    try {
        const stat = await RNFS.stat(plainPath);
        const size = Number(stat.size ?? 0);
        const ext = extname(plainPath);
        const logicalName = buildUploadFileName(
            task.title || parseCloudFileName(basename(plainPath)).title,
            task.artist || parseCloudFileName(basename(plainPath)).artist,
            ext,
        );

        // 同名同大小 → 跳过
        if (remoteSizes.get(logicalName) === size) {
            return "skipped";
        }

        const storedPath = `${CLOUD_MUSIC_DIR}/${toStoredName(logicalName)}`;
        const base64 = await RNFS.readFile(plainPath, "base64");
        // 传 base64 字符串：webdav 内部会据此算出长度并转二进制。
        // 注意不能传 Uint8Array —— 实测报
        //   「Cannot calculate data length: Invalid type」
        await client.putFileContents(storedPath, base64 as any, {
            overwrite: true,
        });
        remoteSizes.set(logicalName, size);
        return "uploaded";
    } catch (e: any) {
        return { failed: `${e?.message ?? String(e)}` };
    }
}

/** 歌词文件名 → 远端存储路径 */
export function lyricRemotePath(logicalName: string): string {
    const safe = sanitizeFileName(logicalName.replace(/\.lrc$/i, "")) + ".lrc";
    return `${CLOUD_LYRIC_DIR}/${toStoredName(safe)}`;
}

export { toStoredPath, basename };




