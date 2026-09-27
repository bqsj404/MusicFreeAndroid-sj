/**
 * 本地音乐 → 云盘的批量上传（用户可触发的入口）。
 *
 * 与 `autoSync.ts` 的自动上传共用同一套能力（`upload.ts`、`uploadRecords.ts`），
 * 区别只是**由用户手动触发**、并且上报进度（自动流程不需要 UI 进度）。
 *
 * 并发固定为 2：桌面版注释提到坚果云对并发敏感（`UPLOAD_CONCURRENCY = 2`）。
 */
import LocalMusicSheet from "@/core/localMusicSheet";
import { getLocalPath } from "@/utils/mediaUtils";
import { cloudPluginPlatform } from "@/constants/commonConst";
import { buildMediaNameKey } from "@/core/mediaNameKey";
import { listCloudFiles, basename, extname, parseCloudFileName } from "./index";
import { ensureMusicDir, uploadLocalFile, type IUploadTask } from "./upload";
import { upsertUpload } from "./uploadRecords";

/** 并发上限（与自动同步保持一致） */
const CONCURRENCY = 2;

/** 批量上传结果 */
export interface IUploadTasksResult {
    uploaded: number;
    skipped: number;
    failed: number;
    errors: string[];
}

/** 去掉 file:// 前缀 */
function toPlainPath(path: string): string {
    return path.startsWith("file://") ? decodeURIComponent(path.slice(7)) : path;
}


/** 收集本地音乐库里的可上传任务（按本地路径去重） */
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
function recordUpload(task: IUploadTask, size: number): void {
    const plain = toPlainPath(task.filePath);
    const parsed = parseCloudFileName(basename(plain));
    const title = task.title || parsed.title;
    const artist = task.artist || parsed.artist;
    const logicalName = `${title}${artist ? ` - ${artist}` : ""}${extname(plain)}`;
    upsertUpload({
        platform: task.platform || cloudPluginPlatform,
        musicId: task.musicId || logicalName,
        title,
        artist,
        remotePath: `/MusicFree/music/${logicalName}`,
        localPath: plain,
        source: "manual",
        size,
        uploadedAt: Date.now(),
        workKey: buildMediaNameKey(title, artist) || null,
    });
}

/**
 * 批量上传本地音乐到云盘。
 *
 * @param tasks    上传任务（一般来自 [collectLocalTasks]）
 * @param onProgress 进度回调（已处理数 / 总数）
 */
export async function uploadTasksWithProgress(
    tasks: IUploadTask[],
    onProgress?: (done: number, total: number) => void,
): Promise<IUploadTasksResult> {
    const result: IUploadTasksResult = {
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
    };
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
        // 列目录失败不阻塞上传（跳过判定退化为一律上传）
    }

    let done = 0;
    const total = tasks.length;
    const queue = [...tasks];
    const worker = async () => {
        for (;;) {
            const task = queue.shift();
            if (!task) {
                return;
            }
            const outcome = await uploadLocalFile(task, remoteSizes);
            const plain = toPlainPath(task.filePath);
            if (outcome === "uploaded") {
                result.uploaded++;
                recordUpload(task, remoteSizes.get(basename(plain)) ?? 0);
            } else if (outcome === "skipped") {
                result.skipped++;
                recordUpload(task, remoteSizes.get(basename(plain)) ?? 0);
            } else {
                result.failed++;
                if (outcome?.failed) {
                    result.errors.push(outcome.failed);
                }
            }
            done++;
            onProgress?.(done, total);
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
    );
    return result;
}

