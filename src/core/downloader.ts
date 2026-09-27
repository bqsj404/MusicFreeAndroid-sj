import { internalSerializeKey, supportLocalMediaType } from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import { IAppConfig } from "@/types/core/config";
import { IInjectable } from "@/types/infra";
import { addFileScheme, escapeCharacter, mkdirR } from "@/utils/fileUtils";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { errorLog } from "@/utils/log";
import { patchMediaExtra } from "@/utils/mediaExtra";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import network from "@/utils/network";
import { getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { nanoid } from "nanoid";
import path from "path-browserify";
import { useEffect, useState } from "react";
import {
    copyFile,
    downloadFile,
    exists,
    stopDownload,
    unlink,
} from "react-native-fs";
import LocalMusicSheet from "./localMusicSheet";
import { getAllMediaFiles, registerExistingFile } from "./mediaFileRegistry";
import { IPluginManager } from "@/types/core/pluginManager";

/**
 * 下载任务的持久化存储（D11）。
 *
 * 原实现把任务只放在内存 `Map` 里，应用一重启就全丢 —— 下载到一半的任务
 * 既不会继续也不会显示。这里把「未完成任务」与「待下载队列」落盘，
 * 启动时恢复；「已完成」的记录则**不落这里**，而是以
 * `mediaFileRegistry` 里 source=download 的文件真值为准（单一事实来源）。
 */
const downloadStore = getOrCreateMMKV("download.state");
const PERSIST_TASKS_KEY = "dl:tasks";
const PERSIST_QUEUE_KEY = "dl:queue";

/** 落盘用的精简任务结构（剔除 jobId 等运行时字段） */
interface IPersistedTask {
    key: string;
    status: DownloadStatus;
    filename: string;
    quality?: IMusic.IQualityKey;
    fileSize?: number;
    downloadedSize?: number;
    errorReason?: DownloadFailReason;
    musicItem: IMusic.IMusicItem;
    updatedAt: number;
}



export enum DownloadStatus {
    // 等待下载
    Pending,
    // 准备下载链接
    Preparing,
    // 下载中
    Downloading,
    // 已暂停（D11）
    Paused,
    // 下载完成
    Completed,
    // 下载失败
    Error
}

/**
 * 下载记录（D11「单列表三类记录」的统一视图）。
 *
 * 三种 kind 合并成一个列表展示，由 UI 决定分组或筛选：
 *  - `active`    —— 进行中（Pending / Preparing / Downloading / Paused）
 *  - `completed` —— 已完成（来自文件真值层，可与 missing 标记组合）
 *  - `failed`    —— 失败（Error）
 */
export interface IDownloadRecord {
    kind: "active" | "completed" | "failed";
    /** 唯一键（`platform.id`） */
    key: string;
    musicItem: IMusic.IMusicItem;
    status: DownloadStatus;
    filename?: string;
    quality?: IMusic.IQualityKey;
    fileSize?: number;
    downloadedSize?: number;
    /** 本地文件路径（已完成记录有） */
    localPath?: string;
    /** 文件是否已丢失（missing 标记） */
    missing?: boolean;
    /** 失败原因 */
    errorReason?: DownloadFailReason;
    /** 最近更新时间（排序用） */
    updatedAt: number;
}


export enum DownloaderEvent {
    // 某次下载行为出错
    DownloadError = "download-error",

    // 下载任务更新
    DownloadTaskUpdate = "download-task-update",

    // 下载某个音乐时出错
    DownloadTaskError = "download-task-error",

    // 下载完成
    DownloadQueueCompleted = "download-queue-completed",
}

export enum DownloadFailReason {
    /** 无网络 */
    NetworkOffline = "network-offline",
    /** 设置-禁止在移动网络下下载 */
    NotAllowToDownloadInCellular = "not-allow-to-download-in-cellular",
    /** 无法获取到媒体源 */
    FailToFetchSource = "no-valid-source",
    /** 没有文件写入的权限 */
    NoWritePermission = "no-write-permission",
    Unknown = "unknown",
}

interface IDownloadTaskInfo {
    // 状态
    status: DownloadStatus;
    // 目标文件名
    filename: string;
    // 下载id
    jobId?: number;
    // 下载音质
    quality?: IMusic.IQualityKey;
    // 文件大小
    fileSize?: number;
    // 已下载大小
    downloadedSize?: number;
    // 音乐信息
    musicItem: IMusic.IMusicItem;
    // 如果下载失败，下载失败的原因
    errorReason?: DownloadFailReason;
}


const downloadQueueAtom = atom<IMusic.IMusicItem[]>([]);
const downloadTasks = new Map<string, IDownloadTaskInfo>();


interface IEvents {
    /** 某次下载行为出现报错 */
    [DownloaderEvent.DownloadError]: (reason: DownloadFailReason, error?: Error) => void;
    /** 下载某个媒体时报错 */
    [DownloaderEvent.DownloadTaskError]: (reason: DownloadFailReason, mediaItem: IMusic.IMusicItem, error?: Error) => void;
    /** 下载任务更新 */
    [DownloaderEvent.DownloadTaskUpdate]: (task: IDownloadTaskInfo) => void;
    /** 下载队列清空 */
    [DownloaderEvent.DownloadQueueCompleted]: () => void;
}

class Downloader extends EventEmitter<IEvents> implements IInjectable {
    private configService!: IAppConfig;
    private pluginManagerService!: IPluginManager;

    private downloadingCount = 0;

    private static generateFilename(musicItem: IMusic.IMusicItem) {
        return `${escapeCharacter(musicItem.platform)}@${escapeCharacter(
            musicItem.id,
        )}@${escapeCharacter(musicItem.title)}@${escapeCharacter(
            musicItem.artist,
        )}`.slice(0, 200);
    }


    injectDependencies(configService: IAppConfig, pluginManager: IPluginManager): void {
        this.configService = configService;
        this.pluginManagerService = pluginManager;
        // D11：恢复上次未完成的下载任务（重启后可继续）
        this.restoreTasks();
    }

    private updateDownloadTask(musicItem: IMusic.IMusicItem, patch: Partial<IDownloadTaskInfo>) {
        const newValue = {
            ...downloadTasks.get(getMediaUniqueKey(musicItem)),
            ...patch,
        } as IDownloadTaskInfo;
        downloadTasks.set(getMediaUniqueKey(musicItem), newValue);
        this.emit(DownloaderEvent.DownloadTaskUpdate, newValue);
        this.persistTasks();
        return newValue;
    }

    // ——— D11：持久化 ———

    /** 把「未完成任务」与「待下载队列」落盘（已完成的不存，见文件真值层） */
    private persistTasks() {
        try {
            const payload: IPersistedTask[] = [];
            downloadTasks.forEach((task, key) => {
                if (task.status === DownloadStatus.Completed) {
                    return;
                }
                payload.push({
                    key,
                    // 重启后无法续传，进行中的一律降级为等待
                    status:
                        task.status === DownloadStatus.Downloading ||
                        task.status === DownloadStatus.Preparing
                            ? DownloadStatus.Pending
                            : task.status,
                    filename: task.filename,
                    quality: task.quality,
                    fileSize: task.fileSize,
                    downloadedSize: task.downloadedSize,
                    errorReason: task.errorReason,
                    musicItem: task.musicItem,
                    updatedAt: Date.now(),
                });
            });
            downloadStore.set(PERSIST_TASKS_KEY, JSON.stringify(payload));
            downloadStore.set(
                PERSIST_QUEUE_KEY,
                JSON.stringify(
                    getDefaultStore()
                        .get(downloadQueueAtom)
                        .map(m => getMediaUniqueKey(m)),
                ),
            );
        } catch (e) {
            // 落盘失败不影响下载本身
        }
    }

    /** 启动时恢复未完成任务与队列 */
    private restoreTasks() {
        try {
            const rawTasks = downloadStore.getString(PERSIST_TASKS_KEY);
            const saved = rawTasks ? safeParse<IPersistedTask[]>(rawTasks) : null;
            if (!Array.isArray(saved) || !saved.length) {
                return;
            }
            const queueKeysRaw = downloadStore.getString(PERSIST_QUEUE_KEY);
            const queueKeys = new Set(
                (queueKeysRaw ? safeParse<string[]>(queueKeysRaw) : null) ?? [],
            );

            const restoredItems: IMusic.IMusicItem[] = [];
            saved.forEach(item => {
                if (!item?.musicItem || !item.key) {
                    return;
                }
                downloadTasks.set(item.key, {
                    status: item.status,
                    filename: item.filename,
                    quality: item.quality,
                    fileSize: item.fileSize,
                    downloadedSize: item.downloadedSize,
                    errorReason: item.errorReason,
                    musicItem: item.musicItem,
                });
                // Pending 才重新排队；Paused / Error 保留状态等用户操作
                if (item.status === DownloadStatus.Pending) {
                    restoredItems.push(item.musicItem);
                }
            });

            if (restoredItems.length) {
                const queue = getDefaultStore().get(downloadQueueAtom);
                const merged = [...queue];
                restoredItems.forEach(item => {
                    if (
                        !merged.some(existing =>
                            isSameMediaItem(existing, item),
                        )
                    ) {
                        merged.push(item);
                    }
                });
                getDefaultStore().set(downloadQueueAtom, merged);
                this.downloadNextPendingTask();
            }
            void queueKeys;
        } catch (e) {
            // 恢复失败不影响新任务
        }
    }

    // 开始下载
    private markTaskAsStarted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount++;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Preparing,
        });
    }

    private markTaskAsCompleted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Completed,
        });
    }

    private markTaskAsError(musicItem: IMusic.IMusicItem, reason: DownloadFailReason, error?: Error) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Error,
            errorReason: reason,
        });
        this.emit(DownloaderEvent.DownloadTaskError, reason, musicItem, error);
    }

    /** 匹配文件后缀 */
    private getExtensionName(url: string) {
        const regResult = url.match(
            /^https?\:\/\/.+\.([^\?\.]+?$)|(?:([^\.]+?)\?.+$)/,
        );
        if (regResult) {
            return regResult[1] ?? regResult[2] ?? "mp3";
        } else {
            return "mp3";
        }
    };

    /** 获取下载路径 */
    private getDownloadPath(fileName: string) {
        const dlPath =
            this.configService.getConfig("basic.downloadPath") ?? pathConst.downloadMusicPath;
        if (!dlPath.endsWith("/")) {
            return `${dlPath}/${fileName ?? ""}`;
        }
        return fileName ? dlPath + fileName : dlPath;
    };

    /** 获取缓存的下载路径 */
    private getCacheDownloadPath(fileName: string) {
        const cachePath = pathConst.downloadCachePath;
        if (!cachePath.endsWith("/")) {
            return `${cachePath}/${fileName ?? ""}`;
        }
        return fileName ? cachePath + fileName : cachePath;
    }


    private async downloadNextPendingTask() {
        const maxDownloadCount = Math.max(1, Math.min(+(this.configService.getConfig("basic.maxDownload") || 3), 10));
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);

        // 如果超过最大下载数量，或者没有下载任务，则不执行
        if (this.downloadingCount >= maxDownloadCount || this.downloadingCount >= downloadQueue.length) {
            return;
        }

        // 寻找下一个pending task
        let nextTask: IDownloadTaskInfo | null = null;
        for (let i = 0; i < downloadQueue.length; i++) {
            const musicItem = downloadQueue[i];
            const key = getMediaUniqueKey(musicItem);
            const task = downloadTasks.get(key);
            if (task && task.status === DownloadStatus.Pending) {
                nextTask = task;
                break;
            }
        }

        // 没有下一个任务了
        if (!nextTask) {
            if (this.downloadingCount === 0) {
                this.emit(DownloaderEvent.DownloadQueueCompleted);
            }
            return;
        }

        const musicItem = nextTask.musicItem;
        // 更新下载状态
        this.markTaskAsStarted(musicItem);

        let url = musicItem.url;
        let headers = musicItem.headers;

        const plugin = this.pluginManagerService.getByName(musicItem.platform);

        try {
            if (plugin) {
                const qualityOrder = getQualityOrder(
                    nextTask.quality ??
                    this.configService.getConfig("basic.defaultDownloadQuality") ??
                    "standard",
                    this.configService.getConfig("basic.downloadQualityOrder") ?? "asc",
                );
                let data: IPlugin.IMediaSourceResult | null = null;
                for (let quality of qualityOrder) {
                    try {
                        data = await plugin.methods.getMediaSource(
                            musicItem,
                            quality,
                            1,
                            true,
                        );
                        if (!data?.url) {
                            continue;
                        }
                        break;
                    } catch { }
                }
                url = data?.url ?? url;
                headers = data?.headers;
            }
            if (!url) {
                throw new Error(DownloadFailReason.FailToFetchSource);
            }
        } catch (e: any) {
            /** 无法下载，跳过 */
            errorLog("下载失败-无法获取下载链接", {
                item: {
                    id: musicItem.id,
                    title: musicItem.title,
                    platform: musicItem.platform,
                    quality: nextTask.quality,
                },
                reason: e?.message ?? e,
            });

            if (e.message === DownloadFailReason.FailToFetchSource) {
                this.markTaskAsError(musicItem, DownloadFailReason.FailToFetchSource, e);
            } else {
                this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
            }
            return;
        }

        // 预处理完成，可以开始处理下一个任务
        this.downloadNextPendingTask();

        // 下载逻辑
        // 识别文件后缀
        let extension = this.getExtensionName(url);
        if (supportLocalMediaType.every(item => item !== ("." + extension))) {
            extension = "mp3";
        }

        // 缓存下载地址
        const cacheDownloadPath = addFileScheme(
            this.getCacheDownloadPath(`${nanoid()}.${extension}`),
        );

        // 真实下载地址
        const targetDownloadPath = addFileScheme(
            this.getDownloadPath(`${nextTask.filename}.${extension}`),
        );

        // 检测下载位置是否存在
        try {
            const folder = path.dirname(targetDownloadPath);
            const folderExists = await exists(folder);
            if (!folderExists) {
                await mkdirR(folder);
            }
        } catch (e: any) {
            this.emit(DownloaderEvent.DownloadTaskError, DownloadFailReason.NoWritePermission, musicItem, e);
            return;
        }

        // 下载
        //
        // 云盘（WebDAV）与「本地优先」取源返回的是**本地文件**（`file://`），
        // 而 RNFS 的 `downloadFile` 只支持 http/https —— 拿 `file://` 去下载会直接失败，
        // 表现就是「云盘音乐点下载没反应 / 没效果」。本地来源改为直接复制。
        const isLocalSource = (url ?? "").startsWith("file://");
        const promise = (async () => {
            if (isLocalSource) {
                const plainFrom = decodeURIComponent((url as string).slice(7));
                const plainTo = cacheDownloadPath.startsWith("file://")
                    ? decodeURIComponent(cacheDownloadPath.slice(7))
                    : cacheDownloadPath;
                await copyFile(plainFrom, plainTo);
                this.updateDownloadTask(musicItem, {
                    status: DownloadStatus.Downloading,
                    downloadedSize: 0,
                });
                return;
            }
            const { promise: downloadPromise } = downloadFile({
                fromUrl: url ?? "",
                toFile: cacheDownloadPath,
                headers: headers,
                background: true,
                begin: (res) => {
                    this.updateDownloadTask(musicItem, {
                        status: DownloadStatus.Downloading,
                        downloadedSize: 0,
                        fileSize: res.contentLength,
                        jobId: res.jobId,
                    });
                },
                progress: (res) => {
                    this.updateDownloadTask(musicItem, {
                        status: DownloadStatus.Downloading,
                        downloadedSize: res.bytesWritten,
                        fileSize: res.contentLength,
                        jobId: res.jobId,
                    });
                },
            });
            await downloadPromise;
        })();

        try {
            await promise;
            // 下载完成，移动文件
            await copyFile(cacheDownloadPath, targetDownloadPath);

            LocalMusicSheet.addMusic({
                ...musicItem,
                [internalSerializeKey]: {
                    localPath: targetDownloadPath,
                },
            });

            patchMediaExtra(musicItem, {
                downloaded: true,
                localPath: targetDownloadPath,
            });

            // D13：下载完成即登记「文件真值」。
            // 这里会嗅探文件头拿到**真实容器格式** —— 下载来的文件扩展名经常说谎
            // （服务端把 m4a 标成 .mp3 是重灾区），登记后「本地优先取源」
            // 与下载管理的 missing 判定才有可靠依据。
            // 登记属于增强能力，失败不应影响下载结果，故就地吞掉异常。
            try {
                await registerExistingFile(targetDownloadPath, {
                    title: musicItem.title,
                    artist: musicItem.artist,
                    source: "download",
                });
            } catch (e) {
                // 忽略
            }

            this.markTaskAsCompleted(musicItem);
        } catch (e: any) {
            this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
        }

        // 清理工作
        await unlink(cacheDownloadPath);
        this.downloadNextPendingTask();

        // 如果任务状态是完成，则从队列中移除
        const key = getMediaUniqueKey(musicItem);
        if (downloadTasks.get(key)?.status === DownloadStatus.Completed) {
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            const newDownloadQueue = downloadQueue.filter(item => !isSameMediaItem(item, musicItem));
            getDefaultStore().set(downloadQueueAtom, newDownloadQueue);
        }
    }

    download(musicItems: IMusic.IMusicItem | IMusic.IMusicItem[], quality?: IMusic.IQualityKey) {
        if (network.isOffline) {
            this.emit(DownloaderEvent.DownloadError, DownloadFailReason.NetworkOffline);
            return;
        }

        if (network.isCellular && !this.configService.getConfig("basic.useCelluarNetworkDownload")) {
            this.emit(DownloaderEvent.DownloadError, DownloadFailReason.NotAllowToDownloadInCellular);
            return;
        }

        // 整理成数组
        if (!Array.isArray(musicItems)) {
            musicItems = [musicItems];
        }

        // 防止重复下载
        musicItems = musicItems.filter(m => {
            const key = getMediaUniqueKey(m);
            // 如果存在下载任务
            if (downloadTasks.has(key)) {
                return false;
            }
            // TODO: 如果已经下载了，也应该返回false
            if (LocalMusicSheet.isLocalMusic(m)) {
                return false;
            }

            // 设置下载任务
            downloadTasks.set(getMediaUniqueKey(m), {
                status: DownloadStatus.Pending,
                filename: Downloader.generateFilename(m),
                quality: quality,
                musicItem: m,
            });

            return true;
        });

        if (!musicItems.length) {
            return;
        }

        // 添加进任务队列
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const newDownloadQueue = [...downloadQueue, ...musicItems];
        getDefaultStore().set(downloadQueueAtom, newDownloadQueue);

        this.downloadNextPendingTask();
    }

    remove(musicItem: IMusic.IMusicItem) {
        // 删除下载任务
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (task.status === DownloadStatus.Pending || task.status === DownloadStatus.Error) {
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            const newDownloadQueue = downloadQueue.filter(item => !isSameMediaItem(item, musicItem));
            getDefaultStore().set(downloadQueueAtom, newDownloadQueue);
            this.persistTasks();
            return true;
        }
        return false;
    }

    // ——— D11：暂停 / 继续 / 重试 / 丢弃 ———

    /** 暂停一个等待中或正在下载的任务 */
    async pause(musicItem: IMusic.IMusicItem): Promise<boolean> {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (task.status === DownloadStatus.Pending) {
            this.updateDownloadTask(musicItem, {
                status: DownloadStatus.Paused,
            });
            return true;
        }
        if (
            task.status === DownloadStatus.Downloading ||
            task.status === DownloadStatus.Preparing
        ) {
            try {
                if (task.jobId != null) {
                    await stopDownload(task.jobId);
                }
            } catch (e) {
                // 停止失败也置为暂停，用户点继续时会重新排队
            }
            if (this.downloadingCount > 0) {
                this.downloadingCount--;
            }
            this.updateDownloadTask(musicItem, {
                status: DownloadStatus.Paused,
                jobId: undefined,
            });
            this.downloadNextPendingTask();
            return true;
        }
        return false;
    }

    /** 继续一个已暂停的任务 */
    resume(musicItem: IMusic.IMusicItem): boolean {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task || task.status !== DownloadStatus.Paused) {
            return false;
        }
        this.updateDownloadTask(musicItem, { status: DownloadStatus.Pending });
        const queue = getDefaultStore().get(downloadQueueAtom);
        if (!queue.some(item => isSameMediaItem(item, musicItem))) {
            getDefaultStore().set(downloadQueueAtom, [...queue, musicItem]);
        }
        this.downloadNextPendingTask();
        return true;
    }

    /** 重试一个失败的任务 */
    retry(musicItem: IMusic.IMusicItem): boolean {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task || task.status !== DownloadStatus.Error) {
            return false;
        }
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Pending,
            errorReason: undefined,
            downloadedSize: 0,
        });
        const queue = getDefaultStore().get(downloadQueueAtom);
        if (!queue.some(item => isSameMediaItem(item, musicItem))) {
            getDefaultStore().set(downloadQueueAtom, [...queue, musicItem]);
        }
        this.downloadNextPendingTask();
        return true;
    }

    /** 丢弃一个未完成任务（进行中的需先暂停） */
    discard(musicItem: IMusic.IMusicItem): boolean {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (
            task.status === DownloadStatus.Downloading ||
            task.status === DownloadStatus.Preparing
        ) {
            return false;
        }
        downloadTasks.delete(key);
        const queue = getDefaultStore().get(downloadQueueAtom);
        getDefaultStore().set(
            downloadQueueAtom,
            queue.filter(item => !isSameMediaItem(item, musicItem)),
        );
        this.persistTasks();
        return true;
    }

    /** 清空失败与已暂停的任务（批量「清除无效记录」用） */
    clearInactive(): number {
        let removed = 0;
        const queue = getDefaultStore().get(downloadQueueAtom);
        const keep: IMusic.IMusicItem[] = [];
        queue.forEach(item => {
            const task = downloadTasks.get(getMediaUniqueKey(item));
            if (
                task &&
                (task.status === DownloadStatus.Error ||
                    task.status === DownloadStatus.Paused)
            ) {
                downloadTasks.delete(getMediaUniqueKey(item));
                removed++;
            } else {
                keep.push(item);
            }
        });
        if (removed) {
            getDefaultStore().set(downloadQueueAtom, keep);
            this.persistTasks();
        }
        return removed;
    }

    // ——— D11：统一记录视图（单列表三类） ———

    /**
     * 取下载记录。
     *
     * 「已完成」来自 `mediaFileRegistry`（source=download）而**不是**内存任务表 ——
     * 下载完成后任务会被删除（见下载流程），内存表无法作为历史来源；
     * 文件真值层是持久化的，正好充当这一层的单一事实来源。
     *
     * @param options.checkMissing 逐个校验文件是否仍存在（IO 较多，默认关）。
     *                             缺失的会在 `missing` 上标记，供 UI 提示与清理。
     */
    async getDownloadRecords(
        options: { checkMissing?: boolean } = {},
    ): Promise<IDownloadRecord[]> {
        const records: IDownloadRecord[] = [];

        // 进行中 / 失败
        downloadTasks.forEach((task, key) => {
            const isFailed = task.status === DownloadStatus.Error;
            records.push({
                kind: isFailed ? "failed" : "active",
                key,
                musicItem: task.musicItem,
                status: task.status,
                filename: task.filename,
                quality: task.quality,
                fileSize: task.fileSize,
                downloadedSize: task.downloadedSize,
                errorReason: task.errorReason,
                updatedAt: Date.now(),
            });
        });

        // 已完成（文件真值层）
        try {
            getAllMediaFiles()
                .filter(file => file.source === "download")
                .forEach(file => {
                    const musicItem = {
                        id: file.workKey || file.path,
                        platform: "本地",
                        title: file.title,
                        artist: file.artist,
                        artwork: "",
                        [internalSerializeKey]: { localPath: file.path },
                    } as unknown as IMusic.IMusicItem;
                    records.push({
                        kind: "completed",
                        key: `本地.${musicItem.id}`,
                        musicItem,
                        status: DownloadStatus.Completed,
                        fileSize: file.size,
                        downloadedSize: file.size,
                        localPath: file.path,
                        missing: false,
                        updatedAt: file.registeredAt,
                    });
                });
        } catch (e) {
            // 文件真值层不可用时只返回任务记录
        }

        if (options.checkMissing) {
            await Promise.all(
                records.map(async record => {
                    if (record.kind !== "completed" || !record.localPath) {
                        return;
                    }
                    try {
                        record.missing = !(await exists(record.localPath));
                    } catch (e) {
                        record.missing = true;
                    }
                }),
            );
        }

        return records.sort((a, b) => b.updatedAt - a.updatedAt);
    }
}


const downloader = new Downloader();
export default downloader;

export function useDownloadTask(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState(downloadTasks.get(getMediaUniqueKey(musicItem)) ?? null);

    useEffect(() => {
        const callback = (task: IDownloadTaskInfo) => {
            if (isSameMediaItem(task?.musicItem, musicItem)) {
                setDownloadStatus(task);
            }
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, callback);

        return () => {
            downloader.off(DownloaderEvent.DownloadTaskUpdate, callback);
        };
    }, [musicItem]);

    return downloadStatus;
}

export const useDownloadQueue = () => useAtomValue(downloadQueueAtom);
