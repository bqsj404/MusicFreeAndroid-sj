/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
};

import {
    SourceMatchLevel,
    isDurationClose,
    isMatched,
    isPreciseMatch,
    matchSourceLevel,
    normalizeArtists,
    pickBestMatch,
} from "../sourceMatch";

/**
 * D2 换源匹配的四级规则。
 *
 * 判松了会「换错歌」（把 Live 版换成录音室版、把翻唱换成原唱），
 * 判严了会「明明有却不换」（歌手写法不同就认不出）。两种都很难在
 * 界面上一眼看出来，所以逐级锁住。
 */
describe("matchSourceLevel", () => {
    it("歌名与歌手都一致 → Exact", () => {
        expect(
            matchSourceLevel(
                { title: "李白", artist: "李荣浩" },
                { title: "李白", artist: "李荣浩" },
            ),
        ).toBe(SourceMatchLevel.Exact);
    });

    it("标点/空白/大小写差异不影响 Exact", () => {
        expect(
            matchSourceLevel(
                { title: "The Best Song!", artist: "A B" },
                { title: "the best song", artist: "ab" },
            ),
        ).toBe(SourceMatchLevel.Exact);
    });

    it("多歌手顺序不同仍算 Exact（字典序归一）", () => {
        expect(
            matchSourceLevel(
                { title: "千里之外", artist: "周杰伦/费玉清" },
                { title: "千里之外", artist: "费玉清/周杰伦" },
            ),
        ).toBe(SourceMatchLevel.Exact);
    });

    it("歌名一致、歌手互相包含 → TitleExact", () => {
        expect(
            matchSourceLevel(
                { title: "海底", artist: "凤凰传奇" },
                { title: "海底", artist: "凤凰传奇/某某" },
            ),
        ).toBe(SourceMatchLevel.TitleExact);
    });

    it("歌名互相包含 + 歌手互相包含 → MutualContains", () => {
        expect(
            matchSourceLevel(
                { title: "海底 (Live)", artist: "凤凰传奇" },
                { title: "海底", artist: "凤凰传奇" },
            ),
        ).toBe(SourceMatchLevel.MutualContains);
    });

    it("仅歌名互相包含 → TitleContains", () => {
        expect(
            matchSourceLevel(
                { title: "李白 (Live)", artist: "李荣浩" },
                { title: "李白", artist: "张三" },
            ),
        ).toBe(SourceMatchLevel.TitleContains);
    });

    it("歌名毫不相干 → None", () => {
        expect(
            matchSourceLevel(
                { title: "李白", artist: "李荣浩" },
                { title: "晴天", artist: "周杰伦" },
            ),
        ).toBe(SourceMatchLevel.None);
    });

    it("缺歌名 → None（不做兜底乱配）", () => {
        expect(
            matchSourceLevel({ title: "", artist: "李荣浩" }, { title: "李白" }),
        ).toBe(SourceMatchLevel.None);
    });
});

describe("normalizeArtists", () => {
    it("拆分后排序，与输入顺序无关", () => {
        const a = normalizeArtists("周杰伦/费玉清");
        const b = normalizeArtists("费玉清/周杰伦");
        expect(a).toBe(b);
    });

    it("也认「 - 」这种分隔", () => {
        const a = normalizeArtists("周杰伦 - 费玉清");
        const b = normalizeArtists("费玉清&周杰伦");
        expect(a).toBe(b);
    });
});

describe("isMatched / isPreciseMatch", () => {
    it("None 不算匹配，其余都算", () => {
        expect(isMatched(SourceMatchLevel.None)).toBe(false);
        expect(isMatched(SourceMatchLevel.TitleContains)).toBe(true);
    });

    it("只有 0/1 级算精确档", () => {
        expect(isPreciseMatch(SourceMatchLevel.Exact)).toBe(true);
        expect(isPreciseMatch(SourceMatchLevel.TitleExact)).toBe(true);
        expect(isPreciseMatch(SourceMatchLevel.MutualContains)).toBe(false);
    });
});

describe("pickBestMatch", () => {
    it("级别优先于时长：差一级但时长更接近的不能胜出", () => {
        const target = { title: "李白", artist: "李荣浩", duration: 100 };
        const result = pickBestMatch(target, [
            // 级别较差（仅歌名包含），但时长只差 1s
            { title: "李白 (Live)", artist: "张三", duration: 101 },
            // 级别更好（Exact），时长差 20s
            { title: "李白", artist: "李荣浩", duration: 120 },
        ]);
        expect(result?.level).toBe(SourceMatchLevel.Exact);
        expect(result?.item.artist).toBe("李荣浩");
    });

    it("同级别内取时长更接近的", () => {
        const target = { title: "李白", artist: "李荣浩", duration: 100 };
        const result = pickBestMatch(target, [
            { title: "李白", artist: "李荣浩", duration: 130 },
            { title: "李白", artist: "李荣浩", duration: 102 },
        ]);
        expect(result?.item.duration).toBe(102);
    });

    it("没有匹配项时返回 null", () => {
        expect(
            pickBestMatch({ title: "李白", artist: "李荣浩" }, [
                { title: "晴天", artist: "周杰伦" },
            ]),
        ).toBe(null);
    });

    it("空候选返回 null", () => {
        expect(pickBestMatch({ title: "李白" }, [])).toBe(null);
    });
});

describe("isDurationClose", () => {
    it("±5s 内算接近", () => {
        expect(isDurationClose(100, 104)).toBe(true);
        expect(isDurationClose(100, 106)).toBe(false);
    });

    it("缺时长时不算接近（不因此误判）", () => {
        expect(isDurationClose(undefined, 100)).toBe(false);
        expect(isDurationClose(0, 0)).toBe(false);
    });
});
