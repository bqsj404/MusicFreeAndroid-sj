/**
 * Focusable —— 给任意可点击组件套上「硬件键盘 / 遥控器焦点」能力。
 *
 * 用法：
 * ```tsx
 * <Focusable focusId={`song-${index}`} group="song-list" index={index} onPress={...}>
 *   <ListItem ... />
 * </Focusable>
 * ```
 *
 * 说明：
 *  - 默认渲染 `TouchableOpacity`；也可以用 `component` 换成别的宿主组件
 *  - `ref` 指向宿主组件本身，`measure` / `focus` 都由它提供
 *  - 焦点样式由 `Theme` 的 primary 色描边 + 半透明底色构成，
 *    **不做**桌面版「连按 3 次导航键才显示」的门控（Android 上没必要）
 */
import React, { ReactNode } from "react";
import {
    StyleProp,
    StyleSheet,
    TouchableOpacity,
    View,
    ViewStyle,
} from "react-native";
import Theme from "@/core/theme";
import { useFocusable } from "./hooks";

export interface FocusableProps {
    /** 稳定唯一 id */
    focusId: string;
    /** 焦点组名（同组按 index 顺序导航） */
    group?: string;
    /** 组内序号 */
    index?: number;
    /** 是否参与焦点导航 */
    enabled?: boolean;
    /** 宿主组件类型，默认 TouchableOpacity */
    component?: React.ComponentType<any> | React.ElementType;
    /** 外层样式 */
    style?: StyleProp<ViewStyle>;
    /** 焦点态附加样式（覆盖默认焦点环） */
    focusStyle?: StyleProp<ViewStyle>;
    /** 是否显示默认焦点环（默认 true） */
    showFocusRing?: boolean;
    onPress?: (evt?: any) => void;
    onLongPress?: (evt?: any) => void;
    onPressIn?: (evt?: any) => void;
    children?: ReactNode;
    [key: string]: any;
}

export function useFocusRingStyle(): ViewStyle {
    const theme = Theme.useTheme();
    return {
        borderColor: theme.colors.primary,
        borderWidth: 2,
        backgroundColor: theme.colors.listActive,
    };
}

export default function Focusable(props: FocusableProps) {
    const {
        focusId,
        group,
        index,
        enabled = true,
        component: Component = TouchableOpacity,
        style,
        focusStyle,
        showFocusRing = true,
        onPress,
        onLongPress,
        onPressIn,
        children,
        ...rest
    } = props;

    const theme = Theme.useTheme();
    const defaultFocusStyle: ViewStyle = {
        borderColor: theme.colors.primary,
        borderWidth: 2,
        backgroundColor: theme.colors.listActive,
    };

    const focusable = useFocusable({
        focusId,
        group,
        index,
        enabled,
        focusStyle:
            showFocusRing && enabled
                ? (focusStyle as ViewStyle) ?? defaultFocusStyle
                : undefined,
        style,
    });

    return (
        <Component
            {...rest}
            ref={focusable.ref}
            focusable={focusable.focusable}
            style={focusable.style}
            onFocus={focusable.onFocus}
            onBlur={focusable.onBlur}
            onPressIn={(evt: any) => {
                focusable.onPressIn();
                onPressIn?.(evt);
            }}
            onPress={onPress}
            onLongPress={onLongPress}>
            {children}
        </Component>
    );
}

/** 焦点环样式工具（供不方便用 Focusable 的场景手写） */
export const focusStyles = StyleSheet.create({
    ring: {
        borderWidth: 2,
    },
});

export { View };
