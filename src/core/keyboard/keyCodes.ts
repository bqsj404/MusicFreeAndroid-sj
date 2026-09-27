/**
 * 硬件按键键码表与语义键定义。
 *
 * 键码取自 Android `android.view.KeyEvent` 常量（原生桥直接透传 keyCode），
 * 覆盖三类输入设备：
 *  - 物理键盘（含外接/蓝牙键盘）
 *  - Android TV 遥控器（DPAD_* 与键盘方向键同码）
 *  - 游戏手柄（BUTTON_*）
 */

/** 事件类型 */
export type HardwareKeyType = "key";

/** 按键动作，对应 Android KeyEvent.ACTION_DOWN / ACTION_UP */
export type HardwareKeyAction = 0 | 1;

/** 原生桥推送的原始事件 */
export interface HardwareKeyEvent {
    type: HardwareKeyType;
    /** Android KeyEvent.keyCode */
    keyCode: number;
    /** 0 = DOWN，1 = UP */
    action: HardwareKeyAction;
    /** 长按重复次数，首次按下为 0 */
    repeatCount: number;
    /** 字符键的 unicode 码（无字符为 0） */
    unicodeChar: number;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    timestamp: number;
}

/** 输入设备类型（按 keyCode 推断，用于 UI 提示与手柄长按等差异行为） */
export type KeyboardDeviceKind = "keyboard" | "dpad" | "gamepad" | "media";

/** 语义键名（与具体键码解耦，供快捷键映射与焦点导航使用） */
export type SemanticKey =
    | "up"
    | "down"
    | "left"
    | "right"
    | "enter"
    | "confirm"
    | "numpadEnter"
    | "space"
    | "escape"
    | "tab"
    | "back"
    | "home"
    | "end"
    | "pageUp"
    | "pageDown"
    | "insert"
    | "delete"
    | "volumeUp"
    | "volumeDown"
    | "mute"
    | "mediaPlayPause"
    | "mediaPlay"
    | "mediaPause"
    | "mediaStop"
    | "mediaNext"
    | "mediaPrevious"
    | "mediaRewind"
    | "mediaFastForward"
    | "gamepadA"
    | "gamepadB"
    | "gamepadX"
    | "gamepadY"
    | "gamepadL1"
    | "gamepadR1"
    | "gamepadL2"
    | "gamepadR2"
    | "gamepadStart"
    | "gamepadSelect"
    | "gamepadL3"
    | "gamepadR3";

/** 带修饰键的完整键位标识，例如 `space`、`ctrl+left`、`shift+mediaNext` */
export type KeyBinding = string;

/** Android KeyEvent 键码常量 */
export const AndroidKeyCode = {
    DPAD_UP: 19,
    DPAD_DOWN: 20,
    DPAD_LEFT: 21,
    DPAD_RIGHT: 22,
    DPAD_CENTER: 23,

    A: 29,
    B: 30,
    C: 31,
    D: 32,
    E: 33,
    F: 34,
    G: 35,
    H: 36,
    I: 37,
    J: 38,
    K: 39,
    L: 40,
    M: 41,
    N: 42,
    O: 43,
    P: 44,
    Q: 45,
    R: 46,
    S: 47,
    T: 48,
    U: 49,
    V: 50,
    W: 51,
    X: 52,
    Y: 53,
    Z: 54,

    DIGIT_0: 7,
    DIGIT_1: 8,
    DIGIT_2: 9,
    DIGIT_3: 10,
    DIGIT_4: 11,
    DIGIT_5: 12,
    DIGIT_6: 13,
    DIGIT_7: 14,
    DIGIT_8: 15,
    DIGIT_9: 16,

    SPACE: 62,
    ENTER: 66,
    NUMPAD_ENTER: 160,
    ESCAPE: 111,
    TAB: 61,
    DEL: 67,
    FORWARD_DEL: 112,
    INSERT: 124,
    MOVE_HOME: 122,
    MOVE_END: 123,
    PAGE_UP: 92,
    PAGE_DOWN: 93,

    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    VOLUME_MUTE: 164,

    MEDIA_PLAY_PAUSE: 85,
    MEDIA_PLAY: 126,
    MEDIA_PAUSE: 127,
    MEDIA_STOP: 86,
    MEDIA_NEXT: 87,
    MEDIA_PREVIOUS: 88,
    MEDIA_REWIND: 89,
    MEDIA_FAST_FORWARD: 90,

    BUTTON_A: 96,
    BUTTON_B: 97,
    BUTTON_X: 99,
    BUTTON_Y: 100,
    BUTTON_L1: 102,
    BUTTON_R1: 103,
    BUTTON_L2: 104,
    BUTTON_R2: 105,
    BUTTON_THUMBL: 106,
    BUTTON_THUMBR: 107,
    BUTTON_START: 108,
    BUTTON_SELECT: 109,

    BACK: 4,
    MENU: 82,
} as const;

/** keyCode → 语义键 */
const KEY_CODE_TO_SEMANTIC: Record<number, SemanticKey> = {
    [AndroidKeyCode.DPAD_UP]: "up",
    [AndroidKeyCode.DPAD_DOWN]: "down",
    [AndroidKeyCode.DPAD_LEFT]: "left",
    [AndroidKeyCode.DPAD_RIGHT]: "right",
    [AndroidKeyCode.DPAD_CENTER]: "confirm",
    [AndroidKeyCode.ENTER]: "enter",
    [AndroidKeyCode.NUMPAD_ENTER]: "numpadEnter",
    [AndroidKeyCode.SPACE]: "space",
    [AndroidKeyCode.ESCAPE]: "escape",
    [AndroidKeyCode.TAB]: "tab",
    [AndroidKeyCode.BACK]: "back",
    [AndroidKeyCode.MOVE_HOME]: "home",
    [AndroidKeyCode.MOVE_END]: "end",
    [AndroidKeyCode.PAGE_UP]: "pageUp",
    [AndroidKeyCode.PAGE_DOWN]: "pageDown",
    [AndroidKeyCode.INSERT]: "insert",
    [AndroidKeyCode.DEL]: "delete",
    [AndroidKeyCode.FORWARD_DEL]: "delete",
    [AndroidKeyCode.VOLUME_UP]: "volumeUp",
    [AndroidKeyCode.VOLUME_DOWN]: "volumeDown",
    [AndroidKeyCode.VOLUME_MUTE]: "mute",
    [AndroidKeyCode.MEDIA_PLAY_PAUSE]: "mediaPlayPause",
    [AndroidKeyCode.MEDIA_PLAY]: "mediaPlay",
    [AndroidKeyCode.MEDIA_PAUSE]: "mediaPause",
    [AndroidKeyCode.MEDIA_STOP]: "mediaStop",
    [AndroidKeyCode.MEDIA_NEXT]: "mediaNext",
    [AndroidKeyCode.MEDIA_PREVIOUS]: "mediaPrevious",
    [AndroidKeyCode.MEDIA_REWIND]: "mediaRewind",
    [AndroidKeyCode.MEDIA_FAST_FORWARD]: "mediaFastForward",
    [AndroidKeyCode.BUTTON_A]: "gamepadA",
    [AndroidKeyCode.BUTTON_B]: "gamepadB",
    [AndroidKeyCode.BUTTON_X]: "gamepadX",
    [AndroidKeyCode.BUTTON_Y]: "gamepadY",
    [AndroidKeyCode.BUTTON_L1]: "gamepadL1",
    [AndroidKeyCode.BUTTON_R1]: "gamepadR1",
    [AndroidKeyCode.BUTTON_L2]: "gamepadL2",
    [AndroidKeyCode.BUTTON_R2]: "gamepadR2",
    [AndroidKeyCode.BUTTON_START]: "gamepadStart",
    [AndroidKeyCode.BUTTON_SELECT]: "gamepadSelect",
    [AndroidKeyCode.BUTTON_THUMBL]: "gamepadL3",
    [AndroidKeyCode.BUTTON_THUMBR]: "gamepadR3",
};

/** 手柄按键集合 */
const GAMEPAD_KEY_CODES: Set<number> = new Set([
    AndroidKeyCode.BUTTON_A,
    AndroidKeyCode.BUTTON_B,
    AndroidKeyCode.BUTTON_X,
    AndroidKeyCode.BUTTON_Y,
    AndroidKeyCode.BUTTON_L1,
    AndroidKeyCode.BUTTON_R1,
    AndroidKeyCode.BUTTON_L2,
    AndroidKeyCode.BUTTON_R2,
    AndroidKeyCode.BUTTON_START,
    AndroidKeyCode.BUTTON_SELECT,
    AndroidKeyCode.BUTTON_THUMBL,
    AndroidKeyCode.BUTTON_THUMBR,
]);

/** 媒体键集合 */
const MEDIA_KEY_CODES: Set<number> = new Set([
    AndroidKeyCode.MEDIA_PLAY_PAUSE,
    AndroidKeyCode.MEDIA_PLAY,
    AndroidKeyCode.MEDIA_PAUSE,
    AndroidKeyCode.MEDIA_STOP,
    AndroidKeyCode.MEDIA_NEXT,
    AndroidKeyCode.MEDIA_PREVIOUS,
    AndroidKeyCode.MEDIA_REWIND,
    AndroidKeyCode.MEDIA_FAST_FORWARD,
    AndroidKeyCode.VOLUME_UP,
    AndroidKeyCode.VOLUME_DOWN,
    AndroidKeyCode.VOLUME_MUTE,
]);

/** 方向 / 确认类按键（遥控器与方向键同码） */
const DPAD_KEY_CODES: Set<number> = new Set([
    AndroidKeyCode.DPAD_UP,
    AndroidKeyCode.DPAD_DOWN,
    AndroidKeyCode.DPAD_LEFT,
    AndroidKeyCode.DPAD_RIGHT,
    AndroidKeyCode.DPAD_CENTER,
]);

/** 取语义键名；未登记的键返回 undefined */
export function keyCodeToSemanticKey(keyCode: number): SemanticKey | undefined {
    return KEY_CODE_TO_SEMANTIC[keyCode];
}

/** 修饰键前缀（Ctrl / Alt / Shift），按固定顺序拼接 */
export function modifierPrefix(event: {
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
}): string {
    const parts: string[] = [];
    if (event.ctrl) {
        parts.push("ctrl");
    }
    if (event.alt) {
        parts.push("alt");
    }
    if (event.shift) {
        parts.push("shift");
    }
    return parts.length ? `${parts.join("+")}+` : "";
}

/**
 * 把原始事件归一成键位标识（含修饰键），例如 `space`、`ctrl+left`。
 * 未登记的键返回 undefined。
 */
export function toKeyBinding(
    event: Pick<HardwareKeyEvent, "keyCode" | "ctrl" | "alt" | "shift">,
): KeyBinding | undefined {
    const semantic = keyCodeToSemanticKey(event.keyCode);
    if (!semantic) {
        return undefined;
    }
    return `${modifierPrefix(event)}${semantic}`;
}

/** 按 keyCode 推断输入设备类型 */
export function getDeviceKind(keyCode: number): KeyboardDeviceKind {
    if (GAMEPAD_KEY_CODES.has(keyCode)) {
        return "gamepad";
    }
    if (MEDIA_KEY_CODES.has(keyCode)) {
        return "media";
    }
    if (DPAD_KEY_CODES.has(keyCode)) {
        return "dpad";
    }
    return "keyboard";
}

/** 判断是否方向键（含遥控器 D-pad） */
export function isArrowKey(keyCode: number): boolean {
    return (
        keyCode === AndroidKeyCode.DPAD_UP ||
        keyCode === AndroidKeyCode.DPAD_DOWN ||
        keyCode === AndroidKeyCode.DPAD_LEFT ||
        keyCode === AndroidKeyCode.DPAD_RIGHT
    );
}

/** 判断是否确认键（Enter / 遥控器 OK / 手柄 A） */
export function isConfirmKey(keyCode: number): boolean {
    return (
        keyCode === AndroidKeyCode.ENTER ||
        keyCode === AndroidKeyCode.NUMPAD_ENTER ||
        keyCode === AndroidKeyCode.DPAD_CENTER ||
        keyCode === AndroidKeyCode.BUTTON_A
    );
}

/** 键位可读名称，用于设置页展示（无需 i18n） */
export const KEY_BINDING_LABELS: Record<string, string> = {
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    enter: "Enter",
    confirm: "OK / 确认",
    numpadEnter: "Numpad Enter",
    space: "Space",
    escape: "Esc",
    tab: "Tab",
    back: "Back",
    home: "Home",
    end: "End",
    pageUp: "PageUp",
    pageDown: "PageDown",
    insert: "Insert",
    delete: "Delete",
    volumeUp: "音量 +",
    volumeDown: "音量 −",
    mute: "静音",
    mediaPlayPause: "Media ⏯",
    mediaPlay: "Media ▶",
    mediaPause: "Media ⏸",
    mediaStop: "Media ⏹",
    mediaNext: "Media ⏭",
    mediaPrevious: "Media ⏮",
    mediaRewind: "Media ⏪",
    mediaFastForward: "Media ⏩",
    gamepadA: "手柄 A",
    gamepadB: "手柄 B",
    gamepadX: "手柄 X",
    gamepadY: "手柄 Y",
    gamepadL1: "手柄 L1",
    gamepadR1: "手柄 R1",
    gamepadL2: "手柄 L2",
    gamepadR2: "手柄 R2",
    gamepadStart: "手柄 Start",
    gamepadSelect: "手柄 Select",
    gamepadL3: "手柄 L3",
    gamepadR3: "手柄 R3",
};

/** 取键位展示名（未登记时回退为原字符串） */
export function getKeyBindingLabel(binding: string): string {
    return KEY_BINDING_LABELS[binding] ?? binding;
}

/**
 * 可用于绑定的全部键位（设置页选项来源）。
 * 不含方向键（方向键固定用于焦点导航，不允许改绑）。
 */
export const BINDABLE_KEYS: KeyBinding[] = [
    "space",
    "enter",
    "numpadEnter",
    "escape",
    "mediaPlayPause",
    "mediaPlay",
    "mediaPause",
    "mediaStop",
    "mediaNext",
    "mediaPrevious",
    "mediaRewind",
    "mediaFastForward",
    "volumeUp",
    "volumeDown",
    "mute",
    "gamepadA",
    "gamepadB",
    "gamepadX",
    "gamepadY",
    "gamepadL1",
    "gamepadR1",
    "gamepadL2",
    "gamepadR2",
    "gamepadStart",
    "gamepadSelect",
    "pageUp",
    "pageDown",
    "home",
    "end",
];
