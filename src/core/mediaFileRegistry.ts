/**
 * 媒体文件真值层（D3「文件真值」职责）。
 *
 * 桌面版用 SQLite 表 + `work_key` 承载三件事，Android 侧用 MMKV 承载，
 * 但**职责划分保持一致**：
 *
 *   1. **文件真值**（本模块）：这个文件在哪、多大、什么容器格式、什么时候登记的
 *   2. **作品身份**（`@/core/mediaNameKey`）：这首歌是谁 —— `歌名|歌手` 归一化键
 *   3. **记录层**（`cloudDisk/uploadRecords`、下载记录）：谁上传/下载过它
 *
 * 分开的理由：同一个作品可能有多个文件（不同格式、不同来源），
 * 而「某个作品本地有没有文件」是一个**跨来源**的问题 ——
 * 下载来的、扫描入库的、云盘缓存下来的都算。
 * 只靠 `LocalMusicSheet` 的内存清单回答不了（它只有扫描入库的那些）。
 *
 * 存储布局（MMKV `media.files`）：
 *   `mf:rec:<path>`        → 单条记录（JSON），path 天然唯一
 *   `mf:work:<workKey>`    → path 数组（作品 → 文件索引，加速查询）
 *   `mf:all`               → 全部 path 数组（遍历/清理用）
 *
 * 注意：**workKey 为空时不建索引** —— 否则一堆「歌名/歌手都缺失」的
 * 条目会全部落到同一个键上，被当成同一首作品（与桌面版注释同口径）。
 */
import RNFS from "react-native-fs";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { buildMediaNameKey } from "@/core/mediaNameKey";
import { keyboardLog } from "@/core/keyboard/native";
import {
    detectContainer,
    guessContainerByExt,
    isExtMismatch,
    type AudioContainer,
    SNIFF_BYTES,
} from "@/core/audioContainer";

const store = getOrCreateMMKV("media.files");

const REC_PREFIX = "mf:rec:";
const WORK_PREFIX = "mf:work:";
const ALL_KEY = "mf:all";

/** 登记来源 */
export type MediaFileSource = "download" | "scan" | "cloud" | "manual";

/** 一条媒体文件真值记录 */
export interface IMediaFileRecord {
    /** 绝对路径（无 `file://` 前缀，统一口径） */
    path: string;
    /** 文件大小（字节） */
    size: number;
    /** 修改时间（毫秒） */
    mtime: number;
    /** 真实容器格式（文件头嗅探；失败时回落到扩展名猜测） */
    container: AudioContainer;
    /** 作品键；无法确定时为空串（此时不进索引） */
    workKey: string;
    /** 歌名 */
    title: string;
    /** 歌手 */
    artist: string;
    /** 扩展名与真实容器是否不一致（供 UI 提示/修正） */
    extMismatch: boolean;
    /** 登记来源 */
    source: MediaFileSource;
    /** 登记时间 */
    registeredAt: number;
}

/** 去掉 `file://` 前缀 */
export function toPlainPath(path: string): string {
    return path.startsWith("file://")
        ? decodeURIComponent(path.slice(7))
        : path;
}

/** 取扩展名（含点，如 `.mp3`） */
function extnameOf(path: string): string {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot) : "";
}

// ——— 内部索引读写 ———

function readPaths(key: string): string[] {
    const raw = store.getString(key);
    const parsed = raw ? safeParse<string[]>(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
}

function writePaths(key: string, paths: string[]) {
    store.set(key, JSON.stringify(Array.from(new Set(paths))));
}

function readRecord(path: string): IMediaFileRecord | null {
    const raw = store.getString(REC_PREFIX + path);
    if (!raw) {
        return null;
    }
    const parsed = safeParse<IMediaFileRecord>(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
}

// ——— 嗅探 ———

/**
 * 读文件头并嗅探容器格式。
 *
 * @returns 容器格式；读取失败时回落到扩展名猜测
 */
export async function sniffFileContainer(
    path: string,
): Promise<AudioContainer> {
    const plain = toPlainPath(path);
    try {
        // react-native-fs 的 read(path, length, position, encoding)
        const head = await RNFS.read(plain, SNIFF_BYTES, 0, "ascii");
        const bytes: number[] = [];
        for (let i = 0; i < head.length; i++) {
            bytes.push(head.charCodeAt(i) & 0xff);
        }
        const detected = detectContainer(bytes);
        if (detected !== "unknown") {
            return detected;
        }
    } catch (e) {
        // 落到扩展名猜测
    }
    return guessContainerByExt(extnameOf(plain));
}

// ——— 写入 ———

/** 登记一条记录（同 path 覆盖） */
export function registerMediaFile(record: IMediaFileRecord): void {
    const path = toPlainPath(record.path);
    if (!path) {
        return;
    }
    const prev = readRecord(path);

    // 作品变化时清理旧索引
    if (prev?.workKey && prev.workKey !== record.workKey) {
        const key = WORK_PREFIX + prev.workKey;
        writePaths(
            key,
            readPaths(key).filter(p => p !== path),
        );
    }

    store.set(REC_PREFIX + path, JSON.stringify({ ...record, path }));

    // 全部路径
    const all = readPaths(ALL_KEY);
    if (!all.includes(path)) {
        all.push(path);
        writePaths(ALL_KEY, all);
    }

    // 作品索引（workKey 为空时不建）
    if (record.workKey) {
        const key = WORK_PREFIX + record.workKey;
        const list = readPaths(key);
        if (!list.includes(path)) {
            list.push(path);
            writePaths(key, list);
        }
    }
}

/** 从已存在的文件构造并登记记录（读 stat + 嗅探容器） */
export async function registerExistingFile(
    path: string,
    options: {
        title?: string | null;
        artist?: string | null;
        source?: MediaFileSource;
    } = {},
): Promise<IMediaFileRecord | null> {
    const plain = toPlainPath(path);
    if (!plain) {
        return null;
    }
    let stat: any;
    try {
        stat = await RNFS.stat(plain);
    } catch (e) {
        return null;
    }
    const container = await sniffFileContainer(plain);
    const ext = extnameOf(plain);
    const title = options.title ?? "";
    const artist = options.artist ?? "";
    const record: IMediaFileRecord = {
        path: plain,
        size: Number(stat?.size ?? 0),
        mtime:
            stat?.mtime instanceof Date
                ? stat.mtime.getTime()
                : Number(stat?.mtime ?? 0),
        container,
        workKey: buildMediaNameKey(title, artist),
        title,
        artist,
        extMismatch: isExtMismatch(ext, container),
        source: options.source ?? "manual",
        registeredAt: Date.now(),
    };
    registerMediaFile(record);
    // 登记是静默的基础设施操作，留一条可观测日志（排查「本地已有文件却没命中」时用）
    keyboardLog(
        "MediaFile",
        `registered ${record.container} workKey=${record.workKey} mismatch=${record.extMismatch} path=${plain}`,
    );
    return record;
}

// ——— 查询 ———

/** 按路径查记录 */
export function lookupFileByPath(path: string): IMediaFileRecord | null {
    return readRecord(toPlainPath(path));
}

/** 按作品键查记录（取第一个登记的文件） */
export function lookupFileByWorkKey(
    workKey: string | null | undefined,
): IMediaFileRecord | null {
    if (!workKey) {
        return null;
    }
    const paths = readPaths(WORK_PREFIX + workKey);
    for (const path of paths) {
        const record = readRecord(path);
        if (record) {
            return record;
        }
    }
    return null;
}

/**
 * 便捷查询：按「歌名 + 歌手」找本地文件记录。
 *
 * 与 `localMusicIndex.findLocalMusicByWorkKey`（查内存清单）的分工：
 * 本函数查的是**真实登记过的文件**，覆盖下载/云盘缓存等非扫描来源。
 */
export function findFileForMedia(
    title?: string | null,
    artist?: string | null,
): IMediaFileRecord | null {
    return lookupFileByWorkKey(buildMediaNameKey(title, artist));
}

/** 全部记录 */
export function getAllMediaFiles(): IMediaFileRecord[] {
    return readPaths(ALL_KEY)
        .map(readRecord)
        .filter((r): r is IMediaFileRecord => !!r);
}

/** 记录总数 */
export function getMediaFileCount(): number {
    return readPaths(ALL_KEY).length;
}

// ——— 删除 ———

/** 删除一条记录 */
export function removeMediaFile(path: string): void {
    const plain = toPlainPath(path);
    const prev = readRecord(plain);
    if (prev?.workKey) {
        const key = WORK_PREFIX + prev.workKey;
        writePaths(
            key,
            readPaths(key).filter(p => p !== plain),
        );
    }
    store.delete(REC_PREFIX + plain);
    writePaths(
        ALL_KEY,
        readPaths(ALL_KEY).filter(p => p !== plain),
    );
}

/**
 * 清理「文件已不存在」的记录。
 *
 * @returns 清理条数
 */
export async function pruneMissingFiles(): Promise<number> {
    const paths = readPaths(ALL_KEY);
    if (!paths.length) {
        return 0;
    }
    let removed = 0;
    await Promise.all(
        paths.map(async path => {
            try {
                await RNFS.stat(path);
            } catch (e) {
                removeMediaFile(path);
                removed++;
            }
        }),
    );
    return removed;
}

/** 清空全部记录（谨慎：会影响「本地已有文件」判定） */
export function clearMediaFiles(): void {
    readPaths(ALL_KEY).forEach(path => {
        const prev = readRecord(path);
        if (prev?.workKey) {
            const key = WORK_PREFIX + prev.workKey;
            writePaths(
                key,
                readPaths(key).filter(p => p !== path),
            );
        }
        store.delete(REC_PREFIX + path);
    });
    store.delete(ALL_KEY);
}

