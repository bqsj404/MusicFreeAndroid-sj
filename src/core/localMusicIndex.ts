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
import { toPlainFilePath } from "@/utils/fileUrl";
import {
    buildMediaNameKey,
    isUnknownArtist,
    normalizeTitleKey,
} from "@/core/mediaNameKey";
import { findFileForMedia } from "@/core/mediaFileRegistry";
import { isDurationConflict } from "@/core/sourceMatch";

export {
    buildMediaNameKey,
    normalizeArtistKey,
    normalizeTitleKey,
} from "@/core/mediaNameKey";

/**
 * 在本地音乐清单里按作品键找文件路径。
 *
 * 查找顺序（D1 与第 5 批「文件真值层」的衔接）：
 *  1. **优先查文件真值层**（`mediaFileRegistry`）—— 里面只登记过真实存在过、
 *     且嗅探过容器格式的文件，比内存清单可靠得多；
 *  2. 再兜底查 `LocalMusicSheet` 内存清单（扫描入库但尚未登记的条目）。
 *
 * 为什么要分两步：本地库里可能残留 `localPath` 已失效的条目
 * （例如从云盘播放后自动入库、随后缓存被清理），
 * 若先命中这种条目，调用方的 `exists` 检查会失败，于是"本地优先"被白白错过。
 *
 * @param title    歌名
 * @param artist   歌手
 * @param duration 期望时长（秒，可选）。
 *                 **第 7 批 · 问题 2**：同一首歌名在本地可能有多个版本
 *                 （试听片段、Live、翻唱、不同码率的转码），只按「歌名+歌手」
 *                 会命中最先入库的那一个。给了期望时长后，会优先返回
 *                 **时长接近**的那条，把"点开却不是这首"的概率降下来。
 *                 时长未知（为 0/undefined）时不做筛选，行为与从前一致。
 * @returns 本地文件路径（file:// 或绝对路径）；未命中返回 null
 */
export function findLocalMusicByWorkKey(
    title?: string | null,
    artist?: string | null,
    duration?: number | null,
): string | null {
    const titleKey = normalizeTitleKey(title);
    if (!titleKey) {
        return null;
    }

    // 1. 文件真值层（可信度最高）
    const recorded = findFileForMedia(title, artist);
    if (recorded?.path) {
        // 真值层不存时长，无法做版本优选；但若内存清单里能找到
        // 同一路径的条目且时长对不上，就说明真值层命中的是另一个版本。
        const conflicted = isConflictedWithLocalSheet(
            recorded.path,
            duration,
        );
        if (!conflicted) {
            return recorded.path;
        }
    }

    // 2. 兜底：内存清单
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
    /** 同作品但时长不接近的候选，作为最后兜底 */
    const weakCandidates: string[] = [];

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
            if (isDurationConflict(duration, item.duration)) {
                weakCandidates.push(path);
                continue;
            }
            return path;
        }
        // 2) 任一侧歌手未知时，收集「同歌名」候选，最后要求唯一
        if (isUnknownArtist(artist) || isUnknownArtist(item.artist)) {
            fallbackByTitle.push(path);
        }
    }

    if (fallbackByTitle.length === 1) {
        return fallbackByTitle[0];
    }
    // 3) 只剩"同名但时长对不上"的候选时仍然返回 ——
    //    总比让用户什么都听不到好；时长只是优选而非硬门槛。
    return weakCandidates.length ? weakCandidates[0] : null;
}

/**
 * 真值层命中的路径，是否与内存清单里同路径条目的时长冲突。
 * 真值层记录不带时长，只能反查内存清单拿；查不到就不否决。
 */
function isConflictedWithLocalSheet(
    path: string,
    expectedDuration?: number | null,
): boolean {
    if (
        typeof expectedDuration !== "number" ||
        expectedDuration <= 0
    ) {
        return false;
    }
    let list: IMusic.IMusicItem[] = [];
    try {
        list = LocalMusicSheet.getMusicList() ?? [];
    } catch (e) {
        return false;
    }
    const plain = toPlainFilePath(path);
    const hit = list.find(item => {
        const itemPath = getLocalPath(item);
        return !!itemPath && toPlainFilePath(itemPath) === plain;
    });
    return (
        !!hit && isDurationConflict(expectedDuration, hit.duration)
    );
}

