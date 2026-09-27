/**
 * 硬件按键相关的 React Hook。
 */
import { useEffect, useRef } from "react";
import {
    HardwareKeyContext,
    HardwareKeyHandler,
    registerKeyHandler,
    pushKeyLayer,
    setupKeyboardBridge,
} from "./registry";
import { isNativeKeyboardEnabled, setNativeKeyboardEnabled } from "./native";

/**
 * 注册一个按键处理器（组件卸载自动取消）。
 *
 * @param handler 处理器；返回 true 表示已消费，事件不再向下传递
 * @param deps    依赖数组，变化时重新注册
 */
export function useHardwareKey(handler: HardwareKeyHandler, deps: any[] = []) {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        return registerKeyHandler({
            name: handlerRef.current?.name ?? "anonymous",
            priority: handlerRef.current?.priority,
            handle: context => handlerRef.current?.handle(context),
        });
    }, deps);
}

/**
 * 注册一个按键处理器（回调形式），组件卸载自动取消。
 */
export function useHardwareKeyPress(
    onKey: (context: HardwareKeyContext) => boolean | void,
    deps: any[] = [],
    priority?: number,
    name = "useHardwareKeyPress",
) {
    const onKeyRef = useRef(onKey);
    onKeyRef.current = onKey;
    useEffect(() => {
        return registerKeyHandler({
            name,
            priority,
            handle: context => onKeyRef.current?.(context),
        });
    }, deps);
}

/**
 * 进入一个按键分层（例如浮层 / 弹窗打开期间）。
 *
 * 注册到该层的处理器优先于全局处理器执行；
 * 典型用法是让浮层接管方向键与确认键，Esc 则关闭浮层。
 *
 * @param active 是否激活（便于配合显隐状态直接传入）
 * @returns layer 值，传给 `useHardwareKey(handler, deps, layer)`
 */
export function useHardwareKeyLayer(active = true): number | undefined {
    const layerRef = useRef<{ layer: number; pop: () => void }>();
    if (!layerRef.current) {
        layerRef.current = pushKeyLayer();
    }

    useEffect(() => {
        if (!active) {
            return;
        }
        const { layer, pop } = pushKeyLayer();
        layerRef.current = { layer, pop };
        return () => {
            pop();
        };
    }, [active]);

    return active ? layerRef.current?.layer : undefined;
}

let keyboardConsumerCount = 0;

/**
 * 让原生层开始把硬件按键转发给 JS。
 *
 * 采用引用计数：只要还有组件在使用键盘体系，原生拦截就保持开启；
 * 全部卸载后恢复系统默认焦点行为。
 *
 * 注意：这里同时负责建立原生事件的订阅（`setupKeyboardBridge`），
 * 任何使用键盘体系的页面都必须经过本 hook 或显式调用 `Keyboard.setup()`，
 * 否则原生事件会「没人监听」。
 */
export function useKeyboardEnabled(enabled = true) {
    useEffect(() => {
        if (!enabled) {
            return;
        }
        setupKeyboardBridge();
        keyboardConsumerCount += 1;
        setEnabled(true);
        return () => {
            keyboardConsumerCount -= 1;
            if (keyboardConsumerCount <= 0) {
                keyboardConsumerCount = 0;
                setEnabled(false);
            }
        };
    }, [enabled]);
}

function setEnabled(value: boolean) {
    if (isNativeKeyboardEnabled() === value) {
        return;
    }
    setNativeKeyboardEnabled(value);
}
