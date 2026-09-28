/**
 * 云盘上传记录列表（第 7 批 · 问题 4）。
 *
 * 桌面版把「上传记录」并进下载管理页（`cloud_uploads` 表与下载任务同一张列表，
 * 用状态筛选里的 `uploaded` 档位切出来）。Android 这里做成**同一页面的两个
 * Tab**：上传记录没有进度、没有暂停/继续/重试，行内操作与下载行完全不同，
 * 混在一条时间轴里反而更难操作；但「入口在下载管理里」这一点与桌面版一致。
 *
 * 两条清除语义刻意分开（对齐桌面版 `downloadRowEntries`）：
 *  - **移除记录**：只删本地记账（`cu:rec:*` 与索引数组），云端文件不动
 *  - **从云端删除**：`moveToTrash` 移入 `/MusicFree/trash`，**不物理删除**，
 *    用户还能在云盘回收站里恢复
 *
 * 刻意**不做**「暂停/重试/取消」：上传是一次性 Promise（云端没有分片会话），
 * 失败了直接再点一次上传即可，做半套任务状态机只会让人误以为可以续传。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import dayjs from "dayjs";

import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import Toast from "@/utils/toast";
import { sizeFormatter } from "@/utils/fileUtils";
import { useI18N } from "@/core/i18n";
import { useSelection, type ISelectionApi } from "@/core/selection";
import { showDialog } from "@/components/dialogs/useDialog";
import rpx from "@/utils/rpx";
import {
    buildRecordKey,
    deleteUploadRecords,
    getAllUploads,
    type ICloudUploadRecord,
} from "@/core/cloudDisk/uploadRecords";
import { moveToTrash } from "@/core/cloudDisk/trash";

/** 记录的唯一键：三元组（只按 remotePath 会把「换插件后的同一文件」误删） */
function recordKey(record: ICloudUploadRecord): string {
    return `up-${buildRecordKey(
        record.platform,
        record.musicId,
        record.remotePath,
    )}`;
}

interface IRowProps {
    record: ICloudUploadRecord;
    onRemoveRecord: (record: ICloudUploadRecord) => void;
    selection: ISelectionApi<ICloudUploadRecord>;
}

function UploadRecordItem(props: IRowProps) {
    const { record, onRemoveRecord, selection } = props;
    const { t } = useI18N();
    const key = recordKey(record);
    const selected = selection.isSelected(key);

    const description = useMemo(() => {
        const parts: string[] = [];
        if (record.size) {
            parts.push(sizeFormatter(record.size));
        }
        if (record.uploadedAt) {
            parts.push(dayjs(record.uploadedAt).format("YYYY-MM-DD HH:mm"));
        }
        parts.push(
            record.source === "auto"
                ? t("downloading.upload.source.auto")
                : t("downloading.upload.source.manual"),
        );
        return parts.join(" · ");
    }, [record, t]);

    return (
        <ListItem
            withHorizontalPadding
            onLongPress={() => {
                selection.enter(key);
            }}
            onPress={() => {
                if (selection.selectMode) {
                    selection.toggle(key);
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
                title={record.title || record.remotePath}
                description={
                    record.artist
                        ? `${record.artist} · ${description}`
                        : description
                }
            />
            {!selection.selectMode ? (
                <ThemeText
                    fontSize="description"
                    fontColor="primary"
                    style={style.rowAction}
                    onPress={() => onRemoveRecord(record)}>
                    {t("downloading.upload.removeRecord")}
                </ThemeText>
            ) : null}
        </ListItem>
    );
}

export default function UploadRecordList() {
    const { t } = useI18N();
    const [records, setRecords] = useState<ICloudUploadRecord[]>([]);

    const reload = useCallback(() => {
        try {
            setRecords(getAllUploads());
        } catch (e) {
            // 读取失败保持原列表
        }
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    const selection = useSelection({
        items: records,
        keyOf: recordKey,
    });

    const onRemoveRecord = useCallback(
        (record: ICloudUploadRecord) => {
            deleteUploadRecords([
                {
                    platform: record.platform,
                    musicId: record.musicId,
                    remotePath: record.remotePath,
                },
            ]);
            reload();
        },
        [reload],
    );

    const onRemoveSelected = useCallback(() => {
        const targets = records.filter(record =>
            selection.selectedKeys.has(recordKey(record)),
        );
        if (!targets.length) {
            return;
        }
        const removed = deleteUploadRecords(
            targets.map(record => ({
                platform: record.platform,
                musicId: record.musicId,
                remotePath: record.remotePath,
            })),
        );
        selection.exit();
        Toast.success(
            t("downloading.upload.removed", { count: String(removed) }),
        );
        reload();
    }, [records, selection, t, reload]);

    const onDeleteFromCloud = useCallback(() => {
        const targets = records.filter(record =>
            selection.selectedKeys.has(recordKey(record)),
        );
        if (!targets.length) {
            return;
        }
        showDialog("SimpleDialog", {
            title: t("downloading.upload.deleteFromCloud"),
            content: t("downloading.upload.deleteConfirm", {
                count: String(targets.length),
            }),
            async onOk() {
                const result = await moveToTrash(
                    targets.map(record => record.remotePath),
                );
                if (result.errors?.length) {
                    Toast.warn(
                        `${t("downloading.upload.deleteFailed")} ${result.errors[0]}`,
                    );
                } else {
                    Toast.success(t("downloading.upload.deleted"));
                }
                selection.exit();
                reload();
            },
        });
    }, [records, selection, t, reload]);

    return (
        <View style={style.wrapper}>
            {selection.selectMode ? (
                <View>
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
                    <View style={[style.filterBar, style.actionBar]}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            onPress={onRemoveSelected}>
                            {t("downloading.upload.removeRecord")}
                        </ThemeText>
                        <ThemeText
                            fontSize="description"
                            fontColor="primary"
                            onPress={onDeleteFromCloud}>
                            {t("downloading.upload.deleteFromCloud")}
                        </ThemeText>
                    </View>
                </View>
            ) : null}

            {records.length === 0 ? (
                <View style={style.empty}>
                    <ThemeText fontColor="textSecondary">
                        {t("downloading.upload.empty")}
                    </ThemeText>
                </View>
            ) : (
                <FlashList
                    style={style.list}
                    data={records}
                    keyExtractor={recordKey}
                    renderItem={({ item }) => (
                        <UploadRecordItem
                            record={item}
                            onRemoveRecord={onRemoveRecord}
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
    list: {
        flexGrow: 0,
    },
    filterBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    actionBar: {
        gap: rpx(16),
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
});
