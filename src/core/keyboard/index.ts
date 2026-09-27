/**
 * 硬件键盘 / TV 遥控器 / 游戏手柄 的统一入口。
 *
 * 模块分层：
 *  - `keyCodes.ts`  键码表与语义键
 *  - `native.ts`    原生桥封装（启用拦截）
 *  - `registry.ts`  事件分发、优先级与分层
 *  - `hooks.ts`     React Hook
 *
 * 使用方式：
 * ```ts
 * import Keyboard, { useKeyboardEnabled } from "@/core/keyboard";
 *
 * // 焦点体系入口组件挂载时开启
 * useKeyboardEnabled();
 * ```
 */
import {
    registerKeyHandler,
    registerKeyHandlers,
    setupKeyboardBridge,
    teardownKeyboardBridge,
    pushKeyLayer,
    hasActiveKeyLayer,
    setKeyboardDevLogging,
    isKeyboardDevLoggingEnabled,
    getLastHardwareKeyEvent,
    KEY_PRIORITY,
} from "./registry";
import {
    isKeyboardBridgeAvailable,
    isNativeKeyboardEnabled,
    setNativeKeyboardEnabled,
} from "./native";

const Keyboard = {
    /** 初始化事件订阅（幂等） */
    setup: setupKeyboardBridge,
    teardown: teardownKeyboardBridge,
    /** 打开/关闭原生按键拦截 */
    enable: setNativeKeyboardEnabled,
    isEnabled: isNativeKeyboardEnabled,
    isBridgeAvailable: isKeyboardBridgeAvailable,
    /** 注册按键处理器 */
    registerKeyHandler,
    registerKeyHandlers,
    /** 分层 */
    pushKeyLayer,
    hasActiveKeyLayer,
    /** 调试 */
    setDevLogging: setKeyboardDevLogging,
    isDevLoggingEnabled: isKeyboardDevLoggingEnabled,
    getLastEvent: getLastHardwareKeyEvent,
    PRIORITY: KEY_PRIORITY,
};

export { KEY_PRIORITY };
export * from "./keyCodes";
export * from "./hooks";
export type { HardwareKeyContext, HardwareKeyHandler } from "./registry";
export default Keyboard;
