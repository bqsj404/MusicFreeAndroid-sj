import pathConst from "@/constants/pathConst";
import { getAllLyricEntries, lookupLyric } from "@/core/lyricRegistry";
import { readDir, unlink } from "react-native-fs";

/**
 * 歌词文件管理的数据层（D8）。
 *
 * 三个 scope：
 *  - `local`   —— `local_lrc/<platformHash>/<idHash>.lrc`：用户手动上传/设置的
 *  - `cache`   —— `cache/lrc/*.lrc`：插件取词后写下的缓存（文件名是随机串，
 *                 不携带归属信息，因此天然无法关联到歌曲）
 *  - `cloud`   —— 远端的 `/MusicFree/lyrics`（由云端模块枚举，见 cloudDisk）
 */
export type LyricScope = "local" | "cache" | "cloud";

export interface ILyricFileRecord {
    scope: LyricScope;
    /** 展示用文件名 */
    name: string;
    /** 绝对路径（可直接删除） */
    path: string;
    /** 是否有翻译文件 */
    hasTranslation: boolean;
    /** 关联到的歌曲信息；未登记时为 null */
    owner: {
        title: string;
        artist: string;
        platform: string;
        id: string;
    } | null;
}

/** 从路径取文件名（不依赖 node:path，避免 bundler 差异） */
function baseName(p: string): string {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx >= 0 ? p.slice(idx + 1) : p;
}

function dirName(p: string): string {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx >= 0 ? p.slice(0, idx) : p;
}

/** 目录名安全读取（目录不存在时返回空数组） */
async function safeReadDir(dir: string): Promise<any[]> {
    try {
        return (await readDir(dir)) ?? [];
    } catch (e) {
        return [];
    }
}

/**
 * 枚举本地手动歌词（`local_lrc/`）。
 *
 * 目录结构是 `<platformHash>/<idHash>.lrc`（翻译为 `<idHash>.tran.lrc`），
 * 所以先按 idHash 把原文与翻译聚成一条记录。
 */
export async function listLocalLyricFiles(): Promise<ILyricFileRecord[]> {
    const base = pathConst.localLrcPath;
    const result: ILyricFileRecord[] = [];
    const platformDirs = await safeReadDir(base);

    for (const dir of platformDirs) {
        if (!dir?.isDirectory?.()) {
            continue;
        }
        const platformHash = baseName(dir.path);
        const files: any[] = await safeReadDir(dir.path);
        /** idHash → { rawPath?, tranPath? } */
        const grouped = new Map<string, { raw?: string; tran?: string }>();

        files.forEach(file => {
            if (file?.isDirectory?.()) {
                return;
            }
            const fileName = baseName(file.path);
            if (!fileName.endsWith(".lrc")) {
                return;
            }
            const isTran = fileName.endsWith(".tran.lrc");
            const idHash = isTran
                ? fileName.slice(0, -".tran.lrc".length)
                : fileName.slice(0, -".lrc".length);
            const entry = grouped.get(idHash) ?? {};
            if (isTran) {
                entry.tran = file.path;
            } else {
                entry.raw = file.path;
            }
            grouped.set(idHash, entry);
        });

        grouped.forEach((entry, idHash) => {
            const registered = lookupLyric(platformHash, idHash);
            result.push({
                scope: "local",
                name: registered
                    ? `${registered.title}${registered.artist ? ` - ${registered.artist}` : ""}`
                    : `${idHash.slice(0, 8)}…(未登记)`,
                path: entry.raw ?? entry.tran ?? "",
                hasTranslation: !!entry.tran,
                owner: registered
                    ? {
                          title: registered.title,
                          artist: registered.artist,
                          platform: registered.platform,
                          id: registered.id,
                      }
                    : null,
            });
        });
    }

    return result;
}

/** 枚举插件取词缓存（`cache/lrc/`）——文件名是随机串，无归属信息 */
export async function listCacheLyricFiles(): Promise<ILyricFileRecord[]> {
    const files = await safeReadDir(pathConst.lrcCachePath);
    return files
        .filter(file => !file?.isDirectory?.())
        .map(file => ({
            scope: "cache" as const,
            name: baseName(file.path),
            path: file.path,
            hasTranslation: false,
            owner: null,
        }));
}

/** 删除一个歌词文件（含它的翻译兄弟文件与注册记录） */
export async function deleteLyricFile(
    record: ILyricFileRecord,
): Promise<boolean> {
    let ok = false;
    const target = record.path;
    if (!target) {
        return false;
    }

    await unlink(target).catch(() => {
        ok = false;
    });
    ok = true;

    if (record.scope === "local") {
        // 同时清掉 .tran.lrc 与相反的那份
        const dir = dirName(target);
        const fileName = baseName(target);
        const idHash = fileName.endsWith(".tran.lrc")
            ? fileName.slice(0, -".tran.lrc".length)
            : fileName.endsWith(".lrc")
              ? fileName.slice(0, -".lrc".length)
              : null;
        if (idHash) {
            await unlink(`${dir}/${idHash}.lrc`).catch(() => {});
            await unlink(`${dir}/${idHash}.tran.lrc`).catch(() => {});
        }
    }
    return ok;
}

/** 批量删除；返回成功条数 */
export async function deleteLyricFiles(
    records: ILyricFileRecord[],
): Promise<number> {
    let done = 0;
    for (const record of records) {
        // 串行即可，歌词文件很小、数量也有限
        // eslint-disable-next-line no-await-in-loop
        if (await deleteLyricFile(record)) {
            done++;
        }
    }
    return done;
}

/** 统计：本地歌词里有多少条完全没有归属（用于「清理未登记」提示） */
export function countUnowned(
    records: ILyricFileRecord[],
): number {
    return records.filter(r => !r.owner).length;
}

/** 便于页面快速拿到注册总条数 */
export function getRegisteredCount(): number {
    return getAllLyricEntries().length;
}

