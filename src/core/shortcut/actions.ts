/**
 * 快捷键的动作定义与键位映射。
 *
 * 与桌面版 `src/infra/shortCut/renderer.ts` 的对应关系：
 *  - 桌面用 tinykeys 注册快捷键，并判定「让位给 DOM」（输入框 / role=slider）
 *  - 这里用原生按键桥的事件流 + 焦点体系判定「让位」（输入框由原生放行），
 *    动作语义保持一致
 *
 * 动作分两类：
 *  - 播放类：交给 `TrackPlayer`
 *  - 导航类：需要路由，由路由层在挂载时提供执行函数（见 `actions.ts`）
 */
import { KeyBinding } from "@/core/keyboard";

/** 动作 id */
export type ShortcutActionId =
    | "playPause"
    | "playNext"
    | "playPrevious"
    | "seekForward"
    | "seekBackward"
    | "favorite"
    | "openSearch"
    | "openSetting"
    | "pageUp"
    | "pageDown";

/** 动作的展示信息（设置页、冲突提示用） */
export interface ShortcutActionMeta {
    id: ShortcutActionId;
    /** 是否允许改绑 */
    rebindable: boolean;
    /** 默认键位（可多个） */
    defaultKeys: KeyBinding[];
    /** 中文描述（设置页主标题） */
    description: string;
}

/**
 * 动作表。
 *
 * 键位遵循桌面版语义并补充 Android 媒体键：
 *  - Space 播放/暂停、←/→ 在播放栏内为快退/快进
 *  - 媒体键直接映射标准语义，方便蓝牙耳机 / 遥控器
 */
export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
    {
        id: "playPause",
        rebindable: true,
        defaultKeys: ["space", "mediaPlayPause", "gamepadA"],
        description: "播放 / 暂停",
    },
    {
        id: "playNext",
        rebindable: true,
        defaultKeys: ["mediaNext", "gamepadR1"],
        description: "下一首",
    },
    {
        id: "playPrevious",
        rebindable: true,
        defaultKeys: ["mediaPrevious", "gamepadL1"],
        description: "上一首",
    },
    {
        id: "seekForward",
        rebindable: true,
        defaultKeys: ["mediaFastForward", "gamepadR2"],
        description: "快进 10 秒",
    },
    {
        id: "seekBackward",
        rebindable: true,
        defaultKeys: ["mediaRewind", "gamepadL2"],
        description: "快退 10 秒",
    },
    {
        id: "favorite",
        rebindable: true,
        defaultKeys: ["ctrl+f", "gamepadY"],
        description: "收藏当前歌曲",
    },
    {
        id: "openSearch",
        rebindable: true,
        defaultKeys: ["ctrl+k", "gamepadX"],
        description: "打开搜索",
    },
    {
        id: "openSetting",
        rebindable: true,
        defaultKeys: ["ctrl+comma"],
        description: "打开设置",
    },
    {
        id: "pageUp",
        rebindable: true,
        defaultKeys: ["pageUp"],
        description: "列表向上翻页",
    },
    {
        id: "pageDown",
        rebindable: true,
        defaultKeys: ["pageDown"],
        description: "列表向下翻页",
    },
];

/** 动作 id → 定义 */
export const SHORTCUT_ACTION_MAP: Record<string, ShortcutActionMeta> =
    SHORTCUT_ACTIONS.reduce(
        (acc, action) => {
            acc[action.id] = action;
            return acc;
        },
        {} as Record<string, ShortcutActionMeta>,
    );

/** 键位映射：KeyBinding → 动作 id（默认值） */
export function createDefaultKeyMap(): Record<KeyBinding, ShortcutActionId> {
    const map: Record<KeyBinding, ShortcutActionId> = {};
    SHORTCUT_ACTIONS.forEach(action => {
        action.defaultKeys.forEach(key => {
            map[key] = action.id;
        });
    });
    return map;
}

/**
 * 不可改绑 / 固定用于焦点导航的键位前缀。
 *
 * 方向键固定用于焦点移动（与桌面版一致），不允许绑成动作，
 * 否则「移动焦点」与「触发动作」会互相打架。
 */
export const FOCUS_RESERVED_KEYS = [
    "up",
    "down",
    "left",
    "right",
    "enter",
    "confirm",
    "escape",
    "back",
];

/** 判断某个键位是否被保留给焦点导航 */
export function isFocusReservedKey(binding: string): boolean {
    return FOCUS_RESERVED_KEYS.includes(binding);
}

/** 某键位可绑定的动作列表（设置页选择用） */
export function getBindableActions(): ShortcutActionMeta[] {
    return SHORTCUT_ACTIONS.filter(_ => _.rebindable);
}
