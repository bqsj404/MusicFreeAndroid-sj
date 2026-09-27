import {
    StorageKeys,
    internalSerializeKey,
    supportLocalMediaType,
} from "@/constants/commonConst";
import mp3Util, { IBasicMeta } from "@/native/mp3Util";
import { addFileScheme, getFileName } from "@/utils/fileUtils.ts";
import {
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import StateMapper from "@/utils/stateMapper";
import { getStorage, setStorage } from "@/utils/storage";
import {
    addScanFolders,
    beginScan,
    failScan,
    filterChangedFiles,
    finishScan,
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
        for (let musicItem of sheet) {
            const localPath = getLocalPath(musicItem);
            if (localPath && (await exists(localPath))) {
                validSheet.push(musicItem);
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

export async function addMusic(
    musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    if (!Array.isArray(musicItem)) {
        musicItem = [musicItem];
    }
    let newSheet = [...localSheet];
    musicItem.forEach(mi => {
        if (localSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
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
        if (localSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
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
    const idx = localSheet.findIndex(_ => isSameMediaItem(_, musicItem));
    let newSheet = [...localSheet];
    if (idx !== -1) {
        const localMusicItem = localSheet[idx];
        newSheet.splice(idx, 1);
        const localPath =
            musicItem[internalSerializeKey]?.localPath ??
            localMusicItem[internalSerializeKey]?.localPath;
        if (deleteOriginalFile && localPath) {
            try {
                await unlink(localPath);
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
                return {
                    id,
                    platform,
                    title: title ?? meta?.title ?? getFileName(musicPath),
                    artist: artist ?? meta?.artist ?? "未知歌手",
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
        addMusic(musicItems);
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
        ? localSheet.find(_ => isSameMediaItem(_, musicItem))
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
