/**
 * 硬件按键分发注册表。
 *
 * 职责：
 *  1. 订阅原生桥事件，把原始 KeyEvent 归一成 [HardwareKeyEvent]（带语义键与设备类型）
 *  2. 只把 ACTION_DOWN 派发给处理器（ACTION_UP 仅用于长按结束，默认不派发）
 *  3. 提供优先级 + 分层（layer）两种注册方式，上层（浮层/页面）优先于下层
 *  4. 把处理结果回传原生（是否消费），未消费时交回系统的默认焦点移动
 *
 * 设计约定：
 *  - 处理器返回 `true` 表示已消费，事件不再向下传递
 *  - 方向键的几何导航由焦点系统注册的处理器接管（见 `src/core/focus`）
 *  - 快捷键动作在更低优先级注册，便于「浮层优先」的语义
 */
import { DeviceEventEmitter, EmitterSubscription } from "react-native";
import {
    AndroidKeyCode,
    HardwareKeyAction,
    HardwareKeyEvent,
    getDeviceKind,
    isArrowKey,
    isConfirmKey,
    keyCodeToSemanticKey,
    modifierPrefix,
    SemanticKey,
} from "./keyCodes";

export const KEYBOARD_EVENT_NAME = "hardwareKeyboardKey";

/** 处理上下文 */
export interface HardwareKeyContext {
    /** 归一后的事件 */
    event: HardwareKeyEvent;
    /** 语义键（未登记的键为 undefined） */
    semanticKey?: SemanticKey;
    /** 键位标识（含修饰键） */
    binding?: string;
    /** 是否方向键 */
    isArrow: boolean;
    /** 是否确认键 */
    isConfirm: boolean;
    /** 长按重复触发 */
    isRepeat: boolean;
    /** 是否首次按下（repeatCount === 0） */
    isFirstPress: boolean;
}

/** 按键处理器 */
export interface HardwareKeyHandler {
    /** 可读名称，仅用于调试 */
    name: string;
    /** 数值越小越先被调用（等价于优先级越高） */
    priority?: number;
    handle: (context: HardwareKeyContext) => boolean | void;
}

interface RegisteredHandler {
    handler: HardwareKeyHandler;
    /** 所属分层；非空时仅在层激活期间生效 */
    layer?: number;
    /** 是否只处理首次按下（默认 true，长按不重复触发） */
    firstPressOnly: boolean;
}

/** 默认优先级：小 → 先执行 */
export const KEY_PRIORITY = {
    /** 浮层 / 模态（最优先） */
    OVERLAY: 10,
    /** 当前页面的导航逻辑 */
    PAGE: 100,
    /** 全局焦点移动 */
    FOCUS: 500,
    /** 全局快捷键 */
    SHORTCUT: 900,
} as const;

let subscription: EmitterSubscription | null = null;
let handlers: RegisteredHandler[] = [];
let devLogging = false;
/** 分层栈（后进先出），元素为分层 id */
let layerStack: number[] = [];
let layerSeed = 0;

/** 最近一次按键是否被 JS 消费（调试用） */
let lastConsumed = false;

/** 最近一次按键（调试 / 自检用） */
let lastEvent: HardwareKeyEvent | null = null;

/** 归一化原生事件 */
function normalize(raw: Partial<HardwareKeyEvent> & { keyCode: number }): HardwareKeyEvent {
    const event: HardwareKeyEvent = {
        type: "key",
        keyCode: raw.keyCode,
        action: (raw.action ?? 0) as HardwareKeyAction,
        repeatCount: raw.repeatCount ?? 0,
        unicodeChar: raw.unicodeChar ?? 0,
        ctrl: !!raw.ctrl,
        alt: !!raw.alt,
        shift: !!raw.shift,
        timestamp: raw.timestamp ?? Date.now(),
    };
    return event;
}

/** 构造处理上下文 */
export function createKeyContext(event: HardwareKeyEvent): HardwareKeyContext {
    const semanticKey = keyCodeToSemanticKey(event.keyCode);
    return {
        event,
        semanticKey,
        binding: semanticKey
            ? `${modifierPrefix(event)}${semanticKey}`
            : undefined,
        isArrow: isArrowKey(event.keyCode),
        isConfirm: isConfirmKey(event.keyCode),
        isRepeat: event.repeatCount > 0,
        isFirstPress: event.repeatCount === 0,
    };
}

/** 按优先级 + 分层顺序派发；返回是否被消费 */
function dispatch(context: HardwareKeyContext): boolean {
    const layer = currentLayerId();
    const ordered = handlers
        .filter(item => !item.layer || item.layer === layer)
        .slice()
        .sort((a, b) => (a.handler.priority ?? 1000) - (b.handler.priority ?? 1000));

    for (const item of ordered) {
        if (item.firstPressOnly && !context.isFirstPress) {
            continue;
        }
        try {
            if (item.handler.handle(context) === true) {
                if (devLogging) {
                    console.log(
                        "[Keyboard] consumed by",
                        item.handler.name,
                        context.binding ?? context.event.keyCode,
                    );
                }
                return true;
            }
        } catch (e) {
            console.warn("[Keyboard] handler error:", item.handler.name, e);
        }
    }
    return false;
}

/** 当前栈顶分层 id */
function currentLayerId(): number | undefined {
    return layerStack.length ? layerStack[layerStack.length - 1] : undefined;
}

/** 内部：处理一条原生事件 */
function onRawEvent(raw: Partial<HardwareKeyEvent> & { keyCode: number }) {
    if (raw.action === 1) {
        // ACTION_UP 暂不派发；保留给后续「长按结束」类交互
        return;
    }
    const event = normalize(raw);
    lastEvent = event;
    const context = createKeyContext(event);

    if (devLogging) {
        console.log(
            "[Keyboard]",
            JSON.stringify({
                keyCode: event.keyCode,
                semantic: context.semanticKey,
                binding: context.binding,
                device: getDeviceKind(event.keyCode),
                repeat: event.repeatCount,
            }),
        );
    }

    lastConsumed = dispatch(context);
    if (devLogging && !lastConsumed) {
        console.log("[Keyboard] unhandled", context.binding ?? event.keyCode);
    }
}

/** 初始化按键桥（幂等）。应在 App 启动时调用一次 */
export function setupKeyboardBridge() {
    if (subscription) {
        return;
    }
    subscription = DeviceEventEmitter.addListener(
        KEYBOARD_EVENT_NAME,
        onRawEvent,
    );
}

/** 释放按键桥 */
export function teardownKeyboardBridge() {
    subscription?.remove();
    subscription = null;
}

/**
 * 注册按键处理器，返回取消函数。
 *
 * @param handler  处理器
 * @param options  layer：限定生效分层（由 [pushKeyLayer] 返回）；firstPressOnly：长按不重复触发（默认 true）
 */
export function registerKeyHandler(
    handler: HardwareKeyHandler,
    options: {
        layer?: number;
        firstPressOnly?: boolean;
    } = {},
) {
    const item: RegisteredHandler = {
        handler,
        layer: options.layer,
        firstPressOnly: options.firstPressOnly ?? true,
    };
    handlers = [...handlers, item];
    return () => {
        handlers = handlers.filter(_ => _ !== item);
    };
}

/**
 * 注册一组按键处理器（同一函数内注册多个），返回统一取消函数。
 */
export function registerKeyHandlers(items: HardwareKeyHandler[]) {
    const disposers = items.map(item => registerKeyHandler(item));
    return () => disposers.forEach(dispose => dispose());
}

/**
 * 进入一个按键分层（例如打开浮层）。
 *
 * 分层生效期间，属于该分层的处理器会先于全局处理器执行；
 * 未匹配到处理器时是否落到下层由调用方在浮层处理器中返回 true 决定。
 *
 * 返回 { layer, pop }，layer 用于注册处理器，pop 退出分层（栈式，可嵌套）。
 */
export function pushKeyLayer(): {
    layer: number;
    pop: () => void;
} {
    const id = ++layerSeed;
    layerStack = [...layerStack, id];
    return {
        layer: id,
        pop: () => {
            layerStack = layerStack.filter(_ => _ !== id);
        },
    };
}

/** 当前是否有活跃的按键分层 */
export function hasActiveKeyLayer(): boolean {
    return layerStack.length > 0;
}

/** 最近一次按键事件（调试用） */
export function getLastHardwareKeyEvent(): HardwareKeyEvent | null {
    return lastEvent;
}

/** 打开/关闭按键调试日志（输出到 console，可在 adb logcat 中过滤 [Keyboard]） */
export function setKeyboardDevLogging(enabled: boolean) {
    devLogging = enabled;
}

export function isKeyboardDevLoggingEnabled(): boolean {
    return devLogging;
}

/** 未消费的按键回退 —— 目前未使用，预留：供原生侧查询后决定是否放行 */
export function wasLastKeyConsumed(): boolean {
    return lastConsumed;
}

/** 常用键码的再导出，便于业务侧写可读判断 */
export { AndroidKeyCode };
export type { HardwareKeyEvent, SemanticKey };
