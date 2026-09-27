/**
 * 快捷键配置的读写与响应式订阅。
 *
 * 持久化落在 `AppConfig`（MMKV）的 `keyboard.shortcuts`，
 * 结构是 `键位 → 动作 id`；未在配置里的键位使用动作的默认键位。
 */
import Config from "@/core/appConfig";
import {
    createDefaultKeyMap,
    ShortcutActionId,
    SHORTCUT_ACTION_MAP,
    SHORTCUT_ACTIONS,
} from "./actions";

const CONFIG_KEY = "keyboard.shortcuts" as const;

/** 配置状态 */
let keyMap: Record<string, ShortcutActionId> = createDefaultKeyMap();
let loaded = false;

const listeners = new Set<() => void>();
let version = 0;

function notify() {
    version += 1;
    listeners.forEach(listener => {
        try {
            listener();
        } catch (e) {
            console.warn("[Shortcut] listener error", e);
        }
    });
}

/** 只保留合法动作 id 的配置项 */
function sanitize(
    raw: Record<string, unknown> | undefined,
): Record<string, ShortcutActionId> | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const result: Record<string, ShortcutActionId> = {};
    Object.keys(raw).forEach(key => {
        const actionId = raw[key];
        if (typeof actionId === "string" && SHORTCUT_ACTION_MAP[actionId]) {
            result[key] = actionId as ShortcutActionId;
        }
    });
    return result;
}

/** 从配置读取（幂等，首次调用时加载） */
export function setupShortcut() {
    if (loaded) {
        return;
    }
    loaded = true;
    const saved = sanitize(
        Config.getConfig(CONFIG_KEY) as Record<string, unknown> | undefined,
    );
    // 配置存在时以配置为准（允许用户清空某个键位）
    keyMap = saved ?? createDefaultKeyMap();
    notify();
}

/** 当前键位映射（只读） */
export function getKeyMap(): Record<string, ShortcutActionId> {
    return keyMap;
}

/** 快照版本号 */
export function getShortcutVersion(): number {
    return version;
}

/** 订阅配置变化 */
export function subscribeShortcut(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function persist() {
    Config.setConfig(CONFIG_KEY, keyMap);
}

/** 把某个键位绑定到动作（覆盖该键位原有绑定） */
export function bindKey(binding: string, actionId: ShortcutActionId | null) {
    const next = { ...keyMap };
    if (actionId) {
        next[binding] = actionId;
    } else {
        delete next[binding];
    }
    keyMap = next;
    persist();
    notify();
}

/** 把某个动作绑到新键位（先清掉该动作的其它键位，保证一个动作一键） */
export function rebindAction(
    actionId: ShortcutActionId,
    newBinding: string,
) {
    const next: Record<string, ShortcutActionId> = {};
    Object.keys(keyMap).forEach(key => {
        if (keyMap[key] !== actionId) {
            next[key] = keyMap[key];
        }
    });
    // 新键位如果被别的动作占用，由调用方通过冲突检测提示
    next[newBinding] = actionId;
    keyMap = next;
    persist();
    notify();
}

/** 恢复默认键位 */
export function resetShortcut() {
    keyMap = createDefaultKeyMap();
    persist();
    notify();
}

/** 取某动作当前绑定的键位 */
export function getActionKeys(actionId: ShortcutActionId): string[] {
    return Object.keys(keyMap).filter(key => keyMap[key] === actionId);
}

/** 某键位当前绑定的动作 */
export function getKeyAction(binding: string): ShortcutActionId | undefined {
    return keyMap[binding];
}

/**
 * 该键位是否被用户显式处理过。
 *
 * 用户把某键位从配置里删掉（解绑）后，配置里就没有这个键；
 * 而首次启动时配置里也没有这个键——两者的区别是：
 * 配置存在（`loaded` 且非空对象）说明用户改过，未命中即视为解绑。
 */
export function isKeyMapCustomized(): boolean {
    const saved = Config.getConfig(CONFIG_KEY);
    return !!saved && typeof saved === "object";
}

/** 取某键位的生效动作：用户配置优先，其次默认键位（未被解绑时） */
export function resolveKeyAction(
    binding: string,
): ShortcutActionId | undefined {
    const configured = keyMap[binding];
    if (configured) {
        return configured;
    }
    const customized = isKeyMapCustomized();
    const defaultValue = createDefaultKeyMap()[binding];
    if (!defaultValue) {
        return undefined;
    }
    // 用户改过配置 → 以配置为准（未命中即解绑）
    if (customized) {
        return undefined;
    }
    return defaultValue;
}

/** 找出被多个动作占用的键位（正常不应出现，用于自检） */
export function findConflicts(): string[] {
    const seen = new Set<string>();
    const conflicts: string[] = [];
    Object.keys(keyMap).forEach(key => {
        if (seen.has(key)) {
            conflicts.push(key);
        }
        seen.add(key);
    });
    return conflicts;
}

/**
 * 校验一个键位是否可以绑给指定动作。
 *
 * @returns `ok: false` 时 `reason` 说明原因（用于设置页标红）
 */
export function validateBinding(
    binding: string,
    actionId: ShortcutActionId,
    reservedChecker: (binding: string) => boolean,
): { ok: boolean; reason?: string; conflictActionId?: ShortcutActionId } {
    if (reservedChecker(binding)) {
        return { ok: false, reason: "reserved" };
    }
    const owner = keyMap[binding];
    if (owner && owner !== actionId) {
        return { ok: false, reason: "conflict", conflictActionId: owner };
    }
    return { ok: true };
}

/** 所有动作的当前键位（设置页渲染用） */
export function getActionKeyPairs() {
    return SHORTCUT_ACTIONS.map(action => ({
        action,
        keys: getActionKeys(action.id),
    }));
}
