import React from "react";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import DeviceInfo from "react-native-device-info";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import ThemeText from "@/components/base/themeText";
import LinkText from "@/components/base/linkText";
import useCheckUpdate from "@/hooks/useCheckUpdate.ts";
import useOrientation from "@/hooks/useOrientation";
import Divider from "@/components/base/divider";

/** 本变体仓库（sj） */
const FORK_REPO = "https://github.com/bqsj404/MusicFreeAndroid-sj";
/** 原版仓库与官网 */
const UPSTREAM_REPO = "https://github.com/maotoumao/MusicFree";
const UPSTREAM_SITE = "https://musicfree.catcat.work";

export default function AboutSetting() {
    const checkAndShowResult = useCheckUpdate();
    const orientation = useOrientation();
    const version = DeviceInfo.getVersion();

    return (
        <View
            style={[
                style.wrapper,
                orientation === "horizontal"
                    ? {
                        flexDirection: "row",
                    }
                    : null,
            ]}>
            <View
                style={[
                    style.header,
                    orientation === "horizontal" ? style.horizontalSize : null,
                ]}>
                <Image
                    source={ImgAsset.logo}
                    style={style.image}
                    resizeMode="contain"
                />
                <ThemeText style={style.margin}>版本: v{version}</ThemeText>
                <ThemeText style={style.margin}>修改者: 不甚解</ThemeText>
                <TouchableOpacity
                    style={style.margin}
                    onPress={() => {
                        checkAndShowResult(true);
                    }}>
                    <ThemeText style={style.actionText}>检查更新</ThemeText>
                </TouchableOpacity>
            </View>
            <ScrollView
                contentContainerStyle={style.scrollViewContainer}
                style={style.scrollView}>
                <ThemeText fontSize="title">关于本变体</ThemeText>
                <ThemeText style={style.content}>
                    本软件是基于 MusicFree 修改的个人变体（sj），遵循 AGPL 3.0
                    协议开源，完全免费。
                </ThemeText>
                <ThemeText style={style.content}>
                    本变体仓库:{" "}
                    <LinkText linkTo={FORK_REPO}>{FORK_REPO}</LinkText>
                </ThemeText>
                <ThemeText style={style.content}>
                    问题与建议请到本仓库的{" "}
                    <LinkText linkTo={`${FORK_REPO}/issues`}>Issues</LinkText>{" "}
                    反馈。
                </ThemeText>

                <Divider style={style.content} />

                <ThemeText fontSize="title">原版信息</ThemeText>
                <ThemeText style={style.content}>
                    原作者: <ThemeText fontWeight="bold">猫头猫</ThemeText>
                    （公众号【一只猫头猫】）
                </ThemeText>
                <View style={style.contactContainer}>
                    <ThemeText style={style.margin}>
                        B站:{" "}
                        <LinkText linkTo="https://space.bilibili.com/12866223">
                            不想睡觉猫头猫
                        </LinkText>
                    </ThemeText>
                    <ThemeText style={style.margin}>
                        小红书:{" "}
                        <LinkText linkTo="https://www.xiaohongshu.com/user/profile/5ce6085200000000050213a6?xsec_token=YBqVNCKP4kpvphpU5sZI8WC93c5JINc3NhGtRBymgKvuo%3D&xsec_source=app_share&xhsshare=CopyLink&appuid=5ce6085200000000050213a6&apptime=1747275535&share_id=faef5820564a43be80e5b77da887e4b9&share_channel=copy_link">
                            一只猫头猫
                        </LinkText>
                    </ThemeText>
                </View>
                <ThemeText style={style.content}>
                    原版仓库:{" "}
                    <LinkText linkTo={UPSTREAM_REPO}>{UPSTREAM_REPO}</LinkText>
                </ThemeText>
                <ThemeText style={style.content}>
                    原版官网:{" "}
                    <LinkText linkTo={UPSTREAM_SITE}>{UPSTREAM_SITE}</LinkText>
                    （下载地址、使用方式、插件开发方式、常见问题都在站点中）
                </ThemeText>

                <Divider style={style.content} />

                <ThemeText fontSize="title">开源约定</ThemeText>
                <ThemeText style={style.content}>
                    本软件完全免费，并基于{" "}
                    <ThemeText fontWeight="bold">AGPL 3.0 协议</ThemeText>{" "}
                    开源，如果需要使用此代码进行二次开发，请遵守如下约定：
                </ThemeText>
                <ThemeText style={style.content}>
                    1. 二次分发版必须同样遵循 AGPL 3.0 协议，开源且免费
                </ThemeText>
                <ThemeText style={style.content}>
                    2. 合法合规使用代码，不要用于商业用途；修改后的软件造成的任何问题由使用此代码的开发者承担
                </ThemeText>
                <ThemeText style={style.content}>
                    3. 打包、二次分发时请保留代码出处（原版仓库与本变体仓库）
                </ThemeText>
                <ThemeText style={style.content}>
                    4. 如果开源协议变更，将在本仓库更新，不另行通知
                </ThemeText>

                <Divider style={style.content} />

                <ThemeText fontSize="title">插件提示</ThemeText>
                <ThemeText style={style.content}>
                    本软件需要通过插件来完成包括播放、搜索在内的大部分功能，如果你是从第三方下载的插件，
                    <ThemeText fontWeight="bold">
                        请一定谨慎识别这些插件的安全性，保护好自己。
                    </ThemeText>
                    （注意：插件以及插件可能产生的数据与本软件无关，请使用者合理合法使用。）
                </ThemeText>
                <ThemeText style={style.content}>
                    本发行版不包含任何插件或音源，音源需自行在「插件管理」中添加。
                </ThemeText>
            </ScrollView>
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    header: {
        width: rpx(750),
        height: rpx(400),
        justifyContent: "center",
        alignItems: "center",
    },
    contactContainer: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: rpx(24),
    },
    horizontalSize: {
        width: rpx(600),
        height: "100%",
    },
    image: {
        width: rpx(150),
        height: rpx(150),
        borderRadius: rpx(28),
    },
    margin: {
        marginTop: rpx(24),
    },
    actionText: {
        marginTop: rpx(24),
        textDecorationLine: "underline",
    },
    content: {
        marginTop: rpx(24),
        lineHeight: rpx(48),
    },
    scrollView: {
        flex: 1,
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(48),
    },
    scrollViewContainer: {
        paddingBottom: rpx(96),
    },
});
