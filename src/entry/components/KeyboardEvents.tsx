import React, { useEffect, useRef } from "react";
import {
    useHardwareKeyPress,
    useKeyboardEnabled,
    useKeyboardDebugLog,
    type HardwareKeyContext,
} from "@/core/keyboard";
import { isKeyboardBridgeAvailable, keyboardLog } from "@/core/keyboard/native";
import { ARROW_DIRECTION, getFocusable, getCurrentFocusId, moveFocus } from "@/core/focus";
import {
    registerShortcutNavigator,
    resolveKeyAction,
    runShortcutAction,
    setupShortcut,
    type ShortcutActionId,
} from "@/core/shortcut";
import {
    ROUTE_PATH,
    useNavigate,
} from "@/core/router";
import { MUSIC_BAR_FOCUS_GROUP } from "@/components/musicBar";
import { invalidateFocusLayout } from "@/core/focus";

/**
 * 硬件按键体系挂载点（必须常驻在 NavigationContainer 内）。
 *
 * 挂载后：
 *  1. 开启原生按键拦截（`useKeyboardEnabled`）并订阅原生事件
 *  2. 方向键 → 几何焦点导航
 *  3. 其余键位 → 快捷键动作（`src/core/shortcut`）
 *
 * 优先级（数值越小越先执行）：
 *  OVERLAY(10) 浮层 > PAGE(100) 页面/播放栏 > FOCUS(500) 焦点导航
 *  > SHORTCUT(900) 快捷键
 */
export default function KeyboardEvents() {
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;

    useKeyboardEnabled();
    useKeyboardDebugLog();

    // 加载用户键位配置（幂等）
    useEffect(() => {
        setupShortcut();
    }, []);

    // 给快捷键体系注入路由能力（保持 core 层不依赖导航）
    useEffect(() => {
        return registerShortcutNavigator({
            openSearch: () => navigateRef.current(ROUTE_PATH.SEARCH_PAGE),
            openSetting: () => navigateRef.current(ROUTE_PATH.SETTING),
        });
    }, []);

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
            return true;
        },
        [],
        500,
        "KeyboardEvents.arrowFocus",
    );

    // 快捷键动作
    useHardwareKeyPress(
        (context: HardwareKeyContext) => {
            // 翻页类动作需要调用方自己处理（焦点导航由列表宿主负责）
            const binding = context.binding;
            if (!binding) {
                return false;
            }
            const actionId = resolveKeyAction(binding);
            if (!actionId) {
                return false;
            }

            // 播放栏内的 ←→ 已经由播放栏自己处理（快退/快进），此处跳过
            if (
                (actionId === "seekForward" || actionId === "seekBackward") &&
                isFocusInMusicBar()
            ) {
                return false;
            }

            runShortcutAction(actionId)
                .then(handled => {
                    keyboardLog(
                        "Shortcut",
                        `${binding} -> ${actionId} handled=${handled}`,
                    );
                })
                .catch(e => {
                    keyboardLog("Shortcut", `${binding} error ${String(e)}`);
                });
            return true;
        },
        [],
        900,
        "KeyboardEvents.shortcut",
    );

    // 焦点信息变化后让坐标缓存失效由列表自身的 onScroll 负责；
    // 这里只在页面切换时兜底清理一次
    useEffect(() => {
        return () => invalidateFocusLayout();
    }, []);

    return null;
}

/** 当前焦点是否在播放栏内 */
function isFocusInMusicBar(): boolean {
    const focusId = getCurrentFocusId();
    if (!focusId) {
        return false;
    }
    return getFocusable(focusId)?.group === MUSIC_BAR_FOCUS_GROUP;
}
