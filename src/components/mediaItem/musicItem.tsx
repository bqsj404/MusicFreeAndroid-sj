import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import rpx from "@/utils/rpx";
import ListItem from "../base/listItem";

import LocalMusicSheet from "@/core/localMusicSheet";
import { localMusicSheetId } from "@/constants/commonConst";
import { showPanel } from "../panels/usePanel";
import TitleAndTag from "./titleAndTag";
import ThemeText from "../base/themeText";
import TrackPlayer from "@/core/trackPlayer";
import Icon from "@/components/base/icon.tsx";
import { Focusable } from "@/core/focus";
import { useI18N } from "@/core/i18n";

interface IMusicItemProps {
    index?: string | number;
    showMoreIcon?: boolean;
    musicItem: IMusic.IMusicItem;
    musicSheet?: IMusic.IMusicSheetItem;
    onItemPress?: (musicItem: IMusic.IMusicItem) => void;
    onItemLongPress?: () => void;
    itemPaddingRight?: number;
    left?: () => JSX.Element;
    containerStyle?: StyleProp<ViewStyle>;
    highlight?: boolean;
    /** 焦点 id（硬件键盘 / 遥控器导航用）；不传则不参与焦点体系 */
    focusId?: string;
    /** 焦点组名 */
    focusGroup?: string;
    /** 组内序号 */
    focusIndex?: number;
}
export default function MusicItem(props: IMusicItemProps) {
    const {
        musicItem,
        index,
        onItemPress,
        onItemLongPress,
        musicSheet,
        itemPaddingRight,
        showMoreIcon = true,
        left: Left,
        containerStyle,
        highlight = false,
        focusId,
        focusGroup,
        focusIndex,
    } = props;
    const { t } = useI18N();

    /**
     * 第 7 批 · 问题 1：**本地音乐列表内**的条目一律标「本地」。
     *
     * 下载/上传过的歌，文件名是 `平台@id@歌名@歌手`（`downloader.generateFilename`），
     * 扫描入库时 `parseFilename` 会把这个平台名解析回来当 `platform`，
     * 于是本地音乐列表里冒出一条顶着「云盘」标签的歌 —— 用户会觉得莫名其妙。
     *
     * 平台名在这里**不该被当作品类展示**：它只是「回连哪家音源」的身份，
     * 播放时的真实音源由底部播放栏的「音源胶囊」（D1/D18）负责说明。
     *
     * 只在这个列表里改写（而不是"只要在本地库里就改写"）：
     * 云盘音乐页、搜索结果里保持原平台名，标签的语义在同一个列表内才是一致的；
     * 「这首歌本地已经有了」由下面的 ✓ 图标表达，不需要占用标签。
     */
    const isLocal = LocalMusicSheet.isLocalMusic(musicItem);
    const inLocalSheet = musicSheet?.id === localMusicSheetId;
    const platformTag = inLocalSheet ? t("common.local") : musicItem.platform;

    const content = (
        <ListItem
            heightType="big"
            style={containerStyle}
            withHorizontalPadding
            leftPadding={index !== undefined ? 0 : undefined}
            rightPadding={itemPaddingRight}
            onLongPress={onItemLongPress}
            onPress={() => {
                if (onItemPress) {
                    onItemPress(musicItem);
                } else {
                    TrackPlayer.play(musicItem);
                }
            }}>
            {Left ? <Left /> : null}
            {index !== undefined ? (
                <ListItem.ListItemText
                    width={rpx(82)}
                    position="none"
                    fixedWidth
                    fontColor={highlight ? "primary" : "text"}
                    contentStyle={styles.indexText}>
                    {index}
                </ListItem.ListItemText>
            ) : null}
            <ListItem.Content
                title={
                    <TitleAndTag
                        title={musicItem.title}
                        titleFontColor={highlight ? "primary" : "text"}
                        tag={platformTag}
                    />
                }
                description={
                    <View style={styles.descContainer}>
                        {isLocal && (
                            <Icon
                                style={styles.icon}
                                color="#11659a"
                                name="check-circle"
                                size={rpx(22)}
                            />
                        )}
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontColor={highlight ? "primary" : "textSecondary"}>
                            {musicItem.artist}
                            {musicItem.album ? ` - ${musicItem.album}` : ""}
                        </ThemeText>
                    </View>
                }
            />
            {showMoreIcon ? (
                <ListItem.ListItemIcon
                    width={rpx(48)}
                    position="none"
                    icon="ellipsis-vertical"
                    onPress={() => {
                        showPanel("MusicItemOptions", {
                            musicItem,
                            musicSheet,
                        });
                    }}
                />
            ) : null}
        </ListItem>
    );

    if (!focusId) {
        return content;
    }

    return (
        <Focusable
            focusId={focusId}
            group={focusGroup}
            index={focusIndex}
            style={styles.focusContainer}>
            {content}
        </Focusable>
    );
}

const styles = StyleSheet.create({
    icon: {
        marginRight: rpx(6),
    },
    descContainer: {
        flexDirection: "row",
        marginTop: rpx(16),
    },

    indexText: {
        fontStyle: "italic",
        textAlign: "center",
        padding: rpx(2),
    },
    focusContainer: {
        width: "100%",
    },
});
