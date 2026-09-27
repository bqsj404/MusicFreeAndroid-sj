/**
 * 快捷键动作的执行。
 *
 * 播放类动作直接调 `TrackPlayer`；导航类动作由路由层在挂载时注入
 * （`registerShortcutNavigator`），因此本模块不依赖 `@react-navigation`。
 */
import TrackPlayer from "@/core/trackPlayer";
import MusicSheet from "@/core/musicSheet";
import { showToast } from "@/components/base/toast";
import ReactNativeTrackPlayer, {
    State as TrackPlayerState,
} from "react-native-track-player";
import type { ShortcutActionId } from "./actions";

/** 快进 / 快退步长（秒），与播放栏 ←→ 保持一致 */
export const SEEK_STEP_SECONDS = 10;

/** 「我喜欢」歌单 id（见 `src/core/musicSheet/index.ts` 的 defaultSheet） */
const FAVORITE_SHEET_ID = "favorite";

/** 导航动作的执行函数（由路由层注入） */
export interface ShortcutNavigator {
    openSearch: () => void;
    openSetting: () => void;
}

let navigator: ShortcutNavigator | null = null;

/** 注册导航能力（在 NavigationContainer 内的常驻组件里调用） */
export function registerShortcutNavigator(nav: ShortcutNavigator) {
    navigator = nav;
    return () => {
        if (navigator === nav) {
            navigator = null;
        }
    };
}

/** 相对当前位置快进 / 快退 */
async function seekBy(deltaSeconds: number) {
    try {
        const progress = await TrackPlayer.getProgress();
        const position = progress?.position ?? 0;
        const duration = progress?.duration ?? 0;
        const raw = position + deltaSeconds;
        const target = duration > 0 ? Math.min(duration, Math.max(0, raw)) : Math.max(0, raw);
        await TrackPlayer.seekTo(target);
    } catch (e) {
        // 未在播放 / 未取到进度时忽略
    }
}

/** 播放 / 暂停（按当前播放状态取反，与播放栏按钮语义一致） */
async function togglePlayPause() {
    if (!TrackPlayer.currentMusic) {
        return;
    }
    try {
        const { state } = await ReactNativeTrackPlayer.getPlaybackState();
        if (state === TrackPlayerState.Playing) {
            await TrackPlayer.pause();
        } else {
            await TrackPlayer.play();
        }
    } catch (e) {
        // 忽略
    }
}

async function addCurrentToFavorite() {
    const current = TrackPlayer.currentMusic;
    if (!current) {
        showToast({ type: "warn", message: "当前没有播放中的歌曲" });
        return;
    }
    try {
        await MusicSheet.addMusic(FAVORITE_SHEET_ID, current);
        showToast({ type: "success", message: "已添加到「我喜欢」" });
    } catch (e) {
        showToast({ type: "warn", message: "收藏失败" });
    }
}

/**
 * 执行一个快捷键动作。
 *
 * @returns 是否真正执行（false 表示该动作当前不可用，调用方可继续传递事件）
 */
export async function runShortcutAction(
    actionId: ShortcutActionId,
): Promise<boolean> {
    switch (actionId) {
        case "playPause":
            await togglePlayPause();
            return true;
        case "playNext":
            try {
                await TrackPlayer.skipToNext();
            } catch (e) {
                // 队列边界时忽略
            }
            return true;
        case "playPrevious":
            try {
                await TrackPlayer.skipToPrevious();
            } catch (e) {
                // 队列边界时忽略
            }
            return true;
        case "seekForward":
            await seekBy(SEEK_STEP_SECONDS);
            return true;
        case "seekBackward":
            await seekBy(-SEEK_STEP_SECONDS);
            return true;
        case "favorite":
            await addCurrentToFavorite();
            return true;
        case "openSearch":
            if (!navigator) {
                return false;
            }
            navigator.openSearch();
            return true;
        case "openSetting":
            if (!navigator) {
                return false;
            }
            navigator.openSetting();
            return true;
        default:
            return false;
    }
}
