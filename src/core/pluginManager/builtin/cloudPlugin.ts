/**
 * 云盘内建插件定义。
 *
 * 与桌面版 `src/main/core/builtinPlugins/cloudPlugin.ts` 对齐：云盘插件本身
 * **很薄**，只负责把「云盘条目」接到宿主能力上，重活都在 `src/core/cloudDisk/`：
 *  - `getMediaSource`：远端直链 + `Authorization` + Zotero `User-Agent` 请求头
 *    （Android 的 ExoPlayer 原生支持自定义请求头，**不需要**桌面版那套本地回环代理）
 *  - `getLyric`：远端 `/MusicFree/lyrics/` 下的同名 `.lrc`
 *  - `getMusicInfo`：当前远端无封面约定，返回 null
 *
 * 与桌面版一致：**故意不实现 `search`**，因此云盘不会进入自动换源搜索链。
 */
import { cloudPluginPlatform } from "@/constants/commonConst";
import {
    buildCloudMediaSource,
    getCloudLyricSource,
    getCloudMusicInfo,
} from "@/core/cloudDisk";

/** 云盘插件伪路径（参与 hash 计算，同时标记为非磁盘插件） */
export const CLOUD_PLUGIN_INTERNAL_PATH = "internal-plugin://cloud-plugin";

/**
 * 创建云盘插件定义。
 *
 * 返回的是**纯对象定义**（与磁盘插件经沙箱包装出的对象同构）；
 * 真正的 `Plugin` 实例由 `../plugin.ts` 统一构造，避免模块环。
 */
export function createCloudPluginDefine(): IPlugin.IPluginDefine {
    return {
        platform: cloudPluginPlatform,
        async getMediaSource(musicItem, quality) {
            return buildCloudMediaSource(
                musicItem as IMusic.IMusicItem,
                quality,
            );
        },
        async getLyric(musicBase: ICommon.IMediaBase) {
            // D10：一并返回 `<名>-tr.lrc` 翻译
            return getCloudLyricSource(musicBase);
        },
        async getMusicInfo(musicBase: ICommon.IMediaBase) {
            return getCloudMusicInfo(musicBase);
        },
    };
}

