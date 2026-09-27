/**
 * 焦点状态的 React 绑定。
 *
 * 每个焦点元素只关心「焦点是否在我身上」，因此这里用
 * `useSyncExternalStore` 订阅全局焦点 id，并在订阅回调里**只在翻转时**
 * `setState`，避免全量重渲染。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
    findNodeHandle,
    UIManager,
    ViewStyle,
} from "react-native";
import {
    keyboardLog,
    requestNativeFocus,
} from "@/core/keyboard/native";
import {
    FocusableItem,
    FocusRect,
    getCurrentFocusId,
    getFocusable,
    invalidateMeasureCache,
    registerFocusable,
    setCurrentFocusId,
    subscribeFocus,
} from "./registry";

/**
 * 订阅「当前焦点是否是 focusId」。
 *
 * @param focusId 关注的元素 id
 * @returns 是否聚焦
 */
export function useIsFocused(focusId: string): boolean {
    const [focused, setFocused] = useState(
        () => getCurrentFocusId() === focusId,
    );

    useEffect(() => {
        const sync = () => {
            const next = getCurrentFocusId() === focusId;
            setFocused(prev => (prev === next ? prev : next));
        };
        sync();
        return subscribeFocus(sync);
    }, [focusId]);

    return focused;
}

/** 订阅全局当前焦点 id（用于根级组件） */
export function useCurrentFocusId(): string | null {
    const [id, setId] = useState<string | null>(() => getCurrentFocusId());
    useEffect(() => {
        const sync = () => {
            const next = getCurrentFocusId();
            setId(prev => (prev === next ? prev : next));
        };
        sync();
        return subscribeFocus(sync);
    }, []);
    return id;
}

/**
 * 测量宿主 View 在屏幕上的位置。
 *
 * 走 `findNodeHandle` + `UIManager.measureInWindow`：
 * `TouchableOpacity` / `TouchableHighlight` 的 ref 是类组件实例，
 * 实例上并没有 `measureInWindow`，必须转成原生 reactTag 再测量。
 */
function measureRef(ref: React.RefObject<any>): Promise<FocusRect | null> {
    return new Promise(resolve => {
        const handle = safeFindNodeHandle(ref?.current);
        if (handle == null) {
            keyboardLog("Measure", "findNodeHandle -> null");
            resolve(null);
            return;
        }
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                keyboardLog("Measure", `measureInWindow timeout tag=${handle}`);
                resolve(null);
            }
        }, 1200);
        try {
            UIManager.measureInWindow(
                handle,
                (x: number, y: number, width: number, height: number) => {
                    if (done) {
                        return;
                    }
                    done = true;
                    clearTimeout(timer);
                    if (!width || !height || !isFinite(x)) {
                        keyboardLog(
                            "Measure",
                            `invalid rect x=${x} y=${y} w=${width} h=${height}`,
                        );
                        resolve(null);
                        return;
                    }
                    resolve({ x, y, width, height });
                },
            );
        } catch (e) {
            done = true;
            clearTimeout(timer);
            keyboardLog("Measure", `throw ${String(e)}`);
            resolve(null);
        }
    });
}

/** 安全地取 reactTag（组件卸载 / 类型不符时返回 null） */
export function safeFindNodeHandle(instance: any): number | null {
    if (instance == null) {
        return null;
    }
    try {
        return findNodeHandle(instance) ?? null;
    } catch (e) {
        return null;
    }
}

/**
 * 让元素真正获得原生焦点。
 *
 * 只更新 JS 侧焦点状态不够——原生焦点不移动的话，
 * 系统自身的焦点导航与无障碍焦点都不会跟着走。
 *
 * @returns 是否已发出焦点请求
 */
export function focusByRef(ref: React.RefObject<any>): boolean {
    const node = ref?.current;
    if (!node) {
        return false;
    }
    if (typeof node.focus === "function") {
        try {
            node.focus();
            return true;
        } catch (e) {
            // 落到原生通道
        }
    }
    const handle = safeFindNodeHandle(node);
    if (handle == null) {
        return false;
    }
    requestNativeFocus(handle);
    return true;
}

export interface UseFocusableOptions {
    /** 稳定唯一 id（必须全局唯一） */
    focusId: string;
    /** 焦点组名（同组元素之间做顺序导航） */
    group?: string;
    /** 组内序号 */
    index?: number;
    /** 是否参与焦点导航，默认 true */
    enabled?: boolean;
    /** 获得焦点时附加的样式（与 `style` 合并，在 `style` 之前） */
    focusStyle?: ViewStyle;
    /** 元素原有的样式 */
    style?: any;
}

export interface FocusableResult {
    ref: React.RefObject<any>;
    /** 合并焦点高亮后的样式 */
    style: any;
    focusable: boolean;
    onFocus: () => void;
    onBlur: () => void;
    onPressIn: () => void;
    /** 主动请求焦点 */
    requestFocus: () => void;
    /** 当前是否聚焦 */
    focused: boolean;
}

/**
 * 让一个可点击元素支持硬件键盘 / 遥控器 / 手柄焦点。
 *
 * 用法（与 `TouchableOpacity` 等宿主组件配合）：
 * ```tsx
 * const focusable = useFocusable({ focusId, style: styles.item, focusStyle: styles.focusRing });
 * return (
 *   <TouchableOpacity
 *     ref={focusable.ref}
 *     focusable={focusable.focusable}
 *     style={focusable.style}
 *     onFocus={focusable.onFocus}
 *     onBlur={focusable.onBlur}
 *     onPressIn={focusable.onPressIn}
 *     onPress={onPress}
 *   />
 * );
 * ```
 */
export function useFocusable(options: UseFocusableOptions): FocusableResult {
    const { focusId, group, index, enabled = true, focusStyle, style } = options;

    const ref = useRef<any>(null);
    const focused = useIsFocused(focusId);
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const measure = useCallback(() => measureRef(ref), []);
    const requestFocus = useCallback(() => {
        focusByRef(ref);
    }, []);

    // 注册到焦点注册表
    useEffect(() => {
        if (!enabled) {
            return;
        }
        const unregister = registerFocusable({
            id: focusId,
            group,
            index,
            measure,
            focus: requestFocus,
            navigable: () => optionsRef.current.enabled !== false,
        });
        return unregister;
    }, [focusId, enabled, group, index, measure, requestFocus]);

    const onFocus = useCallback(() => {
        setCurrentFocusId(focusId);
    }, [focusId]);

    const onBlur = useCallback(() => {
        // 不做清空：焦点在元素之间转移时，新元素的 onFocus 会覆盖旧值；
        // 真正需要清空的场景（元素卸载）由 registerFocusable 的注销逻辑处理。
    }, []);

    const onPressIn = useCallback(() => {
        // 触屏点击时同步焦点，保证「焦点环 = 上次交互元素」
        requestFocus();
        setCurrentFocusId(focusId);
    }, [focusId, requestFocus]);

    return {
        ref,
        style: focused && focusStyle ? [focusStyle, style] : style,
        focusable: enabled,
        onFocus,
        onBlur,
        onPressIn,
        requestFocus,
        focused,
    };
}

/** 取某个元素的注册信息（例如宿主组件要转发滚动） */
export function getFocusableItem(id: string) {
    return getFocusable(id);
}

/** 让焦点坐标缓存失效（列表滚动后调用） */
export function invalidateFocusLayout() {
    invalidateMeasureCache();
}
