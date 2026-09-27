import IconTextButton from "@/components/base/iconTextButton";
import ThemeText from "@/components/base/themeText";
import repeatModeConst from "@/constants/repeatModeConst";
import { useI18N } from "@/core/i18n";
import PersistStatus from "@/utils/persistStatus";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { localPluginPlatform } from "@/constants/commonConst";
import { hidePanel } from "@/components/panels/usePanel";
import TrackPlayer, { usePlayList, useQueueSource, useRepeatMode } from "@/core/trackPlayer";
import delay from "@/utils/delay";
import rpx from "@/utils/rpx";
import React from "react";
import { InteractionManager, StyleSheet, View } from "react-native";

export default function Header() {
    const repeatMode = useRepeatMode();
    const playList = usePlayList();
    const { t } = useI18N();
    // D18：队列来源（无记录时为 null）
    const navigate = useNavigate();
    const queueSource = useQueueSource();

    return (
        <View style={style.wrapper}>
            <ThemeText
                style={style.headerText}
                fontSize="title"
                fontWeight="bold">
                {t("panel.playList.title")}
                <ThemeText fontColor="textSecondary">
                    {t("panel.playList.count", {
                        count: playList.length,
                    })}
                </ThemeText>
            </ThemeText>
            <IconTextButton
                onPress={() => {
                    InteractionManager.runAfterInteractions(async () => {
                        await delay(20, false);
                        TrackPlayer.toggleRepeatMode();
                    });
                }}
                icon={repeatModeConst[repeatMode].icon}>
                {t(("repeatMode." + repeatMode) as any)}
            </IconTextButton>
            <IconTextButton
                icon="trash-outline"
                onPress={() => {
                    TrackPlayer.clearPlayList();
                }}>
                {t("common.clear")}
            </IconTextButton>
            {/*
              * D18「还原来源」：队列本身持久化后重启还在，但用户无从知道
              * 这批歌是从哪来的。这里显示来源歌单，点一下即可跳回去。
              */}
            {queueSource?.title ? (
                <IconTextButton
                    icon="arrow-uturn-left"
                    onPress={() => {
                        if (!queueSource) {
                            return;
                        }
                        navigate(
                            queueSource.platform === localPluginPlatform
                                ? ROUTE_PATH.LOCAL_SHEET_DETAIL
                                : ROUTE_PATH.PLUGIN_SHEET_DETAIL,
                            { sheetInfo: queueSource } as any,
                        );
                        hidePanel();
                    }}>
                    {t("panel.playList.from", { title: queueSource.title })}
                </IconTextButton>
            ) : null}
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        height: rpx(80),
        paddingHorizontal: rpx(24),
        marginTop: rpx(18),
        marginBottom: rpx(12),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerText: {
        flex: 1,
    },
});



