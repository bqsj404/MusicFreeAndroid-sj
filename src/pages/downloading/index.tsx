import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import StatusBar from "@/components/base/statusBar";
import DownloadingList from "./downloadingList";
import UploadRecordList from "./uploadRecordList";
import MusicBar from "@/components/musicBar";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import ThemeText from "@/components/base/themeText";
import globalStyle from "@/constants/globalStyle";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";

/**
 * 下载管理页（第 7 批 · 问题 4 起同时承载「上传记录」）。
 *
 * 入口已从「本地音乐」的菜单里移出，改挂侧边栏 —— 下载/上传都不属于
 * 本地音乐这一个来源，挂在它下面会让用户以为「下载完的东西就是本地音乐」。
 * 桌面版同样是侧边栏「本地」分组下的独立页面（`/download`）。
 */
type TabKey = "download" | "upload";

export default function Downloading() {
    const { t } = useI18N();
    const [tab, setTab] = useState<TabKey>("download");

    const tabs: TabKey[] = ["download", "upload"];

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("downloading.managerTitle")}</AppBar>
            <View style={styles.tabBar}>
                {tabs.map(key => (
                    <ThemeText
                        key={key}
                        fontSize="subTitle"
                        fontWeight={tab === key ? "bold" : "regular"}
                        fontColor={tab === key ? "primary" : "textSecondary"}
                        style={styles.tabItem}
                        onPress={() => setTab(key)}>
                        {t(`downloading.tab.${key}`)}
                    </ThemeText>
                ))}
            </View>
            {tab === "download" ? <DownloadingList /> : <UploadRecordList />}
            <MusicBar />
        </VerticalSafeAreaView>
    );
}

const styles = StyleSheet.create({
    tabBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(8),
        gap: rpx(36),
    },
    tabItem: {
        paddingVertical: rpx(12),
    },
});
