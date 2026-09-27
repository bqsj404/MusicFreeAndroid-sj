import CryptoJs from "crypto-js";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";

/**
 * 歌词注册表（D8 歌词管理）。
 *
 * ## 为什么需要它
 *
 * 手动设置的歌词落在 `local_lrc/<platformHash>/<idHash>.lrc`，
 * 文件名是 **MD5（单向）**，无法从文件名反查回是哪首歌。
 * 而「歌词管理」要做的**孤儿分区**（判断某个歌词文件是否还有主）
 * 恰恰需要这个反查能力。
 *
 * 所以写入歌词时顺带登记一份可逆映射；历史遗留的歌词没有登记记录，
 * 会被归入「未知来源」——这与「孤儿」是不同的概念：
 *  - **孤儿**：有登记记录，但对应歌曲已不在任何歌单/本地库里
 *  - **未登记**：本次改动之前写入的，无从判断
 */
export interface ILyricRegistryEntry {
    /** `MD5(platform)` */
    platformHash: string;
    /** `MD5(id)` */
    idHash: string;
    platform: string;
    id: string;
    title: string;
    artist: string;
    /** 是否有翻译文件 */
    hasTranslation: boolean;
    /** 登记时间 */
    registeredAt: number;
}

const lyricRegistry = getOrCreateMMKV("lyric.registry");
const REGISTRY_KEY = "lyric:entries";

type EntryMap = Record<string, ILyricRegistryEntry>;

/** 注册表键：`<platformHash>/<idHash>`（与磁盘目录结构一致） */
export function buildRegistryKey(platformHash: string, idHash: string): string {
    return `${platformHash}/${idHash}`;
}

/** 由音乐条目算出它在歌词目录里的键 */
export function registryKeyOf(musicItem: IMusic.IMusicItem): string {
    const platformHash = CryptoJs.MD5(musicItem.platform).toString(
        CryptoJs.enc.Hex,
    );
    const idHash = CryptoJs.MD5(musicItem.id).toString(CryptoJs.enc.Hex);
    return buildRegistryKey(platformHash, idHash);
}

function readAll(): EntryMap {
    try {
        const raw = lyricRegistry.getString(REGISTRY_KEY);
        const parsed = raw ? safeParse<EntryMap>(raw) : null;
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
    } catch (e) {
        // 读取失败视为空表
    }
    return {};
}

function writeAll(map: EntryMap) {
    try {
        lyricRegistry.set(REGISTRY_KEY, JSON.stringify(map));
    } catch (e) {
        // 落盘失败不影响歌词本身
    }
}

/** 登记（或更新）一条歌词归属 */
export function registerLyric(
    musicItem: IMusic.IMusicItem,
    options: { hasTranslation?: boolean } = {},
) {
    if (!musicItem?.platform || !musicItem?.id) {
        return;
    }
    const platformHash = CryptoJs.MD5(musicItem.platform).toString(
        CryptoJs.enc.Hex,
    );
    const idHash = CryptoJs.MD5(musicItem.id).toString(CryptoJs.enc.Hex);
    const all = readAll();
    const key = buildRegistryKey(platformHash, idHash);
    const existed = all[key];

    all[key] = {
        platformHash,
        idHash,
        platform: musicItem.platform,
        id: musicItem.id,
        title: musicItem.title ?? existed?.title ?? "",
        artist: musicItem.artist ?? existed?.artist ?? "",
        // 只在显式传入时更新翻译标志，避免"上传原文"把已有翻译标记清掉
        hasTranslation: options.hasTranslation ?? existed?.hasTranslation ?? false,
        registeredAt: existed?.registeredAt ?? Date.now(),
    };
    writeAll(all);
}

/** 只更新翻译标志（上传翻译时用，不动其它字段） */
export function markTranslation(
    musicItem: IMusic.IMusicItem,
    hasTranslation: boolean,
) {
    const key = registryKeyOf(musicItem);
    const all = readAll();
    if (!all[key]) {
        // 没有登记过就先建一条
        registerLyric(musicItem, { hasTranslation });
        return;
    }
    all[key].hasTranslation = hasTranslation;
    writeAll(all);
}

/** 注销一条歌词归属（删除歌词时调用） */
export function unregisterLyric(musicItem: IMusic.IMusicItem) {
    const key = registryKeyOf(musicItem);
    const all = readAll();
    if (all[key]) {
        delete all[key];
        writeAll(all);
    }
}

/** 查询一条歌词的归属；未登记返回 null */
export function lookupLyric(
    platformHash: string,
    idHash: string,
): ILyricRegistryEntry | null {
    const all = readAll();
    return all[buildRegistryKey(platformHash, idHash)] ?? null;
}

/** 取全部登记记录 */
export function getAllLyricEntries(): ILyricRegistryEntry[] {
    return Object.values(readAll());
}

/**
 * 清理注册表：只保留 `validKeys` 里的记录。
 *
 * @returns 被清理掉的条数
 */
export function pruneLyricRegistry(validKeys: Set<string>): number {
    const all = readAll();
    let removed = 0;
    Object.keys(all).forEach(key => {
        if (!validKeys.has(key)) {
            delete all[key];
            removed++;
        }
    });
    if (removed) {
        writeAll(all);
    }
    return removed;
}

/** 清空注册表 */
export function clearLyricRegistry() {
    writeAll({});
}

