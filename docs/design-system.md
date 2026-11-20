# 原生设计系统

iPhone 单列 UIKit 导航栈；iPad 宽度驱动双栏（M2）；系统深浅色、安全区、Dynamic Type、最小 44pt 操作目标，正文可读优先。原生导航/系统菜单不重画为网页；M-1 用 Expo Router Stack 与 iOS ActionSheet 验证。

GlassView 来自 expo-glass-effect，使用原生 UIVisualEffectView。须同时检查 isLiquidGlassAvailable/isGlassEffectAPIAvailable；Reduce Transparency 使用清晰标注的实色表面，不用 CSS blur、半透明底或 WebView 冒充。变化监听系统辅助功能；控件有 label/role/state，文本不封顶字体缩放。

M-1 页面明确“离线技术验证”，不把合成会话画成已连接电脑。检查 iPhone/iPad、深浅色、实际输入/滑动/返回/系统菜单，以及大字/低透明度截图。截图与模拟器 native view hierarchy 一起保存，单凭 availability 文案不证明原生渲染。

参考 Apple HIG https://developer.apple.com/design/human-interface-guidelines/ 和 Expo GlassEffect 官方文档；T3 仅借鉴结构，未复用其自定义 screens fork 或私有组件。
