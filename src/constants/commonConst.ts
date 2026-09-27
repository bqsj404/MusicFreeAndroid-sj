import { Easing, EasingFunction } from "react-native-reanimated";

export const internalSymbolKey = Symbol.for("$");
// 加入播放列表的时间；app内使用，无法被序列化
export const timeStampSymbol = Symbol.for("time-stamp");
// 加入播放列表的辅助顺序
export const sortIndexSymbol = Symbol.for("sort-index");
export const internalSerializeKey = "$";
export const localMusicSheetId = "local-music-sheet";
export const musicHistorySheetId = "history-music-sheet";

export const localPluginPlatform = "本地";
export const localPluginHash = "local-plugin-hash";

/**
 * 内建插件：云盘（WebDAV 音乐库）。
 *
 * 与桌面版对齐：桌面版 `BUILTIN_PLUGIN_HASHES = [本地, 云盘]`，
 * 内建插件的 hash 固定、不进插件安装目录、不出现在插件管理页，
 * 也不能被卸载 / 更新。
 */
export const cloudPluginPlatform = "云盘";
export const cloudPluginHash = "cloud-plugin-hash";

/** 内建插件平台名集合（判定「是否是内建来源」用） */
export const builtinPluginPlatforms: string[] = [
    localPluginPlatform,
    cloudPluginPlatform,
];

/** 内建插件 hash 集合（过滤与保护用） */
export const builtinPluginHashes: string[] = [
    localPluginHash,
    cloudPluginHash,
];

/** 判断平台名是否属于内建插件 */
export function isBuiltinPluginPlatform(platform?: string | null): boolean {
    return !!platform && builtinPluginPlatforms.includes(platform);
}

/** 判断 hash 是否属于内建插件 */
export function isBuiltinPluginHash(hash?: string | null): boolean {
    return !!hash && builtinPluginHashes.includes(hash);
}

export const internalFakeSoundKey = "fake-key";

const emptyFunction = () => {};
Object.freeze(emptyFunction);
export { emptyFunction };

export enum RequestStateCode {
    /** 空闲 */
    IDLE = 0b00000000,
    PENDING_FIRST_PAGE = 0b00000010,
    LOADING = 0b00000010,
    /** 检索中 */
    PENDING_REST_PAGE = 0b00000011,
    /** 部分结束 */
    PARTLY_DONE = 0b00000100,
    /** 全部结束 */
    FINISHED = 0b0001000,
    /** 出错了 */
    ERROR = 0b10000000,
}

export const StorageKeys = {
    /** @deprecated */
    MediaMetaKeys: "media-meta-keys",
    PluginMetaKey: "plugin-meta",
    MediaCache: "media-cache",
    LocalMusicSheet: "local-music-sheet",
};

export const CacheControl = {
    Cache: "cache",
    NoCache: "no-cache",
    NoStore: "no-store",
};

export const supportLocalMediaType = [
    ".mp3",
    ".flac",
    ".wma",
    ".wav",
    ".m4a",
    ".ogg",
    ".acc",
    ".aac",
    ".ape",
    ".opus",
];

const ANIMATION_EASING: EasingFunction = Easing.out(Easing.exp);
const ANIMATION_DURATION = 150;

const animationFast = {
    duration: ANIMATION_DURATION,
    easing: ANIMATION_EASING,
};

const animationNormal = {
    duration: 250,
    easing: ANIMATION_EASING,
};

const animationSlow = {
    duration: 500,
    easing: ANIMATION_EASING,
};

export const timingConfig = {
    animationFast,
    animationNormal,
    animationSlow,
};

export const enum SortType {
    // 未排序
    None = "None",
    // 按标题排序
    Title = "title",
    // 按作者排序
    Artist = "artist",
    // 按专辑名排序
    Album = "album",
    // 按时间排序
    Newest = "time",
    // 按时间逆序
    Oldest = "time-rev",
}

export const enum ResumeMode {
    Append = "append",
    Overwrite = "overwrite",
    OverwriteDefault = "overwrite-default",
}
