/**
 * 云盘对账纯函数的单测。
 *
 * 这块逻辑决定「哪些云端文件会被移入回收站」，**误判会删掉用户的云端备份**，
 * 所以五条豁免必须逐条锁住。本文件只依赖 `syncPlan` 与 `keys`（均零依赖），
 * 不需要 mock MMKV。
 *
 * 说明：项目未安装 `@types/jest`（离线环境不新增依赖），
 * 因此这里就地声明用到的 jest 全局，保证 `tsc --noEmit` 干净。
 */
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: any) => {
    toEqual: (expected: any) => void;
    toBe: (expected: any) => void;
};
import { selectOrphanUploads, cloudDisplayName } from "../syncPlan";
import { uploadKey } from "../keys";
import type { ICloudUploadRecord } from "../uploadRecords";

function makeRecord(
    patch: Partial<ICloudUploadRecord> = {},
): ICloudUploadRecord {
    return {
        platform: "云盘",
        musicId: "id-1",
        title: "晴天",
        artist: "周杰伦",
        remotePath: "/MusicFree/music/晴天 - 周杰伦.mp3",
        localPath: "/sdcard/Music/晴天 - 周杰伦.mp3",
        source: "auto",
        size: 100,
        uploadedAt: 1,
        workKey: "晴天|周杰伦",
        ...patch,
    };
}

describe("selectOrphanUploads", () => {
    it("本地文件确实不存在、且各项管理集合都没命中 → 判为孤儿", () => {
        const rows = [makeRecord()];
        const orphans = selectOrphanUploads(
            rows,
            new Set(),
            new Set(),
            new Set(),
        );
        expect(orphans).toEqual(["/MusicFree/music/晴天 - 周杰伦.mp3"]);
    });

    it("豁免①：该 (platform, musicId) 仍被本地管理 → 保留", () => {
        const rows = [makeRecord()];
        const managed = new Set([uploadKey("云盘", "id-1")]);
        expect(selectOrphanUploads(rows, managed, new Set())).toEqual([]);
    });

    it("豁免①'：换插件后 id 变了，但 workKey 仍在 → 保留", () => {
        const rows = [makeRecord({ musicId: "new-id", platform: "酷我" })];
        const managedWorkKeys = new Set(["晴天|周杰伦"]);
        // managedKeys 里没有这条，只有 workKey 命中
        expect(
            selectOrphanUploads(rows, new Set(), new Set(), managedWorkKeys),
        ).toEqual([]);
    });

    it("豁免②：从音源直传（无 localPath）→ 永远不动", () => {
        const rows = [makeRecord({ localPath: null })];
        expect(selectOrphanUploads(rows, new Set(), new Set())).toEqual([]);
    });

    it("豁免③：清单记的本地文件仍然存在 → 保留", () => {
        const rows = [makeRecord()];
        const existing = new Set(["/sdcard/Music/晴天 - 周杰伦.mp3"]);
        expect(selectOrphanUploads(rows, new Set(), existing)).toEqual([]);
    });

    it("豁免④：同一 remotePath 出现多条记录 → 只输出一次", () => {
        const rows = [
            makeRecord({ musicId: "a" }),
            makeRecord({ musicId: "b" }),
        ];
        const orphans = selectOrphanUploads(
            rows,
            new Set(),
            new Set(),
            new Set(),
        );
        expect(orphans).toEqual(["/MusicFree/music/晴天 - 周杰伦.mp3"]);
    });

    it("缺 remotePath 的记录被忽略", () => {
        const rows = [makeRecord({ remotePath: "" })];
        expect(selectOrphanUploads(rows, new Set(), new Set())).toEqual([]);
    });

    it("空清单 / null 输入不报错", () => {
        expect(selectOrphanUploads([], new Set(), new Set())).toEqual([]);
        expect(selectOrphanUploads(null, new Set(), new Set())).toEqual([]);
    });

    it("多条记录混合场景：只挑出真正该清的", () => {
        const rows = [
            makeRecord({ musicId: "gone", remotePath: "/m/gone.mp3" }),
            makeRecord({
                musicId: "gone2",
                remotePath: "/m/gone2.mp3",
                localPath: null, // 直传 → 保留
            }),
            makeRecord({
                musicId: "keep",
                remotePath: "/m/keep.mp3",
                workKey: "保留|歌手",
            }),
        ];
        const orphans = selectOrphanUploads(
            rows,
            new Set(),
            new Set(),
            new Set(["保留|歌手"]),
        );
        expect(orphans).toEqual(["/m/gone.mp3"]);
    });
});

describe("cloudDisplayName", () => {
    it("取去扩展名的 basename", () => {
        expect(cloudDisplayName("/MusicFree/music/晴天 - 周杰伦.mp3")).toBe(
            "晴天 - 周杰伦",
        );
    });

    it("绝不回退显示歌曲 ID（无扩展名时原样返回 basename）", () => {
        expect(cloudDisplayName("/a/b/c")).toBe("c");
    });

    it("空输入返回空串", () => {
        expect(cloudDisplayName("")).toBe("");
    });
});
