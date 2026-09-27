import React, { memo, useEffect, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { CircularProgressBase } from "react-native-circular-progress-indicator";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showPanel } from "../panels/usePanel";
import useColors from "@/hooks/useColors";
import IconButton from "../base/iconButton";
import TrackPlayer, { useCurrentMusic, useMusicState, useProgress } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import MusicInfo from "./musicInfo";
import Icon from "@/components/base/icon.tsx";
import { FocusIconButton, getCurrentFocusId, getFocusable } from "@/core/focus";
import { useHardwareKeyPress, KEY_PRIORITY } from "@/core/keyboard";

/** 播放栏内的焦点组名：←→ 由播放栏自己处理（快退/快进），↑↓ 交给全局焦点导航 */
export const MUSIC_BAR_FOCUS_GROUP = "music-bar";

/** ←→ 快进/快退步长（秒） */
const SEEK_STEP_SECONDS = 10;

function CircularPlayBtn() {
    const progress = useProgress();
    const musicState = useMusicState();
    const colors = useColors();

    const isPaused = musicIsPaused(musicState);

    return (
        <FocusIconButton
            focusId="music-bar-play"
            group={MUSIC_BAR_FOCUS_GROUP}
            borderRadius={rpx(36)}
            style={style.barButton}>
            <CircularProgressBase
                activeStrokeWidth={rpx(4)}
                inActiveStrokeWidth={rpx(2)}
                inActiveStrokeOpacity={0.2}
                value={
                    progress?.duration
                        ? (100 * progress.position) / progress.duration
                        : 0
                }
                duration={100}
                radius={rpx(36)}
                activeStrokeColor={colors.musicBarText}
                inActiveStrokeColor={colors.textSecondary}>
                <IconButton
                    accessibilityLabel={"播放或暂停歌曲"}
                    name={isPaused ? "play" : "pause"}
                    sizeType={"normal"}
                    hitSlop={{
                        top: 10,
                        left: 10,
                        right: 10,
                        bottom: 10,
                    }}
                    color={colors.musicBarText}
                    onPress={async () => {
                        if (isPaused) {
                            await TrackPlayer.play();
                        } else {
                            await TrackPlayer.pause();
                        }
                    }}
                />
            </CircularProgressBase>
        </FocusIconButton>
    );
}
function MusicBar() {
    const musicItem = useCurrentMusic();

    const [showKeyboard, setKeyboardStatus] = useState(false);

    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();

    useEffect(() => {
        const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
            setKeyboardStatus(true);
        });
        const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
            setKeyboardStatus(false);
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    // 焦点在播放栏内时：←→ 快退/快进，↑↓ 交回全局焦点导航
    useHardwareKeyPress(
        context => {
            const direction = context.semanticKey;
            if (direction !== "left" && direction !== "right") {
                return false;
            }
            const currentId = getCurrentFocusId();
            if (!currentId) {
                return false;
            }
            const item = getFocusable(currentId);
            if (item?.group !== MUSIC_BAR_FOCUS_GROUP) {
                return false;
            }
            const delta =
                (direction === "right" ? 1 : -1) * SEEK_STEP_SECONDS;
            TrackPlayer.getProgress()
                .then(progress => {
                    const duration = progress?.duration ?? 0;
                    const target = Math.max(
                        0,
                        Math.min(duration || Infinity, progress.position + delta),
                    );
                    return TrackPlayer.seekTo(target);
                })
                .catch(() => {
                    // 没有在播放时忽略
                });
            return true;
        },
        [],
        KEY_PRIORITY.PAGE,
        "MusicBar.seek",
    );

    return (
        <>
            {musicItem && !showKeyboard && (
                <View
                    style={[
                        style.wrapper,
                        {
                            backgroundColor: colors.musicBar,
                            paddingRight: safeAreaInsets.right + rpx(24),
                        },
                    ]}
                    accessible
                    accessibilityLabel={`歌曲: ${musicItem.title} 歌手: ${musicItem.artist}`}
                    // onPress={() => {
                    //     navigate(ROUTE_PATH.MUSIC_DETAIL);
                    // }}
                >
                    <MusicInfo musicItem={musicItem} />
                    <View style={style.actionGroup}>
                        <CircularPlayBtn />
                        <FocusIconButton
                            focusId="music-bar-playlist"
                            group={MUSIC_BAR_FOCUS_GROUP}
                            index={1}
                            borderRadius={rpx(12)}
                            style={style.barButton}>
                            <Icon
                                accessible={false}
                                accessibilityLabel="播放列表"
                                name="playlist"
                                size={rpx(56)}
                                onPress={() => {
                                    showPanel("PlayList");
                                }}
                                color={colors.musicBarText}
                                style={[style.actionIcon]}
                            />
                        </FocusIconButton>
                    </View>
                </View>
            )}
        </>
    );
}

export default memo(MusicBar, () => true);

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        height: rpx(132),
        flexDirection: "row",
        alignItems: "center",
        paddingRight: rpx(24),
    },
    actionGroup: {
        width: rpx(200),
        justifyContent: "flex-end",
        flexDirection: "row",
        alignItems: "center",
    },
    actionIcon: {
        marginLeft: rpx(36),
    },
    barButton: {
        paddingHorizontal: rpx(12),
        paddingVertical: rpx(8),
    },
});
