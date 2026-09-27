/**
 * 歌词偏移计算（D9「拖动对时」）。
 *
 * 抽成纯函数是为了能被单测覆盖 —— 这里涉及符号方向，
 * 弄反了会让"对时"把歌词推得更偏，但界面上不容易一眼看出来。
 *
 * 语义（见 `utils/lrcParser.ts`）：
 * ```
 * meta.offset  = 歌词内嵌 offset + extra.offset
 * extra.offset = -storedLyricOffset          // lyricManager 传入时取了反
 * 取词位置      = position - meta.offset
 * ```
 * 于是「某一行实际播放的时刻」= `lyricTime + meta.offset`。
 */

export interface IAlignOffsetParams {
    /** 该行歌词的时间（LRC 原始时间，不含 offset） */
    lyricTime: number;
    /** 当前播放进度（秒） */
    position: number;
    /** 当前解析器上的 offset（= 内嵌 offset + extra.offset） */
    metaOffset: number;
    /** 当前存储的 lyricOffset */
    storedOffset: number;
}

/**
 * 计算「把 `lyricTime` 这一行对齐到 `position` 此刻」所需的 lyricOffset。
 *
 * 推导：令该行实际播放时刻等于 position，
 * ```
 * lyricTime + newMeta = position
 * newMeta   = embedded - newStored
 * embedded  = metaOffset + storedOffset     // 由 meta = embedded + extra 且 extra = -stored
 * ⇒ newStored = metaOffset + storedOffset - position + lyricTime
 * ```
 */
export function computeAlignOffset(params: IAlignOffsetParams): number {
    const { lyricTime, position, metaOffset, storedOffset } = params;
    return metaOffset + storedOffset - position + lyricTime;
}

/**
 * 反向校验：给定 lyricOffset 与该行时间，算出它**实际会在什么进度播放**。
 *
 * 用于单测回代，也可用于界面提示。
 */
export function resolvePlaybackTime(params: {
    lyricTime: number;
    metaOffset: number;
    storedOffset: number;
    /** 歌词内嵌 offset（= metaOffset + storedOffset） */
    embeddedOffset: number;
}): number {
    const { lyricTime, metaOffset, storedOffset, embeddedOffset } = params;
    void metaOffset;
    // newMeta = embedded - stored
    const meta = embeddedOffset - storedOffset;
    return lyricTime + meta;
}
