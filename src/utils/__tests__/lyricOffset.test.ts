/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
    toBeCloseTo: (expected: number, precision?: number) => void;
};

import { computeAlignOffset, resolvePlaybackTime } from "../lyricOffset";

/**
 * D9 拖动对时的偏移公式。
 *
 * 重点守住**符号方向**：算反了会把歌词推得更偏，
 * 而界面上"看起来像生效了"，很难靠肉眼发现。
 */
describe("computeAlignOffset", () => {
    it("已经对齐时应返回原偏移（幂等）", () => {
        // stored=0 → extra=0，embedded=0 → meta=0
        // 该行在 position = lyricTime 时播放，正好对齐
        expect(
            computeAlignOffset({
                lyricTime: 8,
                position: 8,
                metaOffset: 0,
                storedOffset: 0,
            }),
        ).toBe(0);
    });

    it("歌词已经唱过（行时间早于当前进度）时，偏移应为负", () => {
        // 行时间 8，当前已播到 10 —— 说明歌词"慢"了 2 秒
        const offset = computeAlignOffset({
            lyricTime: 8,
            position: 10,
            metaOffset: 0,
            storedOffset: 0,
        });
        expect(offset).toBe(-2);
    });

    it("施加新偏移后，该行应恰好在目标进度播放（回代校验）", () => {
        const position = 10;
        const lyricTime = 8;
        const embeddedOffset = 0;
        const offset = computeAlignOffset({
            lyricTime,
            position,
            metaOffset: embeddedOffset,
            storedOffset: 0,
        });
        const playbackAt = resolvePlaybackTime({
            lyricTime,
            metaOffset: embeddedOffset,
            storedOffset: offset,
            embeddedOffset,
        });
        expect(playbackAt).toBe(position);
    });

    it("存在内嵌 offset 时也应成立（回代校验）", () => {
        const embeddedOffset = 1.5; // 例如 LRC 里的 [offset:1500]
        const storedOffset = 0.5;
        const metaOffset = embeddedOffset - storedOffset; // meta = embedded + extra
        const position = 20;
        const lyricTime = 17;

        const offset = computeAlignOffset({
            lyricTime,
            position,
            metaOffset,
            storedOffset,
        });
        const playbackAt = resolvePlaybackTime({
            lyricTime,
            metaOffset,
            storedOffset: offset,
            embeddedOffset,
        });
        expect(playbackAt).toBeCloseTo(position, 6);
    });

    it("连续对时应收敛（第二次对时偏移不再变化）", () => {
        const lyricTime = 12;
        const embeddedOffset = 0;
        const position = 15;

        const first = computeAlignOffset({
            lyricTime,
            position,
            metaOffset: embeddedOffset,
            storedOffset: 0,
        });
        // 第一次对时后：stored = first，meta = embedded - first
        const second = computeAlignOffset({
            lyricTime,
            position,
            metaOffset: embeddedOffset - first,
            storedOffset: first,
        });
        expect(second).toBeCloseTo(first, 6);
    });
});

describe("resolvePlaybackTime", () => {
    it("无任何偏移时等于行时间", () => {
        expect(
            resolvePlaybackTime({
                lyricTime: 5,
                metaOffset: 0,
                storedOffset: 0,
                embeddedOffset: 0,
            }),
        ).toBe(5);
    });

    it("stored 为正会让该行提前播放", () => {
        // stored=2 → extra=-2 → meta = 0 + (-2) = -2
        // 播放时刻 = 5 + (-2) = 3，即提前 2 秒
        expect(
            resolvePlaybackTime({
                lyricTime: 5,
                metaOffset: -2,
                storedOffset: 2,
                embeddedOffset: 0,
            }),
        ).toBe(3);
    });
});
