import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import StatusBar from "@/components/base/statusBar";
import AppBar from "@/components/base/appBar";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import MusicBar from "@/components/musicBar";
import { useI18N } from "@/core/i18n";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import {
    countUnowned,
    deleteLyricFile,
    deleteLyricFiles,
    listCacheLyricFiles,
    listLocalLyricFiles,
    type ILyricFileRecord,
    type LyricScope,
} from "@/core/lyricFiles";
import { createCloudDiskClient, isCloudDiskConfigured } from "@/core/cloudDisk/client";
import { listCloudLyricFiles } from "@/core/cloudDisk";

const SCOPES: LyricScope[] = ["local", "cache", "cloud"];

/**
 * 歌词管理（D8）。
 *
 * 三个 scope 统一在一个列表里，用顶部档位切换：
 *  - **本地**：手动上传/设置的歌词（可关联到歌曲）
 *  - **缓存**：插件取词缓存（文件名是随机串，没有归属信息）
 *  - **云端**：远端 `/MusicFree/lyrics`
 *
 * 历史遗留的歌词没有登记记录（登记机制是本次才加的），
 * 所以列表里会显示为「未登记」，并提供批量清理入口。
 */
export default function LyricManager() {
    const { t } = useI18N();
    const [scope, setScope] = useState<LyricScope>("local");
    const [records, setRecords] = useState<ILyricFileRecord[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            if (scope === "local") {
                setRecords(await listLocalLyricFiles());
            } else if (scope === "cache") {
                setRecords(await listCacheLyricFiles());
            } else {
                if (!isCloudDiskConfigured()) {
                    setRecords([]);
                } else {
                    const files = await listCloudLyricFiles();
                    setRecords(
                        files.map(file => ({
                            scope: "cloud" as const,
                            name: file.name,
                            path: file.path,
                            hasTranslation: /-tr(\.|_)/.test(file.name),
                            owner: null,
                        })),
                    );
                }
            }
        } catch (e) {
            setRecords([]);
        } finally {
            setLoading(false);
        }
    }, [scope]);

    useEffect(() => {
        load();
    }, [load]);

    const unownedCount = useMemo(() => countUnowned(records), [records]);

    const onDelete = useCallback(
        async (record: ILyricFileRecord) => {
            if (record.scope === "cloud") {
                const client = createCloudDiskClient();
                if (!client) {
                    return;
                }
                try {
                    await client.deleteFile(record.path);
                } catch (e) {
                    Toast.warn(t("lyricManager.deleteFail"));
                    return;
                }
            } else {
                await deleteLyricFile(record);
            }
            Toast.success(t("lyricManager.deleteDone"));
            load();
        },
        [t, load],
    );

    const onClearUnowned = useCallback(async () => {
        const targets = records.filter(r => !r.owner && r.scope !== "cloud");
        if (!targets.length) {
            return;
        }
        const done = await deleteLyricFiles(targets);
        Toast.success(
            t("lyricManager.clearDone", { count: String(done) }),
        );
        load();
    }, [records, t, load]);

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar>{t("lyricManager.title")}</AppBar>

            {/* scope 档位 */}
            <View style={style.tabBar}>
                {SCOPES.map(key => (
                    <ThemeText
                        key={key}
                        fontSize="description"
                        fontColor={scope === key ? "primary" : "textSecondary"}
                        onPress={() => setScope(key)}>
                        {t(`lyricManager.scope.${key}`)}
                    </ThemeText>
                ))}
                {unownedCount > 0 && scope !== "cloud" ? (
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        onPress={onClearUnowned}>
                        {t("lyricManager.clearUnowned")}
                    </ThemeText>
                ) : null}
            </View>

            <ScrollView style={style.list}>
                {records.length === 0 ? (
                    <View style={style.empty}>
                        <ThemeText fontColor="textSecondary">
                            {loading
                                ? t("lyricManager.loading")
                                : t("lyricManager.empty")}
                        </ThemeText>
                    </View>
                ) : (
                    records.map(record => (
                        <ListItem
                            key={`${record.scope}-${record.path}`}
                            withHorizontalPadding>
                            <ListItem.Content
                                title={record.name}
                                description={
                                    record.owner
                                        ? `${record.owner.platform} · ${record.owner.id}`
                                        : t("lyricManager.unregistered")
                                }
                            />
                            {record.hasTranslation ? (
                                <ThemeText
                                    fontSize="description"
                                    fontColor="textSecondary"
                                    style={style.badge}>
                                    {t("lyricManager.hasTranslation")}
                                </ThemeText>
                            ) : null}
                            <ThemeText
                                fontSize="description"
                                fontColor="primary"
                                style={style.badge}
                                onPress={() => onDelete(record)}>
                                {t("lyricManager.delete")}
                            </ThemeText>
                        </ListItem>
                    ))
                )}
            </ScrollView>

            <MusicBar />
        </VerticalSafeAreaView>
    );
}

const style = StyleSheet.create({
    tabBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    list: {
        flex: 1,
        width: rpx(750),
    },
    empty: {
        paddingTop: rpx(120),
        alignItems: "center",
    },
    badge: {
        paddingHorizontal: rpx(12),
    },
});

