/**
 * 音频容器嗅探单测。
 *
 * 用各容器的真实文件头字节作为样例，重点覆盖「扩展名说谎」的常见组合：
 * 服务端把 m4a 标成 .mp3 是重灾区。
 *
 * 项目未安装 `@types/jest`，就地声明用到的全局。
 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toBe: (expected: any) => void;
};

import {
    detectContainer,
    guessContainerByExt,
    isExtMismatch,
    type AudioContainer,
} from "../audioContainer";

/** 便捷：把 ASCII 串 + 十六进制字节拼成待嗅探的头部 */
function bytes(...parts: Array<string | number[]>): number[] {
    const out: number[] = [];
    parts.forEach(part => {
        if (typeof part === "string") {
            for (let i = 0; i < part.length; i++) {
                out.push(part.charCodeAt(i));
            }
        } else {
            out.push(...part);
        }
    });
    while (out.length < 16) {
        out.push(0);
    }
    return out;
}

describe("detectContainer", () => {
    it("ID3v2 标签头 → mp3", () => {
        expect(detectContainer(bytes("ID3", [0x03, 0x00, 0x00]))).toBe("mp3");
    });

    it("MPEG 帧同步 → mp3", () => {
        expect(detectContainer(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
        expect(detectContainer(bytes([0xff, 0xf3, 0x00, 0x00]))).toBe("mp3");
    });

    it("fLaC → flac", () => {
        expect(detectContainer(bytes("fLaC", [0x00, 0x00, 0x00, 0x22]))).toBe(
            "flac",
        );
    });

    it("OggS → ogg", () => {
        expect(detectContainer(bytes("OggS", [0x00, 0x02]))).toBe("ogg");
    });

    it("RIFF....WAVE → wav", () => {
        expect(
            detectContainer(bytes("RIFF", [0x24, 0x08, 0x00, 0x00], "WAVE")),
        ).toBe("wav");
    });

    it("....ftyp → m4a（ISO BMFF）", () => {
        expect(
            detectContainer(bytes([0x00, 0x00, 0x00, 0x20], "ftypM4A ")),
        ).toBe("m4a");
    });

    it("ASF 头 → wma", () => {
        expect(
            detectContainer(bytes([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66])),
        ).toBe("wma");
    });

    it("ADTS 同步 → aac", () => {
        expect(detectContainer(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe("aac");
    });

    it("MAC  → ape", () => {
        expect(detectContainer(bytes("MAC ", [0x96, 0x0f]))).toBe("ape");
    });

    it("无法识别的字节 → unknown", () => {
        expect(detectContainer(bytes([0x00, 0x01, 0x02, 0x03]))).toBe(
            "unknown",
        );
    });

    it("字节不足/空 → unknown（不能抛异常）", () => {
        expect(detectContainer([])).toBe("unknown");
        expect(detectContainer([0x49])).toBe("unknown");
    });
});

describe("guessContainerByExt", () => {
    it("常见扩展名", () => {
        const cases: Array<[string, AudioContainer]> = [
            ["mp3", "mp3"],
            [".m4a", "m4a"],
            ["flac", "flac"],
            ["opus", "ogg"],
            ["wav", "wav"],
            ["ape", "ape"],
            ["wma", "wma"],
            ["aac", "aac"],
        ];
        cases.forEach(([ext, expected]) => {
            expect(guessContainerByExt(ext)).toBe(expected);
        });
    });

    it("未知扩展名 → unknown", () => {
        expect(guessContainerByExt("txt")).toBe("unknown");
        expect(guessContainerByExt("")).toBe("unknown");
    });
});

describe("isExtMismatch", () => {
    it("**检出最常见的说谎：扩展名 .mp3 实际是 m4a**", () => {
        expect(isExtMismatch("mp3", "m4a")).toBe(true);
    });

    it("扩展名 .mp3 实际是 flac 也算冲突", () => {
        expect(isExtMismatch("mp3", "flac")).toBe(true);
    });

    it("一致时不冲突", () => {
        expect(isExtMismatch("mp3", "mp3")).toBe(false);
        expect(isExtMismatch("flac", "flac")).toBe(false);
    });

    it("同族放行（mp4/opus 等）", () => {
        expect(isExtMismatch("mp4", "m4a")).toBe(false);
        expect(isExtMismatch("opus", "ogg")).toBe(false);
        expect(isExtMismatch("aac", "m4a")).toBe(false);
    });

    it("嗅探失败或扩展名未知时不判冲突（避免误报）", () => {
        expect(isExtMismatch("mp3", "unknown")).toBe(false);
        expect(isExtMismatch("bin", "mp3")).toBe(false);
    });
});
