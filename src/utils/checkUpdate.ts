import axios from "axios";
import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";

/**
 * 本变体（sj）的更新源，按顺序尝试。
 * 说明：仓库 https://github.com/bqsj404/MusicFreeAndroid-sj，version.json 位于 release/ 目录；
 * 同时列出 sj / master / main 三个分支，避免分支重命名或合并后源失效。
 */
const updateList = [
    "https://raw.githubusercontent.com/bqsj404/MusicFreeAndroid-sj/sj/release/version.json",
    "https://raw.githubusercontent.com/bqsj404/MusicFreeAndroid-sj/master/release/version.json",
    "https://raw.githubusercontent.com/bqsj404/MusicFreeAndroid-sj/main/release/version.json",
    "https://cdn.jsdelivr.net/gh/bqsj404/MusicFreeAndroid-sj@master/release/version.json",
];

/**
 * 原版（上游）更新源：仅用于「查看原版是否有更新」，
 * 不参与本变体的更新提示，避免把用户引导去下载原版。
 */
export const upstreamUpdateList = [
    "https://gitee.com/maotoumao/MusicFree/raw/master/release/version.json",
    "https://raw.githubusercontent.com/maotoumao/MusicFree/master/release/version.json",
    "https://cdn.jsdelivr.net/gh/maotoumao/MusicFree@master/release/version.json",
];

interface IUpdateInfo {
    needUpdate: boolean;
    data: {
        version: string;
        changeLog: string[];
        download: string[];
    };
}

/** 依次尝试各个源，返回第一个「比当前版本更新」的结果 */
async function fetchUpdateInfo(
    list: string[],
): Promise<IUpdateInfo | undefined> {
    const currentVersion = DeviceInfo.getVersion();
    for (let i = 0; i < list.length; ++i) {
        try {
            const rawInfo = (await axios.get(list[i])).data;
            if (compare(rawInfo.version, currentVersion, ">")) {
                return {
                    needUpdate: true,
                    data: rawInfo,
                };
            }
        } catch {}
    }
}

/** 检查本变体更新（默认行为） */
export default async function checkUpdate(): Promise<IUpdateInfo | undefined> {
    return fetchUpdateInfo(updateList);
}

/** 检查原版更新（供「原版信息」相关入口使用） */
export async function checkUpstreamUpdate(): Promise<
    IUpdateInfo | undefined
> {
    return fetchUpdateInfo(upstreamUpdateList);
}
