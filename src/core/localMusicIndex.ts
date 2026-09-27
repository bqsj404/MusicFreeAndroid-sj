/**
 * 本地音乐索引 —— 支撑「本地优先取源」。
 *
 * 场景：用户在插件（Q音/酷我…）里点播一首歌，而本地音乐库里恰好有同一个作品。
 * 此时应当直接播本地文件，而不是再去请求在线音源。
 *
 * 判定口径统一走 [`@/core/mediaNameKey`]（逐字移植桌面版），即：
 *  - 歌名：小写 + 去掉空白与标点（**只删括号字符，保留括号内内容**）
 *  - 歌手：按分隔符拆成多人、各自归一化后**排序**合并
 *  - 歌手缺失或为「未知歌手」时，退化为「歌名唯一才采用」
 *
 * 注意：只做精确作品键匹配，命中即用；不命中原样走插件，零副作用。
 *
 * 历史修正：本文件原先自带一套归一化，其中
 * `replace(/[（(].*?[）)]/g, "")` 会把括号**连同内容**删掉，
 * 导致 `海底 (Live)` 与 `海底` 归一成同一个键 —— 本地放 Live 版、
 * 用户点的是原版时会被误判命中。现统一到桌面版口径。
 */
import LocalMusicSheet from "@/core/localMusicSheet";
import { getLocalPath } from "@/utils/mediaUtils";
import {
    buildMediaNameKey,
    isUnknownArtist,
    normalizeTitleKey,
} from "@/core/mediaNameKey";

export {
    buildMediaNameKey,
    normalizeArtistKey,
    normalizeTitleKey,
} from "@/core/mediaNameKey";

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

    // 目标作品键（歌手缺失时形如 `晴天|`）
    const wantedKey = buildMediaNameKey(title, artist);
    const fallbackByTitle: string[] = [];

    for (const item of list) {
        if (normalizeTitleKey(item.title) !== titleKey) {
            continue;
        }
        const path = getLocalPath(item);
        if (!path) {
            continue;
        }
        // 1) 作品键精确命中
        if (buildMediaNameKey(item.title, item.artist) === wantedKey) {
            return path;
        }
        // 2) 任一侧歌手未知时，收集「同歌名」候选，最后要求唯一
        if (isUnknownArtist(artist) || isUnknownArtist(item.artist)) {
            fallbackByTitle.push(path);
        }
    }

    return fallbackByTitle.length === 1 ? fallbackByTitle[0] : null;
}
