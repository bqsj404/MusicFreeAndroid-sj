/**
 * 本地音乐扫描管理（扫描入库体验）。
 *
 * 在原有「选目录 → 递归扫文件 → 批量解析元数据 → 入库」的基础上补三件事：
 *
 *  1. **文件夹白名单**：记住上次扫描过的目录，下次可一键重扫
 *     （存 MMKV `localMusic.folders`）
 *  2. **进度上报**：扫描/解析分阶段上报「已处理 / 总数 / 当前文件」，
 *     UI 可以显示进度并支持中断（复用 `LocalMusicSheet` 的 importToken 机制）
 *  3. **增量重扫**：用 `路径 → 大小 + mtime` 索引判断文件是否变化，
 *     未变化的文件不再重复解析元数据（元数据解析是最贵的一步）
 *
 * 状态用极简发布订阅暴露（`getSnapshot` + `subscribe`），
 * 组件侧用 `useSyncExternalStore` 或 `useEffect` 订阅即可。
 */
import Config from "@/core/appConfig";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { addFileScheme } from "@/utils/fileUtils";
import RNFS, { readDir } from "react-native-fs";

const store = getOrCreateMMKV("localMusic.scan");

const FOLDERS_KEY = "localMusic.folders";
const INDEX_KEY = "localMusic.index";

/** 扫描阶段 */
export type ScanPhase = "idle" | "scanning" | "parsing" | "done" | "error";

/** 扫描进度快照 */
export interface IScanProgress {
    phase: ScanPhase;
    /** 已处理数量 */
    current: number;
    /** 总数（解析阶段才有意义） */
    total: number;
    /** 当前处理的文件路径 */
    filePath?: string;
    /** 新增入库的歌曲数 */
    added: number;
    /** 跳过的（未变化）文件数 */
    skipped: number;
    /** 错误信息 */
    error?: string;
}

/** 已入库文件的状态索引项 */
export interface IFileStamp {
    /** 文件大小 */
    size: number;
    /** 修改时间（毫秒） */
    mtime: number;
}

const IDLE: IScanProgress = {
    phase: "idle",
    current: 0,
    total: 0,
    added: 0,
    skipped: 0,
};

let progress: IScanProgress = IDLE;
const listeners = new Set<() => void>();
/** 用户中断标记 */
let cancelled = false;

function notify() {
    listeners.forEach(listener => {
        try {
            listener();
        } catch (e) {
            // 订阅方异常不影响扫描
        }
    });
}

function setProgress(patch: Partial<IScanProgress>) {
    progress = { ...progress, ...patch };
    notify();
}

/** 上报进度（供 LocalMusicSheet 的解析阶段复用） */
export function reportScanProgress(patch: Partial<IScanProgress>) {
    setProgress(patch);
}

/** 当前扫描进度 */
export function getScanProgress(): IScanProgress {
    return progress;
}

/** 订阅扫描进度变化 */
export function subscribeScanProgress(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 请求中断当前扫描 */
export function cancelScan() {
    cancelled = true;
}

/** 是否正在扫描 */
export function isScanning(): boolean {
    return progress.phase === "scanning" || progress.phase === "parsing";
}

// ——— 文件夹白名单 ———

/** 取白名单目录（绝对路径，无 file:// 前缀） */
export function getScanFolders(): string[] {
    const raw = store.getString(FOLDERS_KEY);
    const parsed = raw ? safeParse<string[]>(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
}

/** 覆盖设置白名单目录 */
export function setScanFolders(folders: string[]) {
    store.set(FOLDERS_KEY, JSON.stringify(Array.from(new Set(folders))));
}

/** 追加目录到白名单 */
export function addScanFolders(folders: string[]) {
    setScanFolders([...getScanFolders(), ...folders]);
}

/** 移除某个白名单目录 */
export function removeScanFolder(folder: string) {
    setScanFolders(getScanFolders().filter(_ => _ !== folder));
}

// ——— 文件状态索引（增量重扫用） ———

function readIndex(): Record<string, IFileStamp> {
    const raw = store.getString(INDEX_KEY);
    const parsed = raw ? safeParse<Record<string, IFileStamp>>(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
}

function writeIndex(index: Record<string, IFileStamp>) {
    store.set(INDEX_KEY, JSON.stringify(index));
}

/** 已入库文件数 */
export function getIndexedFileCount(): number {
    return Object.keys(readIndex()).length;
}

/** 清空索引（下次扫描会全量重解析） */
export function clearScanIndex() {
    writeIndex({});
}

/**
 * 递归扫描目录下的音频文件。
 *
 * @param folderPaths 白名单目录（绝对路径）
 * @param isAudio     扩展名判定
 * @returns 音频文件绝对路径列表
 */
export async function collectAudioFiles(
    folderPaths: string[],
    isAudio: (filename: string) => boolean,
): Promise<string[]> {
    const queue = folderPaths.map(path => addFileScheme(path));
    const seen = new Set<string>();
    const result: string[] = [];
    // D12：排除目录（绝对路径前缀匹配），跳过录音/播客/有声书等
    const excluded = getExcludedPaths();
    /** 归一化：去 file:// 前缀，便于与配置里的绝对路径比较 */
    const plain = (p: string) =>
        p.startsWith("file://") ? decodeURIComponent(p.slice(7)) : p;
    const isExcluded = (p: string) => {
        if (!excluded.length) {
            return false;
        }
        const v = plain(p);
        return excluded.some(prefix => {
            const pre = prefix.replace(/\/+$/, "");
            return v === pre || v.startsWith(pre + "/");
        });
    };

    while (queue.length) {
        if (cancelled) {
            break;
        }
        const current = queue.shift()!;
        if (isExcluded(current)) {
            continue;
        }
        let entries: Array<{ isDirectory(): boolean; path: string }> = [];
        try {
            entries = (await readDir(current)) as any[];
        } catch (e) {
            // 目录不可读（权限/已删除）时跳过
            continue;
        }
        entries.forEach(entry => {
            if (entry.isDirectory()) {
                if (seen.has(entry.path) || isExcluded(entry.path)) {
                    return;
                }
                seen.add(entry.path);
                queue.push(entry.path);
            } else if (isAudio(entry.path)) {
                result.push(entry.path);
            }
        });
        setProgress({
            phase: "scanning",
            current: result.length,
            filePath: current,
        });
    }
    return result;
}

/** 读取消毒后的「排除目录」配置 */
function getExcludedPaths(): string[] {
    try {
        const raw = Config.getConfig("localMusic.excludedPaths");
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.filter(v => typeof v === "string" && v.trim().length > 0);
    } catch (e) {
        return [];
    }
}

/** 读取最短时长配置（秒）；<=0 表示不过滤 */
export function getMinDurationSec(): number {
    try {
        const raw = Config.getConfig("localMusic.minDurationSec");
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 判断文件是否需要（重新）解析元数据。
 *
 * 命中索引且 `size` 与 `mtime` 都没变 → 视为未变化。
 */
export function needsReparse(
    filePath: string,
    stat: { size?: number | string; mtime?: Date | number } | undefined,
): boolean {
    if (!stat) {
        return true;
    }
    const index = readIndex();
    const prev = index[filePath];
    if (!prev) {
        return true;
    }
    const size = Number(stat.size ?? 0);
    const mtime =
        stat.mtime instanceof Date
            ? stat.mtime.getTime()
            : Number(stat.mtime ?? 0);
    return prev.size !== size || prev.mtime !== mtime;
}

/** 记录文件已入库的状态 */
export function stampFiles(
    stamps: Array<{ filePath: string; size: number; mtime: number }>,
) {
    if (!stamps.length) {
        return;
    }
    const index = readIndex();
    stamps.forEach(({ filePath, size, mtime }) => {
        index[filePath] = { size, mtime };
    });
    writeIndex(index);
}

/** 扫描生命周期辅助：开始 / 结束 / 出错 */
export function beginScan() {
    cancelled = false;
    progress = { ...IDLE, phase: "scanning" };
    notify();
}

export function finishScan(patch: Partial<IScanProgress> = {}) {
    progress = { ...progress, phase: "done", ...patch };
    notify();
}

export function failScan(error: string) {
    progress = { ...progress, phase: "error", error };
    notify();
}

export function resetScanProgress() {
    cancelled = false;
    progress = IDLE;
    notify();
}

// ——— 增量扫描（与 LocalMusicSheet 协作） ———

/** 解析阶段的分组大小（沿用原有 25，规避序列化问题） */
const PARSE_GROUP_SIZE = 25;

/**
 * 对一组文件做「是否需要重扫」的判定，并把状态写入索引。
 *
 * @returns 需要重新解析元数据的文件列表
 */
export async function filterChangedFiles(
    files: string[],
): Promise<{ changed: string[]; skipped: number }> {
    const changed: string[] = [];
    const stamps: Array<{ filePath: string; size: number; mtime: number }> = [];
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
        if (cancelled) {
            break;
        }
        const filePath = files[i];
        let stat: any;
        try {
            stat = await RNFS.stat(filePath);
        } catch (e) {
            // 读取失败（权限/已删除）→ 跳过该文件
            skipped++;
            continue;
        }
        const size = Number(stat?.size ?? 0);
        const mtime =
            stat?.mtime instanceof Date
                ? stat.mtime.getTime()
                : Number(stat?.mtime ?? 0);
        if (needsReparse(filePath, stat)) {
            changed.push(filePath);
            stamps.push({ filePath, size, mtime });
        } else {
            skipped++;
        }
        if (i % 20 === 0) {
            setProgress({
                phase: "scanning",
                current: i + 1,
                total: files.length,
                filePath,
                skipped,
            });
        }
    }

    stampFiles(stamps);
    return { changed, skipped };
}

/** 解析阶段的分组大小与工具（供 LocalMusicSheet 复用） */
export { PARSE_GROUP_SIZE };
export { addFileScheme };

