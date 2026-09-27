import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import rpx from "@/utils/rpx";
import React from "react";
import { StyleSheet, View } from "react-native";
import ActionButton from "../ActionButton";

export default function Operations() {
    const navigate = useNavigate();
    const { t } = useI18N();

    const actionButtons = [
        {
            iconName: "fire",
            title: t("home.recommendSheet"),
            action() {
                navigate(ROUTE_PATH.RECOMMEND_SHEETS);
            },
        },
        {
            iconName: "trophy",
            title: t("home.topList"),
            action() {
                navigate(ROUTE_PATH.TOP_LIST);
            },
        },
        {
            iconName: "clock-outline",
            title: t("home.playHistory"),
            action() {
                navigate(ROUTE_PATH.HISTORY);
            },
        },
        {
            iconName: "folder-music-outline",
            title: t("home.localMusic"),
            action() {
                navigate(ROUTE_PATH.LOCAL);
            },
        },
        {
            iconName: "circle-stack",
            title: t("cloudMusic.title"),
            action() {
                navigate(ROUTE_PATH.CLOUD_MUSIC);
            },
        },
    ] as const;

    const COUNT = actionButtons.length;
    // 竖屏一行等分：容器内宽减掉 (COUNT-1) 个间距后平分
    const buttonWidth = (rpx(750) - rpx(48) - rpx(24) * (COUNT - 1)) / COUNT;

    return (
        <View style={styles.container}>
            {actionButtons.map((action, index) => (
                <ActionButton
                    style={[
                        styles.actionButtonStyle,
                        { width: buttonWidth },
                        index > 0 ? styles.actionMarginLeft : null,
                    ]}
                    key={action.title}
                    focusId={`home-action-${index}`}
                    focusGroup="home-actions"
                    focusIndex={index}
                    {...action}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: rpx(750),
        paddingHorizontal: rpx(24),
        marginVertical: rpx(32),
        flexDirection: "row",
        flexWrap: "nowrap",
    },
    actionButtonStyle: {
        height: rpx(160),
        borderRadius: rpx(18),
    },
    actionMarginLeft: {
        marginLeft: rpx(24),
    },
});
