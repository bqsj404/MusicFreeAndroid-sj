/**
 * FocusIconButton —— 带硬件键盘焦点环的图标按钮。
 *
 * 与 `Focusable` 的区别：`Icon` 是函数组件、不转发 ref，无法直接测量/聚焦，
 * 因此这里用一层 `View` 作为焦点宿主，把焦点环画在图标外面。
 */
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Theme from "@/core/theme";
import { useFocusable } from "./hooks";

export interface FocusIconButtonProps {
    focusId: string;
    group?: string;
    index?: number;
    enabled?: boolean;
    style?: StyleProp<ViewStyle>;
    /** 焦点环的圆角（按图标形状传，比如圆形图标传半径） */
    borderRadius?: number;
    children?: React.ReactNode;
}

export default function FocusIconButton(props: FocusIconButtonProps) {
    const {
        focusId,
        group,
        index,
        enabled = true,
        style,
        borderRadius = 8,
        children,
    } = props;
    const theme = Theme.useTheme();

    const focusable = useFocusable({
        focusId,
        group,
        index,
        enabled,
        style,
    });

    return (
        <View
            ref={focusable.ref}
            focusable={focusable.focusable}
            accessible={false}
            // RN 的 ViewProps 类型定义里没有声明 onFocus/onBlur（运行时支持），
            // 这里按运行时行为透传
            {...({
                onFocus: focusable.onFocus,
                onBlur: focusable.onBlur,
            } as any)}
            style={[
                styles.container,
                { borderRadius },
                style,
                focusable.focused && enabled
                    ? {
                          borderColor: theme.colors.primary,
                          borderWidth: 2,
                          backgroundColor: theme.colors.listActive,
                      }
                    : null,
            ]}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: "center",
        justifyContent: "center",
    },
});
