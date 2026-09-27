/**
 * 本地音乐索引 —— 支撑「本地优先取源」。
 *
 * 场景：用户在插件（Q音/酷我…）里点播一首歌，而本地音乐库里恰好有同一个作品。
 * 此时应当直接播本地文件，而不是再去请求在线音源。
 *
 * 判定口径与云盘同名匹配保持一致：**归一化「歌名 + 歌手」作品键**。
 *  - 歌名归一化：去空格、统一小写、去掉括号补充说明
 *  - 歌手归一化：去空格、统一小写
 *  - 歌手缺失或为「未知歌手」时，只按歌名匹配，且**要求唯一**才采用
 *
 * 注意：只做「精确作品键」匹配，命中即用；不命中原样走插件，零副作用。
 */
import LocalMusicSheet from "@/core/localMusicSheet";
import { getLocalPath } from "@/utils/mediaUtils";

/** 归一化歌名 */
export function normalizeTitleKey(title?: string | null): string {
    return (title ?? "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[（(].*?[）)]/g, "")
        .trim();
}

/** 归一化歌手 */
export function normalizeArtistKey(artist?: string | null): string {
    return (artist ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

/** 是否属于「歌手未知」 */
function isUnknownArtist(artist?: string | null): boolean {
    const key = normalizeArtistKey(artist);
    return !key || key === "未知歌手" || key === "unknown";
}

/**
 * 在本地音乐清单里按作品键找文件路径。
 *
 * @param title  歌名
 * @param artist 歌手
 * @returns 本地文件路径（file:// 或绝对路径）；未命中返回 null
 */
export function findLocalMusicByWorkKey(
    title?: string | null,
    artist?: string | null,
): string | null {
    const titleKey = normalizeTitleKey(title);
    if (!titleKey) {
        return null;
    }

    let list: IMusic.IMusicItem[] = [];
    try {
        list = LocalMusicSheet.getMusicList() ?? [];
    } catch (e) {
        return null;
    }
    if (!list.length) {
        return null;
    }

    const artistKey = normalizeArtistKey(artist);
    const matchByTitle: string[] = [];

    for (const item of list) {
        if (normalizeTitleKey(item.title) !== titleKey) {
            continue;
        }
        const path = getLocalPath(item);
        if (!path) {
            continue;
        }
        if (isUnknownArtist(artist)) {
            // 歌手未知：只按歌名收集候选，最后要求唯一
            matchByTitle.push(path);
            continue;
        }
        if (normalizeArtistKey(item.artist) === artistKey) {
            return path;
        }
    }

    // 歌手未知（或本地条目歌手缺失）时，歌名唯一才采用
    return matchByTitle.length === 1 ? matchByTitle[0] : null;
}
