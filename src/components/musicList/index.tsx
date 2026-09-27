import { RequestStateCode } from "@/constants/commonConst";
import TrackPlayer from "@/core/trackPlayer";
import rpx from "@/utils/rpx";
import { FlashList } from "@shopify/flash-list";
import React, { useRef, useCallback, useState, useEffect, useId } from "react";
import { FlatListProps, Pressable, StyleSheet, View } from "react-native";
import ListEmpty from "../base/listEmpty";
import ListFooter from "../base/listFooter";
import MusicItem from "../mediaItem/musicItem";
import { isSameMediaItem } from "@/utils/mediaUtils";
import Icon from "../base/icon";
import { iconSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { invalidateFocusLayout, registerFocusGroup } from "@/core/focus";

interface IMusicListProps {
    /** 顶部 */
    Header?: FlatListProps<IMusic.IMusicItem>["ListHeaderComponent"];
    /** 音乐列表 */
    musicList?: IMusic.IMusicItem[];
    /** 所在歌单 */
    musicSheet?: IMusic.IMusicSheetItem;
    /** 是否展示序号 */
    showIndex?: boolean;
    /** 点击 */
    onItemPress?: (
        musicItem: IMusic.IMusicItem,
        musicList?: IMusic.IMusicItem[],
    ) => void;
    // 状态
    state: RequestStateCode;
    /** 高亮的音乐 */
    highlightMusicItem?: IMusic.IMusicItem | null;
    onRetry?: () => void;
    onLoadMore?: () => void;
    /**
     * 焦点组名（硬件键盘 / 遥控器导航用）。
     * 传入后列表项会参与焦点体系，↑↓ 按序号在列表内移动。
     */
    focusGroup?: string;
    /** 焦点 id 前缀，同一页面有多个列表时必须区分 */
    focusGroupPrefix?: string;
}
const ITEM_HEIGHT = rpx(120);

/** 音乐列表 */
export default function MusicList(props: IMusicListProps) {
    const {
        Header,
        musicList,
        musicSheet,
        showIndex,
        onItemPress,
        state,
        onRetry,
        onLoadMore,
        highlightMusicItem,
        focusGroup,
        focusGroupPrefix,
    } = props;    
    const colors = useColors();
    const flashListRef = useRef<FlashList<IMusic.IMusicItem>>(null);
    const [showBadge, setShowBadge] = useState(false);
    const hideTimeoutRef = useRef<NodeJS.Timeout>();

    // 焦点组：默认组名 + 实例唯一前缀，避免同页面多个列表互相覆盖
    const listInstanceId = useId();
    const actualFocusGroup = focusGroup ?? "music-list";
    const useFocus = focusGroup !== null;
    const focusPrefix = focusGroupPrefix ?? actualFocusGroup;

    // 注册焦点组：一维列表，↑↓ 按序号顺序移动
    useEffect(() => {
        if (!useFocus) {
            return;
        }
        return registerFocusGroup(`${actualFocusGroup}${listInstanceId}`, "sequence");
    }, [useFocus, actualFocusGroup, listInstanceId]);

    // 查找高亮项的索引
    const highlightIndex = React.useMemo(() => {
        if (!highlightMusicItem || !musicList) return -1;
        return musicList.findIndex(item => isSameMediaItem(item, highlightMusicItem));
    }, [highlightMusicItem, musicList]);    
    
    // 处理滚动开始
    const handleScrollBegin = useCallback(() => {
        if (highlightIndex !== -1) {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
            setShowBadge(true);
        }
    }, [highlightIndex]);
    
    // 处理滚动结束
    const handleScrollEnd = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        // 5秒后直接隐藏
        hideTimeoutRef.current = setTimeout(() => {
            setShowBadge(false);
        }, 5000);
    }, []);    
    
    // 滚动到高亮项
    const scrollToHighlight = useCallback(() => {
        if (highlightIndex !== -1 && flashListRef.current) {
            flashListRef.current.scrollToIndex({
                index: highlightIndex,
                animated: false,
                viewPosition: 0,
            });
            // 立即隐藏角标
            setShowBadge(false);
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        }
    }, [highlightIndex]);    
    
    // 清理定时器
    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, []);    
    
    return (
        <View style={styles.container}>
            <FlashList
                ref={flashListRef}
                ListHeaderComponent={Header}
                ListEmptyComponent={<ListEmpty state={state} onRetry={onRetry} />}
                ListFooterComponent={
                    musicList?.length ? <ListFooter state={state} onRetry={onRetry} /> : null
                }
                extraData={highlightMusicItem}
                data={musicList ?? []}
                estimatedItemSize={ITEM_HEIGHT}
                onScroll={invalidateFocusLayout}
                onScrollBeginDrag={handleScrollBegin}
                onScrollEndDrag={handleScrollEnd}
                onMomentumScrollEnd={handleScrollEnd}
                renderItem={({ index, item: musicItem }) => {
                    return (
                        <MusicItem
                            key={musicItem.id ?? index}
                            musicItem={musicItem}
                            index={showIndex ? index + 1 : undefined}
                            focusId={
                                useFocus
                                    ? `${focusPrefix}${listInstanceId}-${
                                          musicItem.id ?? index
                                      }`
                                    : undefined
                            }
                            focusGroup={
                                useFocus
                                    ? `${actualFocusGroup}${listInstanceId}`
                                    : undefined
                            }
                            focusIndex={index}
                            onItemPress={() => {
                                // D18：统一记录队列来源。
                                // 放在这里而不是各页面 —— 所有列表都复用本组件，
                                // 且 `musicSheet` 本来就是它的入参，注入点唯一。
                                if (musicSheet) {
                                    TrackPlayer.setQueueSource(musicSheet);
                                }
                                if (onItemPress) {
                                    onItemPress(musicItem, musicList);
                                } else {
                                    TrackPlayer.playWithReplacePlayList(
                                        musicItem,
                                        musicList ?? [musicItem],
                                    );
                                }
                            }}
                            musicSheet={musicSheet}
                            highlight={isSameMediaItem(musicItem, highlightMusicItem)}
                        />
                    );
                }}
                onEndReached={() => {
                    if (state === RequestStateCode.IDLE || state === RequestStateCode.PARTLY_DONE) {
                        onLoadMore?.();
                    }
                }}
                onEndReachedThreshold={0.1}
            />              
            {showBadge && (
                <View style={styles.badge} pointerEvents="box-none">
                    <Pressable
                        style={[styles.badgeButton, { backgroundColor: colors.notification }]}
                        onPress={scrollToHighlight}
                    >
                        <Icon
                            name="crosshair"
                            size={iconSizeConst.normal}
                            color={colors.text}
                        />
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    badge: {
        position: "absolute",
        bottom: rpx(80),
        right: rpx(84),
        zIndex: 1000,
    },
    badgeButton: {
        width: rpx(64),
        height: rpx(64),
        borderRadius: rpx(32),
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
});
