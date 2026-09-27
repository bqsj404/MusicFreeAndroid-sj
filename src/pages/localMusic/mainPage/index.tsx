import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import LocalMusicSheet from "@/core/localMusicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import LocalMusicList from "./localMusicList";
import MusicBar from "@/components/musicBar";
import { localMusicSheetId } from "@/constants/commonConst";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";
import ThemeText from "@/components/base/themeText";
import {
    getScanFolders,
    getScanProgress,
    subscribeScanProgress,
    type IScanProgress,
} from "@/core/localMusicScan";
import rpx from "@/utils/rpx";

/** 顶部扫描进度条（仅扫描中显示） */
function ScanProgressBar() {
    const [progress, setProgress] = useState<IScanProgress>(getScanProgress());
    const { t } = useI18N();

    useEffect(() => subscribeScanProgress(() => setProgress(getScanProgress())), []);

    if (
        progress.phase !== "scanning" &&
        progress.phase !== "parsing"
    ) {
        return null;
    }
    const label =
        progress.phase === "scanning"
            ? t("localMusic.scanning")
            : t("localMusic.parsing");
    const counter =
        progress.phase === "parsing" && progress.total
            ? ` ${progress.current}/${progress.total}`
            : "";

    return (
        <View style={styles.progressBar}>
            <ThemeText fontSize="subTitle" fontColor="primary" numberOfLines={1}>
                {`${label}${counter}`}
            </ThemeText>
            {progress.filePath ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    numberOfLines={1}>
                    {progress.filePath}
                </ThemeText>
            ) : undefined}
        </View>
    );
}

export default function MainPage() {
    const navigate = useNavigate();
    const { t } = useI18N();

    /** 通用扫描入口：传目录就扫目录，不传就用已记住的白名单 */
    function startScan(paths?: string[]) {
        const folders = paths?.length ? paths : getScanFolders();
        if (!folders.length) {
            Toast.warn(t("localMusic.noFolderRemembered"));
            return;
        }
        showDialog("LoadingDialog", {
            title: t("localMusic.scanLocalMusic"),
            promise: LocalMusicSheet.importLocal(folders),
            onResolve(data, hideDialog) {
                hideDialog();
                const result = getScanProgress();
                Toast.success(
                    t("localMusic.scanResult", {
                        added: String(result.added ?? 0),
                        skipped: String(result.skipped ?? 0),
                    }),
                );
            },
            onCancel(hideDialog) {
                LocalMusicSheet.cancelImportLocal();
                hideDialog();
            },
        });
    }

    return (
        <>
            <AppBar
                withStatusBar
                actions={[
                    {
                        icon: "magnifying-glass",
                        onPress() {
                            navigate(ROUTE_PATH.SEARCH_MUSIC_LIST, {
                                musicList: LocalMusicSheet.getMusicList(),
                            });
                        },
                    },
                ]}
                menu={[
                    {
                        icon: "folder-plus",
                        title: t("localMusic.scanLocalMusic"),
                        async onPress() {
                            navigate(ROUTE_PATH.FILE_SELECTOR, {
                                fileType: "folder",
                                multi: true,
                                actionText: t("localMusic.beginScan"),
                                async onAction(selectedFiles) {
                                    return new Promise(resolve => {
                                        showDialog("LoadingDialog", {
                                            title: t("localMusic.scanLocalMusic"),
                                            promise:
                                                LocalMusicSheet.importLocal(
                                                    selectedFiles.map(
                                                        _ => _.path,
                                                    ),
                                                ),
                                            onResolve(data, hideDialog) {
                                                hideDialog();
                                                const result =
                                                    getScanProgress();
                                                Toast.success(
                                                    t("localMusic.scanResult", {
                                                        added: String(
                                                            result.added ?? 0,
                                                        ),
                                                        skipped: String(
                                                            result.skipped ?? 0,
                                                        ),
                                                    }),
                                                );
                                                resolve(true);
                                            },
                                            onCancel(hideDialog) {
                                                LocalMusicSheet.cancelImportLocal();
                                                hideDialog();
                                                resolve(false);
                                            },
                                        });
                                    });
                                },
                            });
                        },
                    },
                    {
                        icon: "arrow-path",
                        title: t("localMusic.rescan"),
                        show: getScanFolders().length > 0,
                        onPress() {
                            startScan();
                        },
                    },
                    {
                        icon: "pencil-square",
                        title: t("common.batchEdit"),
                        async onPress() {
                            navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                                musicList: LocalMusicSheet.getMusicList(),
                                musicSheet: {
                                    id: localMusicSheetId,
                                },
                            });
                        },
                    },
                    {
                        icon: "arrow-down-tray",
                        title: t("localMusic.downloadList"),
                        async onPress() {
                            navigate(ROUTE_PATH.DOWNLOADING);
                        },
                    },
                ]}>
                {t("home.localMusic")}
            </AppBar>
            <ScanProgressBar />
            <LocalMusicList />
            <MusicBar />
        </>
    );
}

const styles = StyleSheet.create({
    progressBar: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
});
