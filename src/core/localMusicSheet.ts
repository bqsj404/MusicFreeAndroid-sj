import {
    StorageKeys,
    internalSerializeKey,
    localPluginPlatform,
    supportLocalMediaType,
} from "@/constants/commonConst";
import mp3Util, { IBasicMeta } from "@/native/mp3Util";
import { addFileScheme, getFileName } from "@/utils/fileUtils.ts";
import { toPlainFilePath } from "@/utils/fileUrl";
import {
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { registerExistingFile } from "./mediaFileRegistry";
import StateMapper from "@/utils/stateMapper";
import { getStorage, setStorage } from "@/utils/storage";
import {
    addScanFolders,
    beginScan,
    failScan,
    filterChangedFiles,
    finishScan,
    getMinDurationSec,
    reportScanProgress,
} from "./localMusicScan";
import CryptoJs from "crypto-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { ReadDirItem, exists, readDir, unlink } from "react-native-fs";

let localSheet: IMusic.IMusicItem[] = [];
const localSheetStateMapper = new StateMapper(() => localSheet);

export async function setup() {
    const sheet = await getStorage(StorageKeys.LocalMusicSheet);
    if (sheet) {
        let validSheet: IMusic.IMusicItem[] = [];
        // 第 7 批 · 问题 1：历史数据里同一份文件可能有两条记录
        // （下载入库一条、后来扫描又入一条，见 [isSameLocalFile]）。
        // 启动时顺手合并一次，否则用户会一直看到重复的「云盘标识」条目。
        // 保留「有在线身份」的那条 —— 它能回连音源、能换源、能重新下载，
        // 而扫描解析出来的那条 id 是被转义过的，回连必然失败。
        const pathIndex = new Map<string, number>();
        for (let musicItem of sheet) {
            const localPath = getLocalPath(musicItem);
            if (!localPath || !(await exists(localPath))) {
                continue;
            }
            const key = toPlainFilePath(localPath);
            const existed = pathIndex.get(key);
            if (existed === undefined) {
                pathIndex.set(key, validSheet.length);
                validSheet.push(musicItem);
                continue;
            }
            // 已有一条同路径记录：谁带在线身份就留谁
            const prev = validSheet[existed];
            const prevHasOnlineIdentity =
                prev.platform && prev.platform !== localPluginPlatform;
            const curHasOnlineIdentity =
                musicItem.platform && musicItem.platform !== localPluginPlatform;
            if (!prevHasOnlineIdentity && curHasOnlineIdentity) {
                validSheet[existed] = musicItem;
            }
        }
        if (validSheet.length !== sheet.length) {
            await setStorage(StorageKeys.LocalMusicSheet, validSheet);
        }
        localSheet = validSheet;
    } else {
        await setStorage(StorageKeys.LocalMusicSheet, []);
    }
    localSheetStateMapper.notify();
}

/**
 * 是否为「同一份本地文件」。
 *
 * 第 7 批 · 问题 1 的根因修复。
 *
 * 本地库原先只按 `platform + id` 去重（[isSameMediaItem]），而同一个文件
 * 会有**两条入库路径**、拿到的身份却不同：
 *
 *  - **下载入库**（`downloader`）：直接用条目原本的 id，云盘歌曲的 id
 *    是远端路径（`/MusicFree/music/x.mp3`）；
 *  - **扫描入库**（`importLocal` → `parseFilename`）：从文件名
 *    `平台@id@歌名@歌手` 里解析，而 `escapeCharacter` 会把 id 里的
 *    `/` 换成 `_`，解析回来自然对不上。
 *
 * 于是同一首歌在本地列表里出现两次，其中一条还顶着「云盘」这类
 * 在线平台标签 —— 用户看到的就是「本地音乐里有个云盘标识的音乐」。
 *
 * 文件路径是比 id 更强的身份：同一个路径就是同一份文件。
 */
function isSameLocalFile(
    a: ICommon.IMediaBase,
    b: ICommon.IMediaBase,
): boolean {
    if (isSameMediaItem(a, b)) {
        return true;
    }
    const pathA = getLocalPath(a);
    const pathB = getLocalPath(b);
    if (!pathA || !pathB) {
        return false;
    }
    return toPlainFilePath(pathA) === toPlainFilePath(pathB);
}

export async function addMusic(
    musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    if (!Array.isArray(musicItem)) {
        musicItem = [musicItem];
    }
    let newSheet = [...localSheet];
    musicItem.forEach(mi => {
        if (newSheet.findIndex(_ => isSameLocalFile(mi, _)) === -1) {
            newSheet.push(mi);
        }
    });
    await setStorage(StorageKeys.LocalMusicSheet, newSheet);
    localSheet = newSheet;
    localSheetStateMapper.notify();
}

function addMusicDraft(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) {
    if (!Array.isArray(musicItem)) {
        musicItem = [musicItem];
    }
    let newSheet = [...localSheet];
    musicItem.forEach(mi => {
        if (newSheet.findIndex(_ => isSameLocalFile(mi, _)) === -1) {
            newSheet.push(mi);
        }
    });
    localSheet = newSheet;
    localSheetStateMapper.notify();
}

async function saveLocalSheet() {
    await setStorage(StorageKeys.LocalMusicSheet, localSheet);
}

export async function removeMusic(
    musicItem: IMusic.IMusicItem,
    deleteOriginalFile = false,
) {
    const idx = localSheet.findIndex(_ => isSameLocalFile(_, musicItem));
    let newSheet = [...localSheet];
    if (idx !== -1) {
        const localMusicItem = localSheet[idx];
        newSheet.splice(idx, 1);
        const localPath =
            getLocalPath(musicItem) ?? getLocalPath(localMusicItem);
        if (deleteOriginalFile && localPath) {
            try {
                await unlink(toPlainFilePath(localPath));
            } catch (e: any) {
                if (e.message !== "File does not exist") {
                    throw e;
                }
            }
        }
    }
    localSheet = newSheet;
    localSheetStateMapper.notify();
    saveLocalSheet();
}

function parseFilename(fn: string): Partial<IMusic.IMusicItem> | null {
    const data = fn.slice(0, fn.lastIndexOf(".")).split("@");
    const [platform, id, title, artist] = data;
    if (!platform || !id) {
        return null;
    }
    return {
        id,
        platform: platform,
        title: title ?? "",
        artist: artist ?? "",
    };
}

/**
 * 从「歌名 - 歌手」这类**常见音乐文件名**里解析歌名与歌手。
 *
 * 为什么需要：`parseFilename` 只认 MusicFree 自己的
 * `平台@id@歌名@歌手` 命名约定，普通文件名会落空；而元数据标签又可能缺失
 * （冷门歌曲、无损转码、录音）。此时条目会退化成
 * 「整串文件名当标题 + 未知歌手」，导致：
 *   - 列表里显示成 `李白 - 李荣浩.wav` 而不是 `李白 - 李荣浩`
 *   - **作品键与在线歌曲对不上，「本地优先取源」永远命中不了**
 *
 * 分隔符口径与云盘同名匹配保持一致（按**最后一个** ` - ` 切分），
 * 避免歌名本身含 ` - ` 时被切错。
 *
 * @returns 解析成功返回 `{ title, artist }`；不适用时返回 null
 */
function parseCommonFilename(
    fn: string,
): { title: string; artist: string } | null {
    const base = fn.replace(/\.[^./\\]+$/, "").trim();
    const idx = base.lastIndexOf(" - ");
    if (idx <= 0) {
        return null;
    }
    const title = base.slice(0, idx).trim();
    const artist = base.slice(idx + 3).trim();
    if (!title || !artist) {
        return null;
    }
    return { title, artist };
}

function localMediaFilter(filename: string) {
    return supportLocalMediaType.some(ext => filename.toLowerCase().endsWith(ext));
}

let importToken: string | null = null;
// 获取本地的文件列表
async function getMusicStats(folderPaths: string[]) {
    const _importToken = nanoid();
    importToken = _importToken;
    const musicList: string[] = [];
    let peek: string | undefined;
    let dirFiles: ReadDirItem[] = [];
    while (folderPaths.length !== 0) {
        if (importToken !== _importToken) {
            throw new Error("Import Broken");
        }
        peek = folderPaths.shift() as string;
        try {
            dirFiles = await readDir(peek);
        } catch {
            dirFiles = [];
        }

        dirFiles.forEach(item => {
            if (item.isDirectory() && !folderPaths.includes(item.path)) {
                folderPaths.push(item.path);
            } else if (localMediaFilter(item.path)) {
                musicList.push(item.path);
            }
        });
    }

    return { musicList, token: _importToken };
}

function cancelImportLocal() {
    importToken = null;
}

// 导入本地音乐
const groupNum = 25;

/**
 * 按文件夹扫描并入库。
 *
 * @param folderPaths 绝对路径（不带 file://）
 * @param options.incremental 只解析「大小/mtime 变化过」的文件（默认 true）
 * @param options.rememberFolders 是否把这些目录记入白名单（默认 true）
 */
async function importLocal(
    _folderPaths: string[],
    options: { incremental?: boolean; rememberFolders?: boolean } = {},
) {
    const { incremental = true, rememberFolders = true } = options;
    const folderPaths = [..._folderPaths.map(it => addFileScheme(it))];

    beginScan();
    if (rememberFolders) {
        addScanFolders(_folderPaths);
    }

    let changedPaths: string[] | null = null;
    let skippedCount = 0;
    try {
        const { musicList, token } = await getMusicStats(folderPaths);
        if (token !== importToken) {
            throw new Error("Import Broken");
        }

        if (musicList.length === 0) {
            finishScan({ added: 0, skipped: 0, total: 0 });
            return;
        }

        // 增量：先筛出「变化过」的文件，未变化的跳过元数据解析
        if (incremental) {
            const { changed, skipped } = await filterChangedFiles(musicList);
            changedPaths = changed;
            skippedCount = skipped;
            if (!changed.length) {
                finishScan({
                    added: 0,
                    skipped: skippedCount,
                    total: musicList.length,
                });
                return;
            }
        } else {
            changedPaths = musicList;
        }

        reportScanProgress({
            phase: "parsing",
            current: 0,
            total: changedPaths.length,
            skipped: skippedCount,
        });

        // 分组请求，不然序列化可能出问题
        let metas: IBasicMeta[] = [];
        const groups = Math.ceil(changedPaths.length / groupNum);
        for (let i = 0; i < groups; ++i) {
            metas = metas.concat(
                await mp3Util.getMediaMeta(
                    changedPaths.slice(i * groupNum, (i + 1) * groupNum),
                ),
            );
            if (token !== importToken) {
                throw new Error("Import Broken");
            }
            reportScanProgress({
                phase: "parsing",
                current: Math.min((i + 1) * groupNum, changedPaths.length),
                total: changedPaths.length,
                skipped: skippedCount,
            });
        }

        const musicItems: IMusic.IMusicItem[] = await Promise.all(
            changedPaths.map(async (musicPath, index) => {
                let { platform, id, title, artist } =
                    parseFilename(getFileName(musicPath, true)) ?? {};
                const meta = metas[index];
                if (!platform || !id) {
                    platform = "本地";
                    id = CryptoJs.MD5(musicPath).toString(CryptoJs.enc.Hex);
                }
                // 元数据标签优先；标签缺失时尝试从「歌名 - 歌手」文件名解析，
                // 最后才退化成「整串文件名 + 未知歌手」（见 parseCommonFilename 注释）
                const common = parseCommonFilename(getFileName(musicPath, true));
                return {
                    id,
                    platform,
                    title:
                        title ?? meta?.title ?? common?.title ?? getFileName(musicPath),
                    artist: artist ?? meta?.artist ?? common?.artist ?? "未知歌手",
                    duration: parseInt(meta?.duration ?? "0", 10) / 1000,
                    album: meta?.album ?? "未知专辑",
                    artwork: "",
                    [internalSerializeKey]: {
                        localPath: musicPath,
                    },
                } as IMusic.IMusicItem;
            }),
        );
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        // D12：最短时长过滤（跳过提示音、试听碎片等）
        const minDurationSec = getMinDurationSec();
        const acceptedItems =
            minDurationSec > 0
                ? musicItems.filter(
                      item => (item.duration ?? 0) >= minDurationSec,
                  )
                : musicItems;
        const skippedByDuration = musicItems.length - acceptedItems.length;

        addMusic(acceptedItems);

        // D13：入库时登记「文件真值」（含文件头容器嗅探）。
        // 分批并发，避免几百个文件同时打开句柄；登记失败不影响入库结果。
        try {
            const REGISTER_BATCH = 10;
            for (let i = 0; i < acceptedItems.length; i += REGISTER_BATCH) {
                await Promise.all(
                    acceptedItems.slice(i, i + REGISTER_BATCH).map(item => {
                        const path = getLocalPath(item);
                        if (!path) {
                            return Promise.resolve(null);
                        }
                        return registerExistingFile(path, {
                            title: item.title,
                            artist: item.artist,
                            source: "scan",
                        }).catch(() => null);
                    }),
                );
            }
        } catch (e) {
            // 忽略：登记是增强能力
        }
        finishScan({
            added: musicItems.length,
            skipped: skippedCount,
            total: musicList.length,
        });
    } catch (e: any) {
        // 用户中断不算错误
        if (e?.message === "Import Broken") {
            finishScan({ skipped: skippedCount });
            return;
        }
        failScan(e?.message ?? String(e));
        throw e;
    }
}

/** 是否为本地音乐 */
function isLocalMusic(
    musicItem: ICommon.IMediaBase | null,
): IMusic.IMusicItem | undefined {
    return musicItem
        ? localSheet.find(_ => isSameLocalFile(_, musicItem))
        : undefined;
}

/** 状态-是否为本地音乐 */
function useIsLocal(musicItem: IMusic.IMusicItem | null) {
    const localMusicState = localSheetStateMapper.useMappedState();
    const [isLocal, setIsLocal] = useState<boolean>(!!isLocalMusic(musicItem));
    useEffect(() => {
        if (!musicItem) {
            setIsLocal(false);
        } else {
            setIsLocal(!!isLocalMusic(musicItem));
        }
    }, [localMusicState, musicItem]);
    return isLocal;
}

function getMusicList() {
    return localSheet;
}

async function updateMusicList(newSheet: IMusic.IMusicItem[]) {
    const _localSheet = [...newSheet];
    try {
        await setStorage(StorageKeys.LocalMusicSheet, _localSheet);
        localSheet = _localSheet;
        localSheetStateMapper.notify();
    } catch {}
}

const LocalMusicSheet = {
    setup,
    addMusic,
    removeMusic,
    addMusicDraft,
    saveLocalSheet,
    importLocal,
    cancelImportLocal,
    isLocalMusic,
    useIsLocal,
    getMusicList,
    useMusicList: localSheetStateMapper.useMappedState,
    updateMusicList,
};

export default LocalMusicSheet;




