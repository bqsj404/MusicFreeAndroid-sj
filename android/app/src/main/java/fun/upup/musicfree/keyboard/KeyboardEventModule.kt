package `fun`.upup.musicfree.keyboard

import android.util.Log
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerModule
import `fun`.upup.musicfree.BuildConfig

/**
 * 硬件按键桥。
 *
 * 由 MainActivity 在 dispatchKeyEvent 中把硬件按键事件转发到这里，
 * 再以 `hardwareKeyboardKey` 事件推给 JS。覆盖三类输入设备：
 *  - 物理键盘（字母/数字/功能键、方向键）
 *  - Android TV 遥控器（DPAD_UP/DOWN/LEFT/RIGHT/CENTER，与键盘方向键同键码）
 *  - 游戏手柄（DPAD / BUTTON_A/B/X/Y / L1/R1 / L2/R2 / START/SELECT / THUMBL/THUMBR）
 *
 * 拦截白名单见 [KeyboardKeyPolicy]：返回键、音量/电源等系统键原样放行，
 * 文本编辑态一律放行。
 */
@ReactModule(name = KeyboardEventModule.NAME)
class KeyboardEventModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        /** 模块名（必须与 `@ReactModule` 及 JS 侧 `NativeModules.KeyboardEvent` 一致） */
        const val NAME = "KeyboardEvent"

        const val EVENT_NAME = "hardwareKeyboardKey"

        /** 同一物理按键的事件间隔下限（毫秒），过滤极短时间的重复抖动 */
        private const val DUPLICATE_INTERVAL_MS = 5L

        /** 硬按键类型：普通按键（按下/抬起） */
        const val TYPE_KEY = "key"

        /** 硬按键类型：文本输入（来自 onKeyMultiple 的字符） */
        const val TYPE_TEXT = "text"

        /** 是否已由 JS 侧接管按键（MainActivity 拦截前会先判断） */
        @Volatile
        var enabled: Boolean = false

        /** 调试日志开关（`adb logcat -s MusicFreeKeyboard` 可观察按键链路） */
        @Volatile
        var DEBUG: Boolean = BuildConfig.DEBUG

        const val TAG = "MusicFreeKeyboard"
    }

    /** 记录上一次事件时间戳，用于过滤抖动 */
    private val lastEventTime = HashMap<Int, Long>()

    override fun getName(): String = NAME

    /**
     * 让 JS 侧可以直接同步读取的常量。
     *
     * `isEnabled` 由 JS 在焦点/快捷键体系就绪后置为 true；
     * 在此之前 MainActivity 不会拦截任何按键，方向键仍走系统默认焦点移动，
     * 避免「JS 挂着但没接管」时出现按键失灵。
     */
    override fun getConstants(): MutableMap<String, Any> {
        return mutableMapOf("isEnabled" to enabled)
    }

    @ReactMethod
    fun setEnabled(value: Boolean) {
        enabled = value
        if (DEBUG) {
            Log.d(TAG, "setEnabled=$value")
        }
    }

    /**
     * 让 JS 侧把调试信息写进 logcat。
     *
     * release bundle 下 Hermes 不会把 `console.log` 转发到 logcat，
     * 排查焦点/快捷键问题时用这个通道观察 JS 内部状态：
     * `adb logcat -s MusicFreeKeyboard`
     */
    @ReactMethod
    fun log(tag: String, message: String) {
        if (DEBUG || tag == "KeyboardLog") {
            Log.d(TAG, "[$tag] $message")
        }
    }

    /**
     * 按 reactTag 请求原生焦点（配合 JS 侧 `findNodeHandle` 使用）。
     *
     * RN 没有内置的 requestFocus 命令，而 `TouchableOpacity` 的 ref 是类实例、
     * 不含 `focus()`，因此焦点移动必须落到这个原生方法上。
     *
     * 注意：View 的焦点操作只能在创建视图层级的主线程上执行，
     * 因此这里统一 post 到 UI 线程（JS 侧不会同步等待结果）。
     */
    @ReactMethod
    fun requestFocus(reactTag: Double) {
        val tag = reactTag.toInt()
        reactContext.runOnUiQueueThread {
            try {
                val uiManager = reactContext.getNativeModule(UIManagerModule::class.java)
                val view = uiManager?.resolveView(tag)
                if (view == null) {
                    if (DEBUG) {
                        Log.d(TAG, "requestFocus tag=$tag view=null")
                    }
                    return@runOnUiQueueThread
                }
                if (!view.isFocusable) {
                    view.isFocusable = true
                }
                if (!view.isFocusableInTouchMode) {
                    view.isFocusableInTouchMode = true
                }
                val ok = view.requestFocus()
                if (DEBUG) {
                    Log.d(TAG, "requestFocus tag=$tag ok=$ok")
                }
            } catch (e: Exception) {
                if (DEBUG) {
                    Log.d(TAG, "requestFocus tag=$tag error=${e.message}")
                }
            }
        }
    }

    /**
     * 把 Android KeyEvent 转成 JS 事件。
     *
     * @param event 原始按键事件
     * @return 是否消费（true = 不再交给系统做默认焦点移动）
     */
    fun dispatch(event: KeyEvent): Boolean {
        val action = event.action
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) {
            return false
        }

        val keyCode = event.keyCode

        // 抖动过滤：仅对同一键码的连续 DOWN 生效
        if (action == KeyEvent.ACTION_DOWN) {
            val now = System.currentTimeMillis()
            val last = lastEventTime[keyCode] ?: 0L
            if (now - last < DUPLICATE_INTERVAL_MS && event.repeatCount == 0) {
                return false
            }
            lastEventTime[keyCode] = now
        }

        emitKey(keyCode, action, event.repeatCount, event.unicodeChar, event.isCtrlPressed, event.isAltPressed, event.isShiftPressed)
        if (DEBUG) {
            Log.d(TAG, "dispatch keyCode=$keyCode action=$action repeat=${event.repeatCount}")
        }
        return true
    }

    private fun emitKey(
        keyCode: Int,
        action: Int,
        repeatCount: Int,
        unicodeChar: Int,
        ctrl: Boolean,
        alt: Boolean,
        shift: Boolean,
    ) {
        if (!reactContext.hasActiveReactInstance()) {
            return
        }
        val payload = Arguments.createMap().apply {
            putString("type", TYPE_KEY)
            putInt("keyCode", keyCode)
            putInt("action", action)
            putInt("repeatCount", repeatCount)
            putInt("unicodeChar", unicodeChar)
            putBoolean("ctrl", ctrl)
            putBoolean("alt", alt)
            putBoolean("shift", shift)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
        }
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT_NAME, payload)
        } catch (e: Exception) {
            // JS 引擎正在销毁时忽略
        }
    }
}
