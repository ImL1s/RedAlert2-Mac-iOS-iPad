package com.ammaar.ra2web

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.UriPermission
import android.net.TestUri
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.lang.reflect.Constructor

class SafResourcePackManagerTest {

    private lateinit var mockPrefs: FakeSharedPreferences
    private lateinit var mockContentResolver: FakeContentResolver
    private lateinit var testContext: FakeContext
    private lateinit var manager: SafResourcePackManager

    private class FakeSharedPreferences : SharedPreferences {
        val map = mutableMapOf<String, Any?>()

        override fun getAll(): Map<String, *> = map
        override fun getString(key: String, defValue: String?): String? = map[key] as? String ?: defValue
        @Suppress("UNCHECKED_CAST")
        override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = map[key] as? Set<String> ?: defValues
        override fun getInt(key: String, defValue: Int): Int = map[key] as? Int ?: defValue
        override fun getLong(key: String, defValue: Long): Long = map[key] as? Long ?: defValue
        override fun getFloat(key: String, defValue: Float): Float = map[key] as? Float ?: defValue
        override fun getBoolean(key: String, defValue: Boolean): Boolean = map[key] as? Boolean ?: defValue
        override fun contains(key: String): Boolean = map.containsKey(key)
        override fun edit(): SharedPreferences.Editor = FakeEditor(this)
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

        class FakeEditor(private val prefs: FakeSharedPreferences) : SharedPreferences.Editor {
            private val temp = mutableMapOf<String, Any?>()
            private var clearFlag = false

            override fun putString(key: String, value: String?): SharedPreferences.Editor {
                temp[key] = value
                return this
            }
            override fun putStringSet(key: String, values: Set<String>?): SharedPreferences.Editor = this
            override fun putInt(key: String, value: Int): SharedPreferences.Editor = this
            override fun putLong(key: String, value: Long): SharedPreferences.Editor = this
            override fun putFloat(key: String, value: Float): SharedPreferences.Editor = this
            override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor = this
            override fun remove(key: String): SharedPreferences.Editor {
                temp[key] = null
                return this
            }
            override fun clear(): SharedPreferences.Editor {
                clearFlag = true
                return this
            }
            override fun commit(): Boolean {
                apply()
                return true
            }
            override fun apply() {
                if (clearFlag) prefs.map.clear()
                for ((k, v) in temp) {
                    if (v == null) prefs.map.remove(k) else prefs.map[k] = v
                }
            }
        }
    }

    private class FakeContentResolver(context: Context) : ContentResolver(context) {
        val persistedList = mutableListOf<UriPermission>()
        var takePersistableCalled = false
        var releasePersistableCalled = false
        var throwSecurityExceptionOnTake = false

        override fun takePersistableUriPermission(uri: Uri, modeFlags: Int) {
            if (throwSecurityExceptionOnTake) {
                throw SecurityException("Permission denial")
            }
            takePersistableCalled = true
            val perm = createUriPermission(uri, modeFlags)
            if (perm != null) {
                persistedList.add(perm)
            }
        }

        override fun releasePersistableUriPermission(uri: Uri, modeFlags: Int) {
            releasePersistableCalled = true
            persistedList.removeAll { it.uri == uri }
        }

        override fun getPersistedUriPermissions(): List<UriPermission> {
            return persistedList
        }

        private fun createUriPermission(uri: Uri, modeFlags: Int): UriPermission? {
            return try {
                val ctor: Constructor<UriPermission> = UriPermission::class.java.getDeclaredConstructor(
                    Uri::class.java,
                    Int::class.javaPrimitiveType,
                    Long::class.javaPrimitiveType
                )
                ctor.isAccessible = true
                ctor.newInstance(uri, modeFlags, System.currentTimeMillis())
            } catch (e: Exception) {
                null
            }
        }
    }

    private class FakeContext : android.content.ContextWrapper(null) {
        val prefs = FakeSharedPreferences()
        val resolver = FakeContentResolver(this)

        override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = prefs
        override fun getContentResolver(): ContentResolver = resolver
        override fun getApplicationContext(): Context = this
        override fun getPackageName(): String = "com.ammaar.ra2web"
    }

    @Before
    fun setUp() {
        testContext = FakeContext()
        mockPrefs = testContext.prefs
        mockContentResolver = testContext.resolver
        manager = SafResourcePackManager(testContext, uriParser = { TestUri(it) })
    }

    @Test
    fun testPersistUriPermissionSuccess() {
        val testUri = TestUri("content://com.android.externalstorage.documents/tree/primary%3AResourcePack")
        val success = manager.persistUriPermission(testUri)

        assertTrue(success)
        assertTrue(mockContentResolver.takePersistableCalled)
        assertEquals(testUri.toString(), mockPrefs.getString(SafResourcePackManager.KEY_PERSISTED_URI, null))
    }

    @Test
    fun testPersistUriPermissionFailureOnSecurityException() {
        mockContentResolver.throwSecurityExceptionOnTake = true
        val testUri = TestUri("content://com.android.externalstorage.documents/tree/primary%3ADenied")
        val success = manager.persistUriPermission(testUri)

        assertFalse(success)
    }

    @Test
    fun testGetPersistedUriWhenNoneStored() {
        assertNull(manager.getPersistedUri())
        assertFalse(manager.hasPersistedUriPermission())
    }

    @Test
    fun testClearPersistedUri() {
        val testUri = TestUri("content://com.android.externalstorage.documents/tree/primary%3APack")
        manager.persistUriPermission(testUri)
        assertEquals(testUri.toString(), mockPrefs.getString(SafResourcePackManager.KEY_PERSISTED_URI, null))

        manager.clearPersistedUri()
        assertTrue(mockContentResolver.releasePersistableCalled)
        assertNull(mockPrefs.getString(SafResourcePackManager.KEY_PERSISTED_URI, null))
        assertFalse(manager.hasPersistedUriPermission())
    }

    @Test
    fun testCreateOpenDocumentTreeIntent() {
        val intent = manager.createOpenDocumentTreeIntent()
        assertNotNull(intent)
    }
}
