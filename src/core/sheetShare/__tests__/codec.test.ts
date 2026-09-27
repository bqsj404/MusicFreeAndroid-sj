/** 便捷：项目未安装 `@types/jest`（离线环境不新增依赖），就地声明用到的全局 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
    toBeGreaterThan: (expected: number) => void;
};

import {
    FRAGMENT_PREFIX,
    buildFragment,
    buildImportText,
    buildPayload,
    crc32,
    decodeFragments,
    decodeSheetFromText,
    encodeSheet,
    escapeField,
    extractFragments,
    fromUtf8Bytes,
    parseFragment,
    parsePayload,
    splitPayload,
    toUtf8Bytes,
    unescapeField,
    utf8Length,
} from "../codec";

/**
 * D5 的 MFS2 编解码。
 *
 * 这块是"分享出去别人解不出来 / 解出来是乱码"的根源，而且
 * 一旦格式细节写错，往往只在**跨设备**时才暴露。所以逐项锁住。
 */
describe("UTF-8 编解码（Hermes 没有 TextEncoder，手写实现）", () => {
    it("ASCII 往返", () => {
        expect(fromUtf8Bytes(toUtf8Bytes("hello"))).toBe("hello");
    });

    it("中文往返", () => {
        expect(fromUtf8Bytes(toUtf8Bytes("海底 - 凤凰传奇"))).toBe(
            "海底 - 凤凰传奇",
        );
    });

    it("emoji（代理对）往返", () => {
        expect(fromUtf8Bytes(toUtf8Bytes("李白🎵"))).toBe("李白🎵");
    });

    it("字节数按 UTF-8 算，而不是字符数", () => {
        // 3 个汉字 = 9 字节
        expect(utf8Length("海底啊")).toBe(9);
        expect(utf8Length("abc")).toBe(3);
        // emoji 是 4 字节
        expect(utf8Length("🎵")).toBe(4);
    });
});

describe("crc32", () => {
    it("与标准测试向量一致", () => {
        // CRC-32/ISO-HDLC 的标准校验值
        expect(crc32("123456789")).toBe("cbf43926");
    });

    it("同样输入结果稳定", () => {
        expect(crc32("海底")).toBe(crc32("海底"));
    });

    it("不同输入结果不同", () => {
        expect(crc32("李白") === crc32("晴天")).toBe(false);
    });
});

describe("字段转义", () => {
    it("控制字符会被转义，反转义可还原", () => {
        const raw = "歌名\u001f带分隔符\u001e还有\u001d";
        const escaped = escapeField(raw);
        expect(escaped.includes("\u001f")).toBe(false);
        expect(unescapeField(escaped)).toBe(raw);
    });

    it("反斜杠本身也会被转义", () => {
        const raw = "C:\\Music\\a.mp3";
        expect(unescapeField(escapeField(raw))).toBe(raw);
    });

    it("空值安全", () => {
        expect(escapeField(undefined)).toBe("");
        expect(unescapeField(null)).toBe("");
    });
});

describe("payload 往返", () => {
    const sheet = {
        title: "我的歌单",
        platform: "本地",
        id: "sheet-1",
        musicList: [
            {
                platform: "云盘",
                id: "a1",
                title: "海底 (Live)",
                artist: "凤凰传奇",
            },
            {
                platform: "本地",
                id: "b2",
                title: "李白: 现场版",
                artist: "李荣浩",
            },
        ],
    };

    it("歌名里含冒号也能正确还原（不能靠 split(':') 定位）", () => {
        const parsed = parsePayload(buildPayload(sheet));
        expect(parsed?.musicList[1].title).toBe("李白: 现场版");
    });

    it("完整还原歌单信息与曲目", () => {
        const parsed = parsePayload(buildPayload(sheet));
        expect(parsed?.title).toBe("我的歌单");
        expect(parsed?.musicList.length).toBe(2);
        expect(parsed?.musicList[0].artist).toBe("凤凰传奇");
    });
});

describe("splitPayload（按字节切分且不劈开汉字）", () => {
    it("短内容不切分", () => {
        expect(splitPayload("短内容", 100).length).toBe(1);
    });

    it("切分后每片都在字节上限内", () => {
        const payload = "海底".repeat(200);
        const parts = splitPayload(payload, 60);
        parts.forEach(part => {
            expect(utf8Length(part) <= 60).toBe(true);
        });
    });

    it("拼回来与原文完全一致（没有半个汉字）", () => {
        const payload = "海底 - 凤凰传奇".repeat(50);
        const parts = splitPayload(payload, 100);
        expect(parts.join("")).toBe(payload);
    });
});

describe("片段编解码", () => {
    const sheet = {
        title: "测试歌单",
        platform: "本地",
        id: "s1",
        musicList: Array.from({ length: 30 }, (_, i) => ({
            platform: "云盘",
            id: `id-${i}`,
            title: `歌曲${i}`,
            artist: "某歌手",
        })),
    };

    it("小歌单只产生一个片段", () => {
        const fragments = encodeSheet({
            ...sheet,
            musicList: sheet.musicList.slice(0, 2),
        });
        expect(fragments.length).toBe(1);
        expect(fragments[0].startsWith(FRAGMENT_PREFIX)).toBe(true);
    });

    it("歌词多时会切成多片，且能完整拼回", () => {
        const fragments = encodeSheet(sheet, 300);
        expect(fragments.length > 1).toBe(true);
        const decoded = decodeFragments(extractFragments(buildImportText(fragments)));
        expect(decoded?.musicList.length).toBe(30);
        expect(decoded?.title).toBe("测试歌单");
    });

    it("片段里的编号与总数正确", () => {
        const fragments = encodeSheet(sheet, 300);
        const first = parseFragment(fragments[0]);
        expect(first?.index).toBe(1);
        expect(first?.total).toBe(fragments.length);
    });

    it("非 MFS2 文本解析为 null", () => {
        expect(parseFragment("MFS1:abcdef")).toBe(null);
        expect(parseFragment("随便一段话")).toBe(null);
    });
});

describe("decodeFragments 的分组与校验", () => {
    const sheetA = {
        title: "A",
        musicList: [{ platform: "p", id: "1", title: "歌A" }],
    };
    const sheetB = {
        title: "B",
        musicList: [{ platform: "p", id: "2", title: "歌B" }],
    };

    it("两份歌单的片段混在一起时，各自成组", () => {
        const fragA = encodeSheet(sheetA, 50);
        const fragB = encodeSheet(sheetB, 50);
        const mixed = extractFragments(
            buildImportText([...fragA, ...fragB]),
        );
        const decoded = decodeFragments(mixed);
        // 两组的 CRC 不同，任取一组都能解出来；关键是**不能被拼混**
        expect(decoded?.title === "A" || decoded?.title === "B").toBe(true);
    });

    it("片段缺失时拒绝拼装（不返回半份歌单）", () => {
        const fragments = encodeSheet(
            {
                title: "长歌单",
                musicList: Array.from({ length: 30 }, (_, i) => ({
                    platform: "p",
                    id: `${i}`,
                    title: `歌曲名字比较长的第${i}首`,
                })),
            },
            200,
        );
        expect(fragments.length > 1).toBe(true);
        const parsed = extractFragments(buildImportText(fragments));
        // 去掉最后一片，模拟丢片
        const decoded = decodeFragments(parsed.slice(0, parsed.length - 1));
        expect(decoded).toBe(null);
    });

    it("片段被篡改（CRC 对不上）时拒绝", () => {
        const fragments = encodeSheet(sheetA, 50);
        const tampered = fragments[0].replace(/歌A/, "歌X");
        const decoded = decodeFragments(extractFragments(tampered));
        expect(decoded).toBe(null);
    });

    it("空输入返回 null", () => {
        expect(decodeFragments([])).toBe(null);
        expect(decodeSheetFromText("")).toBe(null);
        expect(decodeSheetFromText(null)).toBe(null);
    });
});

describe("buildFragment 的头部字段", () => {
    it("头部 CRC 与字节数描述的是**全量** payload", () => {
        const payload = "海底";
        const text = buildFragment(
            payload,
            1,
            1,
            crc32(payload),
            utf8Length(payload),
        );
        const parsed = parseFragment(text);
        expect(parsed?.byteLength).toBe(utf8Length(payload));
        expect(parsed?.crc).toBe(crc32(payload));
    });

    it("同一歌单的多个片段共享同样的 CRC（读取端据此分组）", () => {
        const fragments = encodeSheet(
            {
                title: "分组测试",
                musicList: Array.from({ length: 20 }, (_, i) => ({
                    platform: "p",
                    id: `${i}`,
                    title: `比较长的歌曲名字${i}`,
                })),
            },
            200,
        );
        expect(fragments.length > 1).toBe(true);
        const crcs = fragments.map(f => parseFragment(f)?.crc);
        expect(crcs.every(c => c === crcs[0])).toBe(true);
    });
});

