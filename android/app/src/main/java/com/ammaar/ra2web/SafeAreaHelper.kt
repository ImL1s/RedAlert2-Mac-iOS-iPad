package com.ammaar.ra2web

object SafeAreaHelper {
    fun calculateNormalizedInsets(
        topPx: Int,
        rightPx: Int,
        bottomPx: Int,
        leftPx: Int,
        density: Float
    ): InsetsDpi {
        val d = if (density <= 0f) 1f else density
        return InsetsDpi(
            top = topPx / d,
            right = rightPx / d,
            bottom = bottomPx / d,
            left = leftPx / d
        )
    }

    fun generateCssVariablesScript(insets: InsetsDpi): String {
        return """
            document.documentElement.style.setProperty('--safe-area-inset-top', '${insets.top}px');
            document.documentElement.style.setProperty('--safe-area-inset-right', '${insets.right}px');
            document.documentElement.style.setProperty('--safe-area-inset-bottom', '${insets.bottom}px');
            document.documentElement.style.setProperty('--safe-area-inset-left', '${insets.left}px');
        """.trimIndent()
    }
}

data class InsetsDpi(
    val top: Float,
    val right: Float,
    val bottom: Float,
    val left: Float
)
