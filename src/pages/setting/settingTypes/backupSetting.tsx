import ListItem, { ListItemHeader } from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import Backup from "@/core/backup";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import Toast from "@/utils/toast";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";

import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import axios from "axios";

import { ResumeMode } from "@/constants/commonConst.ts";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import delay from "@/utils/delay";
import { writeInChunks } from "@/utils/fileUtils.ts";
import { errorLog } from "@/utils/log.ts";
import { getDocumentAsync } from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system";
import { createCloudDiskClient } from "@/core/cloudDisk/client";
import { REMOTE_BACKUP_PATH } from "@/core/cloudDisk/autoSync";
import { toStoredPath } from "@/core/cloudDisk/zoteroDavCompat";

export default function BackupSetting() {
    const { t } = useI18N();
    const navigate = useNavigate();

    const resumeMode = useAppConfig("backup.resumeMode");
    const webdavUrl = useAppConfig("webdav.url");
    const webdavUsername = useAppConfig("webdav.username");
    const webdavPassword = useAppConfig("webdav.password");
    const autoBackup = useAppConfig("backup.autoBackup");
    const uploadLocalFiles = useAppConfig("backup.uploadLocalFiles");


    const onBackupToLocal = async () => {
        navigate(ROUTE_PATH.FILE_SELECTOR, {
            fileType: "folder",
            multi: false,
            actionText: t("backupAndResume.beginBackup"),
            async onAction(selectedFiles) {
                const raw = Backup.backup();
                const folder = selectedFiles[0]?.path;
                return new Promise(resolve => {
                    showDialog("LoadingDialog", {
                        title: t("backupAndResume.backupDialogTitle"),
                        loadingText: t("backupAndResume.backuping"),
                        promise: writeInChunks(
                            `${folder}${folder?.endsWith("/") ? "" : "/"
                            }backup.json`,
                            raw,
                        ),
                        onResolve(_, hideDialog) {
                            Toast.success(t("toast.backupSuccess"));
                            hideDialog();
                            resolve(true);
                        },
                        onCancel(hideDialog) {
                            hideDialog();
                            resolve(false);
                        },
                        onReject(reason, hideDialog) {
                            hideDialog();
                            resolve(false);
                            console.log(reason);
                            Toast.warn(t("toast.backupFail", { reason: reason?.message ?? reason }));
                        },
                    });
                });
            },
        });
    };

    async function onResumeFromLocal() {
        try {
            const pickResult = await getDocumentAsync({
                copyToCacheDirectory: true,
                type: "application/json",
            });
            if (pickResult.canceled) {
                return;
            }
            const result = await readAsStringAsync(pickResult.assets[0].uri);
            return new Promise(resolve => {
                showDialog("LoadingDialog", {
                    title: t("backupAndResume.resumeFromLocalFile"),
                    loadingText: t("backupAndResume.resuming"),
                    async task() {
                        await delay(300, false);
                        return Backup.resume(result, resumeMode);
                    },
                    onResolve(_, hideDialog) {
                        Toast.success(t("toast.resumeSuccess"));
                        hideDialog();
                        resolve(true);
                    },
                    onCancel(hideDialog) {
                        hideDialog();
                        resolve(false);
                    },
                    onReject(reason, hideDialog) {
                        hideDialog();
                        resolve(false);
                        console.log(reason);
                        Toast.warn(t("toast.resumeFail", { reason: reason?.message ?? reason }));
                    },
                });
            });
        } catch (e: any) {
            errorLog("恢复失败", e);
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onResumeFromUrl() {
        showPanel("SimpleInput", {
            title: t("backupAndResume.resumeFromUrlDialogTitle"),
            placeholder: t("backupAndResume.resumeFromUrlDialogPlaceHolder"),
            maxLength: 1024,
            async onOk(text, closePanel) {
                try {
                    const url = text.trim();
                    if (url.endsWith(".json") || url.endsWith(".txt")) {
                        const raw = (await axios.get(text)).data;
                        await Backup.resume(raw, resumeMode);
                        Toast.success(t("toast.resumeSuccess"));
                        closePanel();
                    } else {
                        throw "无效的URL";
                    }
                } catch (e: any) {
                    Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
                }
            },
        });
    }

    async function onResumeFromWebdav() {
        const url = Config.getConfig("webdav.url");
        const username = Config.getConfig("webdav.username");
        const password = Config.getConfig("webdav.password");

        if (!(username && password && url)) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }
        // 复用云盘的 client：它修掉了 RN 下 `AuthType.Password` 不发凭据的问题
        // （改用 AuthType.None + 显式 Authorization），并带上目标服务要求的 UA。
        // 原先这里直接用 `createClient({authType: AuthType.Password})`，
        // 请求不带认证 → 恢复自然「没有效果」。
        const client = createCloudDiskClient();
        if (!client) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }

        // 路径口径与「自动对账」写的备份保持一致（经兼容层映射）；
        // 同时兼容未映射的旧路径，逐个探测。
        const storedPath = toStoredPath(REMOTE_BACKUP_PATH);
        const candidatePaths = Array.from(
            new Set([storedPath, REMOTE_BACKUP_PATH]),
        );
        let existedPath: string | null = null;
        for (const p of candidatePaths) {
            try {
                if (await client.exists(p)) {
                    existedPath = p;
                    break;
                }
            } catch (e) {
                // 探测失败就试下一个
            }
        }
        if (!existedPath) {
            Toast.warn(t("toast.backupFileNotFound"));
            return;
        }

        try {
            const resumeData = await client.getFileContents(existedPath, {
                format: "text",
            });
            await Backup.resume(
                resumeData,
                Config.getConfig("backup.resumeMode"),
            );
            Toast.success(t("toast.resumeSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.resumeFail", { reason: e?.message ?? e }));
        }
    }

    async function onBackupToWebdav() {
        const username = Config.getConfig("webdav.username");
        const password = Config.getConfig("webdav.password");
        const url = Config.getConfig("webdav.url");
        if (!(username && password && url)) {
            Toast.warn(t("toast.resumePreCheckFailed"));
            return;
        }
        try {
            // 与恢复、自动对账使用同一 client 与同一路径口径
            const client = createCloudDiskClient();
            if (!client) {
                Toast.warn(t("toast.resumePreCheckFailed"));
                return;
            }

            const raw = Backup.backup();
            const storedPath = toStoredPath(REMOTE_BACKUP_PATH);
            // 确保目录存在（createCloudDiskClient 已处理认证与 UA）
            try {
                if (!(await client.exists("/MusicFree"))) {
                    await client.createDirectory("/MusicFree");
                }
            } catch (e) {
                // 目录已存在时忽略
            }
            await client.putFileContents(storedPath, raw, {
                overwrite: true,
            });
            Toast.success(t("toast.backupSuccess"));
        } catch (e: any) {
            Toast.warn(t("toast.backupFail", { reason: e?.message ?? e }));
        }
    }

    return (
        <ScrollView style={style.wrapper}>
            <ListItemHeader>{t("sidebar.backupAndResume")}</ListItemHeader>

            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showDialog("RadioDialog", {
                        title: t("backupAndResume.setResumeMode"),
                        content: [
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Append) as any),
                                value: ResumeMode.Append,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.OverwriteDefault) as any),
                                value: ResumeMode.OverwriteDefault,
                            },
                            {
                                label: t(("backupAndResume.resumeMode." + ResumeMode.Overwrite) as any),
                                value: ResumeMode.Overwrite,
                            },
                        ],
                        onOk(value) {
                            Config.setConfig(
                                "backup.resumeMode",
                                value as any,
                            );
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.resumeMode")} />
                <ListItem.ListItemText>
                    {
                        t(("backupAndResume.resumeMode." + ((resumeMode as ResumeMode) ||
                            ResumeMode.Append)) as any)
                    }
                </ListItem.ListItemText>
            </ListItem>
            <ListItemHeader>{t("backupAndResume.localBackup")}</ListItemHeader>
            <ListItem withHorizontalPadding onPress={onBackupToLocal}>
                <ListItem.Content title={t("backupAndResume.backupToLocal")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromLocal}>
                <ListItem.Content title={t("backupAndResume.resumeFromLocalFile")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromUrl}>
                <ListItem.Content title={t("backupAndResume.resumeFromUrlDialogTitle")} />
            </ListItem>
            <ListItemHeader>Webdav</ListItemHeader>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    showPanel("SetUserVariables", {
                        title: t("backupAndResume.webdavSettings"),
                        initValues: {
                            url: webdavUrl ?? "",
                            username: webdavUsername ?? "",
                            password: webdavPassword ?? "",
                        },
                        variables: [
                            {
                                key: "url",
                                name: "URL",
                                hint: t("backupAndResume.webdavUrl"),
                            },
                            {
                                key: "username",
                                name: t("common.username"),
                            },
                            {
                                key: "password",
                                name: t("common.password"),
                            },
                        ],
                        onOk(values, closePanel) {
                            Config.setConfig("webdav.url", values?.url);
                            Config.setConfig("webdav.username", values?.username);
                            Config.setConfig("webdav.password", values?.password);

                            Toast.success(t("toast.saveSuccess"));
                            closePanel();
                        },
                    });
                }}>
                <ListItem.Content title={t("backupAndResume.webdavSettings")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onBackupToWebdav}>
                <ListItem.Content title={t("backupAndResume.backupToWebdav")} />
            </ListItem>
            <ListItem withHorizontalPadding onPress={onResumeFromWebdav}>
                <ListItem.Content title={t("backupAndResume.resumeFromWebdav")} />
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    Config.setConfig("backup.autoBackup", !autoBackup);
                }}>
                <ListItem.Content
                    title={t("backupAndResume.autoSync")}
                />
                <ThemeSwitch
                    value={!!autoBackup}
                    onValueChange={value => {
                        Config.setConfig("backup.autoBackup", value);
                    }}
                />
            </ListItem>
            <ListItem
                withHorizontalPadding
                onPress={() => {
                    Config.setConfig(
                        "backup.uploadLocalFiles",
                        !uploadLocalFiles,
                    );
                }}>
                <ListItem.Content
                    title={t("backupAndResume.uploadLocalFiles")}
                />
                <ThemeSwitch
                    value={!!uploadLocalFiles}
                    onValueChange={value => {
                        Config.setConfig("backup.uploadLocalFiles", value);
                    }}
                />
            </ListItem>
        </ScrollView>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});
