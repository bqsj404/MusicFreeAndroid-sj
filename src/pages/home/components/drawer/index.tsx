import Divider from "@/components/base/divider";
import { IIconName } from "@/components/base/icon.tsx";
import ListItem from "@/components/base/listItem";
import PageBackground from "@/components/base/pageBackground";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer from "@/core/trackPlayer";
import { checkUpdateAndShowResult } from "@/hooks/useCheckUpdate.ts";
import NativeUtils from "@/native/utils";
import rpx from "@/utils/rpx";
import { useScheduleCloseCountDown } from "@/utils/scheduleClose";
import timeformat from "@/utils/timeformat";
import { DrawerContentScrollView } from "@react-navigation/drawer";
import React, { memo, useEffect } from "react";
import { BackHandler, Platform, StyleSheet, View } from "react-native";
import { default as DeviceInfo, default as deviceInfoModule } from "react-native-device-info";
import { registerFocusGroup, getFocusable } from "@/core/focus";
import { useDrawerStatus } from "@react-navigation/drawer";
import { useHardwareKeyPress } from "@/core/keyboard";

const ITEM_HEIGHT = rpx(108);

/** 侧栏焦点组名 */
const DRAWER_FOCUS_GROUP = "drawer-menu";

interface ISettingOptions {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

function HomeDrawer(props: any) {
    const navigate = useNavigate();
    function navigateToSetting(settingType: string) {
        navigate(ROUTE_PATH.SETTING, {
            type: settingType,
        });
    }

    const { t, getSupportedLanguages, getLanguage, setLanguage } = useI18N();

    // 侧栏项参与硬件键盘 / 遥控器焦点导航
    const drawerStatus = useDrawerStatus();
    /** 只有侧栏打开时才注册焦点项，否则关闭的抽屉会抢走主页的焦点 */
    const drawerFocusEnabled = drawerStatus === "open";
    useEffect(() => {
        if (!drawerFocusEnabled) {
            return;
        }
        const unregister = registerFocusGroup(DRAWER_FOCUS_GROUP, "sequence");
        // 侧栏打开后把焦点主动落到第一项：抽屉会盖住主内容，
        // 不主动接管的话键盘焦点还停在背后的页面上
        const timer = setTimeout(() => {
            getFocusable("drawer-basic-0")?.focus();
        }, 200);
        return () => {
            clearTimeout(timer);
            unregister();
        };
    }, [drawerFocusEnabled]);

    // 侧栏打开时：Esc 关闭侧栏（对齐桌面版 Esc 分层仲裁）
    useHardwareKeyPress(
        context => {
            if (!drawerFocusEnabled) {
                return false;
            }
            if (context.semanticKey === "escape") {
                (props.navigation as any)?.closeDrawer?.();
                return true;
            }
            return false;
        },
        [drawerFocusEnabled],
        10,
        "HomeDrawer.close",
    );

    const basicSetting: ISettingOptions[] = [
        {
            icon: "cog-8-tooth",
            title: t("sidebar.basicSettings"),
            onPress: () => {
                navigateToSetting("basic");
            },
        }, {
            icon: "javascript",
            title: t("sidebar.pluginManagement"),
            onPress: () => {
                navigateToSetting("plugin");
            },
        },
        {
            icon: "t-shirt-outline",
            title: t("sidebar.themeSettings"),
            onPress: () => {
                navigateToSetting("theme");
            },
        },
        {
            icon: "bars-3",
            title: t("setting.shortcut.title"),
            onPress: () => {
                navigateToSetting("shortcut");
            },
        },
    ];

    const otherSetting: ISettingOptions[] = [
        {
            icon: "circle-stack",
            title: t("sidebar.backupAndResume"),
            onPress: () => {
                navigateToSetting("backup");
            },
        },
    ];

    if (Platform.OS === "android") {
        otherSetting.push({
            icon: "shield-keyhole-outline",
            title: t("sidebar.permissionManagement"),
            onPress: () => {
                navigate(ROUTE_PATH.PERMISSIONS);
            },
        });
    }


    return (
        <>
            <PageBackground />
            <DrawerContentScrollView {...[props]} style={style.scrollWrapper}>
                <View style={style.header}>
                    <ThemeText fontSize="appbar" fontWeight="bold">
                        {DeviceInfo.getApplicationName()}
                    </ThemeText>
                    {/* <IconButton icon={'qrcode-scan'} size={rpx(36)} /> */}
                </View>
                <View style={style.card}>
                    <ListItem withHorizontalPadding heightType="smallest">
                        <ListItem.ListItemText
                            fontSize="subTitle"
                            fontWeight="bold">
                            {t("common.setting")}
                        </ListItem.ListItemText>
                    </ListItem>
                    {basicSetting.map((item, index) => (
                        <ListItem
                            withHorizontalPadding
                            key={"basic-setting-" + index}
                            focusId={drawerFocusEnabled ? `drawer-basic-${index}` : undefined}
                            focusGroup={DRAWER_FOCUS_GROUP}
                            focusIndex={index}
                            onPress={item.onPress}>
                            <ListItem.ListItemIcon
                                icon={item.icon}
                                width={rpx(48)}
                            />
                            <ListItem.Content title={item.title} />
                        </ListItem>
                    ))}
                </View>
                <View style={style.card}>
                    <ListItem withHorizontalPadding heightType="smallest">
                        <ListItem.ListItemText
                            fontSize="subTitle"
                            fontWeight="bold">
                            {t("common.other")}
                        </ListItem.ListItemText>
                    </ListItem>
                    <CountDownItem />
                    {otherSetting.map((item, index) => (
                        <ListItem
                            withHorizontalPadding
                            key={"other-setting-" + index}
                            focusId={drawerFocusEnabled ? `drawer-other-${index}` : undefined}
                            focusGroup={DRAWER_FOCUS_GROUP}
                            focusIndex={100 + index}
                            onPress={item.onPress}>
                            <ListItem.ListItemIcon
                                icon={item.icon}
                                width={rpx(48)}
                            />
                            <ListItem.Content title={item.title} />
                        </ListItem>
                    ))}
                    <ListItem withHorizontalPadding key='language'
                        focusId={drawerFocusEnabled ? "drawer-language" : undefined}
                        focusGroup={DRAWER_FOCUS_GROUP}
                        focusIndex={200}
                        onPress={() => {
                        showDialog("RadioDialog", {
                            "content": getSupportedLanguages().map(item => ({
                                title: item.name,
                                value: item.locale,
                                label: item.name,
                            })),
                            title: t("sidebar.languageSettings"),
                            onOk(value) {
                                setLanguage(value as string);
                            },
                            defaultSelected: getLanguage().locale,
                        });
                    }}>
                        <ListItem.ListItemIcon icon='language' width={rpx(48)} />
                        <ListItem.Content title={t("sidebar.languageSettings")} />
                        <ListItem.ListItemText fontSize='subTitle' position='right'>{getLanguage().name}</ListItem.ListItemText>
                    </ListItem>
                </View>

                <View style={style.card}>
                    <ListItem withHorizontalPadding heightType="smallest">
                        <ListItem.ListItemText
                            fontSize="subTitle"
                            fontWeight="bold">
                            {t("common.software")}
                        </ListItem.ListItemText>
                    </ListItem>

                    <ListItem
                        withHorizontalPadding
                        key={"update"}
                        focusId={drawerFocusEnabled ? "drawer-update" : undefined}
                        focusGroup={DRAWER_FOCUS_GROUP}
                        focusIndex={300}
                        onPress={() => {
                            checkUpdateAndShowResult(true);
                        }}>
                        <ListItem.ListItemIcon
                            icon={"arrow-path"}
                            width={rpx(48)}
                        />
                        <ListItem.Content title={t("sidebar.checkUpdate")} />
                        <ListItem.ListItemText
                            position="right"
                            fontSize="subTitle">
                            {`${t("sidebar.currentVersion")}${deviceInfoModule.getVersion()}`}
                        </ListItem.ListItemText>
                    </ListItem>
                    <ListItem
                        withHorizontalPadding
                        key={"about"}
                        focusId={drawerFocusEnabled ? "drawer-about" : undefined}
                        focusGroup={DRAWER_FOCUS_GROUP}
                        focusIndex={400}
                        onPress={() => {
                            navigateToSetting("about");
                        }}>
                        <ListItem.ListItemIcon
                            icon={"information-circle"}
                            width={rpx(48)}
                        />
                        <ListItem.Content
                            title={`${t("common.about")} ${deviceInfoModule.getApplicationName()}`}
                        />
                    </ListItem>
                </View>

                <Divider />
                <ListItem
                    withHorizontalPadding
                    onPress={() => {
                        // 仅安卓生效
                        BackHandler.exitApp();
                    }}>
                    <ListItem.ListItemIcon
                        icon={"home-outline"}
                        width={rpx(48)}
                    />
                    <ListItem.Content title={t("sidebar.backToDesktop")} />
                </ListItem>
                <ListItem
                    withHorizontalPadding
                    onPress={async () => {
                        await TrackPlayer.reset();
                        NativeUtils.exitApp();
                    }}>
                    <ListItem.ListItemIcon
                        icon={"power-outline"}
                        width={rpx(48)}
                    />
                    <ListItem.Content title={t("sidebar.exitApp")} />
                </ListItem>
            </DrawerContentScrollView>
        </>
    );
}

export default memo(HomeDrawer, () => true);

const style = StyleSheet.create({
    wrapper: {
        flex: 1,
        backgroundColor: "#999999",
    },
    scrollWrapper: {
        paddingTop: rpx(12),
    },

    header: {
        height: rpx(120),
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginLeft: rpx(24),
    },
    card: {
        marginBottom: rpx(24),
    },
    cardContent: {
        paddingHorizontal: 0,
    },

    /** 倒计时 */
    countDownText: {
        height: ITEM_HEIGHT,
        textAlignVertical: "center",
    },
});

function _CountDownItem() {
    const countDown = useScheduleCloseCountDown();
    const { t } = useI18N();

    return (
        <ListItem
            withHorizontalPadding
            onPress={() => {
                showPanel("TimingClose");
            }}>
            <ListItem.ListItemIcon icon="alarm-outline" width={rpx(48)} />
            <ListItem.Content title={t("sidebar.scheduleClose")} />
            <ListItem.ListItemText position="right" fontSize="subTitle">
                {countDown ? timeformat(countDown) : ""}
            </ListItem.ListItemText>
        </ListItem>
    );
}

const CountDownItem = memo(_CountDownItem, () => true);
