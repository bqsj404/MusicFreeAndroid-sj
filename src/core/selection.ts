import { useCallback, useMemo, useRef, useState } from "react";
import {
    AndroidKeyCode,
    useHardwareKeyPress,
    KEY_PRIORITY,
} from "./keyboard";

/**
 * 通用多选语义（D15）。
 *
 * 桌面版的多选依赖 `Ctrl / Shift / Ctrl+A / Esc` 这一套键位语义。
 * Android 上触摸、遥控器、手柄、外接键盘并存，所以这里把语义统一成
 * **一份状态 + 三种输入**：
 *
 * | 语义 | 触摸 | 键盘/遥控器 |
 * |---|---|---|
 * | 进入多选 | 长按列表项 | `space`（切换当前项并进入） |
 * | 选中/取消 | 点击 | `space` |
 * | 范围选择 | 长按后拖动（由调用方传入） | `shift + up/down` |
 * | 全选 | 操作栏按钮 | `ctrl + a` |
 * | 反选 | 操作栏按钮 | `ctrl + i` |
 * | 退出 | 返回键 / 操作栏 | `escape` / `back` |
 *
 * 「范围选择」需要知道**可见顺序**，所以调用方要提供 `order`
 * （通常是当前筛选后的 key 列表）——这也把 D15 的「筛选」与多选串起来了：
 * 筛选之后，全选与范围选都只作用于可见项。
 */

export interface ISelectionOptions<T> {
    /** 当前可见（通常已筛选）的条目 */
    items: T[];
    /** 取条目的稳定键 */
    keyOf: (item: T) => string;
    /** 是否启用键盘语义（默认 true） */
    enableKeys?: boolean;
    /** 按键处理优先级 */
    priority?: number;
}

export interface ISelectionApi<T> {
    /** 是否处于多选模式 */
    selectMode: boolean;
    /** 已选键集合 */
    selectedKeys: Set<string>;
    /** 已选条目（按可见顺序） */
    selectedItems: T[];
    isSelected: (key: string) => boolean;
    /** 进入多选模式；可指定锚点 */
    enter: (anchorKey?: string) => void;
    /** 退出多选模式并清空选择 */
    exit: () => void;
    /** 切换某一项 */
    toggle: (key: string) => void;
    /** 全选（仅当前可见项） */
    selectAll: () => void;
    /** 清空选择（仍留在多选模式） */
    clear: () => void;
    /** 反选（仅当前可见项） */
    invert: () => void;
    /** 以锚点扩展到某一项（Shift+方向键 / 长按拖动） */
    extendTo: (key: string) => void;
    /** 设置锚点 */
    setAnchor: (key: string | null) => void;
}

export function useSelection<T>(
    options: ISelectionOptions<T>,
): ISelectionApi<T> {
    const { items, keyOf, enableKeys = true, priority } = options;
    const [selectMode, setSelectMode] = useState(false);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
        () => new Set(),
    );
    /** 范围选择的锚点 */
    const anchorRef = useRef<string | null>(null);

    /** 可见键顺序：范围选择与「全选」都以此为准 */
    const visibleKeys = useMemo(() => items.map(keyOf), [items, keyOf]);

    const enter = useCallback((anchorKey?: string) => {
        setSelectMode(true);
        if (anchorKey) {
            anchorRef.current = anchorKey;
            setSelectedKeys(prev => {
                const next = new Set(prev);
                next.add(anchorKey);
                return next;
            });
        }
    }, []);

    const exit = useCallback(() => {
        setSelectMode(false);
        setSelectedKeys(new Set());
        anchorRef.current = null;
    }, []);

    const toggle = useCallback(
        (key: string) => {
            setSelectMode(true);
            anchorRef.current = key;
            setSelectedKeys(prev => {
                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        },
        [],
    );

    const selectAll = useCallback(() => {
        setSelectMode(true);
        setSelectedKeys(new Set(visibleKeys));
    }, [visibleKeys]);

    const clear = useCallback(() => {
        setSelectedKeys(new Set());
        anchorRef.current = null;
    }, []);

    const invert = useCallback(() => {
        setSelectMode(true);
        setSelectedKeys(prev => {
            const next = new Set<string>();
            visibleKeys.forEach(key => {
                if (!prev.has(key)) {
                    next.add(key);
                }
            });
            return next;
        });
    }, [visibleKeys]);

    const setAnchor = useCallback((key: string | null) => {
        anchorRef.current = key;
    }, []);

    /**
     * 从锚点扩展到 `key`（闭区间）。
     *
     * 若没有锚点，就把 `key` 当作锚点并选中它 —— 这样
     * `shift+down` 连续按第一次也能正常起步。
     */
    const extendTo = useCallback(
        (key: string) => {
            const anchor = anchorRef.current;
            if (!anchor) {
                anchorRef.current = key;
                setSelectedKeys(prev => new Set(prev).add(key));
                return;
            }
            const from = visibleKeys.indexOf(anchor);
            const to = visibleKeys.indexOf(key);
            if (from < 0 || to < 0) {
                setSelectedKeys(prev => new Set(prev).add(key));
                return;
            }
            const [start, end] = from <= to ? [from, to] : [to, from];
            const range = visibleKeys.slice(start, end + 1);
            setSelectedKeys(prev => {
                const next = new Set(prev);
                range.forEach(k => next.add(k));
                return next;
            });
        },
        [visibleKeys],
    );

    const selectedItems = useMemo(
        () => items.filter(item => selectedKeys.has(keyOf(item))),
        [items, selectedKeys, keyOf],
    );

    const isSelected = useCallback(
        (key: string) => selectedKeys.has(key),
        [selectedKeys],
    );

    // ——— 键盘语义 ———
    useHardwareKeyPress(
        context => {
            // Esc / 返回：退出多选（没在多选时不拦截，交给上层处理导航）
            if (context.semanticKey === "escape" || context.semanticKey === "back") {
                if (!selectMode) {
                    return false;
                }
                exit();
                return true;
            }

            // Ctrl+A 全选；Ctrl+I 反选。
            //
            // 这里**不能用 `binding` 判断**：`toKeyBinding()` 会先查语义键，
            // 而字母键没有语义键，于是字母键的 binding 恒为 undefined。
            // 所以只能直接看 keyCode。
            if (
                context.event.ctrl &&
                context.event.keyCode === AndroidKeyCode.A
            ) {
                selectAll();
                return true;
            }
            if (
                context.event.ctrl &&
                context.event.keyCode === AndroidKeyCode.I
            ) {
                invert();
                return true;
            }

            // Shift+上下：以锚点扩展范围
            if (
                context.event.shift &&
                (context.semanticKey === "up" || context.semanticKey === "down")
            ) {
                if (!selectMode) {
                    return false;
                }
                const focusKey = anchorRef.current;
                if (!focusKey) {
                    return false;
                }
                const idx = visibleKeys.indexOf(focusKey);
                if (idx < 0) {
                    return false;
                }
                const nextIdx =
                    context.semanticKey === "down"
                        ? Math.min(idx + 1, visibleKeys.length - 1)
                        : Math.max(idx - 1, 0);
                const nextKey = visibleKeys[nextIdx];
                if (!nextKey) {
                    return false;
                }
                // 锚点保持在起始项，焦点（anchorRef 之外的"当前项"）向前推进
                const anchor = anchorRef.current;
                extendTo(nextKey);
                // extendTo 可能改了 anchorRef（无锚点时），这里恢复为原锚点
                anchorRef.current = anchor ?? nextKey;
                return true;
            }

            // 空格：切换当前项（把锚点项视为"当前项"）
            if (context.semanticKey === "space") {
                const focusKey = anchorRef.current;
                if (focusKey) {
                    toggle(focusKey);
                    return true;
                }
                // 没有焦点项时，空格进入多选并选中第一项
                if (visibleKeys.length) {
                    enter(visibleKeys[0]);
                    return true;
                }
            }

            return false;
        },
        [selectMode, selectAll, invert, extendTo, toggle, enter, exit, visibleKeys],
        priority ?? KEY_PRIORITY.PAGE,
        "useSelection",
    );

    return {
        selectMode,
        selectedKeys,
        selectedItems,
        isSelected,
        enter,
        exit,
        toggle,
        selectAll,
        clear,
        invert,
        extendTo,
        setAnchor,
    };
}
