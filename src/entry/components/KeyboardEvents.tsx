import React, { useEffect } from "react";
import {
    useHardwareKeyPress,
    useKeyboardEnabled,
    KEY_PRIORITY,
} from "@/core/keyboard";
import {
    isKeyboardBridgeAvailable,
    keyboardLog,
} from "@/core/keyboard/native";
import { ARROW_DIRECTION, moveFocus } from "@/core/focus";

/**
 * 硬件按键体系挂载点。
 *
 * 挂载后：
 *  1. 打开原生层的按键拦截（方向键 / 媒体键 / 手柄键转发到 JS）
 *  2. 方向键 → 几何焦点导航（`src/core/focus`）
 *  3. dev 构建下输出根级按键日志（便于 `adb logcat | Select-String "[Keyboard]"` 排查）
 *
 * 后续的快捷键动作（第 2.4 步）会以更低的优先级注册在这里。
 */
export default function KeyboardEvents() {
    useKeyboardEnabled();

    useEffect(() => {
        keyboardLog(
            "Mount",
            `KeyboardEvents mounted, bridge=${isKeyboardBridgeAvailable()}`,
        );
    }, []);

    // 方向键 → 焦点导航（优先级高于快捷键，低于浮层）
    useHardwareKeyPress(
        context => {
            const direction = context.semanticKey
                ? ARROW_DIRECTION[context.semanticKey]
                : undefined;
            if (!direction) {
                return false;
            }
            moveFocus(direction).then(result => {
                keyboardLog(
                    "Focus",
                    `${direction} -> ${result.moved ? result.targetId : "none"}`,
                );
            });
            // 先消费；若目标不存在，moveFocus 内部不会移动焦点，
            // 由原生层保持原焦点（不做二次系统跳动，避免抖动）
            return true;
        },
        [],
        KEY_PRIORITY.FOCUS,
        "KeyboardEvents.arrowFocus",
    );

    useHardwareKeyPress(
        context => {
            keyboardLog(
                "Key",
                JSON.stringify({
                    keyCode: context.event.keyCode,
                    semantic: context.semanticKey,
                    binding: context.binding,
                    repeat: context.event.repeatCount,
                }),
            );
            return false;
        },
        [],
        KEY_PRIORITY.SHORTCUT + 1000,
        "KeyboardEvents.rootLog",
    );

    return null;
}
