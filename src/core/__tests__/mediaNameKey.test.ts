/**
 * 作品键（`mediaNameKey`）单测。
 *
 * 这个键决定「本地优先取源」与「云盘同名匹配」能否对上同一首歌，
 * 口径写错会导致两种后果，都很隐蔽：
 *  - 太严（歌手写法不同就匹配不上）→ 本地有文件却仍然走在线音源
 *  - 太松（把不同版本当成同一首）→ Live 版匹配到录音室版，播错歌
 *
 * 所以用桌面版注释里实测的《珊瑚海》多种写法，以及 `海底 (Live)` 这类
 * 版本差异作为回归基线。
 *
 * 项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的 jest 全局。
 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
    toEqual: (expected: any) => void;
    not: {
        toBe: (expected: any) => void;
    };
};

import {
    buildMediaNameKey,
    normalizeArtistKey,
    normalizeTitleKey,
    isUnknownArtist,
} from "../mediaNameKey";

describe("normalizeTitleKey", () => {
    it("小写并去掉空白与标点", () => {
        expect(normalizeTitleKey("Hello, World!")).toBe("helloworld");
    });

    it("**只删括号字符、保留括号内内容**（版本信息不能丢）", () => {
        // 这条是回归基线：曾经写成 replace(/[（(].*?[）)]/g, '') 把 Live 一起删了，
        // 导致「海底 (Live)」与「海底」被误判为同一作品。
        expect(normalizeTitleKey("海底 (Live)")).toBe("海底live");
        expect(normalizeTitleKey("海底")).toBe("海底");
    });

    it("连接号/下划线等噪音会被删，但书名号《》不在噪音集内（沿桌面版口径）", () => {
        // 桌面版 NOISE_RE 未收录 《》，故照实保留；破折号与空格会被删。
        expect(normalizeTitleKey("《晴天》— 周杰伦")).toBe("《晴天》周杰伦");
    });

    it("空/缺失返回空串", () => {
        expect(normalizeTitleKey(null)).toBe("");
        expect(normalizeTitleKey("   ")).toBe("");
    });
});

describe("normalizeArtistKey", () => {
    it("按分隔符拆人、排序后合并 —— 三种写法归一一致", () => {
        // 桌面版注释里实测的《珊瑚海》三种来源写法
        const a = normalizeArtistKey("周杰伦&Lara梁心颐");
        const b = normalizeArtistKey("周杰伦, Lara梁心颐");
        const c = normalizeArtistKey("周杰伦、Lara梁心颐");
        expect(a).toBe(b);
        expect(b).toBe(c);
    });

    it("顺序无关", () => {
        expect(normalizeArtistKey("A&B")).toBe(normalizeArtistKey("B&A"));
    });

    it("连字符分隔（带空格）也算多人", () => {
        expect(normalizeArtistKey("A - B")).toBe(normalizeArtistKey("A、B"));
    });

    it("单人不受影响", () => {
        expect(normalizeArtistKey("孙燕姿")).toBe("孙燕姿");
    });
});

describe("buildMediaNameKey", () => {
    it("同一作品的不同歌手写法应产生同一键", () => {
        const keys = [
            buildMediaNameKey("珊瑚海", "周杰伦&Lara梁心颐"),
            buildMediaNameKey("珊瑚海", "周杰伦, Lara梁心颐"),
            buildMediaNameKey("珊瑚海", "周杰伦、Lara梁心颐"),
        ];
        expect(keys[0]).toBe(keys[1]);
        expect(keys[1]).toBe(keys[2]);
    });

    it("**不同版本不能是同一键**（Live / 原版）", () => {
        const live = buildMediaNameKey("海底 (Live)", "凤凰传奇");
        const studio = buildMediaNameKey("海底", "凤凰传奇");
        expect(live).not.toBe(studio);
    });

    it("歌名不同 → 键不同", () => {
        expect(buildMediaNameKey("晴天", "周杰伦")).not.toBe(
            buildMediaNameKey("雨天", "周杰伦"),
        );
    });

    it("歌名为空时返回空串（不能返回 `|`，否则缺失条目会共享状态）", () => {
        expect(buildMediaNameKey("", "周杰伦")).toBe("");
        expect(buildMediaNameKey(null, null)).toBe("");
        expect(buildMediaNameKey("   ", "周杰伦")).toBe("");
    });

    it("歌手缺失仍返回有效键（只有歌名）", () => {
        expect(buildMediaNameKey("晴天", null)).toBe("晴天|");
    });

    it("已知取舍：本地 ID3 只写第一位歌手时，与完整写法不同键", () => {
        // 桌面版注释提到的场景。按「人」集合排序只能解决**分隔符/顺序**差异，
        // 解决不了**人数**差异，因此仍匹配不上。
        expect(buildMediaNameKey("珊瑚海", "周杰伦")).not.toBe(
            buildMediaNameKey("珊瑚海", "周杰伦&Lara梁心颐"),
        );
    });
});

describe("isUnknownArtist", () => {
    it("识别缺失 / 未知歌手", () => {
        expect(isUnknownArtist(null)).toBe(true);
        expect(isUnknownArtist("")).toBe(true);
        expect(isUnknownArtist("未知歌手")).toBe(true);
        expect(isUnknownArtist("Unknown")).toBe(true);
    });

    it("真实歌手不算未知", () => {
        expect(isUnknownArtist("周杰伦")).toBe(false);
    });
});
