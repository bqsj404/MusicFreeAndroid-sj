/**
 * 云盘上传清单（数据层）。
 *
 * 桌面版用 SQLite 表 `cloud_uploads` 存这份账；Android 没有关系库需求，
 * 这里用 MMKV 承载，**键设计对齐桌面版的业务主键**：
 *
 *  - 记录键：`cu:rec:<platform>\u0000<musicId>\u0000<remotePath>`
 *    三元组做主键，与桌面版 `UNIQUE(platform, music_id, remote_path)` 等价，
 *    天然实现 upsert 语义；**不能用 remotePath 单键**——同一个远端文件可能被
 *    多个 (platform, id) 指向（换插件后重复上传就是这种情况）。
 *  - `cu:ids`：全部记录键数组（供全表扫描 / 对账）
 *  - `cu:manual`：`source === "manual"` 的记录键数组（避免每次全表扫描）
 *
 * `source` 字段「只升不降」：已记为 manual 的条目不会被后续 auto 覆盖
 * （对齐桌面版 SQL 里的 `CASE WHEN source='manual' THEN 'manual' ELSE ...`）。
 */
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";

const store = getOrCreateMMKV("cloudDisk.uploads");

const REC_PREFIX = "cu:rec:";
const IDS_KEY = "cu:ids";
const MANUAL_KEY = "cu:manual";

/** 上传来源 */
export type CloudUploadSource = "manual" | "auto";

/** 一条上传记录 */
export interface ICloudUploadRecord {
    platform: string;
    musicId: string;
    title: string;
    artist: string;
    /** 远端**逻辑路径**（如 /MusicFree/music/歌名 - 歌手.mp3） */
    remotePath: string;
    /** 本地文件绝对路径；从音源直传的条目为空 → 永远不判为孤儿 */
    localPath: string | null;
    source: CloudUploadSource;
    size: number;
    uploadedAt: number;
    /** 作品键（归一化「歌名|歌手」），用于换插件后的身份比对 */
    workKey: string | null;
}

/** 组装记录键（三元组） */
export function buildRecordKey(
    platform: string,
    musicId: string,
    remotePath: string,
): string {
    return `${REC_PREFIX}${platform}\u0000${musicId}\u0000${remotePath}`;
}

/** 本地管理集合用的组合键（与桌面版 uploadKey 口径一致） */
export function uploadKey(platform: string, musicId: string): string {
    return `${platform}\u0000${String(musicId)}`;
}

function readIds(key: string): string[] {
    const raw = store.getString(key);
    const parsed = raw ? safeParse<string[]>(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
}

function writeIds(key: string, ids: string[]): void {
    // 去重后写入，避免长期运行后数组膨胀
    store.set(key, JSON.stringify(Array.from(new Set(ids))));
}

function readRecord(key: string): ICloudUploadRecord | null {
    const raw = store.getString(key);
    if (!raw) {
        return null;
    }
    const parsed = safeParse<ICloudUploadRecord>(raw);
    return parsed && parsed.remotePath ? parsed : null;
}

/**
 * 写入 / 更新一条记录。
 *
 * @returns 是否为新增
 */
export function upsertUpload(record: ICloudUploadRecord): boolean {
    const key = buildRecordKey(
        record.platform,
        record.musicId,
        record.remotePath,
    );
    const prev = readRecord(key);
    const merged: ICloudUploadRecord = {
        ...record,
        // source 只升不降
        source: prev?.source === "manual" ? "manual" : record.source,
        // workKey 缺失时保留旧值
        workKey: record.workKey ?? prev?.workKey ?? null,
        uploadedAt: record.uploadedAt ?? Date.now(),
    };
    store.set(key, JSON.stringify(merged));

    const ids = readIds(IDS_KEY);
    if (!ids.includes(key)) {
        writeIds(IDS_KEY, [...ids, key]);
    }
    const manualIds = readIds(MANUAL_KEY);
    const shouldBeManual = merged.source === "manual";
    const isManual = manualIds.includes(key);
    if (shouldBeManual && !isManual) {
        writeIds(MANUAL_KEY, [...manualIds, key]);
    } else if (!shouldBeManual && isManual) {
        writeIds(
            MANUAL_KEY,
            manualIds.filter(_ => _ !== key),
        );
    }
    return !prev;
}

/** 全部记录（按上传时间倒序，对齐桌面版 `ORDER BY uploaded_at DESC`） */
export function getAllUploads(): ICloudUploadRecord[] {
    return readIds(IDS_KEY)
        .map(readRecord)
        .filter((record): record is ICloudUploadRecord => !!record)
        .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

/** 手动上传的记录（「选择性恢复」清单用） */
export function getManualUploads(): ICloudUploadRecord[] {
    return readIds(MANUAL_KEY)
        .map(readRecord)
        .filter((record): record is ICloudUploadRecord => !!record)
        .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

/** 按远端逻辑路径删除（移入回收站时用） */
export function deleteByRemotePath(remotePath: string): number {
    let removed = 0;
    readIds(IDS_KEY).forEach(key => {
        const record = readRecord(key);
        if (record?.remotePath === remotePath) {
            store.delete(key);
            removed++;
        }
    });
    if (removed) {
        writeIds(
            IDS_KEY,
            readIds(IDS_KEY).filter(key => !!readRecord(key)),
        );
        writeIds(
            MANUAL_KEY,
            readIds(MANUAL_KEY).filter(key => !!readRecord(key)),
        );
    }
    return removed;
}

/** 按三元组删除（纯记账，不动云端文件） */
export function deleteUploadRecords(
    records: Array<Pick<ICloudUploadRecord, "platform" | "musicId" | "remotePath">>,
): number {
    let removed = 0;
    records.forEach(record => {
        const key = buildRecordKey(
            record.platform,
            record.musicId,
            record.remotePath,
        );
        if (readRecord(key)) {
            store.delete(key);
            removed++;
        }
    });
    if (removed) {
        writeIds(
            IDS_KEY,
            readIds(IDS_KEY).filter(key => !!readRecord(key)),
        );
        writeIds(
            MANUAL_KEY,
            readIds(MANUAL_KEY).filter(key => !!readRecord(key)),
        );
    }
    return removed;
}

/** 清空清单（测试 / 重置用） */
export function clearUploads(): void {
    readIds(IDS_KEY).forEach(key => store.delete(key));
    writeIds(IDS_KEY, []);
    writeIds(MANUAL_KEY, []);
}
