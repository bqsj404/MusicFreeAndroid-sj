/**
 * 云盘回收站。
 *
 * 与桌面版语义一致：**从云端删除 = 移动到 `/MusicFree/trash`，不物理删除**；
 * 回收站内重名时给出可读后缀 `歌名 (1).ext`（最多尝试 99 次）。
 *
 * 路径口径：
 *  - 传入的 remotePath 可能是**存储路径**（列表里的 `id`，带 `_hash.ext.zip`）
 *    也可能是**逻辑路径**（清单里记的），两者都吃：
 *    先 [toLogicalPath] 归一，再 [toStoredPath] 映射回服务端名字。
 *  - 清单记录用的是**逻辑路径**，因此同步时也按逻辑路径删。
 */
import { createCloudDiskClient } from "./client";
import { CLOUD_TRASH_DIR, TRASH_RENAME_MAX } from "./constant";
import { deleteByRemotePath } from "./uploadRecords";
import {
    basenameWithoutExt,
    extname,
    basename,
} from "./index";
import {
    toLogicalPath,
    toStoredName,
    toStoredPath,
    sanitizeFileName,
} from "./zoteroDavCompat";
import { ensureTrashDir } from "./upload";

/** 移入回收站的结果 */
export interface IMoveToTrashResult {
    moved: number;
    total: number;
    errors: string[];
}

/**
 * 把远端文件移入回收站。
 *
 * @param remotePaths 远端逻辑路径或存储路径（混合也可以）
 */
export async function moveToTrash(
    remotePaths: string[],
): Promise<IMoveToTrashResult> {
    const result: IMoveToTrashResult = {
        moved: 0,
        total: remotePaths?.length ?? 0,
        errors: [],
    };
    const client = createCloudDiskClient();
    if (!client || !remotePaths?.length) {
        return result;
    }
    await ensureTrashDir();

    for (const inputPath of remotePaths) {
        // 统一成逻辑路径（存储名会被还原）
        const logicalPath = toLogicalPath(inputPath);
        const storedPath = toStoredPath(logicalPath);
        try {
            if (!(await client.exists(storedPath))) {
                // 远端已不存在：只清掉清单记录，避免留下删不掉的幽灵条目
                deleteByRemotePath(logicalPath);
                result.moved++;
                continue;
            }

            const baseName = basenameWithoutExt(basename(logicalPath));
            const ext = extname(basename(logicalPath));
            let target = `${CLOUD_TRASH_DIR}/${toStoredName(
                `${sanitizeFileName(baseName)}${ext}`,
            )}`;

            // 重名 → 可读后缀 歌名 (1).ext
            if (await client.exists(target)) {
                for (let i = 1; i <= TRASH_RENAME_MAX; i++) {
                    const candidate = `${CLOUD_TRASH_DIR}/${toStoredName(
                        `${sanitizeFileName(baseName)} (${i})${ext}`,
                    )}`;
                    if (!(await client.exists(candidate))) {
                        target = candidate;
                        break;
                    }
                }
            }

            await client.moveFile(storedPath, target);
            deleteByRemotePath(logicalPath);
            result.moved++;
        } catch (e: any) {
            result.errors.push(`${logicalPath}: ${e?.message ?? String(e)}`);
        }
    }

    return result;
}

/** 回收站文件条目 */
export interface ITrashFile {
    /** 存储路径（可再移回 / 彻底删除用） */
    path: string;
    /** 逻辑名（展示用） */
    name: string;
    size: number;
    mtime: number | null;
}

/** 列出回收站内容 */
export async function listTrashFiles(): Promise<ITrashFile[]> {
    const client = createCloudDiskClient();
    if (!client) {
        return [];
    }
    try {
        const contents = (await client.getDirectoryContents(
            CLOUD_TRASH_DIR,
        )) as any[];
        return (contents ?? [])
            .filter(entry => entry?.type === "file")
            .map(entry => {
                const storedName = String(
                    entry.basename ?? basename(String(entry.filename ?? "")),
                );
                const rawPath = String(
                    entry.filename ?? `${CLOUD_TRASH_DIR}/${storedName}`,
                );
                const logical = toLogicalPath(storedName);
                return {
                    path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
                    name: logical,
                    size: Number(entry.size ?? 0),
                    mtime: entry.lastmod
                        ? Date.parse(String(entry.lastmod))
                        : null,
                };
            })
            .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
    } catch (e) {
        return [];
    }
}
