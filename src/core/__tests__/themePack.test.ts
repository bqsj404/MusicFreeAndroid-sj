/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
};

import {
    THEME_PACK_VERSION,
    buildThemePack,
    isValidColor,
    parseThemePack,
    themePackFileName,
} from "../themePack";

/**
 * D6 主题包解析与校验。
 *
 * 主题是**全局生效**的：一个错色值会让整个界面不可读，而用户很难判断
 * 是"主题就长这样"还是"装坏了"。所以这里坚持"宁可拒绝，也不尽力而为"，
 * 并逐条锁住拒绝的理由。
 */
describe("isValidColor", () => {
    it("接受十六进制各长度写法", () => {
        expect(isValidColor("#fff")).toBe(true);
        expect(isValidColor("#ffff")).toBe(true);
        expect(isValidColor("#4A90D9")).toBe(true);
        expect(isValidColor("#4A90D9FF")).toBe(true);
    });

    it("拒绝非十六进制写法（RN 上支持面不一致）", () => {
        expect(isValidColor("rgb(1,2,3)")).toBe(false);
        expect(isValidColor("red")).toBe(false);
        expect(isValidColor("var(--color-bg)")).toBe(false);
        expect(isValidColor("rgba(0,0,0,0.5)")).toBe(false);
    });

    it("拒绝非字符串与空值", () => {
        expect(isValidColor(123)).toBe(false);
        expect(isValidColor(null)).toBe(false);
        expect(isValidColor("#12")).toBe(false);
    });
});

describe("parseThemePack", () => {
    it("正常主题包可解析", () => {
        const result = parseThemePack(
            JSON.stringify({
                name: "深夜蓝",
                version: 1,
                author: "某人",
                colors: { primary: "#4A90D9", text: "#E0E0E0" },
            }),
        );
        expect(result.pack?.name).toBe("深夜蓝");
        expect(result.pack?.colors.primary).toBe("#4A90D9");
        expect(result.pack?.author).toBe("某人");
    });

    it("version 缺省时按当前版本处理", () => {
        const result = parseThemePack(
            JSON.stringify({ name: "x", colors: { text: "#fff" } }),
        );
        expect(result.pack?.version).toBe(THEME_PACK_VERSION);
    });

    it("空文本 / 非法 JSON 都被拒绝", () => {
        expect(parseThemePack("")?.error).toBe("empty");
        expect(parseThemePack("   ")?.error).toBe("empty");
        expect(parseThemePack("{不是json")?.error).toBe("invalidJson");
        expect(parseThemePack("123")?.error).toBe("invalidJson");
    });

    it("缺名字被拒绝", () => {
        expect(
            parseThemePack(JSON.stringify({ colors: { text: "#fff" } }))
                ?.error,
        ).toBe("missingName");
    });

    it("缺 colors 被拒绝", () => {
        expect(parseThemePack(JSON.stringify({ name: "x" }))?.error).toBe(
            "missingColors",
        );
    });

    it("非法色值被拒绝，并指出是哪个键", () => {
        const result = parseThemePack(
            JSON.stringify({
                name: "x",
                colors: { text: "#fff", primary: "蓝色" },
            }),
        );
        expect(result.pack).toBe(null);
        expect(result.error).toBe("invalidColor:primary");
    });

    it("未知键被忽略并单独汇报（不算失败）", () => {
        const result = parseThemePack(
            JSON.stringify({
                name: "x",
                colors: { text: "#fff", 完全不认识的键: "#000" },
            }),
        );
        expect(result.pack?.colors.text).toBe("#fff");
        expect(result.ignoredKeys?.length).toBe(1);
    });

    it("全是未知键时视为没有可用颜色", () => {
        const result = parseThemePack(
            JSON.stringify({ name: "x", colors: { 未知: "#fff" } }),
        );
        expect(result.pack).toBe(null);
        expect(result.error).toBe("noUsableColors");
    });

    it("桌面版主题包（含 css 字段）被明确拒绝，而不是装成空主题", () => {
        const result = parseThemePack(
            JSON.stringify({
                name: "桌面主题",
                css: ":root{--color-bg-base:#121212}",
            }),
        );
        expect(result.pack).toBe(null);
        expect(result.error).toBe("desktopThemePack");
    });

    it("版本过新被拒绝（避免读不懂的字段被静默忽略）", () => {
        const result = parseThemePack(
            JSON.stringify({
                name: "x",
                version: THEME_PACK_VERSION + 1,
                colors: { text: "#fff" },
            }),
        );
        expect(result.error).toBe("versionTooNew");
    });
});

describe("buildThemePack", () => {
    it("只挑出可配置且合法的颜色键", () => {
        const text = buildThemePack("我的主题", {
            primary: "#4A90D9",
            text: "#E0E0E0",
            无关字段: "#000",
            非法色: "红色",
        });
        const parsed = JSON.parse(text);
        expect(parsed.name).toBe("我的主题");
        expect(parsed.colors.primary).toBe("#4A90D9");
        expect(parsed.colors.无关字段).toBe(undefined);
        expect(parsed.colors.非法色).toBe(undefined);
    });

    it("导出的内容能被自己解析回来（往返一致）", () => {
        const colors = {
            primary: "#4A90D9",
            text: "#E0E0E0",
            card: "#1E1E1E",
        };
        const text = buildThemePack("往返", colors);
        const result = parseThemePack(text);
        expect(result.pack?.colors.primary).toBe(colors.primary);
        expect(result.pack?.colors.card).toBe(colors.card);
    });

    it("空名字有兜底", () => {
        const parsed = JSON.parse(buildThemePack("", { text: "#fff" }));
        expect(parsed.name.length > 0).toBe(true);
    });
});

describe("themePackFileName", () => {
    it("带正确的扩展名", () => {
        expect(themePackFileName("深夜蓝")).toBe("深夜蓝.mftheme");
    });

    it("去掉文件名里的非法字符", () => {
        const name = themePackFileName('a/b\\c:d*e?f"g<h>i|j');
        expect(name.includes("/")).toBe(false);
        expect(name.includes("\\")).toBe(false);
        expect(name.endsWith(".mftheme")).toBe(true);
    });

    it("空名有兜底", () => {
        expect(themePackFileName("")).toBe("theme.mftheme");
    });
});
