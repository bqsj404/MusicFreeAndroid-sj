package `fun`.upup.musicfree
import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager

import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactContext
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import `fun`.upup.musicfree.keyboard.KeyboardEventModule
import `fun`.upup.musicfree.keyboard.KeyboardKeyPolicy

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MusicFree"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

  // https://reactnavigation.org/docs/getting-started/#installing-dependencies-into-a-bare-react-native-project
  override fun onCreate(savedInstanceState: Bundle?) {
      SplashScreenManager.registerOnActivity(this)
      super.onCreate(null);
  }

  /**
   * 硬件按键入口：物理键盘 / TV 遥控器 / 游戏手柄都从这里进来。
   *
   * 命中 [KeyboardKeyPolicy] 的按键会被转发给 JS 的键盘体系（焦点移动 + 快捷键），
   * 返回 true 阻止系统再做一次默认焦点移动；其余按键（返回、音量、电源、输入法…）
   * 原样交给 super 处理。
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val keyCode = event.keyCode
    val editing = isEditingText()

    if (KeyboardEventModule.DEBUG) {
      Log.d(
        KeyboardEventModule.TAG,
        "dispatchKeyEvent keyCode=$keyCode enabled=${KeyboardEventModule.enabled} editing=$editing shouldHandle=${KeyboardKeyPolicy.shouldHandle(keyCode, editing)}"
      )
    }

    if (KeyboardEventModule.enabled &&
        KeyboardKeyPolicy.shouldHandle(keyCode, editing)
    ) {
      // React 未就绪时不拦截，交回系统做默认焦点移动
      currentReactContext()?.let { context ->
        val module = context.getNativeModule(KeyboardEventModule::class.java)
        if (module != null && module.dispatch(event)) {
          return true
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

  /** 当前焦点是否在文本输入框内（含 ReactEditText），用于避免吞掉输入法按键 */
  private fun isEditingText(): Boolean {
    return isDescendantOfEditText(currentFocus)
  }

  private fun isDescendantOfEditText(view: View?): Boolean {
    var current = view
    var depth = 0
    while (current != null && depth < 20) {
      if (current is EditText) {
        return true
      }
      val parent = current.parent
      current = if (parent is View) parent else null
      depth++
    }
    return false
  }

  private fun currentReactContext(): ReactContext? {
    val application = application as? ReactApplication ?: return null
    return application.reactNativeHost.reactInstanceManager.currentReactContext
  }
}
