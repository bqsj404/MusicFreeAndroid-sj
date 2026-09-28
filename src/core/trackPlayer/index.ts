import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog";
import {
    internalFakeSoundKey,
    localPluginPlatform,
    sortIndexSymbol,
    timeStampSymbol,
} from "@/constants/commonConst";
import { MusicRepeatMode } from "@/constants/repeatModeConst";
import delay from "@/utils/delay";
import { toPlayableFileUrl } from "@/utils/fileUtils";
import getUrlExt from "@/utils/getUrlExt";
import { errorLog, trace } from "@/utils/log";
import { createMediaIndexMap } from "@/utils/mediaIndexMap";
import {
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import Network from "@/utils/network";
import PersistStatus from "@/utils/persistStatus";
import { getQualityOrder } from "@/utils/qualities";
import { musicIsPaused } from "@/utils/trackUtils";
import EventEmitter from "eventemitter3";
import { produce } from "immer";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import shuffle from "lodash.shuffle";
import { exists } from "react-native-fs";
import ReactNativeTrackPlayer, {
    Event,
    State,
    Track,
    TrackMetadataBase,
    usePlaybackState,
    useProgress,
} from "react-native-track-player";
import LocalMusicSheet from "../localMusicSheet";
import MusicSheet from "@/core/musicSheet";
import { findLocalMusicByWorkKey } from "@/core/localMusicIndex";
import { getSourceName } from "@/core/mediaSource";
import toggleChain, {
    buildToggleGroupKey,
    STABLE_PLAY_MS,
} from "@/core/playErrorChain";
import Toast from "@/utils/toast";
import i18n from "@/core/i18n";
import {
    SourceMatchLevel,
    isMatched,
    matchSourceLevel,
} from "@/core/sourceMatch";

import { TrackPlayerEvents } from "@/core.defination/trackPlayer";
import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory";
import { ITrackPlayer } from "@/types/core/trackPlayer/index";
import minDistance from "@/utils/minDistance";
import { IPluginManager } from "@/types/core/pluginManager";
import { ImgAsset } from "@/constants/assetsConst";
import { resolveImportedAssetOrPath } from "@/utils/fileUtils";



const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
const repeatModeAtom = atom<MusicRepeatMode>(MusicRepeatMode.QUEUE);
const qualityAtom = atom<IMusic.IQualityKey>("standard");
const playListAtom = atom<IMusic.IMusicItem[]>([]);
/** D18：队列来源（供队列面板响应式展示） */
const queueSourceAtom = atom<{ id: string; platform: string; title?: string } | null>(null);
// 首次订阅时从持久化补一次初值（重启后队列还在，来源也应还在）
queueSourceAtom.onMount = setSelf => {
    const saved = PersistStatus.get("music.queueSource") ?? null;
    if (saved) {
        setSelf(saved);
    }
};


class TrackPlayer extends EventEmitter<{
    [TrackPlayerEvents.PlayEnd]: () => void;
    [TrackPlayerEvents.CurrentMusicChanged]: (musicItem: IMusic.IMusicItem | null) => void;
    [TrackPlayerEvents.ProgressChanged]: (progress: {
        position: number;
        duration: number;
    }) => void;
}> implements ITrackPlayer {
    // 依赖
    private configService!: IAppConfig;
    private musicHistoryService!: IMusicHistory;
    private pluginManagerService!: IPluginManager;

    // 当前播放的音乐下标
    private currentIndex = -1;
    // 音乐播放器服务是否启动
    private serviceInited = false;
    // 播放队列索引map
    /**
     * 播放失败处理的重入闸门（第 7 批 · 问题 3）。
     *
     * ExoPlayer 一次失败会连发多个 `PlaybackError`，而换源链内部又会
     * `await play(...)`（失败时再次走到 `handlePlayFail`）。不设闸门的话
     * 会并发开出多条链、每条链各弹一次「正在换源」，用户看到的就是
     * 「通知一直弹、歌一直换」。
     */
    private handlePlayFailRunning = false;
    /**
     * 本首曲目「开始取源成功」的时间戳（0 表示尚无）。
     * 用于判断一次失败是「刚换了源就挂」还是「稳定播了一阵才挂」，
     * 见 `playErrorChain.STABLE_PLAY_MS`。
     */
    private playStartedAt = 0;
    /**
     * 当前曲目的**真实音源是否已就绪**（第 7 批 · 问题 2/3 的核心标志）。
     *
     * `play()` 的流程是「先用占位 URL 把歌放进队列（UI/通知栏立刻有信息）→
     * 异步取源 → 取到后 `setTrackSource` 换成真 URL」。占位期间队列里是
     * `[proposed, fakeNext]` 两首，而 `fakeNext` 是一段**能真的播放的静音**
     * （原生侧有映射），大约 4 秒。
     *
     * 于是取源只要超过 4 秒（云盘要先联网解析路径、可能还要下载缓存），
     * 静音就"播完了" → `PlaybackActiveTrackChanged` 判定为「队列末尾」
     * → `skipToNext()` → **用户点的歌还没出声就被跳走**。
     *
     * 这正是「下载的李白不能播放」与「歌一直自己在切」的共同机制：
     * 云盘/失效音源的取源耗时越长，跳得越欢。
     */
    private sourceReady = false;
    private playListIndexMap = createMediaIndexMap([] as IMusic.IMusicItem[]);


    private static maxMusicQueueLength = 10000;
    private static halfMaxMusicQueueLength = 5000;
    private static toggleRepeatMapping = {
        [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
        [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
        [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
    };
    private static fakeAudioUrl = "musicfree://fake-audio";
    private static proposedAudioUrl = "musicfree://proposed-audio";

    constructor() {
        super();
    }

    public get previousMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex - 1);
    }

    public get currentMusic() {
        return getDefaultStore().get(currentMusicAtom);
    }

    public get nextMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex + 1);
    }

    public get repeatMode() {
        return getDefaultStore().get(repeatModeAtom);
    }

    public get quality() {
        return getDefaultStore().get(qualityAtom);
    }

    public get playList() {
        return getDefaultStore().get(playListAtom);
    }


    injectDependencies(configService: IAppConfig, musicHistoryService: IMusicHistory, pluginManager: IPluginManager): void {
        this.configService = configService;
        this.musicHistoryService = musicHistoryService;
        this.pluginManagerService = pluginManager;
    }


    async setupTrackPlayer() {
        const rate = PersistStatus.get("music.rate");
        const musicQueue = PersistStatus.get("music.playList");
        const repeatMode = PersistStatus.get("music.repeatMode");
        const progress = PersistStatus.get("music.progress");
        const track = PersistStatus.get("music.musicItem");
        const quality =
            PersistStatus.get("music.quality") ||
            this.configService.getConfig("basic.defaultPlayQuality") ||
            "standard";

        // 状态恢复
        if (rate) {
            ReactNativeTrackPlayer.setRate(+rate / 100);
        }
        if (repeatMode) {
            getDefaultStore().set(repeatModeAtom, repeatMode as MusicRepeatMode);
        }

        if (musicQueue && Array.isArray(musicQueue)) {
            this.addAll(
                musicQueue,
                undefined,
                repeatMode === MusicRepeatMode.SHUFFLE,
            );
        }

        if (track && this.isInPlayList(track)) {
            if (!this.configService.getConfig("basic.autoPlayWhenAppStart")) {
                track.isInit = true;
            }

            // 异步
            this.pluginManagerService.getByMedia(track)
                ?.methods.getMediaSource(track, quality)
                .then(async newSource => {
                    track.url = newSource?.url || track.url;
                    track.headers = newSource?.headers || track.headers;

                    if (isSameMediaItem(this.currentMusic, track)) {
                        await this.setTrackSource(track as Track, false);
                        if (progress) {
                            // 异步
                            this.seekTo(progress);
                        }
                    }
                });
            this.setCurrentMusic(track);

            if (progress) {
                // 异步
                this.seekTo(progress);
            }
        }

        if (!this.serviceInited) {

            /**
             * 此事件可能会被触发多次（比如直接替换queue） 参考代码：https://github.com/doublesymmetry/KotlinAudio
             */
            ReactNativeTrackPlayer.addEventListener(
                Event.PlaybackActiveTrackChanged,
                async evt => {
                    if (
                        evt.index === 1 &&
                        evt.lastIndex === 0 &&
                        evt.track?.url === TrackPlayer.fakeAudioUrl
                    ) {
                        /*
                         * 第 7 批 · 问题 2/3：先确认「真的听完了」。
                         *
                         * `fakeNext` 是一段**能真的播放的静音**（约 4 秒），
                         * 放在队列末尾做「列表结束」的哨兵。但取源期间队列是
                         * `[占位, fakeNext]`，占位 URL 打不开时播放器会前进到
                         * 静音并很快放完 —— 这条分支就会把「用户点的歌还没
                         * 出声」误判成「听完了」，直接 `skipToNext()`。
                         *
                         * 云盘取源要联网（可达数秒），于是「点李白 → 自动跳到
                         * 下一首」；一整张取源都慢的歌单就表现为「一直在切」。
                         */
                        if (!this.sourceReady) {
                            trace("取源未完成，忽略占位静音的结束事件");
                            return;
                        }
                        trace("队列末尾，播放下一首");
                        this.emit(TrackPlayerEvents.PlayEnd);
                        if (
                            this.repeatMode ===
                            MusicRepeatMode.SINGLE
                        ) {
                            await this.play(null, true);
                        } else {
                            // 当前生效的歌曲是下一曲的标记
                            await this.skipToNext();
                        }
                    }
                },
            );

            ReactNativeTrackPlayer.addEventListener(
                Event.PlaybackError,
                async e => {
                    errorLog("播放出错", e.message);
                    // WARNING: 不稳定，报错的时候有可能track已经变到下一首歌去了
                    const currentTrack =
                        await ReactNativeTrackPlayer.getActiveTrack();
                    if (currentTrack?.isInit) {
                        // HACK: 避免初始失败的情况
                        ReactNativeTrackPlayer.updateMetadataForTrack(0, {
                            ...currentTrack,
                            // @ts-ignore
                            isInit: undefined,
                        });
                        return;
                    }

                    /*
                     * 「本地文件不存在」这条错误原先被无条件丢弃，于是
                     * 用户点一首本地库里已经没文件的歌时**完全没有反应**
                     * （既没有提示，也不会跳过）—— 这也是「下载的李白
                     * 怎么不能播放了」的一种观感来源。
                     *
                     * 现在改成：**只有当当前曲目确实有本地路径时**才
                     * 按播放失败处理（并且明确提示文件已丢失），
                     * 其余场景（初始化阶段、fake/proposed 占位）保持原有豁免。
                     * 处理走 `handlePlayFail`，因此照样受熔断保护，
                     * 不会因为整个歌单都丢文件而无限跳歌。
                     */
                    const isFileNotFound =
                        e.message === "android-io-file-not-found";
                    if (isFileNotFound) {
                        const missingLocal = getLocalPath(
                            this.currentMusic as IMusic.IMusicItem,
                        );
                        if (!missingLocal) {
                            return;
                        }
                        Toast.warn(i18n.t("toast.localFileMissing"));
                    }

                    if (
                        currentTrack?.url !== TrackPlayer.fakeAudioUrl && currentTrack?.url !== TrackPlayer.proposedAudioUrl &&
                        (await ReactNativeTrackPlayer.getActiveTrackIndex()) === 0 &&
                        e.message
                    ) {
                        trace("播放出错", {
                            message: e.message,
                            code: e.code,
                        });

                        this.handlePlayFail();
                    }
                },
            );

            this.serviceInited = true;
        }
    }

    /**************** 播放队列 ******************/
    getMusicIndexInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return -1;
        }
        return this.playListIndexMap.getIndex(musicItem);
    }

    isInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return false;
        }

        return this.playListIndexMap.has(musicItem);
    }

    getPlayListMusicAt(index: number): IMusic.IMusicItem | null {
        const playList = this.playList;
        const len = playList.length;
        if (len === 0) {
            return null;
        }
        return playList[(index + len) % len];
    }

    isPlayListEmpty() {
        return this.playList.length === 0;
    }

    /****** 播放逻辑 *****/
    addAll(
        musicItems: Array<IMusic.IMusicItem>,
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): void {
        const now = Date.now();
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentPlayList = this.playList;
        musicItems.forEach((item, index) => {
            item[timeStampSymbol] = now;
            item[sortIndexSymbol] = index;
        });

        if (beforeIndex === undefined || beforeIndex < 0) {
            // 1.1. 添加到歌单末尾，并过滤掉已有的歌曲
            newPlayList = currentPlayList.concat(
                musicItems.filter(item => !this.isInPlayList(item)),
            );
        } else {
            // 1.2. 新的播放列表，插入
            const indexMap = createMediaIndexMap(musicItems);
            const beforeDraft = currentPlayList
                .slice(0, beforeIndex)
                .filter(item => !indexMap.has(item));
            const afterDraft = currentPlayList
                .slice(beforeIndex)
                .filter(item => !indexMap.has(item));

            newPlayList = [...beforeDraft, ...musicItems, ...afterDraft];
        }

        // 如果太长了
        if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
            newPlayList = this.shrinkPlayListToSize(
                newPlayList,
                beforeIndex ?? newPlayList.length - 1,
            );
        }

        // 2. 如果需要随机
        if (shouldShuffle) {
            newPlayList = shuffle(newPlayList);
        }
        // 3. 设置播放列表
        this.setPlayList(newPlayList);
    }

    add(
        musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
        beforeIndex?: number,
    ): void {
        this.addAll(
            Array.isArray(musicItem) ? musicItem : [musicItem],
            beforeIndex,
        );
    }

    addNext(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]): void {
        const shouldAutoPlay = this.isPlayListEmpty() || !this.currentMusic;

        this.add(musicItem, this.currentIndex + 1);

        if (shouldAutoPlay) {
            this.play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
        }
    }

    async remove(musicItem: IMusic.IMusicItem): Promise<void> {
        const playList = this.playList;

        let newPlayList: IMusic.IMusicItem[] = [];
        let currentMusic: IMusic.IMusicItem | null = this.currentMusic;
        const targetIndex = this.getMusicIndexInPlayList(musicItem);
        let shouldPlayCurrent: boolean | null = null;
        if (targetIndex === -1) {
            // 1. 这种情况应该是出错了
            return;
        }
        // 2. 移除的是当前项
        if (this.currentIndex === targetIndex) {
            // 2.1 停止播放，移除当前项
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 2.2 设置新的播放列表，并更新当前音乐
            if (newPlayList.length === 0) {
                currentMusic = null;
                shouldPlayCurrent = false;
            } else {
                currentMusic = newPlayList[this.currentIndex % newPlayList.length];
                try {
                    const state = (
                        await ReactNativeTrackPlayer.getPlaybackState()
                    ).state;
                    shouldPlayCurrent = !musicIsPaused(state);
                } catch {
                    shouldPlayCurrent = false;
                }
            }
            this.setCurrentMusic(currentMusic);
        } else {
            // 3. 删除
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
        }

        this.setPlayList(newPlayList);
        if (shouldPlayCurrent === true) {
            await this.play(currentMusic, true);
        } else if (shouldPlayCurrent === false) {
            await ReactNativeTrackPlayer.reset();
        }
    }

    isCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        return isSameMediaItem(musicItem, this.currentMusic);
    }

    /**
     * 播放指定歌曲（不传则重播当前曲）。
     *
     * @param forcePlay 强制从头开始（而非从暂停处恢复）
     * @param options.keepToggleHistory
     *   供**自动换源链**内部调用：保留「已试过哪些源」的痕迹，
     *   否则链里试过的死源下一轮又会被重试一遍。
     *   其余调用方（用户点歌 / 上下一首 / 队列切换）都不要传 ——
     *   换了一首歌就应当按「用户接管」处理：作废在途换源链（epoch +1）、
     *   清掉上一首的链内痕迹。
     */
    async play(
        musicItem?: IMusic.IMusicItem | null,
        forcePlay?: boolean,
        options?: { keepToggleHistory?: boolean },
    ): Promise<void> {
        try {
            // 如果不传参，默认是播放当前音乐
            if (!musicItem) {
                musicItem = this.currentMusic;
            }
            if (!musicItem) {
                throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
            }
            if (!options?.keepToggleHistory) {
                // 第 7 批 · 问题 3：换歌即「用户/队列接管」。
                // epoch +1 让在途换源链立刻作废（绝不把用户刚切过去的歌掰回来），
                // 同时清掉上一首的链内痕迹。
                toggleChain.bumpEpoch();
                toggleChain.resetForNewTrack();
            }
            // 第 7 批 · 问题 2/3：进入取源阶段 —— 在拿到真源之前，
            // 队列里的「播完」事件都只代表占位静音放完了，不能当作真的听完。
            this.sourceReady = false;
            // 1. 移动网络禁止播放
            const localPath = getLocalPath(musicItem);
            if (
                Network.isCellular &&
                !this.configService.getConfig("basic.useCelluarNetworkPlay") &&
                !LocalMusicSheet.isLocalMusic(musicItem) &&
                !localPath
            ) {
                await ReactNativeTrackPlayer.reset();
                throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
            }

            // 2. 如果是当前正在播放的音频
            if (this.isCurrentMusic(musicItem)) {
                // 获取底层播放器中的track
                const currentTrack = await ReactNativeTrackPlayer.getTrack(0);
                // 2.1 如果当前有源
                //     注意排除两个占位 URL：`proposed` 是「正在取源」的标记，
                //     `fake` 是队列末尾哨兵。把占位当成「有源」会让
                //     `sourceReady` 被误置为 true，静音播完又会自动跳歌。
                if (
                    currentTrack?.url &&
                    currentTrack.url !== TrackPlayer.proposedAudioUrl &&
                    currentTrack.url !== TrackPlayer.fakeAudioUrl &&
                    isSameMediaItem(
                        musicItem,
                        currentTrack as IMusic.IMusicItem,
                    )
                ) {
                    const currentActiveIndex =
                        await ReactNativeTrackPlayer.getActiveTrackIndex();
                    if (currentActiveIndex !== 0) {
                        await ReactNativeTrackPlayer.skip(0);
                    }
                    if (forcePlay) {
                        // 2.1.1 强制重新开始
                        await this.seekTo(0);
                    }
                    const currentState = (
                        await ReactNativeTrackPlayer.getPlaybackState()
                    ).state;
                    if (currentState === State.Stopped) {
                        await this.setTrackSource(currentTrack);
                    }
                    if (currentState !== State.Playing) {
                        // 2.1.2 恢复播放
                        await ReactNativeTrackPlayer.play();
                    }
                    // 队列里已经是真源，标记就绪
                    this.sourceReady = true;
                    // 这种情况下，播放队列和当前歌曲都不需要变化
                    return;
                }
                // 2.2 其他情况：重新获取源
            }

            // 3. 如果没有在播放列表中，添加到队尾；同时更新列表状态
            const inPlayList = this.isInPlayList(musicItem);
            if (!inPlayList) {
                this.add(musicItem);
            }

            // 4. 更新列表状态和当前音乐
            this.setCurrentMusic(musicItem);
            await ReactNativeTrackPlayer.setQueue([{
                ...musicItem,
                url: TrackPlayer.proposedAudioUrl,
                artwork: resolveImportedAssetOrPath(musicItem.artwork?.trim?.()?.length ? musicItem.artwork : ImgAsset.albumDefault) as unknown as any,
            }, this.getFakeNextTrack()]);

            // 5. 获取音源
            let track: IMusic.IMusicItem;

            // 5.1 通过插件获取音源
            const plugin = this.pluginManagerService.getByName(musicItem.platform);
            // 5.2 获取音质排序
            const qualityOrder = getQualityOrder(
                this.configService.getConfig("basic.defaultPlayQuality") ?? "standard",
                this.configService.getConfig("basic.playQualityOrder") ?? "asc",
            );
            // 5.3 插件返回音源
            let source: IPlugin.IMediaSourceResult | null = null;

            /*
             * 5.2.4 条目**自带的本地文件**（第 7 批 · 问题 2 的核心修复）。
             *
             * `mediaSource.ts` 里写的取源优先级是
             *     local（条目自带文件） → localLibrary（按作品键命中本地库）
             *       → cloud → cache → plugin
             * 但这里原先**只实现了第二档**（下面那段「本地优先」），
             * 第一档只在普通插件的包装层里有 —— 而「云盘」「本地」是内建插件，
             * 会绕过包装层。
             *
             * 后果就是：用户点的是一首**已下载的云盘歌曲**（它自己就有本地
             * 文件），播放器却先按「歌名+歌手」去本地库里找"同作品"，
             * 命中了另一个同名文件（例如同目录下的试听片段 / 另一个版本），
             * 于是"下载好的歌点开却不是它"；若那条同名文件又短，
             * 会出现「刚点开几秒就自动跳下一首」。
             *
             * 自带文件永远是最准的：它就是用户点的这一条。
             */
            const ownLocalPath = getLocalPath(musicItem);
            if (ownLocalPath && (await exists(ownLocalPath))) {
                trace("自带本地文件播放", ownLocalPath);
                source = {
                    url: toPlayableFileUrl(ownLocalPath),
                    sourceKind: "local",
                    sourceName: getSourceName("local"),
                };
            }

            // 5.2.5 本地优先（D1 取源三态的第一步：本地 → 云端 → 插件）
            //
            // 为什么必须放在这一层：原先这段逻辑写在
            // `PluginMethodsWrapper.getMediaSource` 里，而那一层只包装**普通插件**；
            // 「云盘」「本地」是内建插件，其 `methods` 直接是插件自身的实现，
            // 会**绕过包装层** —— 于是对云盘歌曲本地优先从来就没生效过。
            // 放在播放器的取源入口，才能对所有来源统一生效。
            if (
                !source &&
                musicItem.platform !== localPluginPlatform
            ) {
                const localSameWork = findLocalMusicByWorkKey(
                    musicItem.title,
                    musicItem.artist,
                    musicItem.duration,
                );
                if (
                    localSameWork &&
                    (await exists(localSameWork))
                ) {
                    trace("本地优先播放", localSameWork);
                    source = {
                        url: toPlayableFileUrl(localSameWork),
                        sourceKind: "localLibrary",
                        sourceName: getSourceName("localLibrary"),
                    };
                }
            }

            for (let quality of qualityOrder) {
                // 本地优先已命中则不再请求在线音源
                if (source) {
                    break;
                }
                if (this.isCurrentMusic(musicItem)) {
                    source =
                        (await plugin?.methods?.getMediaSource(
                            musicItem,
                            quality,
                        )) ?? null;
                    // 5.3.1 获取到真实源
                    if (source) {
                        this.setQuality(quality);
                        break;
                    }
                } else {
                    // 5.3.2 已经切换到其他歌曲了，
                    return;
                }
            }

            if (!this.isCurrentMusic(musicItem)) {
                return;
            }
            if (!source) {
                // 如果有source
                if (musicItem.source) {
                    for (let quality of qualityOrder) {
                        if (musicItem.source[quality]?.url) {
                            source = musicItem.source[quality]!;
                            this.setQuality(quality);

                            break;
                        }
                    }
                }
                // 5.4 没有返回源
                if (!source && !musicItem.url) {
                    /**
                     * 插件失效的情况。
                     *
                     * 第 7 批 · 问题 7：这里原先单独读旧布尔项
                     * `basic.tryChangeSourceWhenPlayFail`，于是「播放失败时尝试
                     * 更换音源」开关与「播放失败时」四态里的 `toggle` 语义重叠，
                     * 设置页出现两个控制同一件事的选项，而且两套换源代码并存
                     * （这里一次、`runAutoToggleChain` 一次）。
                     *
                     * 现在统一交给 `handlePlayFail` → `runAutoToggleChain`
                     * 处理：那条链有冷却、有链内上限、有已试源去重、有熔断，
                     * 比这里的「一次性重试」完整得多。旧布尔项仍在
                     * `getPlayErrorMode()` 里做读取兜底，老用户的设置不会失效。
                     */
                    throw new Error(PlayFailReason.INVALID_SOURCE);
                } else {
                    source = {
                        url: musicItem.url,
                    };
                    this.setQuality("standard");
                }
            }

            // 6. 特殊类型源
            if (getUrlExt(source.url) === ".m3u8") {
                // @ts-ignore
                source.type = "hls";
            }
            // 7. 合并结果
            track = this.mergeTrackSource(musicItem, source) as IMusic.IMusicItem;

            // 8. 新增历史记录
            this.musicHistoryService.addMusic(musicItem);

            trace("获取音源成功", track);
            // 9. 设置音源
            await this.setTrackSource(track as Track);
            // 第 7 批 · 问题 3：记下这一首「取源成功」的时刻。
            // 之后的失败若发生在 STABLE_PLAY_MS 之内，就计入熔断统计。
            this.playStartedAt = Date.now();

            // 9.1 D1 音源三态：把「已合并音源标记」的 track 同步进 UI 状态。
            //
            // 原先只有拿到补充信息（第 11 步的 `info`）时才会写 currentMusicAtom，
            // 而很多歌曲（如云盘曲目）拿不到 info，于是 atom 里一直是最初那个
            // **取源之前**的 musicItem —— UI 因此读不到 sourceKind/sourceName，
            // 「音源胶囊」永远不显示。
            if (this.isCurrentMusic(musicItem)) {
                getDefaultStore().set(
                    currentMusicAtom,
                    track as IMusic.IMusicItem,
                );
            }

            // 10. 获取补充信息
            let info: Partial<IMusic.IMusicItem> | null = null;
            try {
                info =
                    (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
                if (
                    (typeof info?.url === "string" && info.url.trim() === "") ||
                    (info?.url && typeof info.url !== "string")
                ) {
                    delete info.url;
                }
            } catch { }

            // 11. 设置补充信息
            if (info && this.isCurrentMusic(musicItem)) {
                const mergedTrack = this.mergeTrackSource(track, info);
                getDefaultStore().set(currentMusicAtom, mergedTrack as IMusic.IMusicItem);
                await ReactNativeTrackPlayer.updateMetadataForTrack(
                    0,
                    mergedTrack as TrackMetadataBase,
                );
            }
        } catch (e: any) {
            const message = e?.message;
            if (
                message ===
                "The player is not initialized. Call setupPlayer first."
            ) {
                await ReactNativeTrackPlayer.setupPlayer();
                this.play(musicItem, forcePlay);
            } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
                if (getCurrentDialog()?.name !== "SimpleDialog") {
                    showDialog("SimpleDialog", {
                        title: "流量提醒",
                        content:
                            "当前非WIFI环境，侧边栏设置中打开【使用移动网络播放】功能后可继续播放",
                    });
                }
            } else if (message === PlayFailReason.INVALID_SOURCE) {
                trace("音源为空，播放失败");
                await this.handlePlayFail();
            } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
                // 队列是空的，不应该出现这种情况
            }
        }
    }

    async pause(): Promise<void> {
        await ReactNativeTrackPlayer.pause();
    }

    toggleRepeatMode(): void {
        this.setRepeatMode(TrackPlayer.toggleRepeatMapping[this.repeatMode]);
    }

    // 清空播放队列
    async clearPlayList(): Promise<void> {
        this.setPlayList([]);
        this.setCurrentMusic(null);

        await ReactNativeTrackPlayer.reset();
        PersistStatus.set("music.musicItem", undefined);
        PersistStatus.set("music.progress", 0);
    }

    async skipToNext(): Promise<void> {
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        await this.play(this.getPlayListMusicAt(this.currentIndex + 1), true);
    }

    async skipToPrevious(): Promise<void> {
        // D2：切歌 = 用户主动接管，作废在途换源链
        toggleChain.bumpEpoch();
        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        await this.play(
            this.getPlayListMusicAt(this.currentIndex === -1 ? 0 : this.currentIndex - 1),
            true,
        );
    }

    async changeQuality(newQuality: IMusic.IQualityKey): Promise<boolean> {
        // 获取当前的音乐和进度
        if (newQuality === this.quality) {
            return true;
        }

        // 获取当前歌曲
        const musicItem = this.currentMusic;
        if (!musicItem) {
            return false;
        }
        try {
            const progress = await ReactNativeTrackPlayer.getProgress();
            const plugin = this.pluginManagerService.getByMedia(musicItem);
            const newSource = await plugin?.methods?.getMediaSource(
                musicItem,
                newQuality,
            );
            if (!newSource?.url) {
                throw new Error(PlayFailReason.INVALID_SOURCE);
            }
            if (this.isCurrentMusic(musicItem)) {
                const playingState = (
                    await ReactNativeTrackPlayer.getPlaybackState()
                ).state;
                await this.setTrackSource(
                    this.mergeTrackSource(musicItem, newSource) as unknown as Track,
                    !musicIsPaused(playingState),
                );

                await this.seekTo(progress.position ?? 0);
                this.setQuality(newQuality);
            }
            return true;
        } catch {
            // 修改失败
            return false;
        }
    }

    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
    ): Promise<void> {
        if (newPlayList.length !== 0) {
            const now = Date.now();
            if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
                newPlayList = this.shrinkPlayListToSize(
                    newPlayList,
                    newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
                );
            }

            newPlayList.forEach((it, index) => {
                it[timeStampSymbol] = now;
                it[sortIndexSymbol] = index;
            });

            this.setPlayList(
                this.repeatMode === MusicRepeatMode.SHUFFLE
                    ? shuffle(newPlayList)
                    : newPlayList,
            );
            await this.play(musicItem, true);
        }
    }

    async seekTo(progress: number) {
        PersistStatus.set("music.progress", progress);
        return ReactNativeTrackPlayer.seekTo(progress);
    }

    getProgress = ReactNativeTrackPlayer.getProgress;
    getRate = ReactNativeTrackPlayer.getRate;
    setRate = ReactNativeTrackPlayer.setRate;
    reset = ReactNativeTrackPlayer.reset;


    /**************** 辅助函数 -- 设置内部状态 ****************/

    private setCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        // 设置UI内部状态的musicitem
        if (!musicItem) {
            this.currentIndex = -1;
            getDefaultStore().set(currentMusicAtom, null);
            PersistStatus.set("music.musicItem", undefined);
            PersistStatus.set("music.progress", 0);

            this.emit(TrackPlayerEvents.CurrentMusicChanged, null);
            return;
        }
        if (typeof musicItem.artwork !== "string") {
            musicItem.artwork = ImgAsset.albumDefault;
        }
        this.currentIndex = this.getMusicIndexInPlayList(musicItem);
        getDefaultStore().set(currentMusicAtom, musicItem);

        this.emit(TrackPlayerEvents.CurrentMusicChanged, musicItem);
    }

    private setRepeatMode(mode: MusicRepeatMode) {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[];
        const prevMode = getDefaultStore().get(repeatModeAtom);
        if (
            (prevMode === MusicRepeatMode.SHUFFLE &&
                mode !== MusicRepeatMode.SHUFFLE) ||
            (mode === MusicRepeatMode.SHUFFLE &&
                prevMode !== MusicRepeatMode.SHUFFLE)
        ) {
            if (mode === MusicRepeatMode.SHUFFLE) {
                newPlayList = shuffle(playList);
            } else {
                newPlayList = this.sortByTimestampAndIndex(playList, true);
            }
            this.setPlayList(newPlayList);
        }

        getDefaultStore().set(repeatModeAtom, mode);
        // 更新下一首歌的信息
        ReactNativeTrackPlayer.updateMetadataForTrack(
            1,
            this.getFakeNextTrack(),
        );
        // 记录
        PersistStatus.set("music.repeatMode", mode);
    }

    private setQuality(quality: IMusic.IQualityKey) {
        getDefaultStore().set(qualityAtom, quality);
        PersistStatus.set("music.quality", quality);
    }

    // 设置音源
    private async setTrackSource(track: Track, autoPlay = true) {
        const clonedTrack = this.patchMediaArtwork(track);
        if (!clonedTrack) {
            return;
        }
        await ReactNativeTrackPlayer.setQueue([clonedTrack, this.getFakeNextTrack()]);
        // 真源已经进队列：从这一刻起，「播完」才代表真的听完了一首
        this.sourceReady = true;
        PersistStatus.set("music.musicItem", track as IMusic.IMusicItem);
        PersistStatus.set("music.progress", 0);
        if (autoPlay) {
            await ReactNativeTrackPlayer.play();
        }
    }

    /**
     * 设置播放队列
     * @param newPlayList 播放队列
     * @param persist 是否持久化
     */
    private setPlayList(newPlayList: IMusic.IMusicItem[], persist = true) {
        getDefaultStore().set(playListAtom, newPlayList);

        this.playListIndexMap = createMediaIndexMap(newPlayList);

        if (persist) {
            PersistStatus.set("music.playList", newPlayList);
        }

        this.currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
    }


    /**
     * D18：记录播放队列的**来源歌单**。
     *
     * 队列本身已经持久化（见 `setPlayList` 里的 `music.playList`），
     * 但"这批歌是从哪来的"没有留下痕迹 —— 重启后队列还在，
     * 用户却不知道它是哪个歌单/专辑。这里把它记下来，
     * 队列面板据此展示并可「还原」（跳回来源）。
     */
    setQueueSource(sheet?: IMusic.IMusicSheetItem | null) {
        if (!sheet?.id) {
            PersistStatus.set("music.queueSource", undefined);
            getDefaultStore().set(queueSourceAtom, null);
            return;
        }
        const source = {
            id: sheet.id,
            platform: sheet.platform,
            title: sheet.title,
        };
        PersistStatus.set("music.queueSource", source);
        // 同时写 atom：队列面板是常驻挂载的，只写持久化的话，
        // 已挂载的面板读不到新值（PersistStatus.useValue 基于 useState，
        // 没有全局订阅），表现为「首次打开面板看不到来源、关掉重开才有」。
        getDefaultStore().set(queueSourceAtom, source);
    }

    /** D18：读取队列来源（无记录时为 null） */
    getQueueSource() {
        return PersistStatus.get("music.queueSource") ?? null;
    }

    /**************** 辅助函数 -- 工具方法 ****************/
    private shrinkPlayListToSize = (
        queue: IMusic.IMusicItem[],
        targetIndex = this.currentIndex,
    ) => {
        // 播放列表上限，太多无法缓存状态
        if (queue.length > TrackPlayer.maxMusicQueueLength) {
            if (targetIndex < TrackPlayer.halfMaxMusicQueueLength) {
                queue = queue.slice(0, TrackPlayer.maxMusicQueueLength);
            } else {
                const right = Math.min(
                    queue.length,
                    targetIndex + TrackPlayer.halfMaxMusicQueueLength,
                );
                const left = Math.max(0, right - TrackPlayer.maxMusicQueueLength);
                queue = queue.slice(left, right);
            }
        }
        return queue;
    };

    private mergeTrackSource(
        mediaItem: ICommon.IMediaBase,
        props: Record<string, any> | undefined,
    ) {
        return props
            ? {
                ...mediaItem,
                ...props,
                id: mediaItem.id,
                platform: mediaItem.platform,
            }
            : mediaItem;
    }

    private sortByTimestampAndIndex(array: any[], newArray = false) {
        if (newArray) {
            array = [...array];
        }
        return array.sort((a, b) => {
            const ts = a[timeStampSymbol] - b[timeStampSymbol];
            if (ts !== 0) {
                return ts;
            }
            return a[sortIndexSymbol] - b[sortIndexSymbol];
        });
    }

    private getFakeNextTrack() {
        let track: Track | undefined;
        const repeatMode = this.repeatMode;
        if (repeatMode === MusicRepeatMode.SINGLE) {
            // 单曲循环
            track = this.getPlayListMusicAt(this.currentIndex) as Track;
        } else {
            // 下一曲
            track = this.getPlayListMusicAt(this.currentIndex + 1) as Track;
        }

        if (track) {
            return produce(track, _ => {
                _.url = TrackPlayer.fakeAudioUrl;
                _.$ = internalFakeSoundKey;
                _.artwork = resolveImportedAssetOrPath(ImgAsset.albumDefault) as unknown as any;
            });
        } else {
            // 只有列表长度为0时才会出现的特殊情况
            return {
                url: TrackPlayer.fakeAudioUrl,
                $: internalFakeSoundKey,
            } as Track;
        }
    }


    /**
     * 读播放失败策略（新的四态优先，旧的布尔配置作兼容兜底）。
     *
     * 第 7 批 · 问题 7：旧版有**两个**布尔项 —— `autoStopWhenError`
     * （出错就停）与 `tryChangeSourceWhenPlayFail`（出错就换源），
     * 而新版四态把这两件事合成了一个选择。设置页已不再展示旧项，
     * 但这里必须继续认它们，否则老用户升级后行为会静默变化。
     *
     * 优先级：四态 > 换源 > 停顿 > 跳过。
     * 「换源」优先于「停顿」是因为它的语义更强（用户显式要求换源）。
     */
    private getPlayErrorMode():
        | "toggle"
        | "toggle-replace"
        | "skip"
        | "pause" {
        const mode = this.configService.getConfig("basic.playError");
        if (mode) {
            return mode;
        }
        // 兼容：旧布尔项「播放失败时尝试更换音源」≈ 四态里的 toggle
        if (this.configService.getConfig("basic.tryChangeSourceWhenPlayFail")) {
            return "toggle";
        }
        // 兼容：旧布尔项 —— true 表示出错就停（≈pause），false 跳下一首（≈skip）
        return this.configService.getConfig("basic.autoStopWhenError")
            ? "pause"
            : "skip";
    }

    /**
     * 播放失败的总入口。
     *
     * 加一层**防重入**是第 7 批 · 问题 3 的核心修复之一：
     * ExoPlayer 一次失败往往连发多个 `PlaybackError`，而 `runAutoToggleChain`
     * 内部又会 `await this.play(...)`（失败时再次走到这里），
     * 于是并发开出多条链、每条链各弹一次「正在换源」通知，
     * 用户看到的就是「通知一直在弹、歌一直在换」。
     *
     * 有了它，链内那次 `play` 触发的失败会被直接丢弃 —— 链自己会
     * `continue` 去试下一个源，这才是正确语义。
     */
    private async handlePlayFail(): Promise<void> {
        if (this.handlePlayFailRunning) {
            return;
        }
        this.handlePlayFailRunning = true;
        try {
            await this.doHandlePlayFail();
        } finally {
            this.handlePlayFailRunning = false;
        }
    }

    private async doHandlePlayFail(): Promise<void> {
        const mode = this.getPlayErrorMode();

        // 刚换源成功不久：这条错误更可能是**上一份源**的残留事件
        // （ExoPlayer 的 error 回调与 track 切换存在竞态），忽略即可。
        if (toggleChain.inSuccessGrace()) {
            return;
        }

        // 本次失败之前已经稳定播了一段时间 → 说明这首源本身是好的，
        // 本次属于偶发（网络抖动 / 音源暂时 5xx），不该计入熔断统计。
        //
        // 门槛必须存在：若「能进 Playing 就清零」，那么「每首都只播一秒
        // 就失败」的病态源会永远清零计数，熔断闸门形同虚设 ——
        // 那正是用户看到的「歌一直在切」。
        if (
            this.playStartedAt > 0 &&
            Date.now() - this.playStartedAt >= STABLE_PLAY_MS
        ) {
            toggleChain.resetErrors();
        }

        // 熔断闸门：连续失败到上限就停下来把控制权还给用户。
        // 没有这一步时，`skipToNext` 会让「整张死源歌单」无限跳下去
        // （每跳一首都会重置冷却，于是又能开新链 —— 死循环）。
        if (toggleChain.recordError()) {
            toggleChain.stop();
            await this.pause();
            Toast.warn(i18n.t("toast.playErrorGiveUp"));
            return;
        }

        if (mode === "pause") {
            await this.pause();
            return;
        }

        if (mode === "toggle" || mode === "toggle-replace") {
            const outcome = await this.runAutoToggleChain(mode);
            if (outcome === "toggled") {
                return;
            }
            // 没能开链（已有链在跑 / 用户已接管）：本次错误不追加动作，
            // 否则「重复上报的错误事件」会被当成新故障去跳歌。
            if (outcome === "rejected") {
                return;
            }
            // 用户点过「停止换源」时不再自动跳歌，只暂停
            if (toggleChain.isStopped()) {
                await this.pause();
                return;
            }
        }

        await delay(500);
        await this.skipToNext();
    }

    /**
     * 自动换源链（D2）。
     *
     * 对齐桌面版 `runAutoToggleChain` 的关键约束：
     * **冷却**（避免错误事件密集开出多条链）、**链内最多 3 次**、
     * 按**歌曲组键**去重（换源后 id/platform 会变）、
     * **epoch 失效即中止**（用户主动接管后绝不把歌掰回去）。
     *
     * 返回三态而不是布尔（第 7 批 · 问题 3 的修复）：
     *  - `"toggled"`  换源成功，调用方直接返回
     *  - `"exhausted"` 链跑完了但没找到能播的源 → 调用方按策略跳歌
     *  - `"rejected"`  **压根没开链**（冷却中等不到 / 用户已停止）
     *                  → 调用方不能跳歌，否则重复的错误事件会被当成
     *                  新故障，越跳越快，正是「一直在切换」的成因
     */
    private async runAutoToggleChain(
        mode: "toggle" | "toggle-replace",
    ): Promise<"toggled" | "exhausted" | "rejected"> {
        const musicItem = this.currentMusic;
        if (!musicItem || toggleChain.isStopped()) {
            return "rejected";
        }

        // 冷却中不直接放弃，而是等到冷却结束再开链。
        // 直接返回会让「同一故障的第二次上报」无人处理，界面停在失败态。
        if (toggleChain.inCooldown()) {
            await delay(toggleChain.getRemainingCooldown() + 50);
            // 等待期间用户可能已经切歌/接管了
            if (!this.isCurrentMusic(musicItem) || toggleChain.isStopped()) {
                return "rejected";
            }
        }

        if (!toggleChain.tryStartChain()) {
            return "rejected";
        }

        const epoch = toggleChain.getEpoch();
        toggleChain.markTriedGroup(musicItem);
        // 轻量「状态栏」：桌面版是常驻的 done/total + 停止按钮；
        // Android 这里先用提示让换源过程可见。
        // 停止能力已由 chain.stop() 提供，待有合适的常驻 UI 再挂上。
        Toast.warn(i18n.t("toast.togglingSource"));
        // 只以 epoch 与 stopped 判「中止」：
        // `this.play(similar)` 必然把 currentMusic 换成 similar，
        // 若把 `!isCurrentMusic(musicItem)` 也算中止，链会自己把自己掐死。
        // 「用户切歌」在 `play()` 里会 bumpEpoch，已由 epoch 覆盖。
        const isAborted = () =>
            epoch !== toggleChain.getEpoch() || toggleChain.isStopped();

        while (toggleChain.canAttempt()) {
            if (isAborted()) {
                return "rejected";
            }

            const similar = await this.getSimilarMusic(
                musicItem,
                "music",
                isAborted,
                {
                    plugins: toggleChain.triedPluginsSnapshot(),
                    groupKeys: toggleChain.triedGroupKeysSnapshot(),
                },
            );
            if (!similar) {
                break;
            }

            toggleChain.beginAttempt();
            toggleChain.markTriedGroup(similar as any);
            toggleChain.markTriedPlugin(similar.platform);

            try {
                // keepToggleHistory：链内换源不能清掉「已试过哪些源」，
                // 否则下一轮会把同一个死源再试一遍。
                await this.play(similar as IMusic.IMusicItem, true, {
                    keepToggleHistory: true,
                });
            } catch (e) {
                // 换源本身失败，继续试下一个
                continue;
            }

            if (epoch !== toggleChain.getEpoch()) {
                return "rejected";
            }
            if (this.isCurrentMusic(similar as IMusic.IMusicItem)) {
                toggleChain.markToggleSuccess();
                if (mode === "toggle-replace") {
                    /*
                     * 「替换原歌单信息」与「不替换」的唯一差别就在这一步：
                     * 把各歌单里对原条目的引用改成真正播通的来源，
                     * 否则下次播放还从那个死源开始。
                     */
                    try {
                        MusicSheet.replaceMusicReference(
                            musicItem,
                            similar as IMusic.IMusicItem,
                        );
                    } catch (e) {
                        // 替换失败不影响本次播放
                    }
                }
                return "toggled";
            }
        }
        return "exhausted";
    }

    /**
 *
 * @param musicItem 音乐类型
 * @param type 媒体类型
 * @param abortFunction 如果函数为true，则中断
 * @returns
 */
    private async getSimilarMusic<T extends ICommon.SupportMediaType>(
        musicItem: IMusic.IMusicItem,
        type: T = "music" as T,
        abortFunction?: () => boolean,
        /**
         * D2：自动换源链的排除项。
         *
         * 换源是多轮进行的，每轮都要跳过**已经试过**的插件与歌曲 ——
         * 否则同一个死源会被反复重试。用「歌曲组键」而不是条目 id 去重，
         * 因为换源之后 id/platform 都会变。
         */
        exclude?: {
            plugins?: Set<string>;
            groupKeys?: Set<string>;
        },
    ): Promise<ICommon.SupportMediaItemBase[T] | null> {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManagerService.getSearchablePlugins(type);

        let distance = Infinity;
        // D2：当前找到的最好匹配级别（越小越可信）
        let bestLevel: SourceMatchLevel = SourceMatchLevel.None;
        let minDistanceMusicItem;
        let targetPlugin;

        const startTime = Date.now();

        for (let plugin of plugins) {
            // 超时时间：8s
            if (abortFunction?.() || Date.now() - startTime > 8000) {
                break;
            }
            if (plugin.name === musicItem.platform) {
                continue;
            }
            if (exclude?.plugins?.has(plugin.name)) {
                continue;
            }
            const results = await plugin.methods
                .search(keyword, 1, type)
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (
                    exclude?.groupKeys?.has(buildToggleGroupKey(item))
                ) {
                    continue;
                }
                /*
                 * D2：换源要按「4 级匹配规则」判断是不是同一首歌，
                 * 而不是只看文本距离 —— 只看距离会把 Live 版、
                 * 翻唱版也当成可换的目标，换完用户听到的是另一首歌。
                 *
                 * 级别优先（越小越可信），同级别再比文本距离；
                 * 完全不匹配的直接跳过。
                 */
                const level = matchSourceLevel(musicItem, item);
                if (!isMatched(level)) {
                    continue;
                }
                const dist =
                    minDistance(keyword, musicItem.title) +
                    minDistance(item.artist, musicItem.artist);
                if (
                    level < bestLevel ||
                    (level === bestLevel && dist < distance)
                ) {
                    bestLevel = level;
                    distance = dist;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                }
            }

            // 已经是最高一级（完全一致），不必再往下找
            if (bestLevel === SourceMatchLevel.Exact) {
                break;
            }
        }
        if (minDistanceMusicItem && targetPlugin) {
            return minDistanceMusicItem as ICommon.SupportMediaItemBase[T];
        }

        return null;
    }


    private patchMediaArtwork(track: Track) {
        // Bug: React native track player 在设置音频时，artwork不能为null，并且部分情况下artwork不能为ImageSource类型
        if (!track) {
            return null;
        }
        return {
            ...track,
            artwork: resolveImportedAssetOrPath(
                track.artwork?.trim?.()?.length ? track.artwork : ImgAsset.albumDefault,
            ) as unknown as any,
        };
    }

}

export const usePlayList = () => useAtomValue(playListAtom);
export const useCurrentMusic = () => useAtomValue(currentMusicAtom);
export const useRepeatMode = () => useAtomValue(repeatModeAtom);
export const useMusicQuality = () => useAtomValue(qualityAtom);
/**
 * D18：队列来源（响应式）。
 *
 * 首次从持久化读入 atom 的初值，之后随 `setQueueSource` 即时更新 ——
 * 避免「面板已挂载 → 读不到新写入的来源」。
 * 惰性初始化只在首次订阅时执行一次（进程生命周期内 atom 常驻）。
 */
export function useQueueSource() {
    return useAtomValue(queueSourceAtom);
}
/** 供非组件场景（如面板打开前）主动同步一次持久化值到 atom */
export function syncQueueSourceAtom() {
    getDefaultStore().set(
        queueSourceAtom,
        PersistStatus.get("music.queueSource") ?? null,
    );
}

export function useMusicState() {
    const playbackState = usePlaybackState();

    return playbackState.state;
}
export { State as MusicState, useProgress };

enum PlayFailReason {
    /** 禁止移动网络播放 */
    FORBID_CELLUAR_NETWORK_PLAY = "FORBID_CELLUAR_NETWORK_PLAY",
    /** 播放列表为空 */
    PLAY_LIST_IS_EMPTY = "PLAY_LIST_IS_EMPTY",
    /** 无效源 */
    INVALID_SOURCE = "INVALID_SOURCE",
    /** 非当前音乐 */
}

const trackPlayer = new TrackPlayer();
export default trackPlayer;












