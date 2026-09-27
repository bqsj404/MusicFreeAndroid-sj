/**
 * 云盘回收站。
 *
 * 只做展示：对账/删除产生的孤儿文件会被 `moveToTrash` 移到
 * `/MusicFree/trash`，这里把它列出来，让用户能看到「东西去哪了」。
 *
 * 之所以先不做「恢复/彻底删除」：`trash.ts` 目前只提供了
 * `moveToTrash` 与 `listTrashFiles`，恢复与清空需要补远端 MOVE/DELETE 封装，
 * 留待后续（见 `第4批-云盘实施记录.md`）。
 */
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AppBar from "@/components/base/appBar";
import ThemeText from "@/components/base/themeText";
import StatusBar from "@/components/base/statusBar";
import { useI18N } from "@/core/i18n";
import {
    listTrashFiles,
    purgeFromTrash,
    restoreFromTrash,
    type ITrashFile,
} from "@/core/cloudDisk/trash";
import showToast from "@/utils/toast";
import rpx from "@/utils/rpx";

export default function CloudTrashPage() {
    const { t } = useI18N();
    const [files, setFiles] = useState<ITrashFile[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setFiles(await listTrashFiles());
        } catch (e) {
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    /** 字节数格式化 */
    const formatSize = (bytes: number) => {
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
    };

    /** 恢复到音乐目录 */
    const onRestore = useCallback(
        async (item: ITrashFile) => {
            const target = await restoreFromTrash(item.path);
            if (target) {
                showToast.success(t("cloudMusic.trashRestoreDone"));
                load();
            } else {
                showToast.warn(t("cloudMusic.trashFailed"));
            }
        },
        [t, load],
    );

    /** 彻底删除（会真正丢数据） */
    const onPurge = useCallback(
        async (item: ITrashFile) => {
            const ok = await purgeFromTrash(item.path);
            if (ok) {
                showToast.success(t("cloudMusic.trashPurgeDone"));
            } else {
                showToast.warn(t("cloudMusic.trashFailed"));
            }
            if (ok) {
                load();
            }
        },
        [t, load],
    );
    return (
        <SafeAreaView edges={["top"]} style={styles.wrapper}>
            <StatusBar />
            <AppBar
                actions={[{ icon: "arrow-path", onPress: () => load() }]}>
                {t("cloudMusic.trashTitle")}
            </AppBar>
            {loading ? (
                <View style={styles.center}>
                    <ThemeText fontColor="textSecondary">
                        {t("cloudMusic.trashLoading")}
                    </ThemeText>
                </View>
            ) : files.length === 0 ? (
                <View style={styles.center}>
                    <ThemeText fontColor="textSecondary">
                        {t("cloudMusic.trashEmpty")}
                    </ThemeText>
                </View>
            ) : (
                <FlatList
                    data={files}
                    keyExtractor={item => item.path}
                    renderItem={({ item }) => (
                        <View style={styles.row}>
                            <View style={styles.info}>
                                <ThemeText fontSize="content" numberOfLines={1}>
                                    {item.name}
                                </ThemeText>
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textSecondary">
                                    {formatSize(item.size)}
                                </ThemeText>
                            </View>
                            <View style={styles.actions}>
                                <ThemeText
                                    fontSize="description"
                                    fontColor="primary"
                                    onPress={() => onRestore(item)}>
                                    {t("cloudMusic.trashRestore")}
                                </ThemeText>
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textSecondary"
                                    onPress={() => onPurge(item)}>
                                    {t("cloudMusic.trashPurge")}
                                </ThemeText>
                            </View>
                        </View>
                    )}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    row: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(20),
        flexDirection: "row",
        alignItems: "center",
    },
    info: {
        flex: 1,
    },
    actions: {
        flexDirection: "row",
        gap: rpx(24),
    },
});



