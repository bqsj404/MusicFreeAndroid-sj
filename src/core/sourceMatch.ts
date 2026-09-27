import { NOISE_RE, normalizeArtistKey } from "./mediaNameKey";

/**
 * 换源匹配规则（D2「`sourceMatch` 四级」）。
 *
 * 参考落雪音乐的策略，**4 级递降**：级别数字越小越可信。
 * 手工换源/批量换源都按这个尺度判断"搜到的这首是不是同一首歌"。
 *
 * | 级别 | 规则 |
 * |---|---|
 * | 0 `Exact` | 歌名 + 歌手完全一致（归一化后） |
 * | 1 `TitleExact` | 歌名完全一致 + 歌手互相包含 |
 * | 2 `MutualContains` | 歌名互相包含 + 歌手互相包含 |
 * | 3 `TitleContains` | 仅歌名互相包含（兜底） |
 * | -1 `None` | 不匹配 |
 *
 * 归一化口径**复用 D3 的 `NOISE_RE`**（去空白与常见中英文标点），
 * 这样「换源匹配」与「本地优先命中」判的是同一件事，不会出现
 * 一处认得出、另一处认不出的割裂。
 */

export enum SourceMatchLevel {
    /** 歌名 + 歌手完全一致 */
    Exact = 0,
    /** 歌名完全一致 + 歌手互相包含 */
    TitleExact = 1,
    /** 歌名互相包含 + 歌手互相包含 */
    MutualContains = 2,
    /** 仅歌名互相包含（兜底） */
    TitleContains = 3,
    /** 不匹配 */
    None = -1,
}

/** 归一化：去噪（空白/标点）+ 统一小写 */
export function normalizeForMatch(text?: string | null): string {
    if (!text) {
        return "";
    }
    return text.replace(NOISE_RE, "").toLowerCase();
}

/**
 * 歌手集合归一化。
 *
 * 多歌手按**字典序排序后**再比较 —— 否则「周杰伦/费玉清」与
 * 「费玉清/周杰伦」会被判成不同，而它们其实是同一首。
 */
export function normalizeArtists(artist?: string | null): string {
    // 直接复用 D3 的实现（拆人 + 字典序排序 + 去噪 + 小写），
    // 避免两套口径漂移导致「换源认得出、本地优先认不出」这类割裂。
    return normalizeArtistKey(artist ?? "");
}

function contains(a: string, b: string): boolean {
    if (!a || !b) {
        return false;
    }
    return a.includes(b) || b.includes(a);
}

/**
 * 判定两个条目的匹配级别。
 *
 * @returns 匹配级别；`None` 表示不匹配
 */
export function matchSourceLevel(
    a: { title?: string | null; artist?: string | null } | null | undefined,
    b: { title?: string | null; artist?: string | null } | null | undefined,
): SourceMatchLevel {
    const titleA = normalizeForMatch(a?.title);
    const titleB = normalizeForMatch(b?.title);
    if (!titleA || !titleB) {
        return SourceMatchLevel.None;
    }
    const artistA = normalizeArtists(a?.artist);
    const artistB = normalizeArtists(b?.artist);

    const titleEqual = titleA === titleB;
    const titleMutual = contains(titleA, titleB);
    const artistEqual = !!artistA && !!artistB && artistA === artistB;
    const artistMutual = contains(artistA, artistB);

    if (titleEqual && artistEqual) {
        return SourceMatchLevel.Exact;
    }
    // 歌名一致、但歌手只是互相包含（如「李荣浩」vs「李荣浩/某」）
    if (titleEqual && artistMutual) {
        return SourceMatchLevel.TitleExact;
    }
    // 歌名一致但歌手对不上 —— 降一档，仍有可能是同一首（翻唱/未知歌手）
    if (titleEqual) {
        return SourceMatchLevel.TitleExact;
    }
    if (titleMutual && artistMutual) {
        return SourceMatchLevel.MutualContains;
    }
    if (titleMutual) {
        return SourceMatchLevel.TitleContains;
    }
    return SourceMatchLevel.None;
}

/** 是否算匹配上（非 None） */
export function isMatched(level: SourceMatchLevel): boolean {
    return level !== SourceMatchLevel.None;
}

/** 是否属于「精确」档（级别 0/1）—— 批量换源里做时长优选时用 */
export function isPreciseMatch(level: SourceMatchLevel): boolean {
    return (
        level === SourceMatchLevel.Exact ||
        level === SourceMatchLevel.TitleExact
    );
}

/** 批量换源：时长接近的容差（秒） */
export const DURATION_TOLERANCE_SEC = 5;

/**
 * 在候选里挑最合适的一个。
 *
 * 规则：
 *  1. 先按匹配级别（越小越好）
 *  2. 同级别里，若给了时长，优先**时长接近**的（±5s 内）
 *  3. 都不接近时，取级别最好的第一个
 *
 * 之所以把时长放在"同级别内"而不是全局：时长只是**优选**，
 * 不该让一个差一级但时长凑巧接近的候选胜出。
 */
export function pickBestMatch<T extends { title?: string; artist?: string; duration?: number }>(
    target: { title?: string; artist?: string; duration?: number },
    candidates: T[] | null | undefined,
): { item: T; level: SourceMatchLevel } | null {
    if (!candidates?.length) {
        return null;
    }
    let best: { item: T; level: SourceMatchLevel } | null = null;
    let bestDurationGap = Infinity;

    candidates.forEach(item => {
        const level = matchSourceLevel(target, item);
        if (level === SourceMatchLevel.None) {
            return;
        }
        const gap =
            typeof target.duration === "number" &&
            typeof item.duration === "number" &&
            target.duration > 0 &&
            item.duration > 0
                ? Math.abs(target.duration - item.duration)
                : Infinity;

        if (!best) {
            best = { item, level };
            bestDurationGap = gap;
            return;
        }
        if (level < best.level) {
            best = { item, level };
            bestDurationGap = gap;
            return;
        }
        if (level === best.level && gap < bestDurationGap) {
            // 同级别：时长更接近者胜
            best = { item, level };
            bestDurationGap = gap;
        }
    });

    return best;
}

/** 时长是否在容差内（批量换源的额外优选条件） */
export function isDurationClose(
    a?: number,
    b?: number,
    tolerance = DURATION_TOLERANCE_SEC,
): boolean {
    if (typeof a !== "number" || typeof b !== "number" || a <= 0 || b <= 0) {
        return false;
    }
    return Math.abs(a - b) <= tolerance;
}

