import React, { useCallback, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AppBar from "@/components/base/appBar";
import MusicList from "@/components/musicList";
import StatusBar from "@/components/base/statusBar";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView";
import ThemeText from "@/components/base/themeText";
import { showToast } from "@/components/base/toast";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import {
    getCloudMusicItems,
    invalidateCloudCache,
    type ICloudMusicItem,
} from "@/core/cloudDisk";
import { isCloudDiskConfigured } from "@/core/cloudDisk/client";
import { RequestStateCode } from "@/constants/commonConst";
import { keyboardLog } from "@/core/keyboard/native";
import rpx from "@/utils/rpx";

/**
 * 云盘音乐页（WebDAV）。
 *
 * 当前实现「列目录 + 播放」闭环：
 *  - 列 `/MusicFree/music` 下的音频，还原 Zotero 映射名后展示
 *  - 播放走云盘内建插件（直链 + Basic Auth + Zotero UA 请求头）
 *
 * 已知限制（中国科技云数据胶囊）：服务端**不支持 Range**，
 * 拖动进度条不可用（对 Range 请求返回 200 全量而不是 206）。
 */
export default function CloudMusic() {
    const { t } = useI18N();
    const navigate = useNavigate();
    const [items, setItems] = useState<ICloudMusicItem[]>([]);
    const [state, setState] = useState<RequestStateCode>(
        RequestStateCode.PENDING_FIRST_PAGE,
    );
    const [errorText, setErrorText] = useState("");

    const load = useCallback(
        async (force = false) => {
            if (!isCloudDiskConfigured()) {
                setState(RequestStateCode.ERROR);
                setErrorText(t("cloudMusic.notConfigured"));
                setItems([]);
                return;
            }
            setState(RequestStateCode.PENDING_FIRST_PAGE);
            setErrorText("");
            try {
                const list = await getCloudMusicItems(force);
                setItems(list);
                setState(RequestStateCode.FINISHED);
            } catch (e: any) {
                const detail = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
                // release bundle 下 console 不进 logcat，走原生日志通道
                keyboardLog("CloudMusic", `list failed ${detail}`);
                setErrorText(detail);
                setState(RequestStateCode.ERROR);
                showToast({
                    type: "warn",
                    message: e?.message ?? t("cloudMusic.loadFailed"),
                });
            }
        },
        [t],
    );

    // 从别的页面回来时刷新（远端可能已变化）
    useFocusEffect(
        useCallback(() => {
            invalidateCloudCache();
            load(true);
        }, [load]),
    );

    return (
        <SafeAreaView edges={["top"]} style={styles.wrapper}>
            <StatusBar />
            <AppBar
                actions={[
                    {
                        icon: "arrow-path",
                        onPress: () => load(true),
                    },
                    {
                        icon: "cog-8-tooth",
                        onPress: () =>
                            navigate(ROUTE_PATH.SETTING, { type: "backup" }),
                    },
                ]}>
                {t("cloudMusic.title")}
            </AppBar>
            <HorizontalSafeAreaView style={styles.body}>
                {state === RequestStateCode.ERROR && errorText ? (
                    <ThemeText
                        fontColor="textSecondary"
                        fontSize="subTitle"
                        style={styles.errorText}>
                        {errorText}
                    </ThemeText>
                ) : undefined}
                <MusicList
                    musicList={items}
                    state={state}
                    showIndex
                    focusGroup="cloud-music-list"
                    focusGroupPrefix="cloud-"
                />
            </HorizontalSafeAreaView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    body: {
        flex: 1,
    },
    errorText: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
});
