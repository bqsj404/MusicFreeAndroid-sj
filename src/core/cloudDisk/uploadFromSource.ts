/**
 * 从**在线音源直接上传**到云盘（第 7 批 · 问题 6）。
 *
 * 背景：云盘页只有「上传本地音乐」这一个入口，而用户在**搜索结果 /
 * 推荐歌单 / 排行榜**里看到一首歌时想存到云盘，必须先下载、再回云盘页
 * 上传 —— 中间那一步纯属多余，而且下载目录会多留一份文件。
 * 桌面版的右键菜单里就有「传至云盘」，这里补齐同等能力。
 *
 * 与 `localUpload.ts` 的分工：
 *  - `localUpload` 处理「本地音乐库里已有的文件」（批量、带进度）
 *  - 本文件处理「任意一个音乐条目」（单曲、可能要先取源下载到临时文件）
 *
 * 记账口径与桌面版一致：**从音源直传的条目 `localPath` 记为 `null`**，
 * 这样它永远不会被「本地文件已不存在」的孤儿对账误删。
 */
import RNFS from "react-native-fs";
import pathConst from "@/constants/pathConst";
import Config from "@/core/appConfig";
import pluginManager from "@/core/pluginManager";
import { buildMediaNameKey } from "@/core/mediaNameKey";
import { getLocalPath } from "@/utils/mediaUtils";
import { toPlainFilePath } from "@/utils/fileUrl";
import { getQualityOrder } from "@/utils/qualities";
import { createCloudDiskClient } from "./client";
import { CLOUD_MUSIC_DIR } from "./constant";
import { extname, listCloudFiles } from "./index";
import { buildUploadFileName, toStoredName } from "./zoteroDavCompat";
import { ensureMusicDir, uploadLocalFile, type IUploadTask } from "./upload";
import { upsertUpload } from "./uploadRecords";

/** 取源下载的临时目录（应用私有 cache，不会被媒体扫描器看到） */
const TEMP_DIR = `${pathConst.downloadCachePath}uploadCache/`;

export interface IUploadFromSourceResult {
    status: "uploaded" | "skipped" | "failed";
    /** 失败原因（仅 status === "failed"） */
    reason?: string;
}

async function ensureTempDir(): Promise<void> {
    try {
        if (!(await RNFS.exists(TEMP_DIR))) {
            await RNFS.mkdir(TEMP_DIR);
        }
    } catch (e) {
        // 目录已存在时忽略
    }
}

/** 临时文件名：时间戳 + 随机数，避免并发撞名 */
function tempFilePath(ext: string): string {
    return `${TEMP_DIR}${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
}

/** 从 URL 上摘扩展名（去掉 query / hash），兜底 `.mp3` */
function extensionFromUrl(url: string): string {
    const clean = url.split("?")[0].split("#")[0];
    const ext = extname(clean);
    return /^\.[a-z0-9]{1,5}$/i.test(ext) ? ext : ".mp3";
}

type Materialized =
    | { ok: true; path: string; temp: boolean }
    | { ok: false; reason: string };

/**
 * 把任意音乐条目落成一个**本地可读的文件**，供上传使用。
 *
 * 顺序：条目自带的本地文件 → 云盘/本地优先命中 → 插件取源（在线下载到临时文件）。
 */
async function materializeSource(
    musicItem: IMusic.IMusicItem,
    quality?: IMusic.IQualityKey,
): Promise<Materialized> {
    // 1) 本地文件优先（已下载过的歌不该再走一遍网络）
    const localPath = getLocalPath(musicItem);
    if (localPath) {
        const plain = toPlainFilePath(localPath);
        try {
            if (await RNFS.exists(plain)) {
                return { ok: true, path: plain, temp: false };
            }
        } catch (e) {
            // 落到取源
        }
    }

    // 2) 取源
    let url = musicItem.url;
    let headers: Record<string, string> | undefined;
    const plugin = pluginManager.getByMedia(musicItem);
    if (plugin?.methods?.getMediaSource) {
        const qualityOrder = getQualityOrder(
            quality ??
                Config.getConfig("basic.defaultDownloadQuality") ??
                "standard",
            Config.getConfig("basic.downloadQualityOrder") ?? "asc",
        );
        for (const q of qualityOrder) {
            try {
                const data = await plugin.methods.getMediaSource(musicItem, q);
                if (data?.url) {
                    url = data.url;
                    headers = data.headers as Record<string, string> | undefined;
                    break;
                }
            } catch (e) {
                // 换下一个音质
            }
        }
    }

    if (!url) {
        return { ok: false, reason: "无法获取音源" };
    }

    // 3) 取到的还是本地文件（云盘缓存 / 本地优先）
    if (url.startsWith("file://")) {
        const plain = toPlainFilePath(url);
        try {
            if (await RNFS.exists(plain)) {
                return { ok: true, path: plain, temp: false };
            }
        } catch (e) {
            // 落到失败
        }
        return { ok: false, reason: "本地文件不存在" };
    }

    // 4) 在线源：下载到临时文件再上传。
    //    这里没有做「边下边传」，因为 webdav 客户端要一次性拿到全部内容
    //    （见 upload.ts 的注释：不能传 Uint8Array，只能传 base64）。
    await ensureTempDir();
    const target = tempFilePath(extensionFromUrl(url));
    try {
        const { promise } = RNFS.downloadFile({
            fromUrl: url,
            toFile: target,
            headers,
            background: true,
        });
        const res = await promise;
        const statusCode = Number(res?.statusCode ?? 0);
        if (statusCode >= 400 || statusCode === 0) {
            throw new Error(`HTTP ${statusCode}`);
        }
        return { ok: true, path: target, temp: true };
    } catch (e: any) {
        try {
            if (await RNFS.exists(target)) {
                await RNFS.unlink(target);
            }
        } catch (cleanupError) {
            // 忽略
        }
        return { ok: false, reason: e?.message ?? String(e) };
    }
}

/**
 * 上传单个音乐条目到云盘。
 *
 * @param musicItem 任意来源的条目（搜索结果 / 歌单 / 排行榜 / 本地库均可）
 * @param quality   可选，指定音质；不传则用「设置 → 下载」里的默认音质
 */
export async function uploadMusicItemToCloud(
    musicItem: IMusic.IMusicItem,
    quality?: IMusic.IQualityKey,
): Promise<IUploadFromSourceResult> {
    if (!createCloudDiskClient()) {
        return { status: "failed", reason: "cloudDiskNotConfigured" };
    }

    const materialized = await materializeSource(musicItem, quality);
    if (!materialized.ok) {
        return { status: "failed", reason: materialized.reason };
    }
    const { path, temp } = materialized;

    try {
        await ensureMusicDir();

        // 远端「逻辑名 → 大小」索引，用于同名同大小跳过（与 localUpload 一致）
        const remoteSizes = new Map<string, number>();
        try {
            const files = await listCloudFiles(true);
            files.forEach(file => remoteSizes.set(file.name, file.size));
        } catch (e) {
            // 列目录失败不阻塞上传
        }

        const task: IUploadTask = {
            filePath: path,
            title: musicItem.title,
            artist: musicItem.artist,
            platform: musicItem.platform,
            musicId: String(musicItem.id ?? path),
        };

        const outcome = await uploadLocalFile(task, remoteSizes);
        if (outcome !== "uploaded" && outcome !== "skipped") {
            return {
                status: "failed",
                reason: (outcome as { failed?: string })?.failed ?? "上传失败",
            };
        }

        // 记账：远端逻辑路径与 uploadLocalFile 内部保持一致
        const ext = extname(path);
        const logicalName = buildUploadFileName(
            musicItem.title,
            musicItem.artist,
            ext,
        );
        const remotePath = `${CLOUD_MUSIC_DIR}/${toStoredName(logicalName)}`;
        upsertUpload({
            platform: musicItem.platform || "云盘",
            musicId: String(musicItem.id ?? logicalName),
            title: musicItem.title ?? "",
            artist: musicItem.artist ?? "",
            remotePath,
            // 直传没有留下本地文件，必须记 null：
            // 否则对账时会把它当成「本地文件已丢失」的孤儿
            localPath: null,
            source: "manual",
            size: remoteSizes.get(logicalName) ?? 0,
            uploadedAt: Date.now(),
            workKey:
                buildMediaNameKey(musicItem.title, musicItem.artist) || null,
        });

        return { status: outcome };
    } finally {
        if (temp) {
            try {
                await RNFS.unlink(path);
            } catch (e) {
                // 临时文件清理失败不影响结果
            }
        }
    }
}
