/**
 * 云盘清单的键构造（**零依赖纯函数**）。
 *
 * 单独成文件的原因：`syncPlan.selectOrphanUploads` 需要 `uploadKey` 做判定，
 * 而 `uploadRecords` 依赖 MMKV（RN 原生模块）。把键构造抽出来之后，
 * 对账逻辑就完全不依赖存储层，可以用 Jest 直接单测，无需 mock 原生。
 */

/** 上传记录的存储键（三元组：platform + musicId + remotePath） */
export function buildRecordKey(
    platform: string,
    musicId: string,
    remotePath: string,
): string {
    return `cu:rec:${platform}\u0000${musicId}\u0000${remotePath}`;
}

/** 本地管理集合用的组合键（与桌面版 `uploadKey` 口径一致） */
export function uploadKey(platform: string, musicId: string): string {
    return `${platform}\u0000${String(musicId)}`;
}
