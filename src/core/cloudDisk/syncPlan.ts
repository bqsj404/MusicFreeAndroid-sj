/**
 * 云端对账的**纯函数**部分 —— 原样对齐桌面版
 * `src/infra/cloudDisk/common/syncPlan.ts` 的判定口径。
 *
 * 本文件刻意零依赖（只用 Set / Map / 字符串，类型导入会被 tsc 擦除），
 * 便于单测与直接搬用。
 *
 * 判定要「保守」：只要还有一点证据表明这首歌仍被本地管理，就**不**判为孤儿。
 * 五条豁免（命中任一即保留）：
 *   ① 该 (platform, musicId) 仍在本地管理集合里（只是移动/改名）
 *   ①' 该作品的 workKey 仍在本地管理集合里（换了插件，id/platform 变了）
 *   ② 记录没有 localPath —— 从音源直传的条目，本来就没有本地文件，永远不动
 *   ③ 记录里的 localPath 在本地仍然存在（外部误删记录但文件还在）
 *   ④ 同一个 remotePath 已在本轮处理过（去重，只移一次）
 */
import type { ICloudUploadRecord } from "./uploadRecords";
import { uploadKey } from "./keys";

/**
 * 选出应移入回收站的远端逻辑路径。
 *
 * @param manifest        上传清单全量
 * @param managedKeys     本地仍管理的 (platform, musicId) 组合键集合
 * @param existingPaths   清单里仍然真实存在的 localPath 集合
 * @param managedWorkKeys 本地仍管理的作品键集合
 * @returns 去重后的远端逻辑路径数组
 */
export function selectOrphanUploads(
    manifest: ICloudUploadRecord[] | null | undefined,
    managedKeys: Set<string>,
    existingPaths: Set<string>,
    managedWorkKeys: Set<string> = new Set(),
): string[] {
    const orphans: string[] = [];
    const seen = new Set<string>();

    for (const row of manifest ?? []) {
        if (!row?.remotePath) {
            continue;
        }
        // ① 本地仍管理这个 (platform, id)
        if (
            row.platform &&
            row.musicId &&
            managedKeys.has(uploadKey(row.platform, row.musicId))
        ) {
            continue;
        }
        // ①' 本地仍管理这个作品（换插件 / 换来源）
        if (row.workKey && managedWorkKeys.has(row.workKey)) {
            continue;
        }
        // ② 从音源直传、没有本地文件 → 永不判孤儿
        if (!row.localPath) {
            continue;
        }
        // ③ 记录的本地文件仍在
        if (existingPaths.has(row.localPath)) {
            continue;
        }
        // ④ 去重
        if (seen.has(row.remotePath)) {
            continue;
        }
        seen.add(row.remotePath);
        orphans.push(row.remotePath);
    }

    return orphans;
}

/**
 * 由远端路径得到展示名：去扩展名的 basename。
 *
 * **绝不回退显示歌曲 ID**（桌面版明确要求）。
 */
export function cloudDisplayName(remotePath: string): string {
    if (!remotePath) {
        return "";
    }
    const slash = remotePath.lastIndexOf("/");
    const base = slash >= 0 ? remotePath.slice(slash + 1) : remotePath;
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
}
