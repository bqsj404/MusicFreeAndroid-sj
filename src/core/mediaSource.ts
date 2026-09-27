/**
 * 音源三态（D1）—— 统一取源标记与展示。
 *
 * 背景：取源逻辑原先散落在 `plugin.ts` 的一串 `if` 里，能播但没有「这个概念」：
 *  - 用户看不出正在放的是本地文件、云盘文件还是某个插件解析出来的
 *  - 排查问题时也无法从界面判断「为什么走了在线音源」
 *
 * 这里把「音源」抽成一个显式概念，并保证取源优先级口径唯一：
 *
 *     local（条目自带文件）
 *       → localLibrary（本地库按作品键命中）
 *       → cloud（云盘）
 *       → cache（播放缓存）
 *       → plugin（在线插件）
 *
 * 取源方在返回值里打上 `sourceKind` / `sourceName`，
 * 该结果会随 track 一路带到播放栏与播放详情页。
 */
import { cloudPluginPlatform, localPluginPlatform } from "@/constants/commonConst";

/** 音源类型别名（便于非声明文件里直接引用） */
export type MediaSourceKind = IPlugin.MediaSourceKind;

/** 各音源的展示名（本地/云盘/缓存是固定文案；插件用插件名） */
const FIXED_SOURCE_NAME: Partial<Record<MediaSourceKind, string>> = {
    local: "本地",
    localLibrary: "本地",
    cloud: "云盘",
    cache: "缓存",
};

/**
 * 按 platform 推断音源类型。
 *
 * 只做「这个平台属于哪一类」的判断；具体怎么取到 url 由调用方负责。
 */
export function resolveSourceKindByPlatform(
    platform?: string | null,
): MediaSourceKind {
    if (!platform) {
        return "plugin";
    }
    if (platform === localPluginPlatform) {
        return "local";
    }
    if (platform === cloudPluginPlatform) {
        return "cloud";
    }
    return "plugin";
}

/**
 * 取音源的展示名。
 *
 * @param kind       音源类型
 * @param pluginName 插件名（`kind === "plugin"` 时使用）
 */
export function getSourceName(
    kind: MediaSourceKind | undefined,
    pluginName?: string | null,
): string {
    if (!kind) {
        return pluginName ?? "";
    }
    const fixed = FIXED_SOURCE_NAME[kind];
    if (fixed) {
        return fixed;
    }
    return pluginName ?? "";
}

/** 是否为「本地来源」（含两种细分），用于 UI 上是否显示「本地」标记 */
export function isLocalSourceKind(kind?: MediaSourceKind): boolean {
    return kind === "local" || kind === "localLibrary";
}

/** 是否为「非在线」来源（本地/云盘/缓存），即不需要走插件解析 */
export function isOfflineSourceKind(kind?: MediaSourceKind): boolean {
    return kind === "local" || kind === "localLibrary" || kind === "cache";
}
