/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
};

import { toPlainFilePath, toPlayableFileUrl } from "../fileUrl";

/**
 * 第 7 批 · 问题 2 的回归测试：
 * 「下载好的歌点了没反应」的根因是 `file://` 前缀路径没被百分号编码。
 *
 * 这套用例的**关键守护点**是第三条：同一个路径无论带不带 `file://`、
 * 编没编过码，结果都必须一致（幂等）—— 旧实现正是在这里全线落空。
 */
describe("toPlayableFileUrl", () => {
    it("裸绝对路径应补上 file:// 并编码", () => {
        expect(toPlayableFileUrl("/storage/emulated/0/x/李白 - 李荣浩.mp3")).toBe(
            "file:///storage/emulated/0/x/%E6%9D%8E%E7%99%BD%20-%20%E6%9D%8E%E8%8D%A3%E6%B5%A9.mp3",
        );
    });

    it("已带 file:// 的未编码路径也必须被编码（旧实现的漏洞）", () => {
        expect(
            toPlayableFileUrl("file:///storage/emulated/0/x/李白 - 李荣浩.mp3"),
        ).toBe(
            "file:///storage/emulated/0/x/%E6%9D%8E%E7%99%BD%20-%20%E6%9D%8E%E8%8D%A3%E6%B5%A9.mp3",
        );
    });

    it("三种输入形态结果一致（幂等，不得二次编码）", () => {
        const expected =
            "file:///storage/emulated/0/x/%E6%9D%8E%E7%99%BD.mp3";
        expect(toPlayableFileUrl("/storage/emulated/0/x/李白.mp3")).toBe(expected);
        expect(toPlayableFileUrl("file:///storage/emulated/0/x/李白.mp3")).toBe(
            expected,
        );
        expect(
            toPlayableFileUrl(
                "file:///storage/emulated/0/x/%E6%9D%8E%E7%99%BD.mp3",
            ),
        ).toBe(expected);
        // 再喂一遍也不能变成 %25E6…
        expect(toPlayableFileUrl(expected)).toBe(expected);
    });

    it("纯 ASCII 路径不受影响", () => {
        expect(toPlayableFileUrl("file:///storage/emulated/0/x/test-local.wav")).toBe(
            "file:///storage/emulated/0/x/test-local.wav",
        );
    });

    it("`#` 与 `?` 在文件名里必须转义（它们在 URL 中是分隔符）", () => {
        expect(toPlayableFileUrl("file:///a/b#1 - c?2.mp3")).toBe(
            "file:///a/b%231%20-%20c%3F2.mp3",
        );
    });

    it("文件名含裸 `%` 时不抛错，且被正确编码", () => {
        expect(toPlayableFileUrl("file:///a/100% Love.mp3")).toBe(
            "file:///a/100%25%20Love.mp3",
        );
    });

    it("非本地协议原样返回", () => {
        expect(toPlayableFileUrl("http://a.com/x.mp3")).toBe(
            "http://a.com/x.mp3",
        );
        expect(toPlayableFileUrl("https://a.com/李白.mp3")).toBe(
            "https://a.com/李白.mp3",
        );
        expect(toPlayableFileUrl("content://media/external/audio/1")).toBe(
            "content://media/external/audio/1",
        );
    });

    it("空值安全", () => {
        expect(toPlayableFileUrl("")).toBe("");
    });
});

describe("toPlainFilePath", () => {
    it("去掉 file:// 前缀并解码", () => {
        expect(toPlainFilePath("file:///storage/x/%E6%9D%8E%E7%99%BD.mp3")).toBe(
            "/storage/x/李白.mp3",
        );
    });

    it("带 file:// 的未编码路径原样取出", () => {
        expect(toPlainFilePath("file:///storage/x/李白.mp3")).toBe(
            "/storage/x/李白.mp3",
        );
    });

    it("裸路径保持不变", () => {
        expect(toPlainFilePath("/storage/x/a.mp3")).toBe("/storage/x/a.mp3");
    });

    it("含裸 `%` 时不抛错", () => {
        expect(toPlainFilePath("/storage/x/100%.mp3")).toBe("/storage/x/100%.mp3");
    });
});
