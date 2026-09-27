import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { sizeFormatter } from "@/utils/fileUtils";
import downloader, {
    DownloadFailReason,
    DownloadStatus,
    DownloaderEvent,
    type IDownloadRecord,
} from "@/core/downloader";
import { FlashList } from "@shopify/flash-list";
import { useI18N } from "@/core/i18n";
import Toast from "@/utils/toast";
import { useSelection, type ISelectionApi } from "@/core/selection";

/** 列表筛选（D11「单列表三类记录」用筛选，而不是拆成多个页面） */
type DownloadFilter = "all" | "active" | "completed" | "failed";

const FILTERS: DownloadFilter[] = ["all", "active", "completed", "failed"];

function getStatusDescription(
    record: IDownloadRecord,
    t: (key: any, options?: any) => string,
): string {
    const { status, errorReason } = record;

    if (record.missing) {
        return t("downloading.status.missing");
    }
    if (status === DownloadStatus.Error) {
        if (errorReason === DownloadFailReason.NoWritePermission) {
            return t("downloading.downloadFailReason.noWritePermission");
        }
        if (errorReason === DownloadFailReason.FailToFetchSource) {
            return t("downloading.downloadFailReason.failToFetchSource");
        }
        return t("downloading.downloadFailReason.unknown");
    }
    if (status === DownloadStatus.Completed) {
        return t("downloading.downloadStatus.completed");
    }
    if (status === DownloadStatus.Paused) {
        return t("downloading.status.paused");
    }
    if (status === DownloadStatus.Downloading) {
        const progress = record.downloadedSize
            ? sizeFormatter(record.downloadedSize)
            : "-";
        const totalSize = record.fileSize
            ? sizeFormatter(record.fileSize)
            : "-";
        return t("downloading.downloadStatus.downloadProgress", {
            progress,
            totalSize,
        });
    }
    if (status === DownloadStatus.Pending) {
        return t("downloading.downloadStatus.pending");
    }
    return t("downloading.downloadStatus.preparing");
}

interface IRowProps {
    record: IDownloadRecord;
    onChanged: () => void;
    selection: ISelectionApi<IDownloadRecord>;
}

function DownloadingListItem(props: IRowProps) {
    const { record, onChanged, selection } = props;
    const { t } = useI18N();
    const rowKey = `dl-${record.key}`;
    const selected = selection.isSelected(rowKey);

    /** 依据状态决定可用操作 */
    const actions = useMemo(() => {
        const list: Array<{ label: string; onPress: () => void }> = [];
        const { status } = record;

        if (
            status === DownloadStatus.Pending ||
            status === DownloadStatus.Downloading ||
            status === DownloadStatus.Preparing
        ) {
            list.push({
                label: t("downloading.action.pause"),
                onPress: () => {
                    downloader.pause(record.musicItem).then(onChanged);
                },
            });
        } else if (status === DownloadStatus.Paused) {
            list.push({
                label: t("downloading.action.resume"),
                onPress: () => {
                    downloader.resume(record.musicItem);
                    onChanged();
                },
            });
        } else if (status === DownloadStatus.Error) {
            list.push({
                label: t("downloading.action.retry"),
                onPress: () => {
                    downloader.retry(record.musicItem);
                    onChanged();
                },
            });
        }

        if (record.kind === "failed" || status === DownloadStatus.Paused) {
            list.push({
                label: t("downloading.action.discard"),
                onPress: () => {
                    downloader.discard(record.musicItem);
                    onChanged();
                },
            });
        }

        return list;
    }, [record, t, onChanged]);

    return (
        <ListItem
            withHorizontalPadding
            onLongPress={() => {
                selection.enter(rowKey);
            }}
            onPress={() => {
                // 多选模式下点击=切换选中；否则交给行内操作按钮
                if (selection.selectMode) {
                    selection.toggle(rowKey);
                }
            }}>
            {selection.selectMode ? (
                <ThemeText
                    fontSize="subTitle"
                    fontColor={selected ? "primary" : "textSecondary"}
                    style={style.checkbox}>
                    {selected ? "☑" : "☐"}
                </ThemeText>
            ) : null}
            <ListItem.Content
                title={record.musicItem.title}
                description={getStatusDescription(record, t)}
            />
            {!selection.selectMode &&
                actions.map(action => (
                    <ThemeText
                        key={action.label}
                        fontSize="description"
                        fontColor="primary"
                        style={style.rowAction}
                        onPress={action.onPress}>
                        {action.label}
                    </ThemeText>
                ))}
        </ListItem>
    );
}

export default function DownloadingList() {
    const { t } = useI18N();
    const [filter, setFilter] = useState<DownloadFilter>("all");
    const [records, setRecords] = useState<IDownloadRecord[]>([]);

    /** 拉取记录；`checkMissing` 会逐个校验文件是否还在，用于 missing 标记 */
    const reload = useCallback(async () => {
        try {
            const list = await downloader.getDownloadRecords({
                checkMissing: true,
            });
            setRecords(list);
        } catch (e) {
            // 读取失败保持原列表
        }
    }, []);

    useEffect(() => {
        reload();

        // 下载事件驱动刷新（进度更新也在其中）
        const onChange = () => {
            reload();
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, onChange);
        downloader.on(DownloaderEvent.DownloadTaskError, onChange);
        downloader.on(DownloaderEvent.DownloadQueueCompleted, onChange);
        return () => {
            downloader.off(DownloaderEvent.DownloadTaskUpdate, onChange);
            downloader.off(DownloaderEvent.DownloadTaskError, onChange);
            downloader.off(DownloaderEvent.DownloadQueueCompleted, onChange);
        };
    }, [reload]);

    const filtered = useMemo(() => {
        if (filter === "all") {
            return records;
        }
        return records.filter(record => record.kind === filter);
    }, [records, filter]);

    // D15：通用多选语义。键盘 Ctrl+A（全选）/ Ctrl+I（反选）/ Esc（退出）
    // / Shift+↑↓（范围）由 hook 统一接管。
    // 注意「全选」与范围选择只作用于**当前筛选后的可见项** —— 这正是
    // 桌面版「筛选 + 多选」联动的语义。
    const selection = useSelection({
        items: filtered,
        keyOf: record => `dl-${record.key}`,
    });

    const counts = useMemo(
        () => ({
            all: records.length,
            active: records.filter(r => r.kind === "active").length,
            completed: records.filter(r => r.kind === "completed").length,
            failed: records.filter(r => r.kind === "failed").length,
        }),
        [records],
    );

    const onClearInactive = useCallback(() => {
        const removed = downloader.clearInactive();
        if (removed > 0) {
            Toast.success(
                t("downloading.clearDone", { count: String(removed) }),
            );
        }
        reload();
    }, [t, reload]);

    return (
        <View style={style.wrapper}>
            {selection.selectMode ? (
                /* D15：多选操作栏（替代筛选栏） */
                <View style={[style.filterBar, style.actionBar]}>
                    <ThemeText fontSize="description" fontColor="primary">
                        {t("selection.selectedCount", {
                            count: String(selection.selectedKeys.size),
                        })}
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        onPress={selection.selectAll}>
                        {t("selection.selectAll")}
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        onPress={selection.invert}>
                        {t("selection.invert")}
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        onPress={selection.exit}>
                        {t("selection.exit")}
                    </ThemeText>
                </View>
            ) : (
                <View style={style.filterBar}>
                    {FILTERS.map(key => (
                        <ThemeText
                            key={key}
                            fontSize="description"
                            fontColor={
                                filter === key ? "primary" : "textSecondary"
                            }
                            onPress={() => setFilter(key)}>
                            {`${t(`downloading.filter.${key}`)} (${counts[key]})`}
                        </ThemeText>
                    ))}
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        onPress={onClearInactive}>
                        {t("downloading.action.clearInactive")}
                    </ThemeText>
                </View>
            )}

            {filtered.length === 0 ? (
                <View style={style.empty}>
                    <ThemeText fontColor="textSecondary">
                        {t("downloading.empty")}
                    </ThemeText>
                </View>
            ) : (
                <FlashList
                    style={style.downloading}
                    data={filtered}
                    keyExtractor={item => `dl-${item.key}`}
                    renderItem={({ item }) => (
                        <DownloadingListItem
                            record={item}
                            onChanged={reload}
                            selection={selection}
                        />
                    )}
                />
            )}
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
    },
    downloading: {
        flexGrow: 0,
    },
    filterBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    empty: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    rowAction: {
        paddingHorizontal: rpx(16),
    },
    checkbox: {
        paddingHorizontal: rpx(12),
    },
    actionBar: {
        gap: rpx(16),
    },
});

