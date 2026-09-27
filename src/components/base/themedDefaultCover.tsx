import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Icon from "./icon";
import useColors from "@/hooks/useColors";

/**
 * 默认封面（D14「默认封面染色」）。
 *
 * 桌面版的做法：`res/default-cover.png` 是一张 **alpha mask**
 * （只有墨迹形状、RGB 全黑、底色透明），渲染进程用 CSS `currentColor`
 * 按主题染色；主进程（托盘/任务栏）拿不到 CSS 变量，改由渲染进程上报
 * 两个颜色后用 `sharp` 合成。
 *
 * RN 里没有 `currentColor`，但 **SVG 可以直接吃 `color`**，
 * 于是用「主题底色 + 主题墨迹色描的 SVG 音符」达到同一效果：
 *
 * | 桌面版 | 这里 |
 * |---|---|
 * | `--color-bg-placeholder` | `colors.placeholder` |
 * | `--color-text-muted` | `colors.textSecondary` |
 *
 * 主题切换时 `useColors()` 返回新值、组件自然重绘 —— 与桌面版
 * 「主题切换联动重画」等价。
 *
 * 之所以不直接把默认图换成 mask PNG：`tintColor` 只对**单色**内容生效，
 * 位图 mask 在 RN 上无法按主题着色，SVG 才是可行路径。
 */
interface IThemedDefaultCoverProps {
    /** 容器边长（rpx 由调用方决定，这里收实际数值） */
    size?: number;
    /** 音符图标占边长的比例 */
    iconRatio?: number;
    style?: StyleProp<ViewStyle>;
    rounded?: number;
}

export default function ThemedDefaultCover(props: IThemedDefaultCoverProps) {
    const { size = 48, iconRatio = 0.5, style, rounded } = props;
    const colors = useColors();

    return (
        <View
            style={[
                styles.wrapper,
                {
                    width: size,
                    height: size,
                    backgroundColor: colors.placeholder,
                    borderRadius: rounded ?? size / 8,
                },
                style,
            ]}>
            <Icon
                name="musical-note"
                color={colors.textSecondary ?? colors.text}
                size={size * iconRatio}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
});
