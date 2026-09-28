import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AppBar from "@/components/base/appBar";
import MusicBar from "@/components/musicBar";
import MusicList from "@/components/musicList";
import StatusBar from "@/components/base/statusBar";
import { showDialog } from "@/components/dialogs/useDialog";
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
import {
    collectLocalTasks,
    uploadTasksWithProgress,
} from "@/core/cloudDisk/localUpload";
import {
    clearCloudFileCache,
    getCloudCacheUsage,
} from "@/core/cloudDisk/fileCache";
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
    const [cacheText, setCacheText] = useState("0 B");
    const [uploadProgress, setUploadProgress] = useState("");

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

    const refreshCache = useCallback(async () => {
        const usage = await getCloudCacheUsage();
        setCacheText(formatBytes(usage.bytes));
    }, []);

    useEffect(() => {
        refreshCache();
    }, [refreshCache]);
    // 从别的页面回来时刷新（远端可能已变化）
    useFocusEffect(
        useCallback(() => {
            invalidateCloudCache();
            load(true);
        }, [load]),
    );

    /** 上传本地音乐到云盘 */
    const onUploadLocal = useCallback(async () => {
        const tasks = collectLocalTasks();        if (!tasks.length) {
            showToast({
                type: "warn",
                message: t("cloudMusic.uploadNoLocal"),
            });
            return;
        }
        // 用 LoadingDialog 包住（上传期间有遮罩与进度语义，与备份页一致）
        showDialog("LoadingDialog", {
            title: t("cloudMusic.uploadLocal"),
            promise: uploadTasksWithProgress(tasks, (done, total) => {
                setUploadProgress(`${done}/${total}`);
            }),
            onResolve(result, hideDialog) {
                hideDialog();
                setUploadProgress("");
                showToast({
                    type: result.failed ? "warn" : "success",
                    message: t("cloudMusic.uploadResult", {
                        uploaded: String(result.uploaded),
                        skipped: String(result.skipped),
                        failed: String(result.failed),
                    }),
                });
                invalidateCloudCache();
                load(true);
            },
            onReject(reason, hideDialog) {
                hideDialog();
                setUploadProgress("");
                showToast({
                    type: "warn",
                    message: String(reason?.message ?? reason),
                });
            },
        });
    }, [t, load]);

    /** 清理云盘缓存 */
    const onClearCache = useCallback(async () => {
        const usage = await getCloudCacheUsage();
        await clearCloudFileCache();
        refreshCache();
        showToast({
            type: usage.files ? "success" : "warn",
            message: t("cloudMusic.clearCacheDone"),
        });
    }, [t, refreshCache]);
    return (
        <SafeAreaView edges={["top"]} style={styles.wrapper}>
            <StatusBar />
            <AppBar
                actions={[
                    {
                        icon: "arrow-up-tray",
                        onPress: onUploadLocal,
                    },
                    {
                        icon: "archive-box-x-mark",
                        onPress: onClearCache,
                    },
                    {
                        icon: "trash-outline",
                        onPress: () => navigate(ROUTE_PATH.CLOUD_TRASH),
                    },
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
            {/*
             * 第 7 批 · 问题 5：云盘音乐页原先没有播放状态栏。
             *
             * 云盘的取源要先把远端文件拉到本地缓存，点一下要等好几秒，
             * 而页面底部没有任何「正在播放/正在加载」的反馈，看起来像没反应；
             * 从云盘页点到别的页面后也回不到「正在播的是哪首」。
             * 与本地音乐页保持一致：列表占满剩余空间，MusicBar 常驻底部。
             */}
            <MusicBar />
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
/** 字节数格式化（展示缓存占用） */
function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
















