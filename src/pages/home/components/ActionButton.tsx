import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import { useFocusable } from "@/core/focus";

interface IActionButtonProps {
    iconName: IIconName;
    iconColor?: string;
    title: string;
    action?: () => void;
    style?: StyleProp<ViewStyle>;
    /** 焦点 id（硬件键盘 / 遥控器导航用）；不传则不参与焦点体系 */
    focusId?: string;
    /** 焦点组名 */
    focusGroup?: string;
    /** 组内序号 */
    focusIndex?: number;
}

export default function ActionButton(props: IActionButtonProps) {
    const {
        iconName,
        iconColor,
        title,
        action,
        style,
        focusId,
        focusGroup,
        focusIndex,
    } = props;
    const colors = useColors();

    const focusable = useFocusable({
        focusId: focusId ?? `action-${title}`,
        group: focusGroup,
        index: focusIndex,
        enabled: !!focusId,
    });

    const mergedStyle = [
        styles.wrapper,
        {
            backgroundColor: colors.card,
        },
        style,
        !!focusId && focusable.focused
            ? {
                  borderColor: colors.primary,
                  borderWidth: 2,
                  backgroundColor: colors.listActive,
              }
            : null,
    ];

    // rippleColor="rgba(0, 0, 0, .32)"
    return (
        <TouchableOpacity
            ref={focusId ? focusable.ref : undefined}
            focusable={!!focusId}
            onFocus={focusable.onFocus}
            onBlur={focusable.onBlur}
            onPressIn={focusable.onPressIn}
            onPress={action}
            style={mergedStyle}>
            <>
                <Icon
                    accessible={false}
                    name={iconName}
                    color={iconColor ?? colors.text}
                    size={rpx(48)}
                />
                <ThemeText
                    accessible={false}
                    fontSize="subTitle"
                    fontWeight="semibold"
                    style={styles.text}>
                    {title}
                </ThemeText>
            </>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: rpx(140),
        height: rpx(144),
        borderRadius: rpx(12),
        flexGrow: 1,
        flexShrink: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
    },
    text: {
        marginTop: rpx(12),
    },
});
