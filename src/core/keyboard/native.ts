/**
 * 原生键盘桥的原生模块封装。
 *
 * 对应 `android/app/src/main/java/fun/upup/musicfree/keyboard/KeyboardEventModule.kt`。
 */
import { NativeModules } from "react-native";

interface NativeKeyboardEventModule {
    /** JS 侧是否已接管按键（原生同步常量） */
    isEnabled?: boolean;
    /** 打开/关闭原生层按键拦截 */
    setEnabled: (value: boolean) => void;
    /** 写入 logcat（release 包下 console.log 不可见） */
    log?: (tag: string, message: string) => void;
    /** 按 reactTag 请求原生焦点（异步 post 到 UI 线程，无返回值） */
    requestFocus?: (reactTag: number) => void;
}

const NativeKeyboard = NativeModules.KeyboardEvent as
    | NativeKeyboardEventModule
    | undefined;

/**
 * JS 侧的状态镜像。
 *
 * 不能依赖 `NativeKeyboard.isEnabled`：原生常量只在模块初始化时取一次快照，
 * `setEnabled()` 之后不会更新，用它做判断会导致重复启用/永远关不掉。
 */
let enabledMirror = false;

/** 原生桥是否可用（未重新构建原生代码时为 false） */
export function isKeyboardBridgeAvailable(): boolean {
    return !!NativeKeyboard?.setEnabled;
}

/**
 * 启用/关闭原生按键拦截。
 *
 * 只有启用后，MainActivity 才会把方向键 / 媒体键 / 手柄键转发给 JS；
 * 在此之前方向键保持系统默认的焦点移动行为。
 */
export function setNativeKeyboardEnabled(value: boolean): boolean {
    if (!isKeyboardBridgeAvailable()) {
        return false;
    }
    NativeKeyboard!.setEnabled(value);
    enabledMirror = value;
    return true;
}

/** 当前原生是否处于拦截状态 */
export function isNativeKeyboardEnabled(): boolean {
    return enabledMirror;
}

/**
 * 把调试信息写进 logcat（`adb logcat -s MusicFreeKeyboard`）。
 *
 * release bundle 下 Hermes 不转发 `console.log`，因此键盘/焦点体系的
 * 内部状态统一走这个通道，便于真机排查。
 */
export function keyboardLog(tag: string, message: unknown) {
    try {
        NativeKeyboard?.log?.(tag, typeof message === "string" ? message : JSON.stringify(message));
    } catch (e) {
        // 日志失败不影响功能
    }
}

/**
 * 按 reactTag 请求原生焦点（异步，无返回值）。
 *
 * `TouchableOpacity` 等类组件实例上没有 `focus()`，只能落到原生 View 上，
 * 因此焦点移动统一走这个通道。
 */
export function requestNativeFocus(reactTag: number) {
    try {
        NativeKeyboard?.requestFocus?.(reactTag);
    } catch (e) {
        // 忽略：焦点失败不影响 JS 侧焦点态
    }
}
