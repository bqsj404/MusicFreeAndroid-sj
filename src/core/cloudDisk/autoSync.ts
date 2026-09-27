/**
 * 云盘自动对账编排。
 *
 * 对齐桌面版 `src/renderer/mainWindow/core/cloudAutoSync.ts`：
 *  - 触发源：本地音乐库变化、下载完成、我喜欢/收藏歌单变化 → 打「待同步」标记
 *  - 节流：300ms 内多次触发只写一次标记
 *  - 周期：每 15 分钟检查一次，**只有存在待同步标记才真正执行**
 *  - 启动补跑：启动后 30 秒，若「有待同步标记」或「从未同步过」则立即执行
 *  - 失败时**保留**待同步标记 → 下个周期或下次启动自动重试
 *
 * 三阶段（与桌面版一致）：
 *  ① 歌单备份推送到 WebDAV
 *  ② 若开启「同时上传本地音乐文件」→ 增量上传本地音频（并发 2）
 *  ③ 对账：清单里有、但本地文件已彻底不存在的 → 远端移入回收站
 *
 * 本模块只做「编排」，具体能力落在
 * `upload.ts` / `trash.ts` / `syncPlan.ts` / `uploadRecords.ts`。
 */
import Config from "@/core/appConfig";
import LocalMusicSheet from "@/core/localMusicSheet";
import Backup from "@/core/backup";
import { getLocalPath } from "@/utils/mediaUtils";
import { cloudPluginPlatform } from "@/constants/commonConst";
import { buildMediaNameKey } from "@/core/mediaNameKey";
import RNFS from "react-native-fs";
import { createCloudDiskClient, isCloudDiskConfigured } from "./client";
import { basename, extname, listCloudFiles, parseCloudFileName } from "./index";
import { selectOrphanUploads } from "./syncPlan";
import { moveToTrash } from "./trash";
import {
    ensureMusicDir,
    ensureRemoteDir,
    uploadLocalFile,
    type IUploadTask,
} from "./upload";
import { toStoredPath } from "./zoteroDavCompat";
import { getAllUploads, upsertUpload, uploadKey } from "./uploadRecords";

/** 检查周期：15 分钟 */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** 启动补跑延迟 */
export const STARTUP_CATCHUP_DELAY_MS = 30 * 1000;
/** 写标记的节流窗口 */
const MARK_PENDING_THROTTLE_MS = 300;
/** 上传并发（桌面版备注：坚果云对并发敏感，取 2） */
const UPLOAD_CONCURRENCY = 2;

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastMarkAt = 0;

/** 自动同步是否开启（默认关） */
export function isAutoSyncEnabled(): boolean {
    return !!Config.getConfig("backup.autoBackup");
}

/** 是否连带上传本地音频文件 */
function shouldUploadLocalFiles(): boolean {
    return !!Config.getConfig("backup.uploadLocalFiles");
}

function getPendingAt(): number {
    return Config.getConfig("backup.syncPendingAt") ?? 0;
}


/** 去掉 file:// 前缀 */
function toPlainPath(path: string): string {
    return path.startsWith("file://") ? decodeURIComponent(path.slice(7)) : path;
}

/** 远端逻辑路径 → 逻辑文件名 */
function logicalNameOf(remotePath: string): string {
    const slash = remotePath.lastIndexOf("/");
    return slash >= 0 ? remotePath.slice(slash + 1) : remotePath;
}

/**
 * 打「待同步」标记（300ms 内多次调用只写一次）。
 *
 * 自动同步关闭时直接返回，不产生任何写入。
 */
export function markSyncPending(): void {
    if (!isAutoSyncEnabled()) {
        return;
    }
    const now = Date.now();
    if (now - lastMarkAt < MARK_PENDING_THROTTLE_MS) {
        return;
    }
    lastMarkAt = now;
    Config.setConfig("backup.syncPendingAt", now);
}

/** 收集本地音乐里可上传的任务（按本地路径去重） */
export function collectLocalTasks(): IUploadTask[] {
    let list: IMusic.IMusicItem[] = [];
    try {
        list = LocalMusicSheet.getMusicList() ?? [];
    } catch (e) {
        return [];
    }
    const seen = new Set<string>();
    const tasks: IUploadTask[] = [];
    list.forEach(item => {
        const path = getLocalPath(item);
        if (!path || seen.has(path)) {
            return;
        }
        seen.add(path);
        tasks.push({
            filePath: path,
            title: item.title,
            artist: item.artist,
            platform: item.platform || cloudPluginPlatform,
            musicId: String(item.id ?? path),
        });
    });
    return tasks;
}

/** 上传成功后记账（远端逻辑路径 + 作品键 + 来源身份） */
function recordUpload(task: IUploadTask, size = 0): void {
    const plain = toPlainPath(task.filePath);
    const parsed = parseCloudFileName(basename(plain));
    const title = task.title || parsed.title;
    const artist = task.artist || parsed.artist;
    const logicalName = `${title}${
        artist ? ` - ${artist}` : ""
    }${extname(plain)}`;
    upsertUpload({
        platform: task.platform || cloudPluginPlatform,
        musicId: task.musicId || logicalName,
        title,
        artist,
        remotePath: `/MusicFree/music/${logicalName}`,
        localPath: plain,
        source: "auto",
        size,
        uploadedAt: Date.now(),
        workKey: buildMediaNameKey(title, artist) || null,
    });
}

/** 增量上传全部本地音频 */
async function uploadAllLocalFiles(): Promise<{
    uploaded: number;
    skipped: number;
    failed: number;
}> {
    const result = { uploaded: 0, skipped: 0, failed: 0 };
    const tasks = collectLocalTasks();
    if (!tasks.length) {
        return result;
    }
    await ensureMusicDir();

    // 远端现有文件的「逻辑名 → 大小」索引，用于同名同大小跳过
    const remoteSizes = new Map<string, number>();
    try {
        const files = await listCloudFiles(true);
        files.forEach(file => remoteSizes.set(file.name, file.size));
    } catch (e) {
        // 列目录失败不阻塞上传（跳过判定退化为「一律上传」）
    }

    const queue = [...tasks];
    const worker = async () => {
        for (;;) {
            const task = queue.shift();
            if (!task) {
                return;
            }
            const outcome = await uploadLocalFile(task, remoteSizes);
            if (outcome === "uploaded" || outcome === "skipped") {
                if (outcome === "uploaded") {
                    result.uploaded++;
                } else {
                    result.skipped++;
                }
                const plain = toPlainPath(task.filePath);
                const logical = `${basename(plain)}`;
                recordUpload(task, remoteSizes.get(logical) ?? 0);
            } else {
                result.failed++;
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, () =>
            worker(),
        ),
    );
    return result;
}

/**
 * 对账第三阶段：清单里有、但本地文件已彻底不存在的 → 移入回收站。
 *
 * 判定走纯函数 [selectOrphanUploads]，保持与桌面版一致的保守口径。
 */
async function trashMissingLocalFiles(
    managedKeys: Set<string>,
    managedWorkKeys: Set<string>,
): Promise<number> {
    const rows = getAllUploads();
    if (!rows.length) {
        return 0;
    }

    const existingPaths = new Set<string>();
    const withLocalPath = rows.filter(row => !!row.localPath);
    if (withLocalPath.length) {
        await Promise.all(
            withLocalPath.map(async row => {
                try {
                    await RNFS.stat(row.localPath!);
                    existingPaths.add(row.localPath!);
                } catch (e) {
                    // 文件确实不在了
                }
            }),
        );
    }

    const orphans = selectOrphanUploads(
        rows,
        managedKeys,
        existingPaths,
        managedWorkKeys,
    );
    if (!orphans.length) {
        return 0;
    }
    const result = await moveToTrash(orphans);
    return result.moved;
}

/** 歌单备份在远端的路径（与「设置 → 备份」一致） */
export const REMOTE_BACKUP_PATH = "/MusicFree/MusicFreeBackup.json";

/**
 * ① 把歌单备份推送到 WebDAV。
 *
 * 注意：`Backup.backup()` 只**生成** JSON 字符串（同步返回），
 * 实际上传在设置页里做（`backupSetting.tsx`），所以这里需要自己 PUT。
 */
async function backupSheetsToWebdav(): Promise<void> {
    const client = createCloudDiskClient();
    if (!client) {
        throw new Error("未配置 WebDAV");
    }
    const raw = Backup.backup();
    // 走兼容层映射（数据胶囊只接受 .zip 结尾的上传名）
    const storedPath = toStoredPath(REMOTE_BACKUP_PATH);
    await ensureRemoteDir("/MusicFree");
    await client.putFileContents(storedPath, raw as any, { overwrite: true });
}

/** 同步结果 */
export interface ISyncResult {
    success: boolean;
    message: string;
    uploaded?: number;
    skipped?: number;
    failed?: number;
    trashed?: number;
}

/**
 * 执行一次同步（互斥，重复调用直接返回）。
 */
export async function runSync(reason = "manual"): Promise<ISyncResult> {
    if (running) {
        return { success: false, message: "同步进行中" };
    }
    if (!isCloudDiskConfigured()) {
        return { success: false, message: "未配置 WebDAV" };
    }
    running = true;
    try {
        // ① 歌单备份
        try {
            await backupSheetsToWebdav();
        } catch (e: any) {
            // 备份失败不阻断后续；保留待同步标记以便重试
            return {
                success: false,
                message: `歌单备份失败：${e?.message ?? String(e)}`,
            };
        }

        // ②③ 未开启「同时上传本地文件」时，本次只同步歌单
        if (!shouldUploadLocalFiles()) {
            Config.setConfig("backup.syncPendingAt", 0);
            Config.setConfig("backup.lastSyncAt", Date.now());
            return { success: true, message: "已同步歌单" };
        }

        const uploadResult = await uploadAllLocalFiles();

        const tasks = collectLocalTasks();
        const managedKeys = new Set(
            tasks.map(task =>
                uploadKey(
                    task.platform || cloudPluginPlatform,
                    task.musicId || task.filePath,
                ),
            ),
        );
        const managedWorkKeys = new Set<string>();
        tasks.forEach(task => {
            const key = buildMediaNameKey(task.title, task.artist) || null;
            if (key) {
                managedWorkKeys.add(key);
            }
        });

        const trashed = await trashMissingLocalFiles(
            managedKeys,
            managedWorkKeys,
        );

        Config.setConfig("backup.syncPendingAt", 0);
        Config.setConfig("backup.lastSyncAt", Date.now());
        return {
            success: true,
            message: `同步完成（${reason}）`,
            uploaded: uploadResult.uploaded,
            skipped: uploadResult.skipped,
            failed: uploadResult.failed,
            trashed,
        };
    } catch (e: any) {
        // 保留待同步标记 → 下个周期重试
        return { success: false, message: e?.message ?? String(e) };
    } finally {
        running = false;
    }
}

/** 周期 / 启动补跑判定：只有存在待同步标记才执行 */
export async function maybeSync(
    reason = "interval",
): Promise<ISyncResult | null> {
    if (!isAutoSyncEnabled()) {
        return null;
    }
    if (getPendingAt() <= 0) {
        return null;
    }
    return runSync(reason);
}

/** 启动自动对账（幂等）；返回停止函数 */
export function setupCloudAutoSync(): () => void {
    if (intervalTimer || startupTimer) {
        return teardownCloudAutoSync;
    }
    intervalTimer = setInterval(() => {
        maybeSync("interval").catch(() => {
            // 失败保留标记，等下一轮
        });
    }, SYNC_INTERVAL_MS);

    startupTimer = setTimeout(() => {
        if (!isAutoSyncEnabled()) {
            return;
        }
        const neverSynced = (Config.getConfig("backup.lastSyncAt") ?? 0) <= 0;
        if (getPendingAt() > 0 || neverSynced) {
            runSync("startup").catch(() => {
                // 忽略
            });
        }
    }, STARTUP_CATCHUP_DELAY_MS);

    return teardownCloudAutoSync;
}

/** 停止自动对账 */
export function teardownCloudAutoSync(): void {
    if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
    }
    if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
    }
}

export { createCloudDiskClient };

